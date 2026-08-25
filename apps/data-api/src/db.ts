import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

export function createPool(connectionString: string) {
  return new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000 });
}

export async function migrate(pool: pg.Pool) {
  const file = path.resolve(import.meta.dirname, '..', 'migrations', '001_initial.sql');
  await pool.query(await readFile(file, 'utf8'));
}
