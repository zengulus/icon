import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateInstanceKeyPair, exportPublicJwk, signChallenge } from '../../src/connect/crypto.js';
import { ConnectService, type ConnectServiceDependencies } from '../connect.js';

/**
 * A programmable fake of the small Supabase admin surface ConnectService
 * touches. It emulates the real table semantics that matter here: unique
 * username, one authoritative instance->user binding, session issuance, and
 * transactional profile+binding writes.
 */
class FakeAdmin {
  readonly calls: Array<{ name: string; args: unknown }> = [];
  readonly users = new Map<string, { id: string; email: string; password: string }>();
  readonly profiles = new Map<string, { user_id: string; username_normalized: string; username_display: string }>();
  readonly instances = new Map<string, { instance_id: string; user_id: string; public_key: unknown; revoked_at: string | null }>();
  readonly sessions = new Map<string, string>();
  failBind = false;
  bindErrorMessage = '';

  auth = {
    admin: {
      createUser: async (input: { email: string; password: string }) => {
        this.calls.push({ name: 'admin.createUser', args: input });
        const id = crypto.randomUUID();
        this.users.set(id, { id, email: input.email, password: input.password });
        return { data: { user: { id } }, error: null };
      },
      deleteUser: async (id: string) => {
        this.calls.push({ name: 'admin.deleteUser', args: { id } });
        this.users.delete(id);
        return { error: null };
      },
    },
    signInWithPassword: async (input: { email: string; password: string }) => {
      this.calls.push({ name: 'auth.signInWithPassword', args: { email: input.email } });
      const user = [...this.users.values()].find((candidate) => candidate.email === input.email);
      if (!user || user.password !== input.password) return { data: null, error: new Error('invalid credentials') };
      const token = crypto.randomUUID();
      this.sessions.set(token, user.id);
      return {
        data: { session: { access_token: token, refresh_token: crypto.randomUUID() }, user },
        error: null,
      };
    },
    getUser: async (token: string) => {
      const userId = this.sessions.get(token);
      if (!userId) return { data: null, error: new Error('no session') };
      return { data: { user: { id: userId } }, error: null };
    },
  };

  from(table: string) {
    const filters = new Map<string, unknown>();
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters.set(column, value); return query; },
      is: (column: string, value: unknown) => { filters.set(`is:${column}`, value); return query; },
      limit: () => query,
      maybeSingle: async () => {
        const matches = this.rows(table, filters);
        return { data: matches[0] ?? null, error: null };
      },
    };
    return query;
  }

  async rpc(name: string, args: Record<string, unknown>) {
    this.calls.push({ name: `rpc.${name}`, args });
    if (name === 'connect_bind_instance') {
      if (this.failBind) return { data: null, error: new Error(this.bindErrorMessage || 'binding failed') };
      const username = String(args.p_username_normalized);
      if ([...this.profiles.values()].some((profile) => profile.username_normalized === username)) {
        return { data: null, error: new Error('duplicate key value violates unique constraint "player_profiles_username_unique"') };
      }
      const instanceId = String(args.p_instance_id);
      if (this.instances.has(instanceId)) {
        return { data: null, error: new Error('duplicate key value violates unique constraint "user_instances_pkey"') };
      }
      const userId = String(args.p_user_id);
      this.profiles.set(userId, {
        user_id: userId,
        username_normalized: username,
        username_display: String(args.p_username_display),
      });
      this.instances.set(instanceId, {
        instance_id: instanceId,
        user_id: userId,
        public_key: args.p_public_key,
        revoked_at: null,
      });
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }

  private rows(table: string, filters: Map<string, unknown>): Array<Record<string, unknown>> {
    if (table === 'player_profiles') {
      return [...this.profiles.values()].filter((row) => {
        for (const [column, value] of filters) {
          if (column === 'user_id' && row.user_id !== value) return false;
          if (column === 'username_normalized' && row.username_normalized !== value) return false;
        }
        return true;
      });
    }
    if (table === 'user_instances') {
      return [...this.instances.values()].filter((row) => {
        for (const [column, value] of filters) {
          if (column === 'instance_id' && row.instance_id !== value) return false;
          if (column === 'user_id' && row.user_id !== value) return false;
          if (column === 'is:revoked_at' && value === null && row.revoked_at !== null) return false;
        }
        return true;
      });
    }
    return [];
  }
}

