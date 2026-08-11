import { z } from 'zod';

export const adminRoleSchema = z.enum(['super_admin', 'admin', 'readonly']);
export type AdminRole = z.infer<typeof adminRoleSchema>;

export const adminSchema = z.object({
  _id: z.string(),
  email: z.string().email(),
  passwordHash: z.string(),
  displayName: z.string().max(120).optional(),
  role: adminRoleSchema.default('admin'),
  isActive: z.boolean().default(true),
  lastLoginAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Admin = z.infer<typeof adminSchema>;

export const adminPublicSchema = adminSchema.omit({ passwordHash: true });
export type AdminPublic = z.infer<typeof adminPublicSchema>;

export function buildAdminPublic(a: Admin): AdminPublic {
  const { passwordHash, ...rest } = a;
  return rest;
}

export const adminLoginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
});

export const adminAuditActionSchema = z.enum([
  'admin_login',
  'admin_logout',
  'admin_token_refresh',
  'admin_password_reset',
  'user_viewed',
  'user_deleted',
  'user_locale_updated',
  'knowledge_article_created',
  'knowledge_article_updated',
  'knowledge_article_deleted',
  'subscription_granted',
  'subscription_revoked',
  'trial_extended',
  'push_broadcast',
  'suggestion_updated',
  'wishlist_email_added',
  'wishlist_bulk_upload',
  'wishlist_email_deleted',
]);
export type AdminAuditAction = z.infer<typeof adminAuditActionSchema>;

export const adminAuditLogSchema = z.object({
  _id: z.string(),
  adminId: z.string(),
  adminEmail: z.string(),
  action: adminAuditActionSchema,
  targetUserId: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  createdAt: z.string(),
});
export type AdminAuditLog = z.infer<typeof adminAuditLogSchema>;
