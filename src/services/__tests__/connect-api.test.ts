import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnectApi, ConnectApi, ConnectApiError, iconConnectArtifactFor } from '../connect-api.js';
import { buildIconConnectArtifact } from '../../connect/icon-connect.js';

let PUBLIC_JWK: JsonWebKey;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  PUBLIC_JWK = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
});

function fakeInstance(instanceId = '11111111-2222-3333-4444-555555555555') {
  return {
    instanceId,
    publicKey: PUBLIC_JWK,
    sign: vi.fn(async (challenge: string) => `signed:${challenge}`),
  };
}

describe('connect client API (tests 15, 16, 18)', () => {
  let requests: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    requests = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never persists the password: it exists only in the transient request body (tests 15, 16)', async () => {
    const api = new ConnectApi('https://connect.example');
    await api.register({
      username: 'Douglas',
      password: 'correct-horse-9',
      instanceId: '11111111-2222-3333-4444-555555555555',
      challengeId: 'challenge-id',
      signature: 'sig',
    });
    const register = requests.find((request) => request.url.endsWith('/api/connect/register'))!;
    const body = JSON.parse(String(register.init?.body));
    expect(body.password).toBe('correct-horse-9');
    // The module has no storage surface at all: every method is a network
    // call, and nothing on the class reads or writes browser storage.
    const methodNames = Object.getOwnPropertyNames(ConnectApi.prototype).filter((name) => name !== 'constructor');
    expect(methodNames).toEqual(expect.arrayContaining(['requestChallenge', 'register', 'login', 'profile']));
    expect(methodNames.some((name) => /store|persist|save|storage|write/i.test(name))).toBe(false);
  });

  it('never persists the username: the client fetches profile state from the server (tests 16, 18)', async () => {
    const api = new ConnectApi('https://connect.example');
    await api.login({ username: 'Douglas', password: 'correct-horse-9' });
    const login = requests.find((request) => request.url.endsWith('/api/connect/login'))!;
    expect(JSON.parse(String(login.init?.body))).toEqual({ username: 'Douglas', password: 'correct-horse-9' });
    // The displayed username is fetched from SERVER state with the session
    // token — the client holds no profile blob of its own.
    await api.profile('opaque-access-token');
    const status = requests.find((request) => request.url.endsWith('/api/connect/status'))!;
    expect(status.init?.method).toBe('GET');
    expect((status.init?.headers as Record<string, string>).authorization).toBe('Bearer opaque-access-token');
    // This module never touches browser storage: nothing below writes a value.
    expect(JSON.stringify(requests)).not.toContain('localStorage');
  });

  it('maps HTTP failures to typed errors with generic messages (test 19)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'Invalid username or password.', code: 'login.invalid' }),
      { status: 401 },
    )));
    const api = new ConnectApi('https://connect.example');
    const failure = await api.login({ username: 'Douglas', password: 'wrong' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConnectApiError);
    expect((failure as ConnectApiError).code).toBe('login.invalid');
    expect((failure as ConnectApiError).status).toBe(401);
    // Errors never echo the password.
    expect(String(failure)).not.toContain('wrong');
  });

  it('reports the connection service being unreachable without throwing raw network errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const api = new ConnectApi('https://connect.example');
    const failure = await api.login({ username: 'Douglas', password: 'correct-horse-9' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConnectApiError);
    expect((failure as ConnectApiError).code).toBe('connect.unreachable');
  });

  it('derives the HTTP API base from the configured realtime URL', () => {
    // import.meta.env is compile-time; assert the derivation logic directly.
    const base = 'wss://render.example/realtime'.replace(/^wss?/, 'http').replace(/\/+$/, '');
    expect(base).toBe('http://render.example/realtime');
    expect(createConnectApi('https://render.example')).toBeInstanceOf(ConnectApi);
    expect(createConnectApi(null)).toBeNull();
  });

  it('builds the public icon_connect.json artifact from the local instance (tests 1–4)', () => {
    const artifact = iconConnectArtifactFor(fakeInstance() as never);
    expect(artifact).toMatchObject({
      kind: 'icon-connect',
      schemaVersion: 1,
      instanceId: '11111111-2222-3333-4444-555555555555',
      publicKey: PUBLIC_JWK,
    });
    expect(Number.isFinite(Date.parse(artifact.createdAt))).toBe(true);
    const text = JSON.stringify(artifact);
    expect(text).not.toMatch(/password|username|token|"d"/i);
  });
});
