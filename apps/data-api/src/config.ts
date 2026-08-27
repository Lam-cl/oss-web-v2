const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const integer = (name: string, fallback: number) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 65535) throw new Error(`${name} is invalid.`);
  return value;
};

export type DataApiConfig = ReturnType<typeof readConfig>;

export function readConfig() {
  const serviceToken = required('DATA_API_SERVICE_TOKEN');
  if (Buffer.byteLength(serviceToken) < 32) throw new Error('DATA_API_SERVICE_TOKEN must be at least 32 bytes.');
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: integer('PORT', 3010),
    databaseUrl: required('DATABASE_URL'),
    serviceToken,
    turnstileSecretKey: required('TURNSTILE_SECRET_KEY'),
    sessionEncryptionKey: required('SESSION_ENCRYPTION_KEY'),
    corsOrigins: new Set((process.env.CORS_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean)),
    publicMediaBaseUrl: required('PUBLIC_MEDIA_BASE_URL').replace(/\/$/, ''),
    minio: {
      endPoint: required('MINIO_ENDPOINT'),
      port: integer('MINIO_PORT', 9000),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: required('MINIO_ACCESS_KEY'),
      secretKey: required('MINIO_SECRET_KEY'),
      draftBucket: process.env.MINIO_DRAFT_BUCKET || 'tonewow-draft',
      publicBucket: process.env.MINIO_PUBLIC_BUCKET || 'tonewow-published',
    },
  };
}
