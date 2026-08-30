import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildIconConnectArtifact,
  ICON_CONNECT_KIND,
  ICON_CONNECT_SCHEMA_VERSION,
  isPublicEcP256Jwk,
  parseIconConnectArtifact,
  serializeIconConnectArtifact,
} from '../icon-connect.js';

const INSTANCE_ID = '4c1f0e5a-2d6b-4e8f-9a0c-3b7d1e5f2a6b';

let PUBLIC_JWK: JsonWebKey;
let VALID_TEXT: string;

beforeAll(async () => {
  // A REAL exported public-only EC P-256 JWK (43-char base64url coordinates,
  // as the browser's subtle.exportKey produces). Hand-rolled coordinates are
  // easy to get subtly wrong; the real export is the ground truth.
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  PUBLIC_JWK = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  VALID_TEXT = serializeIconConnectArtifact(buildIconConnectArtifact(INSTANCE_ID, PUBLIC_JWK));
});

describe('icon_connect.json public artifact (tests 1–4)', () => {
  it('contains only identity + public key + version metadata', () => {
    const artifact = buildIconConnectArtifact(INSTANCE_ID, PUBLIC_JWK, '2026-08-30T00:00:00.000Z');
    expect(artifact).toEqual({
      kind: 'icon-connect',
      schemaVersion: 1,
      instanceId: INSTANCE_ID,
      publicKey: PUBLIC_JWK,
      createdAt: '2026-08-30T00:00:00.000Z',
    });
    // The exact key set is the schema; nothing else may ride along.
    expect(Object.keys(artifact).sort()).toEqual(['createdAt', 'instanceId', 'kind', 'publicKey', 'schemaVersion']);
  });

  it('never contains a username', () => {
    expect(VALID_TEXT).not.toMatch(/username|display-name|handle/i);
  });

  it('never contains a password or any credential material', () => {
    expect(VALID_TEXT).not.toMatch(/password|passwd|secret|hash/i);
  });

  it('never contains a session token or private key material', () => {
    expect(VALID_TEXT).not.toMatch(/access_token|refresh_token|session|jwt|bearer/i);
    expect(VALID_TEXT).not.toContain('"d"');
    expect(VALID_TEXT).not.toContain('"p"');
    expect(VALID_TEXT).not.toContain('"q"');
    expect(VALID_TEXT).not.toContain('"dp"');
    expect(VALID_TEXT).not.toContain('"dq"');
  });

  it('serializes to a stable JSON document', () => {
    expect(VALID_TEXT).toContain(`"kind": "${ICON_CONNECT_KIND}"`);
    expect(VALID_TEXT).toContain(`"schemaVersion": ${ICON_CONNECT_SCHEMA_VERSION}`);
    expect(VALID_TEXT).toContain(`"instanceId": "${INSTANCE_ID}"`);
  });
});

