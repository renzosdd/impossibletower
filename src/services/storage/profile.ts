import { ACHIEVEMENTS, BADGES } from '../../content/achievements';
import { COSMETICS, ACCOUNT_COSMETICS, DEFAULT_COSMETICS } from '../../content/cosmetics';
import { MISSIONS, DAILY_MISSIONS } from '../../content/missions';
import type { Profile } from '../../types';

/** Keep the key stable; the version inside the payload controls migrations. */
export const STORAGE_KEY = 'impossible-tower.profile';

const cosmeticById = new Map([...COSMETICS, ...ACCOUNT_COSMETICS].map((cosmetic) => [cosmetic.id, cosmetic]));
const achievementIds = new Set(BADGES.map((achievement) => achievement.id));
const MAX_NUMBER = 1_000_000_000;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function positive(value: unknown, fallback = 0, integer = false): number {
  const number = typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_NUMBER, Math.max(0, value))
    : fallback;
  return integer ? Math.floor(number) : number;
}

export function isUTCDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

export function defaultProfile(): Profile {
  return {
    version: 2,
    economyVersion:3, badgeProgress:Object.fromEntries(BADGES.map(b=>[b.id,0])), missionDay:new Date().toISOString().slice(0,10), legacyDailyBest:0,
    personalBest: 0,
    bestScore: 0,
    coins: 0,
    unlockedCosmetics: Object.values(DEFAULT_COSMETICS),
    selectedCosmetics: { ...DEFAULT_COSMETICS },
    settings: { music: false, sfx: true, haptics: true },
    achievements: [],
    missions: Object.fromEntries([...MISSIONS,...DAILY_MISSIONS].map((mission) => [mission.id, { progress: 0, claimed: false }])),
    daily: {},
    dailyStreak: 0,
    lastDailyDate: '',
    sessionCount: 0,
    runs: 0,
    tutorialComplete: false,
    publicName: '',
  };
}

/** Recover known fields from older schemas and discard malformed/unknown content. */
export function migrateProfile(raw: unknown): Profile {
  const source = record(raw);
  const profile = defaultProfile();
  profile.personalBest = positive(source.personalBest ?? source.bestHeight);
  profile.bestScore = positive(source.bestScore, 0, true);
  profile.coins = 0; // Premium balance only exists on the server, including migrated profiles.
  profile.legacyDailyBest=positive(source.legacyDailyBest);
  profile.badgeProgress=Object.fromEntries(BADGES.map(b=>[b.id,Math.min(b.target,positive(record(source.badgeProgress)[b.id]))]));
  profile.missionDay=typeof source.missionDay==='string'&&isUTCDate(source.missionDay)?source.missionDay:profile.missionDay;
  profile.sessionCount = positive(source.sessionCount, 0, true);
  profile.runs = positive(source.runs, 0, true);
  profile.tutorialComplete = source.tutorialComplete === true;

  profile.unlockedCosmetics = [...new Set([
    ...profile.unlockedCosmetics,
    ...stringIds(source.unlockedCosmetics).filter((id) => cosmeticById.has(id)),
  ])];
  const selected = record(source.selectedCosmetics);
  for (const category of Object.keys(DEFAULT_COSMETICS) as (keyof typeof DEFAULT_COSMETICS)[]) {
    const id = selected[category];
    if (typeof id === 'string' && cosmeticById.get(id)?.category === category && profile.unlockedCosmetics.includes(id)) {
      profile.selectedCosmetics[category] = id;
    }
  }

  const settings = record(source.settings);
  for (const key of ['music', 'sfx', 'haptics'] as const) {
    const value = settings[key] ?? (key === 'sfx' ? settings.sound : undefined);
    if (typeof value === 'boolean') profile.settings[key] = value;
  }
  profile.achievements = [...new Set(stringIds(source.achievements).filter((id) => achievementIds.has(id)))];
  for(const badge of BADGES)if(profile.achievements.includes(badge.id))profile.badgeProgress![badge.id]=badge.target;

  const missions = record(source.missions);
  for (const mission of [...MISSIONS,...DAILY_MISSIONS]) {
    const saved = record(missions[mission.id]);
    const claimed = saved.claimed === true;
    profile.missions[mission.id] = {
      progress: claimed ? mission.target : Math.min(mission.target, positive(saved.progress)),
      claimed,
    };
  }

  for (const [day, value] of Object.entries(record(source.daily))) {
    if (!isUTCDate(day)) continue;
    const daily = record(value);
    profile.daily[day] = {
      best: positive(daily.best ?? daily.height),
      attempts: positive(daily.attempts, 0, true),
    };
  }
  if(source.economyVersion!==3)profile.legacyDailyBest=Math.max(profile.legacyDailyBest??0,...Object.values(profile.daily).map(d=>d.best));
  profile.lastDailyDate = isUTCDate(source.lastDailyDate) ? source.lastDailyDate : '';
  profile.dailyStreak = profile.lastDailyDate ? positive(source.dailyStreak, 0, true) : 0;
  if (typeof source.publicName === 'string') {
    profile.publicName = source.publicName.normalize('NFKC').replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
  }
  return profile;
}

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadProfile(storage?: Storage): Profile {
  try {
    const serialized = (storage ?? browserStorage())?.getItem(STORAGE_KEY);
    return serialized ? migrateProfile(JSON.parse(serialized)) : defaultProfile();
  } catch {
    // Blocked storage and invalid JSON must never prevent starting a run.
    return defaultProfile();
  }
}

export function saveProfile(profile: Profile, storage?: Storage): void {
  try {
    (storage ?? browserStorage())?.setItem(STORAGE_KEY, JSON.stringify(migrateProfile(profile)));
  } catch {
    // The live profile remains in memory if private browsing or quota prevents a write.
  }
}
