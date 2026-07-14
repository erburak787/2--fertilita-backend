import { z } from 'zod';
import { localDateSchema } from './common.schema';

export const eventSourceSchema = z.enum(['journey', 'calendar', 'cycle']);
export const eventTypeSchema = z.enum(['task', 'info']);
export const eventCategorySchema = z.enum([
  'medication',
  'trigger',
  'transfer',
  'retrieval',
  'appointment',
  'outcome',
  'embryo',
  'period',
  'ovulation',
  'fertile',
  'procedure',
  'stimulation',
  'note',
  'other',
]);

export const appEventBaseSchema = z.object({
  clientId: z.string().min(1).max(64),
  source: eventSourceSchema,
  attemptId: z.string().optional(),
  sourceRefId: z.string().optional(),
  sectionKey: z.string().optional(),
  entryId: z.string().optional(),
  title: z.string().min(1).max(300),
  type: eventTypeSchema,
  category: eventCategorySchema,
  date: localDateSchema,
  time: z.string().nullable().optional(),
  isTask: z.boolean(),
  completed: z.boolean().default(false),
  reminderEnabled: z.boolean().default(false),
  reminderTime: z.string().optional(),
  notes: z.string().max(2000).optional(),
  clientCreatedAt: z.string(),
  clientUpdatedAt: z.string().optional(),
});

export const createEventSchema = appEventBaseSchema;
export const updateEventSchema = appEventBaseSchema.partial().extend({
  clientUpdatedAt: z.string(),
});

export interface AppEventDoc {
  _id: string;
  userId: string;
  clientId: string;
  source: 'journey' | 'calendar' | 'cycle';
  attemptId?: string | null;
  sourceRefId?: string;
  sectionKey?: string;
  entryId?: string;
  title: string;
  type: 'task' | 'info';
  category: z.infer<typeof eventCategorySchema>;
  date: string;
  time?: string | null;
  isTask: boolean;
  completed: boolean;
  reminderEnabled: boolean;
  reminderTime?: string;
  notes?: string;
  clientCreatedAt: string;
  clientUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: Date | null;
}