describe('icon_connect.json strict validation (tests 5–6)', () => {
  it('round-trips a valid artifact', () => {
    expect(parseIconConnectArtifact(VALID_TEXT)).toMatchObject({
      kind: 'icon-connect',
      schemaVersion: 1,
      instanceId: INSTANCE_ID,
      publicKey: PUBLIC_JWK,
    });
  });

  it('rejects malformed JSON fail-closed', () => {
    expect(() => parseIconConnectArtifact('{not json')).toThrow(/not valid JSON/i);
    expect(() => parseIconConnectArtifact('')).toThrow(/empty or too large/i);
    expect(() => parseIconConnectArtifact('null')).toThrow(/must be a JSON object/i);
    expect(() => parseIconConnectArtifact('[1, 2]')).toThrow(/must be a JSON object/i);
    expect(() => parseIconConnectArtifact('"hello"')).toThrow(/must be a JSON object/i);
  });

  it('rejects an oversized file', () => {
    const payload = { ...JSON.parse(VALID_TEXT), pad: 'x'.repeat(20 * 1024) };
    // The 16 KB cap fails closed before anything is adopted.
    expect(() => parseIconConnectArtifact(JSON.stringify(payload))).toThrow(/empty or too large/i);
  });

  it('rejects the wrong kind and unsupported schema versions fail-closed', () => {
    const base = JSON.parse(VALID_TEXT) as Record<string, unknown>;
    expect(() => parseIconConnectArtifact(JSON.stringify({ ...base, kind: 'other' }))).toThrow(/kind must be/i);
    expect(() => parseIconConnectArtifact(JSON.stringify({ ...base, schemaVersion: 2 }))).toThrow(/schema version/i);
    expect(() => parseIconConnectArtifact(JSON.stringify({ ...base, schemaVersion: '1' }))).toThrow(/schema version/i);
  });

  it('rejects missing or extra fields and prototype-pollution payloads', () => {
    const base = JSON.parse(VALID_TEXT) as Record<string, unknown>;
    expect(() => parseIconConnectArtifact(JSON.stringify({ kind: 'icon-connect', schemaVersion: 1 }))).toThrow(/missing/i);
    // JSON.parse creates a REAL own '__proto__' property (no setter runs);
    // spreading it copies that key so the parser must reject the extra field.
    const withProto = JSON.parse('{"__proto__": {"polluted": true}}');
    expect(() => parseIconConnectArtifact(JSON.stringify({ ...base, ...withProto }))).toThrow(/unsupported field "__proto__"/i);
    expect(() => parseIconConnectArtifact(JSON.stringify({ ...base, constructor: { prototype: {} } }))).toThrow(/unsupported field/i);
    expect(() => parseIconConnectArtifact(JSON.stringify({ ...base, evil: '() => {}' }))).toThrow(/unsupported field/i);
  });

  it('rejects invalid UUIDs and timestamps', () => {
    const base = JSON.parse(VALID_TEXT) as Record<string, unknown>;
    expect(() => parseIconConnectArtifact(JSON.stringify({ ...base, instanceId: 'not-a-uuid' }))).toThrow(/valid UUID/i);
    expect(() => parseIconConnectArtifact(JSON.stringify({ ...base, instanceId: '' }))).toThrow(/valid UUID/i);
    expect(() => parseIconConnectArtifact(JSON.stringify({ ...base, createdAt: 'yesterday' }))).toThrow(/ISO-8601/i);
  });

  it('rejects a public key carrying private material or wrong algorithm', () => {
    const base = JSON.parse(VALID_TEXT) as Record<string, unknown>;
    const withPrivate = { ...PUBLIC_JWK, d: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY' };
    expect(() => parseIconConnectArtifact(JSON.stringify({ ...base, publicKey: withPrivate }))).toThrow(/public-only EC P-256/i);
    expect(() => parseIconConnectArtifact(JSON.stringify({ ...base, publicKey: { ...PUBLIC_JWK, crv: 'P-384' } }))).toThrow(/public-only EC P-256/i);
    expect(() => parseIconConnectArtifact(JSON.stringify({ ...base, publicKey: { ...PUBLIC_JWK, kty: 'RSA' } }))).toThrow(/public-only EC P-256/i);
    expect(() => parseIconConnectArtifact(JSON.stringify({ ...base, publicKey: { ...PUBLIC_JWK, key_ops: ['sign', 'verify'] } }))).toThrow(/public-only EC P-256/i);
  });

  it('rejects coordinate fields that are not 32-byte base64url', () => {
    expect(isPublicEcP256Jwk({ ...PUBLIC_JWK, x: 'short' })).toBe(false);
    expect(isPublicEcP256Jwk({ ...PUBLIC_JWK, y: '!!!not-base64url!!!' })).toBe(false);
    expect(isPublicEcP256Jwk({ ...PUBLIC_JWK, x: 42 })).toBe(false);
    expect(isPublicEcP256Jwk(null)).toBe(false);
    expect(isPublicEcP256Jwk('EC')).toBe(false);
  });
});

describe('icon_connect.json is a descriptor, not a credential (test 7)', () => {
  it('cannot authenticate by itself: it carries no signature, token, or secret', () => {
    const artifact = parseIconConnectArtifact(VALID_TEXT);
    expect(artifact.publicKey).toMatchObject({ kty: 'EC', crv: 'P-256', key_ops: ['verify'] });
    expect('sign' in artifact).toBe(false);
    expect('signature' in artifact).toBe(false);
    // The private key lives only as a non-extractable CryptoKey in the local
    // key store; the file provably cannot sign anything.
    const raw = serializeIconConnectArtifact(artifact);
    expect(raw).not.toMatch(/signature|challenge/i);
  });
});
