import { z } from 'zod';

export const documentCategorySchema = z.enum([
  'lab',
  'ultrasound',
  'bloodwork',
  'semen_analysis',
  'embryology',
  'letter',
  'prescription',
  'billing',
  'other',
]);
export type DocumentCategory = z.infer<typeof documentCategorySchema>;

export const documentMimeTypeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/heic',
  'application/pdf',
]);

export const documentStatusSchema = z.enum(['pending', 'ready', 'failed']);

export const documentAutoClassificationSchema = z.object({
  suggestedTitle: z.string(),
  suggestedCategory: documentCategorySchema,
  confidence: z.enum(['low', 'medium', 'high']),
});

export const documentSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  attemptId: z.string().optional(),
  storageKey: z.string(),
  filename: z.string().max(200),
  title: z.string().max(200),
  category: documentCategorySchema,
  mimeType: documentMimeTypeSchema,
  fileSize: z.number().int().nonnegative(),
  checksum: z.string().optional(),
  status: documentStatusSchema,
  autoClassification: documentAutoClassificationSchema.optional(),
  ocrText: z.string().optional(),
  notes: z.string().max(2000).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.date().nullable().optional(),
});
export type Document = z.infer<typeof documentSchema>;

export const requestUploadUrlSchema = z.object({
  filename: z.string().min(1).max(200),
  mimeType: documentMimeTypeSchema,
  fileSize: z.number().int().positive().max(25_000_000),
  category: documentCategorySchema.optional(),
  attemptId: z.string().optional(),
});

export const finalizeUploadSchema = z.object({
  checksum: z.string().optional(),
});

export const updateDocumentSchema = z.object({
  title: z.string().max(200).optional(),
  category: documentCategorySchema.optional(),
  notes: z.string().max(2000).optional(),
  attemptId: z.string().nullable().optional(),
});

export const listDocumentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  category: documentCategorySchema.optional(),
  attemptId: z.string().optional(),
});
