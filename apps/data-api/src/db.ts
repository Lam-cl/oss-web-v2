import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

export function createPool(connectionString: string) {
  return new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000 });
}

export async function migrate(pool: pg.Pool) {
  const directory=path.resolve(import.meta.dirname,'..','migrations');
  await pool.query(`CREATE TABLE IF NOT EXISTS data_api_migrations(name text PRIMARY KEY,sha256 char(64) NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`);
  for(const name of (await readdir(directory)).filter(item=>/^\d+_[a-z0-9_-]+\.sql$/.test(item)).sort()){
    const body=await readFile(path.join(directory,name),'utf8'),sha256=createHash('sha256').update(body).digest('hex');
    const prior=(await pool.query('SELECT sha256 FROM data_api_migrations WHERE name=$1',[name])).rows[0];
    if(prior){if(prior.sha256!==sha256)throw new Error(`Applied migration changed: ${name}`);continue;}
    await pool.query(body);await pool.query('INSERT INTO data_api_migrations(name,sha256)VALUES($1,$2)',[name,sha256]);
  }
}
