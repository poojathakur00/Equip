import { pool } from "./db.js";

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS device_groups (
      id             SERIAL PRIMARY KEY,
      manufacturer   TEXT NOT NULL,
      model          TEXT NOT NULL,
      device_type    TEXT,
      serial_format  TEXT,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (manufacturer, model)
    );

    CREATE TABLE IF NOT EXISTS serial_cache (
      id                 SERIAL PRIMARY KEY,
      manufacturer       TEXT NOT NULL,
      model              TEXT NOT NULL,
      serial_number      TEXT NOT NULL,
      manufactured_date  TEXT,
      confidence         TEXT,
      created_at         TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (manufacturer, model, serial_number)
    );
  `);
}
