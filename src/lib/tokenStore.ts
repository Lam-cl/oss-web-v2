import { randomBytes } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

type StoredToken<T> = {
  expiresAt: number;
  payload: T;
};

const DEFAULT_STORE_DIR = path.join(process.cwd(), '.token-store');
const TOKEN_KEY_PREFIX = 'tonewow:token';

type KvConfig = {
  url: string;
  token: string;
};

function getStoreDir(type: string) {
  return path.join(process.env.TOKEN_STORE_DIR || DEFAULT_STORE_DIR, type);
}

function getKvConfig(): KvConfig | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ''), token };
}

function assertDurableStoreAvailable() {
  if (process.env.VERCEL) {
    throw new Error('KV/Upstash token storage is required on Vercel');
  }
}

function getKvKey(type: string, id: string) {
  return `${TOKEN_KEY_PREFIX}:${type}:${id}`;
}

function createSlug() {
  return randomBytes(8).toString('base64url');
}

async function runKvCommand<T>(config: KvConfig, command: unknown[]): Promise<T> {
  const res = await fetch(config.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  const data = await res.json().catch(() => null) as { result?: T; error?: string } | null;
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `KV command failed: ${res.status}`);
  }
  return data?.result as T;
}

export async function createTokenRecord<T>(type: string, payload: T, ttlSeconds: number) {
  const id = createSlug();
  const record: StoredToken<T> = {
    expiresAt: Date.now() + ttlSeconds * 1000,
    payload,
  };

  const kv = getKvConfig();
  if (kv) {
    await runKvCommand(kv, ['SET', getKvKey(type, id), JSON.stringify(record), 'EX', ttlSeconds]);
    return id;
  }

  assertDurableStoreAvailable();

  const dir = getStoreDir(type);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${id}.json`), JSON.stringify(record), 'utf8');

  return id;
}

export async function readTokenRecord<T>(type: string, id: string) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return null;

  const kv = getKvConfig();
  if (kv) {
    try {
      const raw = await runKvCommand<string | null>(kv, ['GET', getKvKey(type, id)]);
      if (!raw) return null;
      const record = JSON.parse(raw) as StoredToken<T>;
      if (!record?.payload || record.expiresAt < Date.now()) return null;
      return record.payload;
    } catch {
      return null;
    }
  }

  assertDurableStoreAvailable();

  try {
    const raw = await readFile(path.join(getStoreDir(type), `${id}.json`), 'utf8');
    const record = JSON.parse(raw) as StoredToken<T>;
    if (!record?.payload || record.expiresAt < Date.now()) return null;
    return record.payload;
  } catch {
    return null;
  }
}
