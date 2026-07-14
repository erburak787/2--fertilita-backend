import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../env';
import { ApiError } from '../utils/errors';

// R2 is an S3-compatible endpoint. Same signing, EU-only buckets, zero egress.
// Env-driven — service is a no-op when R2_* vars are absent (dev without R2).

let cachedClient: S3Client | null = null;

function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new ApiError({ code: 'INTERNAL_SERVER_ERROR', message: 'object_storage_not_configured' });
  }
  cachedClient = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
  return cachedClient;
}

function bucket(): string {
  if (!env.R2_BUCKET) {
    throw new ApiError({ code: 'INTERNAL_SERVER_ERROR', message: 'object_storage_not_configured' });
  }
  return env.R2_BUCKET;
}

export interface PresignedUpload {
  uploadUrl: string;
  storageKey: string;
}

export async function presignUpload(params: {
  userId: string;
  documentId: string;
  mimeType: string;
  fileSize: number;
}): Promise<PresignedUpload> {
  const storageKey = `users/${params.userId}/documents/${params.documentId}`;
  const command = new PutObjectCommand({
    Bucket: bucket(),
    Key: storageKey,
    ContentType: params.mimeType,
    ContentLength: params.fileSize,
  });
  const uploadUrl = await getSignedUrl(getClient(), command, { expiresIn: 600 });
  return { uploadUrl, storageKey };
}

export async function presignDownload(storageKey: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket(), Key: storageKey });
  return getSignedUrl(getClient(), command, { expiresIn: 300 });
}

export interface HeadResult {
  contentLength?: number;
  contentType?: string;
  exists: boolean;
}

export async function headObject(storageKey: string): Promise<HeadResult> {
  try {
    const res = await getClient().send(new HeadObjectCommand({ Bucket: bucket(), Key: storageKey }));
    return { contentLength: res.ContentLength, contentType: res.ContentType, exists: true };
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') {
      return { exists: false };
    }
    throw err;
  }
}

export async function deleteObject(storageKey: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: storageKey }));
}
