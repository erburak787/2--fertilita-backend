// Universal Links (iOS) + App Links (Android) manifests.
//
// Both files must be served with `Content-Type: application/json` at the
// `.well-known/…` path, over HTTPS, with no redirects. The apple-app-site-
// association also must NOT be gzipped or signed. Hono returns raw JSON,
// which is what iOS expects.
//
// Deep-link paths handled by the app:
//   /reset-password?token=…   → onboarding/reset-password
//
// Fill IOS_APP_ID and ANDROID_* env values before deploying to a domain
// that Apple / Google will fetch from (typically fertilita.app).

import { Hono } from 'hono';
import { env } from '../env';

const wellKnown = new Hono();

wellKnown.get('/apple-app-site-association', (c) => {
  const appId = env.IOS_APP_ID;
  const paths = ['/reset-password', '/reset-password/*'];
  const body = {
    applinks: {
      apps: [],
      details: appId
        ? [
            {
              appIDs: [appId],
              components: [
                { '/': '/reset-password', comment: 'Password reset landing' },
                { '/': '/reset-password/*', comment: 'Password reset landing with path token' },
              ],
              paths,
            },
          ]
        : [],
    },
    webcredentials: appId ? { apps: [appId] } : undefined,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

wellKnown.get('/assetlinks.json', (c) => {
  const pkg = env.ANDROID_PACKAGE_NAME;
  const fps = (env.ANDROID_SHA256_CERT_FINGERPRINTS ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
  const body = pkg && fps.length > 0
    ? [
        {
          relation: [
            'delegate_permission/common.handle_all_urls',
            'delegate_permission/common.get_login_creds',
          ],
          target: {
            namespace: 'android_app',
            package_name: pkg,
            sha256_cert_fingerprints: fps,
          },
        },
      ]
    : [];
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

export { wellKnown as wellKnownRoutes };
