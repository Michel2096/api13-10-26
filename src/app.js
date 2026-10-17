import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const TIPOS = ['grafito', 'color', 'mecanico', 'carboncillo', 'acuarelable'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ahora = () => new Date().toISOString();

function texto(valor, campo, { requerido = false, max = 60 } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (requerido) throw new HttpError(400, `El campo "${campo}" es obligatorio`);
    return null;
  }
  if (typeof valor !== 'string') throw new HttpError(400, `"${campo}" debe ser texto`);
  const limpio = valor.trim();
  if (requerido && !limpio) throw new HttpError(400, `El campo "${campo}" es obligatorio`);
  if (limpio.length > max) throw new HttpError(400, `"${campo}" admite máximo ${max} caracteres`);
  return limpio || null;
}

function entero(valor, campo, { min = 0, defecto = 0 } = {}) {
  if (valor === undefined || valor === null || valor === '') return defecto;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min) throw new HttpError(400, `"${campo}" debe ser un entero >= ${min}`);
  return n;
}

function decimal(valor, campo) {
  if (valor === undefined || valor === null || valor === '') return 0;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `"${campo}" debe ser un número >= 0`);
  return Math.round(n * 100) / 100;
}

function uuid(valor, campo = 'id') {
  if (typeof valor !== 'string' || !UUID_RE.test(valor)) throw new HttpError(400, `"${campo}" debe ser un UUID válido`);
  return valor.toLowerCase();
}

function fecha(valor) {
  const d = valor ? new Date(valor) : new Date();
  return Number.isNaN(d.getTime()) ? ahora() : d.toISOString();
}

/** Valida y normaliza los datos descriptivos de un lápiz (server-side). */
function validarLapiz(body) {
  const tipo = texto(body.tipo, 'tipo', { requerido: true });
  if (!TIPOS.includes(tipo)) throw new HttpError(400, `"tipo" debe ser uno de: ${TIPOS.join(', ')}`);
  return {
    marca: texto(body.marca, 'marca', { requerido: true }),
    modelo: texto(body.modelo, 'modelo', { requerido: true }),
    tipo,
    dureza: texto(body.dureza, 'dureza', { max: 10 }),
    color: texto(body.color, 'color', { max: 30 }),
    stock_minimo: entero(body.stock_minimo, 'stock_minimo'),
    precio: decimal(body.precio, 'precio'),
  };
}

