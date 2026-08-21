import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';

afterEach(() => vi.unstubAllEnvs());

describe('test-only development authentication', () => {
  it('refuses dev tokens outside the explicit test runtime', () => {
    vi.stubEnv('ALLOW_DEV_AUTH', 'true');
    vi.stubEnv('NODE_ENV', 'production');
    expect(loadConfig().allowDevAuth).toBe(false);
    expect(loadConfig().allowIncompleteVtt).toBe(false);

    vi.stubEnv('NODE_ENV', 'development');
    expect(loadConfig().allowDevAuth).toBe(false);
    expect(loadConfig().allowIncompleteVtt).toBe(false);
    vi.stubEnv('ALLOW_INCOMPLETE_VTT', 'true');
    expect(loadConfig().allowIncompleteVtt).toBe(true);

    vi.stubEnv('NODE_ENV', 'test');
    expect(loadConfig().allowDevAuth).toBe(true);
    expect(loadConfig().allowIncompleteVtt).toBe(true);
  });
});
