import { describe, expect, it } from 'vitest';
import { internalAuthEmail } from '../auth-email.js';

describe('opaque internal auth email (test 17)', () => {
  it('derives a deterministic but opaque address from the normalized username', async () => {
    const first = await internalAuthEmail('douglas', 'test-pepper');
    const second = await internalAuthEmail('douglas', 'test-pepper');
    expect(first).toBe(second);
    expect(first).toMatch(/^u_[0-9a-f]{64}@icon-connect\.invalid$/);
  });

  it('contains no substring of the plaintext username (test 17)', async () => {
    const email = await internalAuthEmail('bright_eyed', 'test-pepper');
    // The u_ prefix is the opaque locator marker; the username itself (and
    // its underscore) never appears.
    expect(email.toLowerCase()).not.toContain('bright');
    expect(email.toLowerCase()).not.toContain('eyed');
    expect(email.toLowerCase()).not.toContain('bright_eyed');
  });

  it('is unrecoverable without the pepper (test 17)', async () => {
    const withPepper = await internalAuthEmail('douglas', 'secret-a');
    const wrongPepper = await internalAuthEmail('douglas', 'secret-b');
    expect(withPepper).not.toBe(wrongPepper);
  });

  it('maps two different usernames to different addresses', async () => {
    const a = await internalAuthEmail('douglas', 'pepper');
    const b = await internalAuthEmail('thrynn', 'pepper');
    expect(a).not.toBe(b);
  });
});
