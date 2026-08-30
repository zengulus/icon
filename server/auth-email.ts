/**
 * Opaque server-side mapping from a normalized username to the internal
 * Supabase Auth email address.
 *
 * Supabase Auth is email/password oriented, but the player never sees or
 * types an email: they see a username. Rather than inventing a guessable
 * `username@…` address (which would leak the handle and enable enumeration),
 * the server derives a fixed, HMAC-keyed local part:
 *
 *   u_<HMAC-SHA256(pepper, "icon-connect:" + normalizedUsername)>@icon-connect.invalid
 *
 * The HMAC key is the server-only pepper (`ICON_CONNECT_PEPPER`). The derived
 * address is deterministic (so the same username always maps to the same auth
 * user) but opaque: it contains no substring of the username, and without the
 * pepper it cannot be reproduced. The browser never needs to know it.
 *
 * This is not password storage or password-derived encryption: the password
 * itself never touches this mapping, and the pepper is a signing key for the
 * opaque locator only.
 */
import { INTERNAL_AUTH_EMAIL_DOMAIN } from '../src/connect/username.js';

export async function internalAuthEmail(normalizedUsername: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`icon-connect:${normalizedUsername}`),
  );
  const hex = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `u_${hex}@${INTERNAL_AUTH_EMAIL_DOMAIN}`;
}
