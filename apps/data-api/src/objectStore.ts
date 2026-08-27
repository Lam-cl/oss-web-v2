import { createHash } from 'node:crypto';
import { Client } from 'minio';
import type { DataApiConfig } from './config.js';

export type ObjectStore = ReturnType<typeof createObjectStore>;

export function createObjectStore(config: DataApiConfig['minio']) {
  const client = new Client({
    endPoint: config.endPoint,
    port: config.port,
    useSSL: config.useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
  });
  const ensureBuckets = async () => {
    for (const bucket of [config.draftBucket, config.publicBucket]) {
      if (!await client.bucketExists(bucket)) await client.makeBucket(bucket);
    }
  };
  const put = async (visibility: 'draft' | 'published', catalogueId: string, body: Buffer, contentType: string) => {
    const sha256 = createHash('sha256').update(body).digest('hex');
    const objectKey = `${catalogueId}/${sha256}`;
    const bucket = visibility === 'published' ? config.publicBucket : config.draftBucket;
    await client.putObject(bucket, objectKey, body, body.length, { 'Content-Type': contentType, 'X-Amz-Meta-Sha256': sha256 });
    return { bucket, objectKey, sha256 };
  };
  const read = async (visibility: 'draft' | 'published', objectKey: string) => {
    const bucket = visibility === 'published' ? config.publicBucket : config.draftBucket;
    const stream = await client.getObject(bucket, objectKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  };
  const remove = async (visibility: 'draft' | 'published', objectKey: string) => {
    const bucket = visibility === 'published' ? config.publicBucket : config.draftBucket;
    await client.removeObject(bucket, objectKey);
  };
  return { client, ensureBuckets, put, read, remove, config };
}
