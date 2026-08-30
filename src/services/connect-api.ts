/**
 * Client for the Render-hosted ICON Connect endpoints.
 *
 * The username and password exist ONLY in the transient request payloads
 * below (over HTTPS to the trusted Render server). This module is stateless:
 * it never stores, caches, or persists either credential, and it never logs
 * request bodies.
 */
import { buildIconConnectArtifact, type IconConnectArtifact } from '../connect/icon-connect.js';
import type { LocalInstance } from './instance-identity.js';

/** The same Render process that serves `/realtime` (ws) also serves the
 * connect HTTP endpoints; derive the HTTP origin from the realtime URL. */
export function connectApiBaseUrl(): string | null {
  const realtimeUrl = import.meta.env.VITE_REALTIME_URL?.trim();
  if (!realtimeUrl) return null;
  return realtimeUrl.replace(/^wss?/, 'http').replace(/\/+$/, '');
}

export interface ConnectChallenge {
  challengeId: string;
  challenge: string;
  expiresAt: string;
}

export interface ConnectSession {
  accessToken: string;
  refreshToken: string;
}

export interface ConnectProfile {
  userId: string;
  username: string | null;
  boundInstanceId: string | null;
}

export interface ConnectRegistration {
  session: ConnectSession;
  profile: ConnectProfile;
}

export class ConnectApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'ConnectApiError';
  }
}

export class ConnectApi {
  constructor(private readonly baseUrl: string) {}

  /** Ask the server for a short-lived, single-use challenge scoped to one
   * operation (currently `register`). The server binds the challenge to the
   * presented instanceId + public key. */
  async requestChallenge(input: {
    instanceId: string;
    publicKey: JsonWebKey;
    operation: string;
  }): Promise<ConnectChallenge> {
    const body = await this.post('/api/connect/challenge', {
      instanceId: input.instanceId,
      publicKey: input.publicKey,
      operation: input.operation,
    });
    return body as ConnectChallenge;
  }

  /** Prove instance possession with a challenge signature and create the
   * account. The password travels only inside this HTTPS request body. */
  async register(input: {
    username: string;
    password: string;
    instanceId: string;
    challengeId: string;
    signature: string;
  }): Promise<ConnectRegistration> {
    const body = await this.post('/api/connect/register', {
      username: input.username,
      password: input.password,
      instanceId: input.instanceId,
      challengeId: input.challengeId,
      signature: input.signature,
    });
    return body as ConnectRegistration;
  }

  /** Username/password login. The password travels only inside this HTTPS
   * request body. */
  async login(input: { username: string; password: string }): Promise<ConnectRegistration> {
    const body = await this.post('/api/connect/login', { username: input.username, password: input.password });
    return body as ConnectRegistration;
  }

  /** The current profile/binding state, fetched from server state with the
   * player's opaque Supabase access token. */
  async profile(accessToken: string): Promise<ConnectProfile> {
    const response = await fetch(`${this.baseUrl}/api/connect/status`, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const body = await this.readBody(response);
    if (!response.ok) throw this.errorFrom(body, response.status);
    return body as ConnectProfile;
  }

  private async post(path: string, payload: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new ConnectApiError('The connection service is unreachable.', 0, 'connect.unreachable');
    }
    const body = await this.readBody(response);
    if (!response.ok) throw this.errorFrom(body, response.status);
    return body;
  }

  private async readBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { error: 'The connection service returned an unreadable response.' };
    }
  }

  private errorFrom(body: unknown, status: number): ConnectApiError {
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const record = body as Record<string, unknown>;
      if (typeof record.error === 'string' && typeof record.code === 'string') {
        return new ConnectApiError(record.error, status, record.code);
      }
    }
    return new ConnectApiError('The connection service could not complete the request.', status, 'connect.failed');
  }
}

export function createConnectApi(baseUrl: string | null = connectApiBaseUrl()): ConnectApi | null {
  return baseUrl ? new ConnectApi(baseUrl) : null;
}

/** Build the public icon_connect.json descriptor for the local instance. */
export function iconConnectArtifactFor(instance: LocalInstance): IconConnectArtifact {
  return buildIconConnectArtifact(instance.instanceId, instance.publicKey);
}
