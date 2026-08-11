import { Hono } from 'hono';
import { apiRateLimiter } from '../middleware/rateLimit.middleware';
import { authRoutes } from './auth.routes';
import { attemptsRoutes } from './attempts.routes';
import { eventsRoutes } from './events.routes';
import { cycleRoutes } from './cycle.routes';
import { journalRoutes } from './journal.routes';
import { knowledgeRoutes } from './knowledge.routes';
import { aiRoutes } from './ai.routes';
import { settingsRoutes } from './settings.routes';
import { documentsRoutes } from './documents.routes';
import { notificationsRoutes } from './notifications.routes';
import { supportRoutes } from './support.routes';
import { shareRoutes } from './share.routes';
import { subscriptionRoutes } from './subscription.routes';
import { suggestionsRoutes } from './suggestions.routes';
import { wishlistRoutes } from './wishlist.routes';
import type { BaseVariables } from '../types/context';

const api = new Hono<{ Variables: BaseVariables }>();

api.use('*', apiRateLimiter);

api.route('/auth', authRoutes);
api.route('/attempts', attemptsRoutes);
api.route('/events', eventsRoutes);
api.route('/cycle', cycleRoutes);
api.route('/journal', journalRoutes);
api.route('/knowledge', knowledgeRoutes);
api.route('/ai', aiRoutes);
api.route('/settings', settingsRoutes);
api.route('/documents', documentsRoutes);
api.route('/notifications', notificationsRoutes);
api.route('/support', supportRoutes);
api.route('/share', shareRoutes);
api.route('/subscription', subscriptionRoutes);
api.route('/suggestions', suggestionsRoutes);
api.route('/wishlist', wishlistRoutes);

export { api as apiRoutes };