const INSTANCE = '11111111-2222-3333-4444-555555555555';
const OTHER_INSTANCE = '99999999-8888-7777-6666-555555555555';

function makeService(admin = new FakeAdmin()): { service: ConnectService; admin: FakeAdmin } {
  const dependencies: ConnectServiceDependencies = {
    admin: admin as never,
    pepper: 'test-pepper',
  };
  return { service: new ConnectService(dependencies), admin };
}

async function instanceKeyPair() {
  const pair = await generateInstanceKeyPair();
  const publicKey = await exportPublicJwk(pair.publicKey);
  return { pair, publicKey };
}

async function registeredInstance(
  admin: FakeAdmin,
  username = 'Douglas',
  password = 'correct-horse-9',
  instanceId = INSTANCE,
) {
  const { service } = makeService(admin);
  const { pair, publicKey } = await instanceKeyPair();
  const challenge = await service.requestChallenge({ instanceId, publicKey, operation: 'register' });
  const signature = await signChallenge(pair.privateKey, challenge.challenge);
  const result = await service.register({
    username,
    password,
    instanceId,
    challengeId: challenge.challengeId,
    signature,
  });
  return { service, admin, pair, publicKey, result };
}

describe('ConnectService account registration and binding (tests 21–25, 28–30)', () => {
  it('registers a username/password account and binds the proven instance (test 28)', async () => {
    const admin = new FakeAdmin();
    const { result, publicKey } = await registeredInstance(admin);
    expect(result.session.accessToken).toBeTruthy();
    expect(result.profile).toMatchObject({ username: 'Douglas' });
    expect(admin.instances.get(INSTANCE)).toMatchObject({ instance_id: INSTANCE, user_id: result.profile.userId });
    // The bound public key is the one the challenge was issued for.
    expect(admin.instances.get(INSTANCE)?.public_key).toEqual(publicKey);
  });

  it('never binds the same instance to a second backend user (test 21)', async () => {
    const admin = new FakeAdmin();
    const { result } = await registeredInstance(admin);
    // A second registration attempt for the SAME instance (even with a valid
    // fresh challenge from that instance's key) must be refused.
    const second = makeService(admin);
    const { pair, publicKey } = await instanceKeyPair();
    const challenge = await second.service.requestChallenge({ instanceId: INSTANCE, publicKey, operation: 'register' });
    const signature = await signChallenge(pair.privateKey, challenge.challenge);
    await expect(second.service.register({
      username: 'Other',
      password: 'another-pass-1',
      instanceId: INSTANCE,
      challengeId: challenge.challengeId,
      signature,
    })).rejects.toMatchObject({ code: 'register.instance-bound', status: 409 });
    expect([...admin.instances.values()]).toHaveLength(1);
    expect([...admin.instances.values()][0]).toMatchObject({ user_id: result.profile.userId });
  });

  it('rejects a signature made by a different key than the challenge instance (test 22)', async () => {
    const admin = new FakeAdmin();
    const { service } = makeService(admin);
    const { pair, publicKey } = await instanceKeyPair();
    const challenge = await service.requestChallenge({ instanceId: INSTANCE, publicKey, operation: 'register' });
    const other = await instanceKeyPair();
    const signature = await signChallenge(other.pair.privateKey, challenge.challenge);
    await expect(service.register({
      username: 'Douglas',
      password: 'correct-horse-9',
      instanceId: INSTANCE,
      challengeId: challenge.challengeId,
      signature,
    })).rejects.toMatchObject({ code: 'register.challenge', status: 400 });
  });

  it('rejects a challenge bound to a different instanceId than the registration presents (test 22)', async () => {
    const admin = new FakeAdmin();
    const { service } = makeService(admin);
    const { pair, publicKey } = await instanceKeyPair();
    const challenge = await service.requestChallenge({ instanceId: INSTANCE, publicKey, operation: 'register' });
    const signature = await signChallenge(pair.privateKey, challenge.challenge);
    await expect(service.register({
      username: 'Douglas',
      password: 'correct-horse-9',
      instanceId: OTHER_INSTANCE,
      challengeId: challenge.challengeId,
      signature,
    })).rejects.toMatchObject({ code: 'register.challenge', status: 400 });
  });

  it('replays a used challenge and fails; only one account results (tests 9–11)', async () => {
    const admin = new FakeAdmin();
    const { service } = makeService(admin);
    const { pair, publicKey } = await instanceKeyPair();
    const challenge = await service.requestChallenge({ instanceId: INSTANCE, publicKey, operation: 'register' });
    const signature = await signChallenge(pair.privateKey, challenge.challenge);
    await service.register({
      username: 'Douglas',
      password: 'correct-horse-9',
      instanceId: INSTANCE,
      challengeId: challenge.challengeId,
      signature,
    });
    await expect(service.register({
      username: 'Douglas2',
      password: 'correct-horse-9',
      instanceId: INSTANCE,
      challengeId: challenge.challengeId,
      signature,
    })).rejects.toMatchObject({ code: 'register.challenge' });
    expect([...admin.profiles.values()].filter((profile) => profile.username_normalized === 'douglas')).toHaveLength(1);
  });

  it('cleans up the auth user when the binding transaction fails (test 25 / partial failure)', async () => {
    const admin = new FakeAdmin();
    const { service } = makeService(admin);
    admin.failBind = true;
    admin.bindErrorMessage = 'duplicate key value violates unique constraint "player_profiles_username_unique"';
    const { pair, publicKey } = await instanceKeyPair();
    const challenge = await service.requestChallenge({ instanceId: INSTANCE, publicKey, operation: 'register' });
    const signature = await signChallenge(pair.privateKey, challenge.challenge);
    await expect(service.register({
      username: 'Douglas',
      password: 'correct-horse-9',
      instanceId: INSTANCE,
      challengeId: challenge.challengeId,
      signature,
    })).rejects.toMatchObject({ code: 'register.username-taken' });
    // No half-created account: the auth user was deleted and nothing bound.
    expect(admin.users.size).toBe(0);
    expect(admin.instances.has(INSTANCE)).toBe(false);
    expect(admin.calls.some((call) => call.name === 'admin.deleteUser')).toBe(true);
  });

  it('maps a username unique-violation race to a generic error (test 25)', async () => {
    const admin = new FakeAdmin();
    const { service } = makeService(admin);
    const { pair, publicKey } = await instanceKeyPair();
    const challenge = await service.requestChallenge({ instanceId: INSTANCE, publicKey, operation: 'register' });
    const signature = await signChallenge(pair.privateKey, challenge.challenge);
    admin.failBind = true;
    admin.bindErrorMessage = 'duplicate key value violates unique constraint "player_profiles_username_unique"';
    await expect(service.register({
      username: 'Douglas',
      password: 'correct-horse-9',
      instanceId: INSTANCE,
      challengeId: challenge.challengeId,
      signature,
    })).rejects.toMatchObject({ code: 'register.username-taken' });
  });

  it('login verifies credentials without touching the instance binding (tests 19, 25)', async () => {
    const admin = new FakeAdmin();
    const { result } = await registeredInstance(admin);
    const { service } = makeService(admin);
    const before = [...admin.instances.values()].map((row) => row.instance_id);
    const loggedIn = await service.login({ username: 'DOUGLAS', password: 'correct-horse-9' });
    expect(loggedIn.profile).toMatchObject({ userId: result.profile.userId, username: 'Douglas' });
    // Login never reassigns or mutates bindings.
    expect([...admin.instances.values()].map((row) => row.instance_id)).toEqual(before);
    await expect(service.login({ username: 'douglas', password: 'wrong-password' })).rejects.toMatchObject({
      code: 'login.invalid',
      status: 401,
    });
    // Generic failure: does not reveal whether the username exists.
    await expect(service.login({ username: 'nobody-here', password: 'correct-horse-9' })).rejects.toMatchObject({
      code: 'login.invalid',
      message: 'Invalid username or password.',
    });
  });

  it('rejects malformed or oversized inputs before any expensive work', async () => {
    const admin = new FakeAdmin();
    const { service } = makeService(admin);
    const { pair, publicKey } = await instanceKeyPair();
    const challenge = await service.requestChallenge({ instanceId: INSTANCE, publicKey, operation: 'register' });
    await expect(service.register({
      username: 'a',
      password: 'correct-horse-9',
      instanceId: INSTANCE,
      challengeId: challenge.challengeId,
      signature: '',
    })).rejects.toMatchObject({ code: 'request.invalid' });
    await expect(service.register({
      username: 'Douglas',
      password: 'short',
      instanceId: INSTANCE,
      challengeId: challenge.challengeId,
      signature: 'a'.repeat(200),
    })).rejects.toMatchObject({ code: 'request.invalid' });
    await expect(service.requestChallenge({ instanceId: 'not-a-uuid', publicKey, operation: 'register' })).rejects.toMatchObject({
      code: 'request.invalid',
    });
    await expect(service.requestChallenge({ instanceId: INSTANCE, publicKey, operation: 'exploit' })).rejects.toMatchObject({
      code: 'request.invalid',
    });
  });

  it('status resolves the profile and binding for a valid session token (test 25)', async () => {
    const admin = new FakeAdmin();
    const { result } = await registeredInstance(admin);
    const { service } = makeService(admin);
    const profile = await service.profile(result.session.accessToken);
    expect(profile).toMatchObject({ userId: result.profile.userId, username: 'Douglas', boundInstanceId: INSTANCE });
    expect(await service.profile('bogus-token')).toBeNull();
  });

  it('rejects account work when the deployment is not configured (fail closed)', async () => {
    const { service } = makeService(null as never);
    await expect(service.requestChallenge({
      instanceId: INSTANCE,
      publicKey: { kty: 'EC', crv: 'P-256', x: 'a'.repeat(43), y: 'b'.repeat(43) },
      operation: 'register',
    })).rejects.toMatchObject({ code: 'connect.unconfigured', status: 503 });
  });
});

