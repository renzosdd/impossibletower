import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACHIEVEMENTS } from '../../src/content/achievements';
import { COSMETICS } from '../../src/content/cosmetics';
import { getActiveMissions, MISSIONS, DAILY_MISSIONS } from '../../src/content/missions';
import { defaultProfile } from '../../src/services/storage/profile';
import { beginSession, buyCosmetic, recordRun, recordShare } from '../../src/services/storage/progress';
import type { RunStats } from '../../src/types';

it('renews daily mission progress on a new UTC session while preserving badges',()=>{
 const profile=defaultProfile();profile.missionDay='2000-01-01';profile.achievements=['v2:stack:bronze'];
 for(const mission of DAILY_MISSIONS)profile.missions[mission.id]={progress:mission.target,claimed:true};
 const next=beginSession(profile);
 expect(next.missionDay).toBe(new Date().toISOString().slice(0,10));expect(next.achievements).toEqual(['v2:stack:bronze']);
 for(const mission of DAILY_MISSIONS)expect(next.missions[mission.id]).toEqual({progress:0,claimed:false});
});

function run(overrides: Partial<RunStats> = {}): RunStats {
  return {
    mode: 'casual', seed: 'test-sequence', height: 14, score: 800,
    objectsPlaced: 4, perfectDrops: 2, combo: 2, maxCombo: 2, maxPerfectCombo: 2,
    duration: 30, objectIds: ['box', 'chair', 'table', 'sofa'], ...overrides,
  };
}

afterEach(() => vi.useRealTimers());

describe('rotating goals and achievements', () => {
  it('contains the requested content and rotates three unclaimed goals every five runs', () => {
    expect(ACHIEVEMENTS).toHaveLength(36);
    expect(MISSIONS).toHaveLength(8);
    expect(COSMETICS.filter((item) => item.category === 'crane')).toHaveLength(5);
    expect(COSMETICS.filter((item) => item.category === 'background')).toHaveLength(3);
    expect(COSMETICS.filter((item) => item.category === 'trail')).toHaveLength(5);
    expect(COSMETICS.filter((item) => item.category === 'effect')).toHaveLength(5);
    const profile = defaultProfile();
    expect(getActiveMissions(profile).map((mission) => mission.id)).toEqual(MISSIONS.slice(0, 3).map((mission) => mission.id));
    profile.runs = 5;
    expect(getActiveMissions(profile).map((mission) => mission.id)).toEqual(MISSIONS.slice(3, 6).map((mission) => mission.id));
    for (const mission of MISSIONS) profile.missions[mission.id].claimed = true;
    expect(getActiveMissions(profile)).toEqual([]);
  });

  it('accumulates daily goals locally without minting premium coins', () => {
    let profile = defaultProfile();
    const initial = profile;
    const first = recordRun(profile, run({ objectsPlaced: 10 }),true);
    expect(initial.runs).toBe(0);
    expect(first.profile.missions['daily-three-runs'].progress).toBe(1);
    const second = recordRun(first.profile, run({ objectsPlaced: 5 }),true);
    expect(second.completedMissions).toEqual([]);
    const third = recordRun(second.profile, run({ objectsPlaced: 5 }),true);
    expect(third.completedMissions).toEqual(['daily-three-runs']);
    expect(third.earnedCoins).toBe(0);
    expect(third.profile.coins).toBe(0);
    expect(recordRun(third.profile,run({perfectDrops:0})).completedMissions).toEqual([]);
  });

  it('requires real consecutive Perfects rather than a Great combo for Perfect goals', () => {
    const mixed = recordRun(defaultProfile(), run({ maxCombo: 10, maxPerfectCombo: 2 }));
    expect(mixed.newAchievements).not.toContain('v2:combo:silver');
    expect(mixed.profile.missions['three-perfect'].claimed).toBe(false);
    const perfect = recordRun(mixed.profile, run({ maxPerfectCombo: 10, perfectDrops: 10, objectsPlaced: 10 }),true);
    expect(perfect.newAchievements).toEqual(expect.arrayContaining(['v2:combo:silver', 'v2:combo:gold']));
    expect(perfect.completedMissions).toContain('daily-eight-perfect');
    const again = recordRun(perfect.profile, run({ maxPerfectCombo: 10 }));
    expect(again.newAchievements).not.toContain('v2:combo:silver');
  });

  it('unverified offline runs do not advance missions',()=>{const result=recordRun(defaultProfile(),run({objectsPlaced:10,perfectDrops:8,height:30}));expect(result.completedMissions).toEqual([]);expect(result.profile.missions['daily-three-runs'].progress).toBe(0);expect(result.earnedCoins).toBe(0);});
  it('awards height and object achievements without requiring a backend', () => {
    const result = recordRun(defaultProfile(), run({ height: 200, objectIds: ['rocket'] }));
    expect(result.newAchievements).toEqual(expect.arrayContaining([
      'v2:stack:bronze', 'v2:height:bronze', 'v2:height:silver', 'v2:height:gold', 'v2:rockets:bronze',
    ]));
    expect(result.profile.unlockedCosmetics).toEqual(expect.arrayContaining(['crane-coral', 'background-aurora']));
    expect(result.profile.personalBest).toBe(200);
    const worse = recordRun(result.profile, run({ height: 12, score: 3 }));
    expect(worse.profile.personalBest).toBe(200);
    expect(worse.profile.bestScore).toBe(800);
  });

  it('sharing never grants local or premium coins', () => {
    const original = defaultProfile();
    const first = recordShare(original);
    expect(first.earnedCoins).toBe(0);
    expect(original.coins).toBe(0);
    const repeated = recordShare(first.profile);
    expect(repeated.earnedCoins).toBe(0);
    expect(repeated.completedMissions).toEqual([]);
    expect(repeated.profile.coins).toBe(0);
  });
});

