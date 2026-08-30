/**
 * ICON CONNECT — server-mediated account creation, login, and instance
 * binding.
 *
 * The Render/Express server is the trusted boundary: the Supabase service
 * role key never reaches the browser, all username/password handling happens
 * here (over HTTPS), and the instance→user binding is authoritative and
 * challenge-proven.
 *
 * Security properties:
 * - The password exists only in the transient request body (bounded in size,
 *   never logged, never echoed in errors) and inside Supabase Auth's normal
 *   credential path. Our application never stores it anywhere.
 * - Registration requires a fresh, single-use, short-lived challenge signed
 *   by the instance's non-extractable private key; the signature must verify
 *   against the public key the challenge was issued for.
 * - Username uniqueness is enforced by the database; collisions return a
 *   generic error. The internal auth email is opaque (HMAC-keyed), never
 *   exposed, and unrelated to the plaintext username.
 * - A bound instance can never bind to a second backend user: the binding
 *   row is authoritative and the server rejects any re-binding attempt.
 * - Account endpoints are rate-limited per caller, and absurd request sizes
 *   are rejected before any expensive work.
 */
import { Router, type Request, type Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { validateUsername } from '../src/connect/username.js';
import { isPublicEcP256Jwk } from '../src/connect/icon-connect.js';
import { verifyChallengeSignature } from '../src/connect/crypto.js';
import type { ServerConfig } from './config.js';
import { ChallengeStore, type StoredChallenge } from './challenges.js';
import { InMemoryRateLimiter } from './rate-limit.js';
import { internalAuthEmail } from './auth-email.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 72;
const MAX_SIGNATURE_CHARS = 128;
const MAX_INSTANCE_BINDINGS_PER_USER = 8;
/** Per-caller windows; deliberately conservative for credential endpoints. */
const REGISTER_LIMIT = 5;
const LOGIN_LIMIT = 10;
const AUTH_WINDOW_MS = 15 * 60_000;

/** An operation a challenge may be scoped to. */
export const CONNECT_CHALLENGE_OPERATIONS = ['register', 'login', 'bind'] as const;
export type ConnectChallengeOperation = (typeof CONNECT_CHALLENGE_OPERATIONS)[number];

export class ConnectError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ConnectError';
  }
}

export interface ConnectServiceDependencies {
  admin: SupabaseClient | null;
  /** Server-only HMAC pepper for the opaque internal auth email. */
  pepper: string;
  now?: () => number;
  challenges?: ChallengeStore;
  registerLimiter?: InMemoryRateLimiter;
  loginLimiter?: InMemoryRateLimiter;
}

export class ConnectService {
  private readonly admin: SupabaseClient | null;
  private readonly pepper: string;
  private readonly now: () => number;
  private readonly challenges: ChallengeStore;
  private readonly registerLimiter: InMemoryRateLimiter;
  private readonly loginLimiter: InMemoryRateLimiter;

  constructor(dependencies: ConnectServiceDependencies) {
    this.admin = dependencies.admin;
    this.pepper = dependencies.pepper;
    this.now = dependencies.now ?? Date.now;
    this.challenges = dependencies.challenges ?? new ChallengeStore(this.now);
    this.registerLimiter = dependencies.registerLimiter ?? new InMemoryRateLimiter(REGISTER_LIMIT, AUTH_WINDOW_MS, this.now);
    this.loginLimiter = dependencies.loginLimiter ?? new InMemoryRateLimiter(LOGIN_LIMIT, AUTH_WINDOW_MS, this.now);
  }

  private ensureConfigured(): SupabaseClient {
    if (!this.admin) {
      throw new ConnectError('Account creation is not configured on this deployment.', 503, 'connect.unconfigured');
    }
    if (!this.pepper) {
      throw new ConnectError('Account creation is not configured on this deployment.', 503, 'connect.unconfigured');
    }
    return this.admin;
  }

  /** Rate-limit a caller; the key is the IP at the HTTP layer. */
  allowRegister(key: string): boolean {
    return this.registerLimiter.allow(key);
  }

  allowLogin(key: string): boolean {
    return this.loginLimiter.allow(key);
  }

  /** Issue a fresh challenge bound to an instanceId + public key + operation. */
  async requestChallenge(body: unknown): Promise<{ challengeId: string; challenge: string; expiresAt: string }> {
    this.ensureConfigured();
    const input = requireObject(body, 'request');
    const instanceId = requireUuid(input.instanceId, 'instanceId');
    const operation = requireOperation(input.operation);
    if (!isPublicEcP256Jwk(input.publicKey)) {
      throw new ConnectError('The instance public key is invalid.', 400, 'challenge.public-key');
    }
    const challenge = this.challenges.create({ instanceId, publicKey: input.publicKey, operation });
    this.challenges.sweep();
    return {
      challengeId: challenge.id,
      challenge: challenge.challenge,
      expiresAt: new Date(challenge.expiresAt).toISOString(),
    };
  }