describe('ConnectService rate limiting (test 20)', () => {
  it('blocks registration beyond the per-caller window and allows others', async () => {
    const { service } = makeService();
    for (let index = 0; index < 5; index += 1) expect(service.allowRegister('ip-1')).toBe(true);
    expect(service.allowRegister('ip-1')).toBe(false);
    expect(service.allowRegister('ip-2')).toBe(true);
    for (let index = 0; index < 10; index += 1) expect(service.allowLogin('ip-1')).toBe(true);
    expect(service.allowLogin('ip-1')).toBe(false);
  });
});

describe('DB authority and RLS guards exist in the migration (tests 25, 29, 30)', () => {
  const migration = readFileSync(
    fileURLToPath(new URL('../../supabase/migrations/202608301100_icon_connect_identity.sql', import.meta.url)),
    'utf8',
  );

  it('requires the creator instance to be bound to the session owner before any character write (test 29)', () => {
    expect(migration).toContain('target_creator_instance_id');
    expect(migration).toMatch(/bound_user is null or bound_user <> session_user/);
    expect(migration).toMatch(/raise exception 'creator instance is not bound to this account'/);
  });

  it('never trusts client-supplied ownerId as authorization authority (test 30)', () => {
    expect(migration).toMatch(/Never trust IconCharacter\.ownerId from client JSON as authorization/);
    expect(migration).toContain('jsonb_set(coalesce(target_data');
    // Direct browser writes are revoked; only the session-owner RPC path remains.
    expect(migration).toMatch(/revoke all on table public\.characters from anon, authenticated/);
  });

  it('keeps profiles and instance bindings private from anonymous and cross-user reads', () => {
    expect(migration).toMatch(/revoke all on table public\.player_profiles from anon, authenticated/);
    expect(migration).toMatch(/revoke all on table public\.user_instances from anon, authenticated/);
    expect(migration).toContain('create policy "players view own profile"');
    expect(migration).toContain('create policy "players view own instances"');
  });

  it('does not persist the username into Supabase user metadata or any auth-adjacent column', () => {
    expect(migration).not.toMatch(/user_metadata|app_metadata/);
  });
});
