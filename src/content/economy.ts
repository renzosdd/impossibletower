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
export const ECONOMY_LIMITS = { version:3, starter:60, gameplayDaily:0, missionsDaily:6, adDaily:0, adBonus:0, adCount:2, freeAttempts:3, attemptPrice:30, referralReward:5, referralDaily:10, referralDays:7, prizeMinimum:20, activeTicks:144000, wallMinutes:60, settlementMinutes:75 } as const;

export function validLoadout(ids: unknown): ids is AidId[] {
  return Array.isArray(ids) && ids.length <= 2 && new Set(ids).size === ids.length
    && ids.every(id => typeof id === 'string' && Object.hasOwn(AID_CATALOG, id))
    && !(ids.includes('guide-5') && ids.includes('guide-10'));
}

export function prizeSlots(participants:number):number {return participants<20?0:Math.min(25,participants);}
export function dailyPoints(rank:number,participants:number):number {
 if(!Number.isInteger(rank)||!Number.isInteger(participants)||rank<1||rank>participants)return 0;
 return participants===1?10:Math.round(10+90*(participants-rank)/(participants-1));
}
export function rankingPrize(period:RankingPeriod,rank:number,participants:number):{coins:number;items:Partial<Record<AidId,number>>} {
 return {coins:period!=='daily'||rank<1||rank>prizeSlots(participants)?0:rank===1?30:rank===2?20:rank===3?10:rank<=10?5:2,items:{}};
}

/** Enable only in a separately reviewed payment release. Environment flags cannot enable charges. */
export const PAYMENTS_RELEASE_ENABLED = false;