export function createApp(db, { staticDir } = {}) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  // CORS abierto: permite consumir la API desde el servidor de desarrollo de Vite u otro host.
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const q = {
    listar: db.prepare('SELECT * FROM lapices ORDER BY marca, modelo'),
    obtener: db.prepare('SELECT * FROM lapices WHERE id = ?'),
    insertar: db.prepare(`
      INSERT INTO lapices (id, marca, modelo, tipo, dureza, color, cantidad, stock_minimo, precio, creado_en, actualizado_en)
      VALUES (:id, :marca, :modelo, :tipo, :dureza, :color, :cantidad, :stock_minimo, :precio, :creado_en, :actualizado_en)
      ON CONFLICT(id) DO NOTHING`),
    actualizar: db.prepare(`
      UPDATE lapices SET marca = :marca, modelo = :modelo, tipo = :tipo, dureza = :dureza, color = :color,
        stock_minimo = :stock_minimo, precio = :precio, actualizado_en = :actualizado_en
      WHERE id = :id`),
    eliminar: db.prepare('DELETE FROM lapices WHERE id = ?'),
    movimiento: db.prepare('SELECT * FROM movimientos WHERE id = ?'),
    insertarMov: db.prepare(`
      INSERT INTO movimientos (id, lapiz_id, tipo, cantidad, nota, creado_en, recibido_en)
      VALUES (:id, :lapiz_id, :tipo, :cantidad, :nota, :creado_en, :recibido_en)`),
    ajustarStock: db.prepare('UPDATE lapices SET cantidad = cantidad + :delta, actualizado_en = :ahora WHERE id = :id'),
    listarMov: db.prepare(`
      SELECT m.*, l.marca, l.modelo FROM movimientos m JOIN lapices l ON l.id = m.lapiz_id
      ORDER BY m.creado_en DESC LIMIT ?`),
    totales: db.prepare(`
      SELECT COUNT(*) AS referencias,
             COALESCE(SUM(cantidad), 0) AS unidades,
             COALESCE(ROUND(SUM(cantidad * precio), 2), 0) AS valor_total,
             COALESCE(SUM(CASE WHEN cantidad <= stock_minimo THEN 1 ELSE 0 END), 0) AS bajo_stock
      FROM lapices`),
    porTipo: db.prepare(`
      SELECT tipo, COUNT(*) AS referencias, SUM(cantidad) AS unidades
      FROM lapices GROUP BY tipo ORDER BY unidades DESC`),
    movimientosHoy: db.prepare(`
      SELECT tipo, COALESCE(SUM(cantidad), 0) AS unidades FROM movimientos
      WHERE substr(recibido_en, 1, 10) = substr(?, 1, 10) GROUP BY tipo`),
  };

  const transaccion = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };

  const api = express.Router();

  api.get('/health', (_req, res) => res.json({ ok: true, hora: ahora() }));

  api.get('/lapices', (_req, res) => res.json(q.listar.all()));

  api.get('/lapices/:id', (req, res) => {
    const lapiz = q.obtener.get(uuid(req.params.id));
    if (!lapiz) throw new HttpError(404, 'Lápiz no encontrado');
    res.json(lapiz);
  });

  // Alta idempotente: el id lo genera el cliente; si llega dos veces (reintento) no se duplica.
  api.post('/lapices', (req, res) => {
    const id = uuid(req.body?.id);
    const datos = {
      id,
      ...validarLapiz(req.body),
      cantidad: entero(req.body.cantidad, 'cantidad'),
      creado_en: fecha(req.body.creado_en),
      actualizado_en: ahora(),
    };
    const { changes } = q.insertar.run(datos);
    res.status(changes ? 201 : 200).json({ ...q.obtener.get(id), duplicado: changes === 0 });
  });

  api.put('/lapices/:id', (req, res) => {
    const id = uuid(req.params.id);
    const { changes } = q.actualizar.run({ id, ...validarLapiz(req.body ?? {}), actualizado_en: ahora() });
    if (!changes) throw new HttpError(404, 'Lápiz no encontrado');
    res.json(q.obtener.get(id));
  });

  // Borrado idempotente: borrar algo que ya no existe también es un éxito.
  api.delete('/lapices/:id', (req, res) => {
    q.eliminar.run(uuid(req.params.id));
    res.sendStatus(204);
  });

  api.get('/movimientos', (req, res) => {
    const limite = Math.min(entero(req.query.limite, 'limite', { min: 1, defecto: 50 }), 500);
    res.json(q.listarMov.all(limite));
  });

  // Entradas/salidas de stock. El servidor es la autoridad: recalcula el stock y
  // rechaza salidas que dejarían el inventario en negativo.
  api.post('/movimientos', (req, res) => {
    const body = req.body ?? {};
    const id = uuid(body.id);
    const lapiz_id = uuid(body.lapiz_id, 'lapiz_id');
    const tipo = body.tipo;
    if (tipo !== 'entrada' && tipo !== 'salida') throw new HttpError(400, '"tipo" debe ser entrada o salida');
    const cantidad = entero(body.cantidad, 'cantidad', { min: 1, defecto: NaN });
    if (Number.isNaN(cantidad)) throw new HttpError(400, '"cantidad" es obligatoria');
    const nota = texto(body.nota, 'nota', { max: 120 });

    const resultado = transaccion(() => {
      const existente = q.movimiento.get(id);
      if (existente) return { status: 200, movimiento: existente, duplicado: true };

      const lapiz = q.obtener.get(lapiz_id);
      if (!lapiz) throw new HttpError(404, 'El lápiz del movimiento no existe');
      const delta = tipo === 'entrada' ? cantidad : -cantidad;
      if (lapiz.cantidad + delta < 0) {
        throw new HttpError(409, `Stock insuficiente: hay ${lapiz.cantidad} y se intentan sacar ${cantidad}`);
      }
      const recibido_en = ahora();
      q.insertarMov.run({ id, lapiz_id, tipo, cantidad, nota, creado_en: fecha(body.creado_en), recibido_en });
      q.ajustarStock.run({ id: lapiz_id, delta, ahora: recibido_en });
      return { status: 201, movimiento: q.movimiento.get(id), duplicado: false };
    });

    res.status(resultado.status).json({
      ...resultado.movimiento,
      duplicado: resultado.duplicado,
      lapiz: q.obtener.get(lapiz_id),
    });
  });

  // Métricas calculadas en el servidor con SQL.
  api.get('/resumen', (_req, res) => {
    res.json({
      ...q.totales.get(),
      por_tipo: q.porTipo.all(),
      movimientos_hoy: q.movimientosHoy.all(ahora()),
      generado_en: ahora(),
    });
  });

  api.use(() => {
    throw new HttpError(404, 'Ruta no encontrada');
  });

  app.use('/api', api);

  // En producción la misma API sirve el build del front (una sola URL para la PWA).
  if (staticDir && existsSync(staticDir)) {
    app.use(
      express.static(staticDir, {
        setHeaders(res, path) {
          if (/(sw\.js|\.html|\.webmanifest)$/.test(path)) res.set('Cache-Control', 'no-cache');
        },
      }),
    );
    app.get('/{*ruta}', (_req, res) => res.sendFile(join(staticDir, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    const status = err.status ?? (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : err.message });
  });

  return app;
}
