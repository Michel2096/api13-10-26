import { randomUUID } from 'node:crypto';

const EJEMPLOS = [
  { marca: 'Faber-Castell', modelo: 'Castell 9000', tipo: 'grafito', dureza: 'HB', color: null, cantidad: 48, stock_minimo: 20, precio: 1.2 },
  { marca: 'Staedtler', modelo: 'Mars Lumograph', tipo: 'grafito', dureza: '2B', color: null, cantidad: 12, stock_minimo: 15, precio: 1.5 },
  { marca: 'Prismacolor', modelo: 'Premier', tipo: 'color', dureza: null, color: 'Rojo carmín', cantidad: 30, stock_minimo: 10, precio: 2.1 },
  { marca: 'Pentel', modelo: 'GraphGear 500', tipo: 'mecanico', dureza: 'HB', color: null, cantidad: 6, stock_minimo: 5, precio: 7.9 },
  { marca: "General's", modelo: 'Charcoal', tipo: 'carboncillo', dureza: '4B', color: null, cantidad: 3, stock_minimo: 8, precio: 2.4 },
];

/** Inserta datos de ejemplo solo si la tabla está vacía. */
export function sembrar(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM lapices').get();
  if (n > 0) return;
  const stmt = db.prepare(`
    INSERT INTO lapices (id, marca, modelo, tipo, dureza, color, cantidad, stock_minimo, precio, creado_en, actualizado_en)
    VALUES (:id, :marca, :modelo, :tipo, :dureza, :color, :cantidad, :stock_minimo, :precio, :fecha, :fecha)`);
  const fecha = new Date().toISOString();
  for (const l of EJEMPLOS) stmt.run({ id: randomUUID(), ...l, fecha });
}