  /** Create a username/password account and bind THIS instance to it. */
  async register(body: unknown): Promise<{ session: { accessToken: string; refreshToken: string }; profile: { userId: string; username: string } }> {
    const admin = this.ensureConfigured();
    const input = requireObject(body, 'register');
    const username = requireUsername(input.username);
    const password = requirePassword(input.password);
    const instanceId = requireUuid(input.instanceId, 'instanceId');
    const challengeId = requireUuid(input.challengeId, 'challengeId');
    const signature = requireSignature(input.signature);

    // Instance possession proof: the challenge was issued for this exact
    // instance + public key, is single-use and short-lived, and the signature
    // must verify against that public key.
    const challenge = this.challenges.consume(challengeId, 'register');
    if (!challenge || challenge.instanceId !== instanceId) {
      throw new ConnectError('The connection challenge is invalid or expired. Try again.', 400, 'register.challenge');
    }
    if (!(await this.verifyChallenge(challenge, signature))) {
      throw new ConnectError('The connection challenge could not be verified. Try again.', 400, 'register.challenge');
    }

    // The instance binding is authoritative: a bound instance can never bind
    // to a second backend user, regardless of any edited local JSON.
    if (await this.instanceAlreadyBound(instanceId)) {
      throw new ConnectError('This device is already connected to an account.', 409, 'register.instance-bound');
    }
    if (await this.usernameTaken(username.normalized)) {
      throw new ConnectError('That username is already taken.', 409, 'register.username-taken');
    }

    // Never expose the internal auth locator; derive it opaquely server-side.
    const email = await internalAuthEmail(username.normalized, this.pepper);
    let createdUserId: string | null = null;
    try {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createError || !created?.user) {
        throw new ConnectError('Could not create the account. Please try again.', 500, 'register.create-failed');
      }
      createdUserId = created.user.id;
      // Profile + binding in ONE transaction; the unique constraints are the
      // final authority against races on username/instance.
      const { error: bindError } = await admin.rpc('connect_bind_instance', {
        p_user_id: created.user.id,
        p_username_normalized: username.normalized,
        p_username_display: username.display,
        p_instance_id: instanceId,
        p_public_key: challenge.publicKey,
      });
      if (bindError) throw this.bindingError(bindError);

      const { data: signedIn, error: signInError } = await admin.auth.signInWithPassword({ email, password });
      if (signInError || !signedIn?.session) {
        throw new ConnectError('The account was created but could not be signed in. Please log in.', 500, 'register.signin-failed');
      }
      return {
        session: {
          accessToken: signedIn.session.access_token,
          refreshToken: signedIn.session.refresh_token,
        },
        profile: { userId: created.user.id, username: username.display },
      };
    } catch (error) {
      // If auth-user creation succeeded but the binding transaction failed,
      // clean up deterministically: never leave a half-created account.
      if (createdUserId !== null) {
        await admin.auth.admin.deleteUser(createdUserId).catch(() => {
          // The account row may already be gone; nothing else to repair here.
        });
      }
      throw error;
    }
  }

  /** Username/password login. Credentials are verified by Supabase Auth; the
   * instance binding is NOT touched, so login can never reassign ownership.
   * Failures are generic. */
  async login(body: unknown): Promise<{ session: { accessToken: string; refreshToken: string }; profile: { userId: string; username: string } }> {
    const admin = this.ensureConfigured();
    const input = requireObject(body, 'login');
    const username = requireUsername(input.username);
    const password = requirePassword(input.password);

    const email = await internalAuthEmail(username.normalized, this.pepper);
    const { data, error } = await admin.auth.signInWithPassword({ email, password });
    if (error || !data?.session || !data.user) {
      throw new ConnectError('Invalid username or password.', 401, 'login.invalid');
    }
    const profile = await this.profileForUser(data.user.id);
    return {
      session: { accessToken: data.session.access_token, refreshToken: data.session.refresh_token },
      profile: { userId: data.user.id, username: profile.username ?? username.display },
    };
  }

  /** Current profile/binding status for an authenticated session token. */
  async profile(accessToken: string): Promise<{ userId: string; username: string | null; boundInstanceId: string | null } | null> {
    const admin = this.ensureConfigured();
    const { data, error } = await admin.auth.getUser(accessToken);
    if (error || !data?.user) return null;
    return this.profileForUser(data.user.id);
  }

  private async profileForUser(userId: string): Promise<{ userId: string; username: string | null; boundInstanceId: string | null }> {
    const admin = this.ensureConfigured();
    const { data: profile } = await admin.from('player_profiles')
      .select('username_display')
      .eq('user_id', userId)
      .maybeSingle();
    const { data: instance } = await admin.from('user_instances')
      .select('instance_id')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .limit(1)
      .maybeSingle();
    return {
      userId,
      username: profile?.username_display ?? null,
      boundInstanceId: instance?.instance_id ?? null,
    };
  }

  private async verifyChallenge(challenge: StoredChallenge, signature: string): Promise<boolean> {
    try {
      return await verifyChallengeSignature(challenge.publicKey, challenge.challenge, signature);
    } catch {
      return false;
    }
  }

  private async instanceAlreadyBound(instanceId: string): Promise<boolean> {
    const admin = this.ensureConfigured();
    const { data, error } = await admin.from('user_instances')
      .select('instance_id')
      .eq('instance_id', instanceId)
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new ConnectError('The connection service could not verify this device. Try again.', 503, 'register.verify-failed');
    }
    return data !== null;
  }

  private async usernameTaken(normalizedUsername: string): Promise<boolean> {
    const admin = this.ensureConfigured();
    const { data, error } = await admin.from('player_profiles')
      .select('user_id')
      .eq('username_normalized', normalizedUsername)
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new ConnectError('The connection service could not verify that username. Try again.', 503, 'register.verify-failed');
    }
    return data !== null;
  }

  /** Map binding failures to generic, non-leaking errors. Postgres reports
   * unique violations by constraint name, so match the table/column families
   * rather than exact messages. */
  private bindingError(bindError: unknown): ConnectError {
    const message = bindError instanceof Error ? bindError.message : String(bindError);
    if (message.includes('username')) {
      return new ConnectError('That username is already taken.', 409, 'register.username-taken');
    }
    if (message.includes('user_instances') || message.includes('instance_id')) {
      return new ConnectError('This device is already connected to an account.', 409, 'register.instance-bound');
    }
    return new ConnectError('Could not finish connecting this device. Try again.', 500, 'register.binding-failed');
  }
}

