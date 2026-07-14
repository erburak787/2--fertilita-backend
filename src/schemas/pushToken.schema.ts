import { z } from 'zod';

export const pushTokenSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  expoPushToken: z.string().regex(/^ExponentPushToken\[.+\]$/, 'Invalid Expo push token'),
  platform: z.enum(['ios', 'android', 'web']),
  isActive: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PushToken = z.infer<typeof pushTokenSchema>;

export const registerPushTokenSchema = z.object({
  expoPushToken: z.string().regex(/^ExponentPushToken\[.+\]$/, 'Invalid Expo push token'),
  platform: z.enum(['ios', 'android', 'web']),
});
