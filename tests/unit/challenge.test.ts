import { afterEach, describe, expect, it, vi } from 'vitest';
import { challengeUrl, decodeChallenge, encodeChallenge, shareResult } from '../../src/services/sharing/challenge';
import type { Challenge, RunResult } from '../../src/types';

const challenge: Challenge = { version: 1, seed: 'daily:2026-10-02', height: 127.4, score: 1583, name: 'Lucía 🏗️' };
const result: RunResult = { ...challenge, mode: 'casual', objectsPlaced: 12, perfectDrops: 4, combo: 0, maxCombo: 4, duration: 30, objectIds: [], reason: 'miss', coins: 5, personalBest: false, moments: [] };
const tokenOf = (value: unknown): string => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

afterEach(() => vi.unstubAllGlobals());

describe('challenge links', () => {
  it('round trips a seed, targets and a Unicode public name', () => {
    const token = encodeChallenge(challenge);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeChallenge(token)).toEqual(challenge);
  });

  it('places only the challenge on the current page URL', () => {
    const url = new URL(challengeUrl(challenge, 'https://tower.example/play?debug=1#settings'));
    expect(url.origin + url.pathname).toBe('https://tower.example/play');
    expect(url.hash).toBe('');
    expect(url.searchParams.has('debug')).toBe(false);
    expect(decodeChallenge(url.searchParams.get('challenge')!)).toEqual(challenge);
  });

  it.each(['', '%', 'A', 'a'.repeat(2049), 'e30', '____', '!!'])('rejects malformed tokens %s', token => {
    expect(decodeChallenge(token)).toBeNull();
  });

  it.each([
    { ...challenge, version: 2 }, { ...challenge, height: -1 },
    { ...challenge, height: 1_000_001 }, { ...challenge, score: 1.5 },
    { ...challenge, seed: '' }, { ...challenge, seed: 'x'.repeat(129) },
    { ...challenge, seed: 'x\u0000' }, { ...challenge, name: { html: 'x' } },
  ])('rejects untrusted target payloads', payload => {
    // Test data is ASCII here; Unicode support is exercised by the round-trip test.
    expect(decodeChallenge(tokenOf({ ...payload, name: typeof payload.name === 'string' ? 'Lucas' : payload.name }))).toBeNull();
  });

  it('sanitizes public text and rejects unsafe URL protocols', () => {
    expect(decodeChallenge(encodeChallenge({ ...challenge, name: '<b>Lucas</b>' }))?.name).toBe('Lucas');
    expect(new URL(challengeUrl(challenge, 'javascript:alert(1)')).protocol).toBe('http:');
  });

  it('falls back to a real clipboard link when sharing is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const shared = await shareResult(result);
    expect(shared.method).toBe('copy');
    expect(writeText).toHaveBeenCalledWith(shared.url);
    expect(decodeChallenge(new URL(shared.url).searchParams.get('challenge')!)?.seed).toBe(result.seed);
  });

  it('returns a manual link if share and clipboard both fail', async () => {
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new Error('unsupported')), clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    expect((await shareResult(result)).method).toBe('manual');
  });

  it('respects a cancelled native share without claiming success or copying', async () => {
    const writeText = vi.fn();
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')), clipboard: { writeText } });
    const shared = await shareResult(result);
    expect(shared.method).toBe('manual');
    expect(writeText).not.toHaveBeenCalled();
    expect(decodeChallenge(new URL(shared.url).searchParams.get('challenge')!)?.height).toBe(result.height);
  });

  it('shares a link when image rendering is unavailable', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share });
    vi.stubGlobal('document', undefined);
    const shared = await shareResult(result, undefined, true);
    expect(shared.method).toBe('share');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: shared.url, title: 'Impossible Tower' }));
  });

  it('returns a manual usable URL when no browser APIs exist', async () => {
    vi.stubGlobal('navigator', undefined);
    const shared = await shareResult(result);
    expect(shared.method).toBe('manual');
    expect(new URL(shared.url).searchParams.get('challenge')).toBeTruthy();
  });
});
