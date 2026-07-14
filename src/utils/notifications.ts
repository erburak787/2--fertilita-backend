import { translate } from './i18n';
import type { AppLocale } from '../config/constants';
import { DEFAULT_LOCALE } from '../config/constants';
import type { OpaqueReminderKind } from '../schemas/notification.schema';

// ⚠️ COMPLIANCE — every server-generated push notification body must be
//    OPAQUE. Never include medication names, procedure names, partner
//    identifiers, or dates. Every `kind` resolves to the SAME opaque copy;
//    the kind is server-only routing metadata that never surfaces to the
//    device or notification center.
const OPAQUE_TITLES: Record<AppLocale, string> = {
  en: 'Fertilita',
  de: 'Fertilita',
};

export function buildOpaqueNotification(
  locale: AppLocale | undefined,
  _kind: OpaqueReminderKind
): { title: string; body: string } {
  const l = locale ?? DEFAULT_LOCALE;
  return {
    title: OPAQUE_TITLES[l] ?? OPAQUE_TITLES[DEFAULT_LOCALE],
    body: translate(l, 'reminder_generic'),
  };
}
