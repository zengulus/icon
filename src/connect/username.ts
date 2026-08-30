/**
 * THE username authority for ICON Connect accounts.
 *
 * A deliberately boring ASCII account handle policy: 3–32 characters from
 * `[a-zA-Z0-9_-]`. No Unicode, no whitespace, no homoglyph/canonicalization
 * surface. Uniqueness and all comparisons use the NORMALIZED form
 * (lower-cased); the display form preserves the casing the player typed so a
 * future display rename never changes identity.
 *
 * This module is environment-neutral (no DOM, no Node builtins) so the exact
 * same authority runs in the browser form and on the Render server.
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
/** ASCII only: letters, digits, underscore, hyphen. */
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** The fixed, non-user-facing domain for opaque internal auth addresses. A
 * connect account's Supabase Auth email is `u_<hmac>@<this domain>`; the
 * browser never needs to display or persist it. */
export const INTERNAL_AUTH_EMAIL_DOMAIN = 'icon-connect.invalid';

export function isOpaqueInternalAuthEmail(email: unknown): boolean {
  return typeof email === 'string' && email.toLowerCase().endsWith(`@${INTERNAL_AUTH_EMAIL_DOMAIN}`);
}

export interface ValidUsername {
  /** Canonical identity form: lower-cased ASCII handle. */
  normalized: string;
  /** The player's chosen casing, preserved for display only. */
  display: string;
}

export type UsernameValidation =
  | (ValidUsername & { ok: true })
  | { ok: false; message: string };

export function validateUsername(input: unknown): UsernameValidation {
  if (typeof input !== 'string') {
    return { ok: false, message: 'Choose a username.' };
  }
  const display = input.trim();
  if (display.length < USERNAME_MIN_LENGTH || display.length > USERNAME_MAX_LENGTH) {
    return { ok: false, message: `Usernames must be ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} characters.` };
  }
  if (!USERNAME_PATTERN.test(display)) {
    return { ok: false, message: 'Usernames may only contain letters, numbers, underscores, and hyphens.' };
  }
  return { ok: true, normalized: display.toLowerCase(), display };
}

/** The canonical identity form; throws when the handle is not valid. */
export function normalizeUsername(input: unknown): string {
  const validation = validateUsername(input);
  if (!validation.ok) throw new Error(validation.message);
  return validation.normalized;
}

export function isValidUsername(input: unknown): input is string {
  return validateUsername(input).ok;
}
