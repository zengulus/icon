/**
 * LOCAL PLAYER INSTANCE IDENTITY (cryptographically bound)
 *
 * Upgrades the neutral local-instance seam (`loadOrCreateCreatorInstanceId`)
 * into a key-bearing identity:
 *
 * - `instanceId` stays the existing stable random UUID. A pre-Connect opaque
 *   instanceId (the Prompt-1 `icon.creatorInstanceId` localStorage value) is
 *   PRESERVED in place — no new creator identity is manufactured and no local
 *   characters are orphaned.
 * - A WebCrypto ECDSA P-256 keypair is generated in the browser. The private
 *   key is non-extractable (`extractable: false`) and is persisted ONLY as a
 *   `CryptoKey` object in IndexedDB — never serialized, never in
 *   localStorage, never in icon_connect.json, never in character records.
 * - The public key is exported as a public-only JWK (stored next to the
 *   private key so it can be re-read without ever exporting the private
 *   material) and is the only key material that leaves the device.
 * - There is deliberately no password-derived encryption and no home-grown
 *   cryptography: everything goes through the platform WebCrypto API.
 *
 * The exported identity signs server-issued challenge strings with the
 * non-extractable private key, proving instance possession at the binding
 * boundary. The public artifact (icon_connect.json) is a descriptor, not a
 * credential.
 */
import { loadOrCreateCreatorInstanceId } from './character-sync.js';
import {
  exportPublicJwk,
  generateInstanceKeyPair,
  signChallenge,
  verifyChallengeSignature,
} from '../connect/crypto.js';
import { isPublicEcP256Jwk } from '../connect/icon-connect.js';

/** Durable storage for the non-extractable private CryptoKey and the public
 * JWK. The real implementation is IndexedDB; tests inject an in-memory one. */
export interface InstanceKeyStore {
  getPrivate(): Promise<CryptoKey | null>;
  getPublic(): Promise<JsonWebKey | null>;
  put(privateKey: CryptoKey, publicKey: JsonWebKey): Promise<void>;
}

export interface LocalInstance {
  instanceId: string;
  /** Public-only JWK; the only key material that may leave the device. */
  publicKey: JsonWebKey;
  /** Sign the exact canonical challenge bytes with the non-extractable
   * private key. Returns a base64url raw r||s signature. */
  sign(challenge: string): Promise<string>;
}

const DB_NAME = 'icon-instance-keys';
const DB_VERSION = 1;
const KEY_STORE = 'keys';
const PRIVATE_KEY_RECORD = 'private';
const PUBLIC_KEY_RECORD = 'public';

function openKeyDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is unavailable; the local instance key cannot be stored.'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(KEY_STORE)) database.createObjectStore(KEY_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the local instance key store.'));
  });
}

/** Browser implementation: the private key lives as a CryptoKey record in
 * IndexedDB, never as serialized bytes. */
export function indexedDbInstanceKeyStore(): InstanceKeyStore {
  return {
    async getPrivate() {
      const database = await openKeyDatabase();
      try {
        return await new Promise<CryptoKey | null>((resolve, reject) => {
          const transaction = database.transaction(KEY_STORE, 'readonly');
          const request = transaction.objectStore(KEY_STORE).get(PRIVATE_KEY_RECORD);
          request.onsuccess = () => resolve((request.result as CryptoKey | undefined) ?? null);
          request.onerror = () => reject(request.error ?? new Error('Could not read the local instance key.'));
        });
      } finally {
        database.close();
      }
    },
    async getPublic() {
      const database = await openKeyDatabase();
      try {
        return await new Promise<JsonWebKey | null>((resolve, reject) => {
          const transaction = database.transaction(KEY_STORE, 'readonly');
          const request = transaction.objectStore(KEY_STORE).get(PUBLIC_KEY_RECORD);
          request.onsuccess = () => resolve((request.result as JsonWebKey | undefined) ?? null);
          request.onerror = () => reject(request.error ?? new Error('Could not read the local instance public key.'));
        });
      } finally {
        database.close();
      }
    },
    async put(privateKey, publicKey) {
      const database = await openKeyDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(KEY_STORE, 'readwrite');
          transaction.objectStore(KEY_STORE).put(privateKey, PRIVATE_KEY_RECORD);
          transaction.objectStore(KEY_STORE).put(publicKey, PUBLIC_KEY_RECORD);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error ?? new Error('Could not store the local instance key.'));
        });
      } finally {
        database.close();
      }
    },
  };
}

/** Prove a stored private key and public JWK actually belong together by
 * signing and verifying a probe. If the pair is inconsistent (or the public
 * key was tampered with), the caller regenerates both rather than shipping a
 * broken identity. */
async function keyPairMatches(privateKey: CryptoKey, publicKey: JsonWebKey): Promise<boolean> {
  if (!isPublicEcP256Jwk(publicKey)) return false;
  try {
    const probe = 'icon-connect:keypair-integrity-probe';
    const signature = await signChallenge(privateKey, probe);
    // `await` matters: without it, a rejected verify promise escapes the
    // try/catch instead of triggering regeneration of the broken pair.
    return await verifyChallengeSignature(publicKey, probe, signature);
  } catch {
    return false;
  }
}

/**
 * Load (or create) the local instance identity. The instanceId comes from the
 * same stable localStorage seam as character creation — a pre-Connect
 * instanceId is preserved exactly. The keypair is generated once and reused
 * thereafter from the key store.
 */
export async function loadLocalInstance(store: InstanceKeyStore = indexedDbInstanceKeyStore()): Promise<LocalInstance> {
  const instanceId = loadOrCreateCreatorInstanceId();
  let privateKey = await store.getPrivate();
  let publicKey = await store.getPublic();
  if (!privateKey || !publicKey || !(await keyPairMatches(privateKey, publicKey))) {
    const pair = await generateInstanceKeyPair();
    privateKey = pair.privateKey;
    publicKey = await exportPublicJwk(pair.publicKey);
    await store.put(privateKey, publicKey);
  }
  const signingKey = privateKey;
  return {
    instanceId,
    publicKey,
    sign(challenge) {
      return signChallenge(signingKey, challenge);
    },
  };
}
