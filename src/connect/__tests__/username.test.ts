import { describe, expect, it } from 'vitest';
import {
  INTERNAL_AUTH_EMAIL_DOMAIN,
  isOpaqueInternalAuthEmail,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  isValidUsername,
  normalizeUsername,
  validateUsername,
} from '../username.js';

describe('username normalization authority (test 14)', () => {
  it('accepts a plain ASCII handle and preserves the display casing separately', () => {
    const validation = validateUsername('  Douglas_Storm-1  ');
    expect(validation).toMatchObject({ ok: true, normalized: 'douglas_storm-1', display: 'Douglas_Storm-1' });
  });

  it('normalizes to a single canonical lowercase identity form', () => {
    expect(normalizeUsername('Douglas')).toBe('douglas');
    expect(normalizeUsername('DOUGLAS')).toBe('douglas');
    expect(normalizeUsername('douglas')).toBe('douglas');
    expect(normalizeUsername('Thrynn')).toBe('thrynn');
  });

  it('is case-insensitively unique because uniqueness is decided on the normalized form', () => {
    // Same normalized value, different casing: they collide by design.
    expect(normalizeUsername('Bright_Eyed')).toBe(normalizeUsername('bright_eyed'));
    expect(normalizeUsername('Dreamer')).toBe(normalizeUsername('DREAMER'));
  });

  it('rejects Unicode, whitespace, punctuation, and empty input', () => {
    expect(validateUsername('')).toMatchObject({ ok: false });
    expect(validateUsername('  ')).toMatchObject({ ok: false });
    expect(validateUsername('Doug las')).toMatchObject({ ok: false });
    expect(validateUsername('Douglas!')).toMatchObject({ ok: false });
    expect(validateUsername('Doug.las')).toMatchObject({ ok: false });
    expect(validateUsername('星')).toMatchObject({ ok: false });
    expect(validateUsername('Døuglas')).toMatchObject({ ok: false });
    expect(validateUsername(42)).toMatchObject({ ok: false });
    expect(validateUsername(null)).toMatchObject({ ok: false });
  });

  it('enforces the 3–32 character bounds', () => {
    expect(validateUsername('ab')).toMatchObject({ ok: false });
    expect(validateUsername('a'.repeat(USERNAME_MIN_LENGTH - 1))).toMatchObject({ ok: false });
    expect(validateUsername('a'.repeat(USERNAME_MIN_LENGTH))).toMatchObject({ ok: true });
    expect(validateUsername('a'.repeat(USERNAME_MAX_LENGTH))).toMatchObject({ ok: true });
    expect(validateUsername('a'.repeat(USERNAME_MAX_LENGTH + 1))).toMatchObject({ ok: false });
  });

  it('never uses the username as an identity primitive (id/uuid/key), only a login handle', () => {
    // The validation result carries no id, uuid, or key fields.
    const validation = validateUsername('Douglas');
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(Object.keys(validation)).toEqual(['ok', 'normalized', 'display']);
    }
    expect(isValidUsername('Douglas')).toBe(true);
    expect(isValidUsername('doug las')).toBe(false);
  });

  it('recognizes the opaque internal auth email so the UI never surfaces it', () => {
    expect(isOpaqueInternalAuthEmail(`u_${'a'.repeat(64)}@${INTERNAL_AUTH_EMAIL_DOMAIN}`)).toBe(true);
    expect(isOpaqueInternalAuthEmail(`U_ABC@${INTERNAL_AUTH_EMAIL_DOMAIN}`.toUpperCase())).toBe(true);
    expect(isOpaqueInternalAuthEmail('douglas@gmail.com')).toBe(false);
    expect(isOpaqueInternalAuthEmail(null)).toBe(false);
    expect(isOpaqueInternalAuthEmail(undefined)).toBe(false);
  });
});
