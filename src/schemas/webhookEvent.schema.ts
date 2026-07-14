import { z } from 'zod';

// Idempotency store for RevenueCat webhooks. Prevents duplicate processing
// when RC retries. `eventId` is unique per RC event.
export const webhookEventSchema = z.object({
  _id: z.string(),
  eventId: z.string(),
  eventType: z.string(),
  appUserId: z.string(),
  processedAt: z.string(),
  status: z.enum(['processing', 'processed', 'failed']),
  error: z.string().optional(),
  rawPayload: z.record(z.string(), z.any()).optional(),
});
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

export function createWebhookEventRecord(
  eventId: string,
  eventType: string,
  appUserId: string,
  status: 'processing' | 'processed' | 'failed',
  error?: string,
  rawPayload?: Record<string, any>
): Omit<WebhookEvent, '_id'> {
  return {
    eventId,
    eventType,
    appUserId,
    processedAt: new Date().toISOString(),
    status,
    error,
    rawPayload,
  };
}
