import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { sembrar } from './seed.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || join(raiz, 'data', 'inventario.db');

const db = openDb(DB_FILE);
sembrar(db);

const app = createApp(db, { staticDir: join(raiz, '..', 'front', 'dist') });
app.listen(PORT, () => {
  console.log(`LapiStock API escuchando en http://localhost:${PORT}  (BD: ${DB_FILE})`);
});
