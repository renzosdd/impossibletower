import { ACHIEVEMENTS, BADGES } from '../../content/achievements';
import { COSMETICS } from '../../content/cosmetics';
import { getActiveMissions, MISSIONS, DAILY_MISSIONS } from '../../content/missions';
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
  const day=new Date().toISOString().slice(0,10);
  if(next.missionDay!==day){next.missionDay=day;for(const m of DAILY_MISSIONS)next.missions[m.id]={progress:0,claimed:false};}
  next.sessionCount += 1;
  return next;
}

/** The caller owns run finalization: a rewarded continuation must finalize only once. */
export function recordRun(profile: Profile, result: RunStats, verified=false): ProgressUpdate {
  const next = migrateProfile(profile);
  const height = finite(result.height);
  const objects = Math.floor(finite(result.objectsPlaced));
  const perfect = Math.min(objects, Math.floor(finite(result.perfectDrops)));
  const newBest = height > next.personalBest;
  const completedMissions: string[] = [];
  const newAchievements: string[] = [];
  let earnedCoins = 0;

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

  // Only verified runs advance daily missions. Offline badges and history remain local.
  const day=new Date().toISOString().slice(0,10);
  if(next.missionDay!==day){next.missionDay=day;for(const m of DAILY_MISSIONS)next.missions[m.id]={progress:0,claimed:false};}
  metrics.qualifyingRuns=objects>=5?1:0;metrics.qualifyingDaily=result.mode==='daily'&&objects>=5?1:0;
  for (const mission of verified?DAILY_MISSIONS:[]) {
    const state = next.missions[mission.id];
    const amount = metrics[mission.metric] ?? 0;
    const progress = mission.metric === 'height' || mission.metric === 'maxCombo' || mission.metric === 'maxPerfectCombo'
      ? Math.max(state.progress, amount)
      : state.progress + amount;
    state.progress = Math.min(mission.target, progress);
    if (state.progress >= mission.target && !state.claimed) {
      state.claimed = true;
      // Guests see progress without premium credit.
      completedMissions.push(mission.id);
    }
  }

  if (result.mode === 'daily') {
    const seedDay = /^tower:daily:(\d{4}-\d{2}-\d{2}):v[123](?::[a-z0-9-]+)?$/.exec(result.seed)?.[1];
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
  const totals=next.badgeMetrics??={};
  totals.totalObjects=(totals.totalObjects??0)+objects;
  totals.totalPerfect=(totals.totalPerfect??0)+perfect;
  totals.qualifyingRuns=(totals.qualifyingRuns??0)+(objects>=5?1:0);
  totals.rockets=(totals.rockets??0)+result.objectIds.filter(id=>id==='rocket').length;
  next.badgeObjects=[...new Set([...(next.badgeObjects??[]),...result.objectIds])];
  totals.uniqueObjects=next.badgeObjects.length;
  if(metrics.qualifyingDaily){
    const playedDay=/^tower:daily:(\d{4}-\d{2}-\d{2})/.exec(result.seed)?.[1]??day;
    if((next.badgeLastDaily??'')<playedDay){
      totals.currentStreak=next.badgeLastDaily===new Date(Date.parse(playedDay+'T00:00:00Z')-DAY_MS).toISOString().slice(0,10)?(totals.currentStreak??0)+1:1;
      totals.dailyStreak=Math.max(totals.dailyStreak??0,totals.currentStreak);
      totals.dailyDays=(totals.dailyDays??0)+1;next.badgeLastDaily=playedDay;
    }
  }
  Object.assign(metrics,totals);
  for (const achievement of BADGES) {
    next.badgeProgress??={};
    next.badgeProgress[achievement.id]=Math.min(achievement.target,Math.max(next.badgeProgress[achievement.id]??0,metrics[achievement.metric]??0));
    if (!next.achievements.includes(achievement.id) && next.badgeProgress[achievement.id] >= achievement.target) {
      next.achievements.push(achievement.id);
      newAchievements.push(achievement.id);
    }
  }

  next.personalBest = Math.max(next.personalBest, height);
  next.bestScore = Math.max(next.bestScore, Math.floor(finite(result.score)));
  next.runs += 1;
  next.tutorialComplete ||= objects > 0;
  next.coins = 0;

  // Height milestones offer cosmetic gifts; they never change physical properties.
  if (newBest) {
    if (height >= 30 && !next.unlockedCosmetics.includes('crane-coral')) next.unlockedCosmetics.push('crane-coral');
    if (height >= 100 && !next.unlockedCosmetics.includes('background-aurora')) next.unlockedCosmetics.push('background-aurora');
  }
  return { profile: next, earnedCoins, newAchievements, completedMissions };
}

/** Call after the share sheet succeeds or a challenge link was copied successfully. */
export function recordShare(profile:Profile):ProgressUpdate {return {profile:migrateProfile(profile),earnedCoins:0,newAchievements:[],completedMissions:[]};}

export function nearBadges(profile:Profile) {
 return BADGES.map(b=>({...b,progress:profile.badgeProgress?.[b.id]??0}))
 .filter(b=>!profile.achievements.includes(b.id)&&b.progress/b.target>.9&&b.progress<b.target)
 .sort((a,b)=>b.progress/b.target-a.progress/a.target).slice(0,3);
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
