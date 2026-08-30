import { describe, expect, it } from 'vitest';
import {
  base64UrlDecode,
  base64UrlEncode,
  ECDSA_PARAMS,
  exportPublicJwk,
  generateInstanceKeyPair,
  signChallenge,
  verifyChallengeSignature,
} from '../crypto.js';

async function keyPair() {
  return generateInstanceKeyPair();
}

describe('instance keypair (tests 8–13)', () => {
  it('generates an ECDSA P-256 keypair with a NON-EXTRACTABLE private key', async () => {
    const pair = await keyPair();
    expect(pair.privateKey.type).toBe('private');
    expect(pair.privateKey.extractable).toBe(false);
    expect(pair.publicKey.extractable).toBe(true);
    expect(pair.privateKey.algorithm).toMatchObject({ name: 'ECDSA', namedCurve: 'P-256' });
    expect(pair.publicKey.usages).toContain('verify');
    // The private key can never be exported — that is the persistence boundary.
    await expect(crypto.subtle.exportKey('jwk', pair.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('pkcs8', pair.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('raw', pair.privateKey)).rejects.toThrow();
  });

  it('exports only a public-only JWK', async () => {
    const pair = await keyPair();
    const jwk = await exportPublicJwk(pair.publicKey);
    expect(jwk.kty).toBe('EC');
    expect(jwk.crv).toBe('P-256');
    expect('d' in jwk).toBe(false);
    expect(jwk.key_ops).toEqual(['verify']);
  });

  it('verifies a signature produced by the correct local private key (test 9)', async () => {
    const pair = await keyPair();
    const publicJwk = await exportPublicJwk(pair.publicKey);
    const challenge = 'challenge:abc123';
    const signature = await signChallenge(pair.privateKey, challenge);
    expect(await verifyChallengeSignature(publicJwk, challenge, signature)).toBe(true);
  });

  it('fails with the wrong key (test 10)', async () => {
    const pair = await keyPair();
    const other = await keyPair();
    const publicJwk = await exportPublicJwk(other.publicKey);
    const signature = await signChallenge(pair.privateKey, 'challenge:same');
    expect(await verifyChallengeSignature(publicJwk, 'challenge:same', signature)).toBe(false);
  });

  it('fails when the signed bytes differ from the canonical challenge (test 11)', async () => {
    const pair = await keyPair();
    const publicJwk = await exportPublicJwk(pair.publicKey);
    const signature = await signChallenge(pair.privateKey, 'challenge:original');
    // A tampered challenge string must not verify.
    expect(await verifyChallengeSignature(publicJwk, 'challenge:tampered', signature)).toBe(false);
  });

  it('signs exactly the canonical UTF-8 challenge bytes (no secondary encoding)', async () => {
    const pair = await keyPair();
    const publicJwk = await exportPublicJwk(pair.publicKey);
    const challenge = 'challenge:unicode-é-✓';
    const signature = await signChallenge(pair.privateKey, challenge);
    // Verification is byte-exact: any mutation of the canonical string fails.
    expect(await verifyChallengeSignature(publicJwk, challenge, signature)).toBe(true);
    expect(await verifyChallengeSignature(publicJwk, `${challenge} `, signature)).toBe(false);
  });

  it('base64url round-trips raw bytes', () => {
    const bytes = Uint8Array.from([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
    expect(() => base64UrlDecode('not!valid')).toThrow();
    expect(() => base64UrlDecode('a')).toThrow();
  });

  it('ECDSA raw r||s signatures are 64 bytes, so a valid signature is not base64url 128 chars', async () => {
    const pair = await keyPair();
    const signature = await signChallenge(pair.privateKey, 'probe');
    expect(base64UrlDecode(signature)).toHaveLength(64);
    expect(signature.length).toBe(86);
  });

  it('rejects a signature that is not valid base64url r||s', async () => {
    const pair = await keyPair();
    const publicJwk = await exportPublicJwk(pair.publicKey);
    // Non-base64url text fails decoding.
    await expect(verifyChallengeSignature(publicJwk, 'probe', '!!!')).rejects.toThrow(/invalid base64url/i);
    // A zero-length signature cannot verify: WebCrypto returns false.
    await expect(verifyChallengeSignature(publicJwk, 'probe', '')).resolves.toBe(false);
  });

  it('imports only EC P-256 public keys with the verify usage', async () => {
    const pair = await keyPair();
    const jwk = await exportPublicJwk(pair.publicKey);
    const imported = await crypto.subtle.importKey('jwk', jwk, ECDSA_PARAMS, true, ['verify']);
    expect(imported.type).toBe('public');
  });
});
