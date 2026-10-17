import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

let server;
let base;

before(async () => {
  const app = createApp(openDb(':memory:'));
  await new Promise((ok) => {
    server = app.listen(0, ok);
  });
  base = `http://localhost:${server.address().port}/api`;
});

after(() => server.close());

const enviar = (metodo, ruta, body) =>
  fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });

const nuevoLapiz = (extra = {}) => ({
  id: randomUUID(),
  marca: 'Faber-Castell',
  modelo: 'Grip 2001',
  tipo: 'grafito',
  dureza: 'HB',
  cantidad: 10,
  stock_minimo: 5,
  precio: 0.95,
  ...extra,
});

test('health responde ok', async () => {
  const r = await fetch(`${base}/health`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('crear lápiz y listarlo', async () => {
  const lapiz = nuevoLapiz();
  const r = await enviar('POST', '/lapices', lapiz);
  assert.equal(r.status, 201);
  const lista = await (await fetch(`${base}/lapices`)).json();
  assert.ok(lista.some((l) => l.id === lapiz.id));
});

test('reenviar el mismo lápiz (reintento de sync) NO lo duplica', async () => {
  const lapiz = nuevoLapiz({ modelo: 'Reintento' });
  const r1 = await enviar('POST', '/lapices', lapiz);
  const r2 = await enviar('POST', '/lapices', lapiz);
  const r3 = await enviar('POST', '/lapices', lapiz);
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 200);
  assert.equal((await r3.json()).duplicado, true);
  const lista = await (await fetch(`${base}/lapices`)).json();
  assert.equal(lista.filter((l) => l.id === lapiz.id).length, 1);
});

test('reenviar el mismo movimiento NO altera el stock dos veces', async () => {
  const lapiz = nuevoLapiz({ cantidad: 10 });
  await enviar('POST', '/lapices', lapiz);
  const mov = { id: randomUUID(), lapiz_id: lapiz.id, tipo: 'salida', cantidad: 4 };
  const r1 = await enviar('POST', '/movimientos', mov);
  const r2 = await enviar('POST', '/movimientos', mov);
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 200);
  const final = await (await fetch(`${base}/lapices/${lapiz.id}`)).json();
  assert.equal(final.cantidad, 6);
});

test('salida mayor al stock es rechazada con 409', async () => {
  const lapiz = nuevoLapiz({ cantidad: 2 });
  await enviar('POST', '/lapices', lapiz);
  const r = await enviar('POST', '/movimientos', { id: randomUUID(), lapiz_id: lapiz.id, tipo: 'salida', cantidad: 5 });
  assert.equal(r.status, 409);
  const final = await (await fetch(`${base}/lapices/${lapiz.id}`)).json();
  assert.equal(final.cantidad, 2);
});

test('validaciones del servidor', async () => {
  assert.equal((await enviar('POST', '/lapices', nuevoLapiz({ marca: '' }))).status, 400);
  assert.equal((await enviar('POST', '/lapices', nuevoLapiz({ tipo: 'boligrafo' }))).status, 400);
  assert.equal((await enviar('POST', '/lapices', nuevoLapiz({ id: 'no-es-uuid' }))).status, 400);
  assert.equal((await enviar('POST', '/lapices', nuevoLapiz({ cantidad: -3 }))).status, 400);
});

test('editar y eliminar (eliminar es idempotente)', async () => {
  const lapiz = nuevoLapiz();
  await enviar('POST', '/lapices', lapiz);
  const r = await enviar('PUT', `/lapices/${lapiz.id}`, { ...lapiz, modelo: 'Editado' });
  assert.equal((await r.json()).modelo, 'Editado');
  assert.equal((await enviar('DELETE', `/lapices/${lapiz.id}`)).status, 204);
  assert.equal((await enviar('DELETE', `/lapices/${lapiz.id}`)).status, 204);
  assert.equal((await fetch(`${base}/lapices/${lapiz.id}`)).status, 404);
});

test('resumen calculado en el servidor', async () => {
  const r = await (await fetch(`${base}/resumen`)).json();
  assert.equal(typeof r.unidades, 'number');
  assert.equal(typeof r.valor_total, 'number');
  assert.ok(Array.isArray(r.por_tipo));
});
