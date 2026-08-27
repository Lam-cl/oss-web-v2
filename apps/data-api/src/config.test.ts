import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig } from './config.js';

const names = ['DATA_API_SERVICE_TOKEN','DATABASE_URL','PUBLIC_MEDIA_BASE_URL','MINIO_ENDPOINT','MINIO_ACCESS_KEY','MINIO_SECRET_KEY','SESSION_ENCRYPTION_KEY','TURNSTILE_SECRET_KEY'] as const;
test('configuration rejects weak service credentials and normalizes endpoints', () => {
  const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {DATABASE_URL:'postgresql://local/test',PUBLIC_MEDIA_BASE_URL:'https://media.test/',MINIO_ENDPOINT:'127.0.0.1',MINIO_ACCESS_KEY:'access',MINIO_SECRET_KEY:'secret',TURNSTILE_SECRET_KEY:'turnstile-secret'});
  process.env.DATA_API_SERVICE_TOKEN='short';assert.throws(()=>readConfig(),/at least 32 bytes/);
  process.env.DATA_API_SERVICE_TOKEN='x'.repeat(32);process.env.SESSION_ENCRYPTION_KEY='a'.repeat(64);const config=readConfig();assert.equal(config.publicMediaBaseUrl,'https://media.test');assert.equal(config.minio.port,9000);
  for(const name of names)prior[name]===undefined?delete process.env[name]:process.env[name]=prior[name];
});
