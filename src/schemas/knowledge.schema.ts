import { z } from 'zod';

// Knowledge articles are admin-seeded and served read-only to mobile clients.
// Title/preview/content are split per locale (en + de day 1) so we can add
// more languages later without changing the schema.

export const knowledgeCategoryIdSchema = z.string().min(1).max(64);

export const knowledgeLocalizedSchema = z.object({
  en: z.object({
    title: z.string().min(1).max(300),
    preview: z.string().min(1).max(500),
    content: z.string().min(1).max(60_000),
  }),
  de: z
    .object({
      title: z.string().min(1).max(300),
      preview: z.string().min(1).max(500),
      content: z.string().min(1).max(60_000),
    })
    .optional(),
});

export interface KnowledgeArticle {
  _id: string;
  slug: string;
  categoryId: string;
  tags: string[];
  readingTime: number;
  order: number;
  published: boolean;
  i18n: {
    en: { title: string; preview: string; content: string };
    de?: { title: string; preview: string; content: string };
  };
  createdAt: string;
  updatedAt: string;
}

export const knowledgeArticleInputSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/, 'slug must be kebab-case'),
  categoryId: knowledgeCategoryIdSchema,
  tags: z.array(z.string().max(64)).max(20).default([]),
  readingTime: z.number().int().min(1).max(120),
  order: z.number().int().default(0),
  published: z.boolean().default(false),
  i18n: knowledgeLocalizedSchema,
});

export const knowledgeListQuerySchema = z.object({
  category: z.string().optional(),
  tag: z.string().optional(),
  q: z.string().optional(),
});