/* ============================================================================
 * Request validation helpers (fail closed, bounded before expensive work)
 * ========================================================================== */

function requireObject(body: unknown, name: string): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ConnectError(`The ${name} request is malformed.`, 400, 'request.invalid');
  }
  return body as Record<string, unknown>;
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64 || !UUID_PATTERN.test(value)) {
    throw new ConnectError(`The ${field} is invalid.`, 400, 'request.invalid');
  }
  return value;
}

function requireOperation(value: unknown): ConnectChallengeOperation {
  if (typeof value !== 'string' || !(CONNECT_CHALLENGE_OPERATIONS as readonly string[]).includes(value)) {
    throw new ConnectError('The challenge operation is invalid.', 400, 'request.invalid');
  }
  return value as ConnectChallengeOperation;
}

function requireUsername(value: unknown): { normalized: string; display: string } {
  const validation = validateUsername(value);
  if (!validation.ok) {
    throw new ConnectError(validation.message, 400, 'request.invalid');
  }
  return validation;
}

function requirePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
    throw new ConnectError(`Passwords must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters.`, 400, 'request.invalid');
  }
  return value;
}

function requireSignature(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_SIGNATURE_CHARS || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ConnectError('The challenge signature is invalid.', 400, 'request.invalid');
  }
  return value;
}

/* ============================================================================
 * Express router
 * ========================================================================== */

function sendConnectError(response: Response, error: unknown) {
  if (error instanceof ConnectError) {
    response.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  // Never echo request bodies or internal details on auth endpoints.
  response.status(500).json({ error: 'The connection service could not complete the request.', code: 'connect.failed' });
}

export function createConnectRouter(config: ServerConfig, dependencies: Partial<ConnectServiceDependencies> = {}): Router {
  const admin = dependencies.admin ?? (config.supabaseUrl && config.supabaseServiceRoleKey
    ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null);
  const service = new ConnectService({ admin, pepper: config.connectPepper, ...dependencies });
  const router = Router();

  const callerKey = (request: Request) => request.ip ?? 'unknown';

  router.post('/challenge', async (request, response) => {
    try {
      const result = await service.requestChallenge(request.body);
      response.json(result);
    } catch (error) {
      sendConnectError(response, error);
    }
  });

  router.post('/register', async (request, response) => {
    try {
      if (!service.allowRegister(callerKey(request))) {
        response.status(429).json({ error: 'Too many account attempts. Please wait and try again.', code: 'rate.limited' });
        return;
      }
      const result = await service.register(request.body);
      response.json(result);
    } catch (error) {
      sendConnectError(response, error);
    }
  });

  router.post('/login', async (request, response) => {
    try {
      if (!service.allowLogin(callerKey(request))) {
        response.status(429).json({ error: 'Too many login attempts. Please wait and try again.', code: 'rate.limited' });
        return;
      }
      const result = await service.login(request.body);
      response.json(result);
    } catch (error) {
      sendConnectError(response, error);
    }
  });

  router.get('/status', async (request, response) => {
    try {
      const token = request.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
      if (!token) {
        response.status(401).json({ error: 'Not signed in.', code: 'connect.unauthenticated' });
        return;
      }
      const profile = await service.profile(token);
      if (!profile) {
        response.status(401).json({ error: 'Not signed in.', code: 'connect.unauthenticated' });
        return;
      }
      response.json(profile);
    } catch (error) {
      sendConnectError(response, error);
    }
  });

  return router;
}
