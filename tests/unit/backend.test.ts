import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunResult } from '../../src/types';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), signInAnonymously: vi.fn(), rpc: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getSession: mocks.getSession, signInAnonymously: mocks.signInAnonymously }, rpc: mocks.rpc })),
}));

import { BackendService, isPlausibleRun, isValidChallenge, sanitizePublicName } from '../../src/services/backend';

const config = { url: 'https://example.supabase.co', anonKey: 'test-public-key' };
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
afterEach(() => { vi.useRealTimers(); });

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
