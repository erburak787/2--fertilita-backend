import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { protectedRoute } from '../middleware/auth.middleware';
import { ApiError } from '../utils/errors';
import { t } from '../utils/i18n';
import { getCollections } from '../db/collections';
import { generateId } from '../utils/id';
import { getNow } from '../utils/date';
import {
  requestUploadUrlSchema,
  finalizeUploadSchema,
  updateDocumentSchema,
  listDocumentsQuerySchema,
  type Document,
} from '../schemas/document.schema';
import {
  presignUpload,
  presignDownload,
  headObject,
  deleteObject,
} from '../services/objectStorage.service';
import { classifyDocument } from '../utils/documentClassifier';
import type { AuthVariables } from '../types/context';

const documents = new Hono<{ Variables: AuthVariables }>();
documents.use('/*', protectedRoute());

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[documents]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

async function withDownloadUrl(doc: Document) {
  if (doc.status !== 'ready') return { ...doc, downloadUrl: null };
  try {
    const downloadUrl = await presignDownload(doc.storageKey);
    return { ...doc, downloadUrl };
  } catch {
    return { ...doc, downloadUrl: null };
  }
}

documents.post('/upload-url', zValidator('json', requestUploadUrlSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const body = c.req.valid('json');
    const now = getNow();
    const documentId = generateId();

    const { uploadUrl, storageKey } = await presignUpload({
      userId,
      documentId,
      mimeType: body.mimeType,
      fileSize: body.fileSize,
    });

    const classification = classifyDocument(body.filename);
    const doc: Document = {
      _id: documentId,
      userId,
      attemptId: body.attemptId,
      storageKey,
      filename: body.filename,
      title: classification.suggestedTitle,
      category: body.category ?? classification.suggestedCategory,
      mimeType: body.mimeType,
      fileSize: body.fileSize,
      status: 'pending',
      autoClassification: classification,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await getCollections().documents.insertOne(doc);

    return c.json({ documentId, uploadUrl, storageKey, document: doc }, 201);
  } catch (err) { return handle(err, c); }
});

documents.post(
  '/:id/finalize',
  zValidator('param', z.object({ id: z.string() })),
  zValidator('json', finalizeUploadSchema),
  async (c) => {
    try {
      const userId = c.get('userId');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const collections = getCollections();

      const doc = await collections.documents.findOne({
        _id: id,
        userId,
        deletedAt: { $in: [null, undefined] } as any,
      });
      if (!doc) throw new ApiError({ code: 'NOT_FOUND', message: t(c, 'error_not_found') });

      const head = await headObject(doc.storageKey);
      if (!head.exists) {
        await collections.documents.updateOne(
          { _id: id },
          { $set: { status: 'failed', updatedAt: getNow() } }
        );
        throw new ApiError({ code: 'BAD_REQUEST', message: 'upload_not_found' });
      }
      if (head.contentLength && head.contentLength !== doc.fileSize) {
        throw new ApiError({ code: 'BAD_REQUEST', message: 'file_size_mismatch' });
      }

      const now = getNow();
      const update: Partial<Document> = { status: 'ready', updatedAt: now };
      if (body.checksum) update.checksum = body.checksum;

      await collections.documents.updateOne({ _id: id }, { $set: update });
      const updated = await collections.documents.findOne({ _id: id });
      return c.json({ document: updated });
    } catch (err) { return handle(err, c); }
  }
);

documents.get('/', zValidator('query', listDocumentsQuerySchema), async (c) => {
  try {
    const userId = c.get('userId');
    const { page, limit, category, attemptId } = c.req.valid('query');
    const filter: Record<string, unknown> = {
      userId,
      deletedAt: { $in: [null, undefined] } as any,
    };
    if (category) filter.category = category;
    if (attemptId) filter.attemptId = attemptId;

    const [rows, total] = await Promise.all([
      getCollections().documents
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      getCollections().documents.countDocuments(filter),
    ]);
    const items = await Promise.all(rows.map(withDownloadUrl));
    return c.json({ items, total, page, limit });
  } catch (err) { return handle(err, c); }
});

documents.get('/:id', zValidator('param', z.object({ id: z.string() })), async (c) => {
  try {
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const doc = await getCollections().documents.findOne({
      _id: id,
      userId,
      deletedAt: { $in: [null, undefined] } as any,
    });
    if (!doc) throw new ApiError({ code: 'NOT_FOUND', message: t(c, 'error_not_found') });
    return c.json({ document: await withDownloadUrl(doc) });
  } catch (err) { return handle(err, c); }
});

documents.put(
  '/:id',
  zValidator('param', z.object({ id: z.string() })),
  zValidator('json', updateDocumentSchema),
  async (c) => {
    try {
      const userId = c.get('userId');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const patch: Record<string, unknown> = { updatedAt: getNow() };
      const unset: Record<string, ''> = {};
      for (const [k, v] of Object.entries(body)) {
        if (v === null) unset[k] = '';
        else if (v !== undefined) patch[k] = v;
      }
      const op: Record<string, unknown> = { $set: patch };
      if (Object.keys(unset).length) op.$unset = unset;

      const result = await getCollections().documents.findOneAndUpdate(
        { _id: id, userId, deletedAt: { $in: [null, undefined] } as any },
        op,
        { returnDocument: 'after' }
      );
      if (!result) throw new ApiError({ code: 'NOT_FOUND', message: t(c, 'error_not_found') });
      return c.json({ document: await withDownloadUrl(result) });
    } catch (err) { return handle(err, c); }
  }
);

documents.delete('/:id', zValidator('param', z.object({ id: z.string() })), async (c) => {
  try {
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const collections = getCollections();

    const doc = await collections.documents.findOne({
      _id: id,
      userId,
      deletedAt: { $in: [null, undefined] } as any,
    });
    if (!doc) throw new ApiError({ code: 'NOT_FOUND', message: t(c, 'error_not_found') });

    // Immediate R2 delete — do not wait for the 7d soft-delete TTL to expire.
    // The soft-delete row is retained only so restore-from-audit remains possible.
    try {
      await deleteObject(doc.storageKey);
    } catch (err) {
      console.error('[documents] failed to delete R2 object', doc.storageKey, err);
    }

    await collections.documents.updateOne({ _id: id }, { $set: { deletedAt: new Date() } });
    return c.json({ success: true });
  } catch (err) { return handle(err, c); }
});

export { documents as documentsRoutes };
