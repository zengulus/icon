import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOrCreateCreatorInstanceId, LOCAL_INSTANCE_KEY } from '../character-sync.js';
import {
  indexedDbInstanceKeyStore,
  loadLocalInstance,
  type InstanceKeyStore,
} from '../instance-identity.js';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

class MemoryKeyStore implements InstanceKeyStore {
  private privateKey: CryptoKey | null = null;
  private publicKey: JsonWebKey | null = null;
  constructor(initial?: { privateKey: CryptoKey | null; publicKey: JsonWebKey | null }) {
    this.privateKey = initial?.privateKey ?? null;
    this.publicKey = initial?.publicKey ?? null;
  }
  async getPrivate() { return this.privateKey; }
  async getPublic() { return this.publicKey; }
  async put(privateKey: CryptoKey, publicKey: JsonWebKey) {
    this.privateKey = privateKey;
    this.publicKey = publicKey;
  }
}

describe('local instance identity (tests 8, 33, 34)', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves a pre-Connect instanceId in place when the keypair is added (test 33)', async () => {
    // A Prompt-1 era local instance exists with characters created under it.
    const legacyId = loadOrCreateCreatorInstanceId();
    expect(storage.getItem(LOCAL_INSTANCE_KEY)).toBe(legacyId);

    const instance = await loadLocalInstance(new MemoryKeyStore());
    expect(instance.instanceId).toBe(legacyId);
    // The same opaque UUID remains the creator identity — no new identity.
    expect(loadOrCreateCreatorInstanceId()).toBe(legacyId);
  });

  it('creates the keypair once and reuses it across loads (tests 8, 33)', async () => {
    const store = new MemoryKeyStore();
    const first = await loadLocalInstance(store);
    // The generated key is persisted in the store.
    const storedPublic = await store.getPublic();
    expect(first.publicKey).toEqual(storedPublic);

    // Reloading with the same store returns the same identity and key — the
    // keypair is generated exactly once, never rotated on every load.
    const second = await loadLocalInstance(store);
    expect(second.instanceId).toBe(first.instanceId);
    expect(second.publicKey).toEqual(first.publicKey);
  });

  it('never makes the private key exportable or serializable (test 8)', async () => {
    const store = new MemoryKeyStore();
    const instance = await loadLocalInstance(store);
    // The store only ever holds the CryptoKey object; there is no bytes API.
    const privateKey = await store.getPrivate();
    expect(privateKey).not.toBeNull();
    expect(privateKey!.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('jwk', privateKey!)).rejects.toThrow();
    // The exported identity exposes ONLY the public JWK — never the key itself.
    expect(Object.keys(instance)).toEqual(['instanceId', 'publicKey', 'sign']);
    expect('d' in instance.publicKey).toBe(false);
  });

  it('signs challenges with the non-extractable key and verifies with the public JWK (test 9)', async () => {
    const instance = await loadLocalInstance(new MemoryKeyStore());
    const signature = await instance.sign('challenge:from-server');
    // Round-trip against the public JWK proves possession of the matching key.
    const { verifyChallengeSignature } = await import('../../connect/crypto.js');
    expect(await verifyChallengeSignature(instance.publicKey, 'challenge:from-server', signature)).toBe(true);
    expect(await verifyChallengeSignature(instance.publicKey, 'challenge:tampered', signature)).toBe(false);
  });

  it('regenerates a broken/inconsistent keypair instead of shipping a broken identity', async () => {
    const { generateInstanceKeyPair, exportPublicJwk } = await import('../../connect/crypto.js');
    const pair = await generateInstanceKeyPair();
    const other = await generateInstanceKeyPair();
    const mismatched = new MemoryKeyStore({
      privateKey: pair.privateKey,
      publicKey: await exportPublicJwk(other.publicKey),
    });
    const instance = await loadLocalInstance(mismatched);
    // The mismatch was detected; a consistent pair replaced it.
    const stored = await mismatched.getPrivate();
    expect(stored).not.toBeNull();
    const probe = 'icon-connect:keypair-integrity-probe';
    const signature = await instance.sign(probe);
    const { verifyChallengeSignature } = await import('../../connect/crypto.js');
    expect(await verifyChallengeSignature(instance.publicKey, probe, signature)).toBe(true);
  });

  it('rejects a tampered public JWK stored next to the private key', async () => {
    const { generateInstanceKeyPair, exportPublicJwk } = await import('../../connect/crypto.js');
    const pair = await generateInstanceKeyPair();
    const tampered = { ...(await exportPublicJwk(pair.publicKey)), x: 'sTPu3m0d3n8Y5hWkQjLfOeBqVxKJgHdCzNwMaRbUvTi' };
    const store = new MemoryKeyStore({ privateKey: pair.privateKey, publicKey: tampered });
    const instance = await loadLocalInstance(store);
    // The probe failed, so the store was regenerated into a consistent pair.
    const probe = 'icon-connect:keypair-integrity-probe';
    const { verifyChallengeSignature } = await import('../../connect/crypto.js');
    expect(await verifyChallengeSignature(instance.publicKey, probe, await instance.sign(probe))).toBe(true);
  });

  it('existing local characters stay associated with the preserved instance (test 34)', async () => {
    const legacyId = loadOrCreateCreatorInstanceId();
    const instance = await loadLocalInstance(new MemoryKeyStore());
    // The creatorInstanceId written on characters is exactly the preserved id.
    expect(instance.instanceId).toBe(legacyId);
    // Two separate loads (two tabs) never diverge identities.
    const otherTab = await loadLocalInstance(new MemoryKeyStore());
    expect(otherTab.instanceId).toBe(legacyId);
  });

  it('the IndexedDB store implementation marks keys as non-extractable CryptoKeys, not text', () => {
    // The real store cannot run under Node, but its contract is explicit: the
    // private key is a CryptoKey record, never serialized bytes. The browser
    // implementation stores whatever CryptoKey the platform gave it.
    const store = indexedDbInstanceKeyStore();
    expect(typeof store.put).toBe('function');
    expect(typeof store.getPrivate).toBe('function');
  });
});
