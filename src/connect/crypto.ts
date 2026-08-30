/**
 * Shared WebCrypto helpers for the ICON Connect local-instance keypair and the
 * challenge-response binding protocol.
 *
 * The algorithm is the boring, broadly supported choice: ECDSA over P-256
 * with SHA-256, exactly as `SubtleCrypto` provides it in both browsers and
 * Node. The private key is ALWAYS generated non-extractable (`extractable:
 * false`), so it can sign challenges but can never be serialized. Signatures
 * are the WebCrypto-native raw r||s form, transported as base64url.
 *
 * The "canonical challenge bytes" are the UTF-8 bytes of the challenge string
 * the server issued. Both sides sign/verify exactly those bytes; there is no
 * secondary encoding.
 *
 * Environment-neutral: no DOM, no Node builtins, no Buffer.
 */

export const ECDSA_PARAMS: EcKeyImportParams = { name: 'ECDSA', namedCurve: 'P-256' };
export const ECDSA_SIGN_PARAMS: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' };

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function base64UrlEncode(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!;
    const b = index + 1 < bytes.length ? bytes[index + 1]! : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2]! : 0;
    output += B64_ALPHABET[a >> 2];
    output += B64_ALPHABET[((a & 0x03) << 4) | (b >> 4)];
    if (index + 1 < bytes.length) output += B64_ALPHABET[((b & 0x0f) << 2) | (c >> 6)];
    if (index + 2 < bytes.length) output += B64_ALPHABET[c & 0x3f];
  }
  return output;
}

export function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
    throw new Error('Invalid base64url text.');
  }
  const alphabetIndex = new Map<string, number>();
  for (let index = 0; index < B64_ALPHABET.length; index += 1) alphabetIndex.set(B64_ALPHABET[index]!, index);
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of text) {
    const value = alphabetIndex.get(character);
    if (value === undefined) throw new Error('Invalid base64url text.');
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

/** Cryptographically random challenge bytes (default 256 bits). */
export function randomChallengeBytes(byteLength = 32): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytes;
}

export async function generateInstanceKeyPair(): Promise<CryptoKeyPair> {
  // `extractable: false` is the hard guarantee: the private key is a sign-only
  // CryptoKey that can never be exported, serialized, or persisted as bytes.
  return crypto.subtle.generateKey(ECDSA_PARAMS, false, ['sign', 'verify']);
}

export async function exportPublicJwk(publicKey: CryptoKey): Promise<JsonWebKey> {
  const jwk = await crypto.subtle.exportKey('jwk', publicKey);
  if (!jwk || typeof jwk !== 'object' || 'd' in jwk) {
    throw new Error('The instance public key could not be exported as a public-only JWK.');
  }
  return jwk;
}

export async function importPublicJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, ECDSA_PARAMS, true, ['verify']);
}

/** Sign the exact canonical challenge bytes (UTF-8 of the challenge string)
 * with the non-extractable private key. Returns a base64url raw r||s
 * signature. */
export async function signChallenge(privateKey: CryptoKey, challenge: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    ECDSA_SIGN_PARAMS,
    privateKey,
    new TextEncoder().encode(challenge),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

/** Verify a base64url raw r||s signature over the canonical challenge bytes
 * against a public-only JWK. */
export async function verifyChallengeSignature(
  publicKeyJwk: JsonWebKey,
  challenge: string,
  signatureBase64Url: string,
): Promise<boolean> {
  const publicKey = await importPublicJwk(publicKeyJwk);
  return crypto.subtle.verify(
    ECDSA_SIGN_PARAMS,
    publicKey,
    base64UrlDecode(signatureBase64Url),
    new TextEncoder().encode(challenge),
  );
}
