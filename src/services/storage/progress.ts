import { ACHIEVEMENTS } from '../../content/achievements';
import { COSMETICS } from '../../content/cosmetics';
import { getActiveMissions, MISSIONS } from '../../content/missions';
import type { Profile, ProgressUpdate, RunStats } from '../../types';
import { isUTCDate, migrateProfile } from './profile';

const MAX_COINS = 1_000_000_000;
const DAY_MS = 86_400_000;

function finite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Called once per page session, regardless of the number of attempts. */
export function beginSession(profile: Profile): Profile {
  const next = migrateProfile(profile);
  next.sessionCount += 1;
  return next;
}

/** The caller owns run finalization: a rewarded continuation must finalize only once. */
export function recordRun(profile: Profile, result: RunStats): ProgressUpdate {
  const next = migrateProfile(profile);
  const height = finite(result.height);
  const objects = Math.floor(finite(result.objectsPlaced));
  const perfect = Math.min(objects, Math.floor(finite(result.perfectDrops)));
  const newBest = height > next.personalBest;
  const completedMissions: string[] = [];
  const newAchievements: string[] = [];
  let earnedCoins = Math.min(120, objects * 2 + Math.floor(height / 5) + perfect) + (newBest ? 10 : 0);

  const metrics: Record<string, number> = {
    height,
    objectsPlaced: objects,
    perfectDrops: perfect,
    maxCombo: finite(result.maxCombo),
    maxPerfectCombo: finite(result.maxPerfectCombo ?? 0),
    daily: result.mode === 'daily' ? 1 : 0,
    personalBest: newBest ? 1 : 0,
    runs: 1,
    rocket: result.objectIds.includes('rocket') ? 1 : 0,
    challengeWon: result.mode === 'challenge' && (result as RunStats & { challengeWon?: boolean }).challengeWon === true ? 1 : 0,
  };

  // Only the three visible goals advance. Cumulative goals survive rotations.
  for (const mission of getActiveMissions(next)) {
    const state = next.missions[mission.id];
    const amount = metrics[mission.metric] ?? 0;
    const progress = mission.metric === 'height' || mission.metric === 'maxCombo' || mission.metric === 'maxPerfectCombo'
      ? Math.max(state.progress, amount)
      : state.progress + amount;
    state.progress = Math.min(mission.target, progress);
    if (state.progress >= mission.target && !state.claimed) {
      state.claimed = true;
      earnedCoins += mission.reward;
      completedMissions.push(mission.id);
    }
  }

  if (result.mode === 'daily') {
    const seedDay = /^tower:daily:(\d{4}-\d{2}-\d{2}):v1$/.exec(result.seed)?.[1];
    // A run started before midnight still belongs to the sequence it played.
    const day = isUTCDate(seedDay) ? seedDay : new Date().toISOString().slice(0, 10);
    const daily = next.daily[day] ?? { best: 0, attempts: 0 };
    next.daily[day] = { best: Math.max(daily.best, height), attempts: daily.attempts + 1 };
    if (next.lastDailyDate < day) {
      const yesterday = new Date(Date.parse(`${day}T00:00:00.000Z`) - DAY_MS).toISOString().slice(0, 10);
      next.dailyStreak = next.lastDailyDate === yesterday ? next.dailyStreak + 1 : 1;
      next.lastDailyDate = day;
    }
  }
  metrics.dailyStreak = next.dailyStreak;

  for (const achievement of ACHIEVEMENTS) {
    if (!next.achievements.includes(achievement.id) && (metrics[achievement.metric] ?? 0) >= achievement.target) {
      next.achievements.push(achievement.id);
      newAchievements.push(achievement.id);
    }
  }

  next.personalBest = Math.max(next.personalBest, height);
  next.bestScore = Math.max(next.bestScore, Math.floor(finite(result.score)));
  next.runs += 1;
  next.tutorialComplete ||= objects > 0;
  next.coins = Math.min(MAX_COINS, next.coins + earnedCoins);

  // Height milestones offer cosmetic gifts; they never change physical properties.
  if (newBest) {
    if (height >= 30 && !next.unlockedCosmetics.includes('crane-coral')) next.unlockedCosmetics.push('crane-coral');
    if (height >= 100 && !next.unlockedCosmetics.includes('background-aurora')) next.unlockedCosmetics.push('background-aurora');
  }
  return { profile: next, earnedCoins, newAchievements, completedMissions };
}

/** Call after the share sheet succeeds or a challenge link was copied successfully. */
export function recordShare(profile: Profile): ProgressUpdate {
  const next = migrateProfile(profile);
  const mission = MISSIONS.find((entry) => entry.metric === 'share')!;
  const state = next.missions[mission.id];
  if (state.claimed) return { profile: next, earnedCoins: 0, newAchievements: [], completedMissions: [] };
  state.progress = mission.target;
  state.claimed = true;
  next.coins = Math.min(MAX_COINS, next.coins + mission.reward);
  return { profile: next, earnedCoins: mission.reward, newAchievements: [], completedMissions: [mission.id] };
}

/** Buying an owned cosmetic equips it without paying again. */
export function buyCosmetic(profile: Profile, id: string): { profile: Profile; ok: boolean; message: string } {
  const next = migrateProfile(profile);
  const cosmetic = COSMETICS.find((entry) => entry.id === id);
  if (!cosmetic) return { profile: next, ok: false, message: 'Ese estilo no está disponible.' };
  if (!next.unlockedCosmetics.includes(id)) {
    if (next.coins < cosmetic.price) return { profile: next, ok: false, message: 'Te faltan coins. Podés conseguirlas jugando.' };
    next.coins -= cosmetic.price;
    next.unlockedCosmetics.push(id);
  }
  next.selectedCosmetics[cosmetic.category] = id;
  return { profile: next, ok: true, message: `${cosmetic.name} equipado.` };
}
