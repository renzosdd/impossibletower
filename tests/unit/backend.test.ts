import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunResult } from '../../src/types';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), signInAnonymously: vi.fn(), rpc: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getSession: mocks.getSession, signInAnonymously: mocks.signInAnonymously }, rpc: mocks.rpc })),
}));

import { BackendService, isPlausibleRun, isValidChallenge, sanitizePublicName } from '../../src/services/backend';
import { createClient } from '@supabase/supabase-js';

const config = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test-public-key' };
const legacyKey = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.signature`;
const run: RunResult = {
  mode: 'casual', seed: 'tower:casual:test:v1', height: 11.6, score: 366,
  objectsPlaced: 2, perfectDrops: 2, combo: 2, maxCombo: 2, duration: 8,
  objectIds: ['box', 'box'], reason: 'miss', coins: 6, personalBest: true, moments: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'player-id' } } }, error: null });
  mocks.signInAnonymously.mockResolvedValue({ data: { user: { id: 'player-id' } }, error: null });
  mocks.rpc.mockResolvedValue({ data: [], error: null });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('backend input policy', () => {
  it('sanitizes public names and bounds Unicode pseudonyms', () => {
    expect(sanitizePublicName('<script> Lucía\n 🚀 </script>')).toBe('script Lucía script');
    expect(sanitizePublicName('   ')).toBe('Anónimo');
    expect(Array.from(sanitizePublicName('á'.repeat(80)))).toHaveLength(24);
    expect(sanitizePublicName('https://bad.example')).not.toContain(':');
  });

  it('accepts plausible results but rejects assisted and impossible summaries', () => {
    expect(isPlausibleRun(run)).toBe(true);
    for (const invalid of [
      { assisted: true }, { height: NaN }, { height: 5_001 }, { score: 999_999 },
      { duration: 0.1 }, { perfectDrops: 3 }, { maxCombo: 3 }, { seed: '<script>' }, { objectsPlaced: 2.5 },
    ]) expect(isPlausibleRun({ ...run, ...invalid })).toBe(false);
  });

  it('rejects malformed stored challenge payloads', () => {
    const challenge = { version: 1, seed: run.seed, height: run.height, score: run.score };
    expect(isValidChallenge(challenge)).toBe(true);
    for (const invalid of [null, { ...challenge, version: 2 }, { ...challenge, score: 1.5 }, { ...challenge, height: Infinity }, { ...challenge, name: {} }])
      expect(isValidChallenge(invalid)).toBe(false);
  });
});

describe('optional backend', () => {
  it('prefers the publishable key and reads the current environment names', () => {
    vi.stubEnv('VITE_SUPABASE_URL', ' https://example.supabase.co/ ');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', ' sb_publishable_preferred ');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', legacyKey('anon'));
    expect(new BackendService().enabled).toBe(true);
    expect(createClient).toHaveBeenCalledWith('https://example.supabase.co', 'sb_publishable_preferred', expect.any(Object));
  });

  it('supports a legacy anon JWT when the preferred key is blank', () => {
    const anonKey = legacyKey('anon');
    expect(new BackendService({ url: config.url, publishableKey: ' ', anonKey }).enabled).toBe(true);
    expect(createClient).toHaveBeenCalledWith(config.url, anonKey, expect.any(Object));
  });

  it('accepts publishable keys in the legacy environment field and local development URLs', () => {
    expect(new BackendService({ url: 'http://127.0.0.1:54321', anonKey: config.publishableKey }).enabled).toBe(true);
    expect(createClient).toHaveBeenCalledWith('http://127.0.0.1:54321', config.publishableKey, expect.any(Object));
  });

  it('rejects secret, privileged, malformed and arbitrary credentials before creating a client', async () => {
    for (const publishableKey of [
      'sb_secret_test', legacyKey('service_role'), legacyKey('authenticated'),
      'eyJhbGciOiJIUzI1NiJ9.invalid.signature', 'sb_publishable_', 'database-password',
    ]) {
      const backend = new BackendService({ ...config, publishableKey, anonKey: legacyKey('anon') });
      expect(backend.enabled).toBe(false);
      expect(backend.lastError).toBe('Supabase requires a publishable or legacy anon key');
      await backend.initialize();
      expect(await backend.leaderboard('today')).toEqual([]);
    }
    expect(createClient).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects insecure or malformed project URLs before creating a client', () => {
    for (const url of [
      'not-a-url', 'http://example.supabase.co', 'ftp://example.supabase.co',
      'https://user:password@example.supabase.co', 'https://example.supabase.co/auth/v1',
      'https://example.supabase.co?key=public', 'https://example.supabase.co#fragment',
    ]) expect(new BackendService({ ...config, url }).enabled).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('works without credentials and makes no auth or database calls', async () => {
    const backend = new BackendService({});
    expect(backend.enabled).toBe(false);
    await backend.initialize();
    await backend.submitRun(run);
    expect(await backend.leaderboard('today')).toEqual([]);
    expect(await backend.saveChallenge({ version: 1, seed: run.seed, height: run.height, score: run.score })).toBeNull();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('creates an anonymous identity only when no saved session exists', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const backend = new BackendService(config);
    await Promise.all([backend.initialize(), backend.initialize()]);
    await backend.initialize();
    expect(mocks.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('submits a validated summary through the RPC and never direct table writes', async () => {
    const backend = new BackendService(config);
    await backend.submitRun(run, '<Lucía>');
    expect(mocks.rpc).toHaveBeenCalledWith('submit_run', expect.objectContaining({
      p_name: 'Lucía', p_assisted: false, p_seed: run.seed, p_height: 11.6, p_duration: 8,
    }));
    await backend.submitRun({ ...run, assisted: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('returns only real, valid leaderboard entries and strips hostile names', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ name: '<Player>', height: '12.3' }, { name: 'Invalid', height: 8_000 }, { height: 4 }], error: null });
    expect(await new BackendService(config).leaderboard('today')).toEqual([{ name: 'Player', height: 12.3 }]);
  });

  it('contains network/database errors and allows the local fallback', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Offline' } });
    const backend = new BackendService(config);
    expect(await backend.leaderboard('all-time')).toEqual([]);
    expect(backend.lastError).toBe('Offline');
    await expect(backend.submitRun(run)).resolves.toBeUndefined();
    expect(await backend.saveChallenge({ version: 1, seed: run.seed, height: run.height, score: run.score })).toBeNull();
  });

  it('contains anonymous authentication failures and retries on a later request', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    mocks.signInAnonymously.mockResolvedValueOnce({ data: { user: null }, error: { message: 'Anonymous sign-ins disabled' } });
    const backend = new BackendService(config);
    await expect(backend.submitRun(run)).resolves.toBeUndefined();
    expect(backend.lastError).toBe('Anonymous sign-ins disabled');
    expect(mocks.rpc).not.toHaveBeenCalled();
    await backend.submitRun(run);
    expect(mocks.signInAnonymously).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('bounds a hanging request rather than freezing a sharing/menu action', async () => {
    vi.useFakeTimers();
    mocks.rpc.mockImplementation(() => new Promise(() => {}));
    const backend = new BackendService(config);
    const request = backend.leaderboard('today');
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await request).toEqual([]);
    expect(backend.lastError).toContain('timed out');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects malformed challenge identifiers before requesting the backend', async () => {
    expect(await new BackendService(config).loadChallenge('../../private')).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
