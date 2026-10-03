export const AID_CATALOG = {
  'guide-5': { name: 'Guía 5', price: 25 },
  'guide-10': { name: 'Guía 10', price: 45 },
  preview: { name: 'Vista previa', price: 20 },
  focus: { name: 'Foco', price: 35 },
  skip: { name: 'Cambiar pieza', price: 50 },
  'second-chance': { name: 'Segunda oportunidad', price: 90 },
} as const;
export type AidId = keyof typeof AID_CATALOG;
export const COIN_PACKS = {
  small: { coins: 200, amount: '2.99', currency: 'USD' },
  medium: { coins: 600, amount: '6.99', currency: 'USD' },
  large: { coins: 1400, amount: '12.99', currency: 'USD' },
} as const;
export type PackId = keyof typeof COIN_PACKS;
export type RankingPeriod = 'daily' | 'weekly' | 'monthly';
export const ECONOMY_LIMITS = { starter: 100, gameplayDaily: 300, missionsDaily: 25, adDaily: 75, adBonus: 25, adCount: 3, activeTicks: 144000, wallMinutes: 60, settlementMinutes: 75 } as const;

export function validLoadout(ids: unknown): ids is AidId[] {
  return Array.isArray(ids) && ids.length <= 2 && new Set(ids).size === ids.length
    && ids.every(id => typeof id === 'string' && Object.hasOwn(AID_CATALOG, id))
    && !(ids.includes('guide-5') && ids.includes('guide-10'));
}

export function prizeSlots(participants: number): number {
  return participants < 5 ? 0 : participants < 10 ? 1 : participants < 25 ? 3 : participants < 100 ? 10 : 25;
}

export function dailyPoints(rank: number, participants: number): number {
  if (!Number.isInteger(rank) || !Number.isInteger(participants) || rank < 1 || rank > participants) return 0;
  return participants === 1 ? 10 : Math.round(10 + 90 * (participants - rank) / (participants - 1));
}

export function rankingPrize(period: RankingPeriod, rank: number, participants: number): { coins: number; items: Partial<Record<AidId, number>> } {
  if (rank < 1 || rank > prizeSlots(participants)) return { coins: 0, items: {} };
  const amounts = { daily: [60, 40, 25, 10, 5], weekly: [200, 140, 100, 40, 15], monthly: [600, 400, 250, 100, 35] };
  const coins = amounts[period][rank <= 3 ? rank - 1 : rank <= 10 ? 3 : 4];
  let items: Partial<Record<AidId, number>> = {};
  if (period === 'daily') items = rank === 1 ? { 'guide-5': 1 } : rank === 2 ? { preview: 1 } : {};
  if (period === 'weekly') items = rank === 1 ? { 'guide-10': 1, focus: 1 } : rank === 2 ? { 'guide-10': 1 } : rank === 3 ? { 'guide-5': 1 } : rank <= 10 ? { preview: 1 } : {};
  if (period === 'monthly') items = rank === 1 ? { 'guide-10': 3, focus: 2 } : rank === 2 ? { 'guide-10': 2, focus: 1 } : rank === 3 ? { 'guide-10': 1 } : rank <= 10 ? { 'guide-5': 1 } : {};
  return { coins, items };
}
