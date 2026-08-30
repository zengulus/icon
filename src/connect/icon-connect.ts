/**
 * icon_connect.json — the versioned PUBLIC binding artifact / instance
 * descriptor.
 *
 * It describes a local player instance: the stable instanceId and its public
 * key. It is deliberately NOT an authentication secret:
 *
 * - it never contains a username, password, password hash, email, Supabase
 *   access/refresh token, session cookie, private key, or service-role key;
 * - possession of the file alone proves nothing (there is no private key in
 *   it), so importing it never logs anyone in, grants network permissions, or
 *   claims characters;
 * - the server's instance→user binding is authoritative and keyed by
 *   signatures, never by this file.
 *
 * Parsing is strict and fail-closed: expected kind, supported schema version,
 * valid UUID, a real EC P-256 public-only JWK, sane field sizes, and an exact
 * key set (no extra/executable data, no prototype-pollution payload).
 */
import { base64UrlDecode } from './crypto.js';

export const ICON_CONNECT_KIND = 'icon-connect';
export const ICON_CONNECT_SCHEMA_VERSION = 1;
/** Rough cap so a connect file cannot smuggle a huge payload past parsers. */
export const ICON_CONNECT_MAX_BYTES = 16 * 1024;
/** P-256 coordinates are 32 bytes → 43 base64url characters. */
const COORDINATE_MAX_CHARS = 64;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Fields a PUBLIC EC JWK may carry; anything else (notably `d`) is rejected. */
const PUBLIC_JWK_ALLOWED_KEYS = new Set(['kty', 'crv', 'x', 'y', 'ext', 'key_ops', 'alg']);

export interface IconConnectArtifact {
  kind: typeof ICON_CONNECT_KIND;
  schemaVersion: typeof ICON_CONNECT_SCHEMA_VERSION;
  instanceId: string;
  publicKey: JsonWebKey;
  createdAt: string;
}

export function buildIconConnectArtifact(
  instanceId: string,
  publicKey: JsonWebKey,
  now = new Date().toISOString(),
): IconConnectArtifact {
  if (!isPublicEcP256Jwk(publicKey)) {
    throw new Error('The local instance has no valid public key to export.');
  }
  return {
    kind: ICON_CONNECT_KIND,
    schemaVersion: ICON_CONNECT_SCHEMA_VERSION,
    instanceId,
    publicKey,
    createdAt: now,
  };
}

export function serializeIconConnectArtifact(artifact: IconConnectArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

/** True only for a public-only EC P-256 JWK with sane coordinate sizes. */
export function isPublicEcP256Jwk(value: unknown): value is JsonWebKey {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const jwk = value as Record<string, unknown>;
  if (Object.keys(jwk).some((key) => !PUBLIC_JWK_ALLOWED_KEYS.has(key))) return false;
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') return false;
  if (typeof jwk.x !== 'string' || typeof jwk.y !== 'string') return false;
  if (jwk.x.length < 1 || jwk.x.length > COORDINATE_MAX_CHARS || jwk.y.length < 1 || jwk.y.length > COORDINATE_MAX_CHARS) return false;
  try {
    if (base64UrlDecode(jwk.x).length !== 32 || base64UrlDecode(jwk.y).length !== 32) return false;
  } catch {
    return false;
  }
  // A public artifact must never carry a private component.
  if ('d' in jwk || 'dp' in jwk || 'dq' in jwk || 'p' in jwk || 'q' in jwk || 'qi' in jwk || 'oth' in jwk) return false;
  if (jwk.key_ops !== undefined) {
    if (!Array.isArray(jwk.key_ops) || jwk.key_ops.length !== 1 || jwk.key_ops[0] !== 'verify') return false;
  }
  if (jwk.ext !== undefined && jwk.ext !== true) return false;
  if (jwk.alg !== undefined && (typeof jwk.alg !== 'string' || jwk.alg.length > 16)) return false;
  return true;
}

function assertInstanceId(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64 || !UUID_PATTERN.test(value)) {
    throw new Error(`${path} must be a valid UUID.`);
  }
  return value;
}

function assertCreatedAt(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 40 || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${path} must be an ISO-8601 timestamp.`);
  }
  return value;
}

/**
 * Strictly parse and validate an icon_connect.json payload. Throws on any
 * malformed input; it never executes or adopts anything from the JSON.
 */
export function parseIconConnectArtifact(text: string): IconConnectArtifact {
  if (typeof text !== 'string' || text.length < 1 || text.length > ICON_CONNECT_MAX_BYTES) {
    throw new Error('The connect file is empty or too large.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (reason) {
    throw new Error(`The connect file is not valid JSON: ${reason instanceof Error ? reason.message : 'parse failed.'}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The connect file must be a JSON object.');
  }
  const artifact = parsed as Record<string, unknown>;
  // Exact key set: no extra fields, no prototype-pollution or executable data.
  const expectedKeys = ['kind', 'schemaVersion', 'instanceId', 'publicKey', 'createdAt'];
  const unexpected = Object.keys(artifact).find((key) => !expectedKeys.includes(key));
  if (unexpected) throw new Error(`The connect file has an unsupported field "${unexpected}".`);
  for (const key of expectedKeys) {
    if (!(key in artifact)) throw new Error(`The connect file is missing "${key}".`);
  }
  if (artifact.kind !== ICON_CONNECT_KIND) {
    throw new Error(`The connect file kind must be "${ICON_CONNECT_KIND}".`);
  }
  if (artifact.schemaVersion !== ICON_CONNECT_SCHEMA_VERSION) {
    throw new Error(`Unsupported icon_connect schema version ${String(artifact.schemaVersion)}.`);
  }
  const instanceId = assertInstanceId(artifact.instanceId, 'instanceId');
  const createdAt = assertCreatedAt(artifact.createdAt, 'createdAt');
  if (!isPublicEcP256Jwk(artifact.publicKey)) {
    throw new Error('The connect file public key must be a public-only EC P-256 JWK.');
  }
  return {
    kind: ICON_CONNECT_KIND,
    schemaVersion: ICON_CONNECT_SCHEMA_VERSION,
    instanceId,
    publicKey: artifact.publicKey as JsonWebKey,
    createdAt,
  };
}
