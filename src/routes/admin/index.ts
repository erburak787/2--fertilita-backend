import { Hono } from 'hono';
import { adminAuthRoutes } from './auth.routes';
import { adminUsersRoutes } from './users.routes';
import { adminMetricsRoutes } from './metrics.routes';
import { adminNotificationsRoutes } from './notifications.routes';
import { adminKnowledgeRoutes } from './knowledge.routes';
import { adminSubscriptionRoutes } from './subscription.routes';
import { adminSuggestionsRoutes } from './suggestions.routes';
import { adminAuditRoutes } from './audit.routes';
import type { BaseVariables } from '../../types/context';

const admin = new Hono<{ Variables: BaseVariables }>();

admin.route('/auth', adminAuthRoutes);
admin.route('/users', adminUsersRoutes);
admin.route('/metrics', adminMetricsRoutes);
admin.route('/notifications', adminNotificationsRoutes);
admin.route('/knowledge', adminKnowledgeRoutes);
admin.route('/users', adminSubscriptionRoutes);
admin.route('/suggestions', adminSuggestionsRoutes);
admin.route('/audit-log', adminAuditRoutes);

export { admin as adminRoutes };
