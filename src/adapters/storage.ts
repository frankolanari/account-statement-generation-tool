import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ArtifactStore } from '../domain/ports.js';
export function createStorage() {
  const bucket = process.env.STATEMENTS_BUCKET?.trim();
  if (!bucket) throw new Error('STATEMENTS_BUCKET is required');
  const client = new S3Client({ region: process.env.AWS_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined, forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true' });
  const store: ArtifactStore = { async put(key, bytes, contentType) {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType,
      CacheControl: 'private, no-store', ContentDisposition: 'inline; filename="account_statement.pdf"' }));
  } };
  return { store, async read(key: string) {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) throw new Error('Stored PDF is missing');
    return response.Body.transformToByteArray();
  }, async signedDownload(key: string) {
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 300 });
  } };
}

// A bucket is the explicit opt-in. AWS credentials or an endpoint alone do not enable storage.
export function createOptionalStorage() {
  return process.env.STATEMENTS_BUCKET?.trim() ? createStorage() : undefined;
}
