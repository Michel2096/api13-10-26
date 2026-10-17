import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Abre (o crea) la base SQLite y aplica el esquema.
 * Se usa el módulo nativo `node:sqlite`, así que no hace falta instalar drivers.
 */
export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS lapices (
      id           TEXT PRIMARY KEY,           -- UUID generado en el cliente
      marca        TEXT NOT NULL,
      modelo       TEXT NOT NULL,
      tipo         TEXT NOT NULL,              -- grafito | color | mecanico | carboncillo | acuarelable
      dureza       TEXT,                       -- HB, 2B, 4H...
      color        TEXT,
      cantidad     INTEGER NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
      stock_minimo INTEGER NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
      precio       REAL NOT NULL DEFAULT 0 CHECK (precio >= 0),
      creado_en    TEXT NOT NULL,              -- fecha del cliente (puede ser offline)
      actualizado_en TEXT NOT NULL             -- fecha del servidor
    );

    CREATE TABLE IF NOT EXISTS movimientos (
      id        TEXT PRIMARY KEY,              -- UUID del cliente => idempotencia
      lapiz_id  TEXT NOT NULL REFERENCES lapices(id) ON DELETE CASCADE,
      tipo      TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida')),
      cantidad  INTEGER NOT NULL CHECK (cantidad > 0),
      nota      TEXT,
      creado_en TEXT NOT NULL,
      recibido_en TEXT NOT NULL
    );
  `);
  return db;
}