describe('UTC daily history', () => {
  it('counts completed attempts, preserves best height and increments streak once per UTC day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T01:00:00Z'));
    const initial = beginSession(defaultProfile());
    expect(initial.daily).toEqual({});
    expect(initial.sessionCount).toBe(1);
    let profile = recordRun(initial, run({ mode: 'daily',objectsPlaced:5, height: 40 })).profile;
    expect(profile.dailyStreak).toBe(1);
    profile = recordRun(profile, run({ mode: 'daily',objectsPlaced:5, height: 20 })).profile;
    expect(profile.daily['2026-10-03']).toEqual({ best: 40, attempts: 2 });
    expect(profile.dailyStreak).toBe(1);
    vi.setSystemTime(new Date('2026-10-04T00:00:01Z'));
    profile = recordRun(profile, run({ mode: 'daily',objectsPlaced:5 })).profile;
    expect(profile.dailyStreak).toBe(2);
    vi.setSystemTime(new Date('2026-10-05T01:00:00Z'));
    const thirdDay = recordRun(profile, run({ mode: 'daily',objectsPlaced:5 }));
    expect(thirdDay.profile.dailyStreak).toBe(3);
    expect(thirdDay.newAchievements).toContain('v2:streak:bronze');
    vi.setSystemTime(new Date('2026-10-08T01:00:00Z'));
    expect(recordRun(thirdDay.profile, run({ mode: 'daily',objectsPlaced:5 })).profile.dailyStreak).toBe(1);
  });

  it('attributes a run spanning midnight to its seed date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T00:01:00Z'));
    const result = recordRun(defaultProfile(), run({ mode: 'daily', seed: 'tower:daily:2026-10-03:v1' }));
    expect(result.profile.daily['2026-10-03'].attempts).toBe(1);
    expect(result.profile.daily['2026-10-04']).toBeUndefined();
    expect(result.profile.lastDailyDate).toBe('2026-10-03');
  });

  it('does not roll streak history backward when an older daily result arrives', () => {
    const profile = defaultProfile();
    profile.lastDailyDate = '2026-10-04';
    profile.dailyStreak = 4;
    const result = recordRun(profile, run({ mode: 'daily', seed: 'tower:daily:2026-10-03:v1' }));
    expect(result.profile.lastDailyDate).toBe('2026-10-04');
    expect(result.profile.dailyStreak).toBe(4);
  });
});

describe('cosmetic purchases', () => {
  it('local coins cannot purchase cosmetics, existing styles can still be equipped', () => {
    const profile = defaultProfile(); profile.coins=120;
    expect(buyCosmetic(profile,'crane-coral').ok).toBe(false);
    profile.unlockedCosmetics.push('crane-coral');
    const equipped=buyCosmetic(profile,'crane-coral');
    expect(equipped.ok).toBe(true);
    expect(equipped.profile.selectedCosmetics.crane).toBe('crane-coral');
    expect(equipped.profile.coins).toBe(0);
  });

  it('handles insufficient funds and unknown styles without modifying the source', () => {
    const profile = defaultProfile();
    expect(buyCosmetic(profile, 'crane-gold').ok).toBe(false);
    expect(buyCosmetic(profile, 'missing').ok).toBe(false);
    expect(profile.coins).toBe(0);
    expect(profile.selectedCosmetics.crane).toBe('crane-default');
  });
});
