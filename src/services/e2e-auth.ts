/**
 * Browser acceptance tests need two local identities without a hosted auth
 * provider. This deliberately only evaluates to true while Vite is serving in
 * the explicit `e2e` mode; `import.meta.env.DEV` is false for every build,
 * including `vite build --mode e2e`.
 *
 * Do not turn this into a development-login shortcut. Render independently
 * requires NODE_ENV=test and ALLOW_DEV_AUTH=true before it accepts the paired
 * `dev:` token.
 */
export const e2eAuthEnabled = import.meta.env.DEV
  && import.meta.env.MODE === 'e2e'
  && import.meta.env.VITE_E2E_AUTH === 'true';

export interface E2EIdentity {
  id: string;
  email: string;
  role: 'gm' | 'player';
}

const identityPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;

function e2eQuery(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  // HashRouter keeps route query parameters after the # fragment, so the
  // normal location.search is intentionally only a fallback here.
  const hashQuery = window.location.hash.includes('?')
    ? window.location.hash.slice(window.location.hash.indexOf('?') + 1)
    : window.location.search;
  return new URLSearchParams(hashQuery);
}

/** Return an identity only for the explicit browser-E2E development server. */
export function currentE2EIdentity(): E2EIdentity | null {
  if (!e2eAuthEnabled) return null;
  const query = e2eQuery();
  const id = query.get('e2eUser') ?? 'e2e-gm';
  if (!identityPattern.test(id)) throw new Error('The E2E user id is malformed.');
  const role = query.get('e2eRole') === 'player' ? 'player' : 'gm';
  return { id, email: `${id}@e2e.invalid`, role };
}

/** A test-only token accepted only by the server's equally narrow test gate. */
export function e2eRealtimeAccessToken(identity: E2EIdentity): string {
  if (!e2eAuthEnabled) throw new Error('E2E authentication is unavailable outside the browser acceptance server.');
  return `dev:${identity.id}:${identity.role}`;
}
