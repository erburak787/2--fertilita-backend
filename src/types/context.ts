import type { Context } from 'hono';
import type { AppLocale } from '../config/constants';
import type { User } from '../schemas/user.schema';
import type { Admin } from '../schemas/admin.schema';

// Variables for routes guarded by `protectedRoute()` / `extractAuthContext()`.
export type AuthVariables = {
  user: User;
  userId: string;
  locale: AppLocale;
};

// Variables for routes guarded by `adminJwtRoute()`.
export type AdminVariables = {
  admin: Admin;
  locale: AppLocale;
};

// Variables present on every request (set by `i18nMiddleware()`).
export type BaseVariables = {
  locale: AppLocale;
};

export type AppContext = Context<{ Variables: BaseVariables }>;
export type AuthContext = Context<{ Variables: AuthVariables }>;
export type AdminContext = Context<{ Variables: AdminVariables }>;
