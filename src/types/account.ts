import type { AidId, RankingPeriod } from '../content/economy';
export interface AccountSnapshot { balance: number; inventory: Partial<Record<AidId, number>>; onlineCosmetics: string[]; recoverable: boolean; gameplayEarned: number; missionEarned: number; adBonusClaims: number; transactions: { id: string; source: string; coins: number; items: Partial<Record<AidId, number>>; createdAt: string }[]; }
export interface RunTicket { id: string; mode: 'casual' | 'daily'; seed: string; catalog: 'legacy-18' | 'extended-24' | 'extended-30'; ruleset: 'v2'; startedAt: string; expiresAt: string; aids: AidId[]; }
export interface ReplayInput { tick: number; action: 'drop' | 'aid'; aid?: AidId; }
export interface ReplaySubmission { runId: string; finalTick: number; events: ReplayInput[]; }
export interface AccountRun { id: string; status: 'started' | 'pending' | 'validating' | 'accepted' | 'rejected' | 'verification_timeout'; error?: string; result?: { height: number; score: number; objectsPlaced: number; perfectDrops: number; maxCombo: number; earnedCoins: number; }; }
export interface RankingEntry { rank: number; name: string; height: number; score: number; points: number; wins: number; aidsUsed: AidId[]; coins: number; items: Partial<Record<AidId, number>>; }
export interface RankingSnapshot { period: RankingPeriod; periodId: string; startUTC: string; endUTC: string; settlesAt: string; status: 'open' | 'settled'; participants: number; entries: RankingEntry[]; ownEntry: RankingEntry | null; }
