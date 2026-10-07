import { describe, expect, it } from 'vitest';
import { defaultProfile, loadProfile, migrateProfile, saveProfile, STORAGE_KEY } from '../../src/services/storage/profile';

class MemoryStorage implements Storage {
  private entries = new Map<string, string>();
  get length() { return this.entries.size; }
  clear() { this.entries.clear(); }
  getItem(key: string) { return this.entries.get(key) ?? null; }
  key(index: number) { return [...this.entries.keys()][index] ?? null; }
  removeItem(key: string) { this.entries.delete(key); }
  setItem(key: string, value: string) { this.entries.set(key, value); }
}

describe('versioned local profiles', () => {
  it('creates independent nested defaults', () => {
    const first = defaultProfile();
    first.settings.sfx = false;
    first.unlockedCosmetics.push('crane-coral');
    first.missions['reach-thirty'].progress = 7;
    const second = defaultProfile();
    expect(second.settings.sfx).toBe(true);
    expect(second.unlockedCosmetics).not.toContain('crane-coral');
    expect(second.missions['reach-thirty'].progress).toBe(0);
  });

  it('migrates v1 fields and validates every recovered field', () => {
    const profile = migrateProfile({
      version: 1,
      bestHeight: 72.5,
      coins: 35.9,
      settings: { sound: false, music: 'true', haptics: false },
      unlockedCosmetics: ['crane-coral', 'crane-coral', 'missing'],
      selectedCosmetics: { crane: 'crane-coral', background: 'crane-coral', trail: 'trail-comet' },
      achievements: ['first-stack', 'first-stack', 'missing'],
      missions: { 'reach-thirty': { progress: 999, claimed: true }, missing: { progress: 1, claimed: true } },
      daily: { '2026-02-28': { best: 42.1, attempts: 2.7 }, '2026-02-30': { best: 80, attempts: 1 } },
      lastDailyDate: '2026-02-28', dailyStreak: 2,
      publicName: '  <Lucas>\u0000  ',
    });
    expect(profile.version).toBe(2);
    expect(profile.personalBest).toBe(72.5);
    expect(profile.coins).toBe(0);
    expect(profile.economyVersion).toBe(3);
    expect(profile.legacyDailyBest).toBe(42.1);
    expect(migrateProfile(profile)).toEqual(profile);
    expect(profile.settings).toEqual({ music: false, sfx: false, haptics: false });
    expect(profile.selectedCosmetics).toEqual({ crane: 'crane-coral', background: 'background-default', trail: 'trail-default', effect: 'effect-default' });
    expect(profile.unlockedCosmetics.filter((id) => id === 'crane-coral')).toHaveLength(1);
    expect(profile.achievements).toEqual(['first-stack']);
    expect(profile.missions['reach-thirty']).toEqual({ progress: 30, claimed: true });
    expect(profile.daily).toEqual({ '2026-02-28': { best: 42.1, attempts: 2 } });
    expect(profile.publicName).toBe('Lucas');
  });

  it('rejects corrupt numbers, payloads and inconsistent cosmetic selections', () => {
    expect(migrateProfile(null)).toEqual(defaultProfile());
    expect(migrateProfile([])).toEqual(defaultProfile());
    const profile = migrateProfile({ personalBest: Infinity, coins: -4, runs: NaN, settings: null, dailyStreak: 9, lastDailyDate: 'bad' });
    expect(profile.personalBest).toBe(0);
    expect(profile.coins).toBe(0);
    expect(profile.runs).toBe(0);
    expect(profile.dailyStreak).toBe(0);
  });

  it('falls back to playable defaults when JSON or browser storage fails', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, '{broken');
    expect(loadProfile(storage)).toEqual(defaultProfile());
    const blocked = {
      getItem() { throw new DOMException('Blocked', 'SecurityError'); },
      setItem() { throw new DOMException('Full', 'QuotaExceededError'); },
    } as unknown as Storage;
    expect(loadProfile(blocked)).toEqual(defaultProfile());
    expect(() => saveProfile(defaultProfile(), blocked)).not.toThrow();
  });

  it('roundtrips selected cosmetics, settings, daily attempts and mission claims', () => {
    const storage = new MemoryStorage();
    const profile = defaultProfile();
    profile.unlockedCosmetics.push('trail-comet');
    profile.selectedCosmetics.trail = 'trail-comet';
    profile.settings.music = true;
    profile.missions['share-challenge'] = { progress: 1, claimed: true };
    profile.daily['2026-10-03'] = { best: 41.8, attempts: 4 };
    profile.lastDailyDate = '2026-10-03';
    profile.dailyStreak = 1;
    saveProfile(profile, storage);
    expect(loadProfile(storage)).toEqual(profile);
  });
});
