import { isUTCDate } from '../storage/profile';

export const REWARDS_STORAGE_KEY = 'impossible-tower.rewards.v1';
export const BONUS_COINS = 25;
export const DAILY_BONUS_LIMIT = 3;

type RewardStorage = Pick<Storage, 'getItem' | 'setItem'>;

interface RewardState {
  version: 1;
  day: string;
  coinClaims: number;
  pendingTrial: boolean;
}

function emptyState(): RewardState {
  return { version: 1, day: '', coinClaims: 0, pendingTrial: false };
}

function browserStorage(): RewardStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; }
}

function normalize(value: unknown): RewardState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyState();
  const state = value as Record<string, unknown>;
  if (state.version !== 1) return emptyState();
  const day = state.day ?? state.bonusDay;
  const count = state.coinClaims ?? state.bonusCount;
  return {
    version: 1,
    day: isUTCDate(day) ? day : '',
    coinClaims: typeof count === 'number' && Number.isFinite(count)
      ? Math.min(DAILY_BONUS_LIMIT, Math.max(0, Math.floor(count))) : 0,
    pendingTrial: (state.pendingTrial ?? state.confettiPending) === true,
  };
}

export class RewardLedger {
  private state = emptyState();
  private storageAvailable = true;
  private readonly storage: RewardStorage | undefined;

  constructor(storage?: RewardStorage, private readonly now: () => Date = () => new Date()) {
    this.storage = storage ?? browserStorage();
    this.refresh();
  }

  private refresh(): void {
    if (!this.storage || !this.storageAvailable) return;
    try {
      const value = this.storage.getItem(REWARDS_STORAGE_KEY);
      try { this.state = value ? normalize(JSON.parse(value)) : emptyState(); } catch { this.state = emptyState(); }
    } catch {
      this.storageAvailable = false;
    }
  }

  private persist(): void {
    if (!this.storage || !this.storageAvailable) return;
    try { this.storage.setItem(REWARDS_STORAGE_KEY, JSON.stringify(this.state)); } catch { this.storageAvailable = false; }
  }

  private currentDay(): string {
    return this.now().toISOString().slice(0, 10);
  }

  bonusRemaining(): number {
    this.refresh();
    return this.state.day === this.currentDay() ? DAILY_BONUS_LIMIT - this.state.coinClaims : DAILY_BONUS_LIMIT;
  }

  grantCoinBonus(): number {
    if (this.bonusRemaining() === 0) return 0;
    const day = this.currentDay();
    this.state.coinClaims = this.state.day === day ? this.state.coinClaims + 1 : 1;
    this.state.day = day;
    this.persist();
    return BONUS_COINS;
  }

  canClaimConfetti(purchased: boolean): boolean {
    this.refresh();
    return !purchased && !this.state.pendingTrial;
  }

  claimConfetti(purchased: boolean): boolean {
    if (!this.canClaimConfetti(purchased)) return false;
    this.state.pendingTrial = true;
    this.persist();
    return true;
  }

  consumeConfettiTrial(): boolean {
    this.refresh();
    if (!this.state.pendingTrial) return false;
    this.state.pendingTrial = false;
    this.persist();
    return true;
  }
}
