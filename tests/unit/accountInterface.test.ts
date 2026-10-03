import { describe, expect, it } from 'vitest';
import { canBuyAid, canSelectAid, type AccountEnabledFlags, type AccountViewState } from '../../src/ui/AccountInterface';

const flags: AccountEnabledFlags = { economy: true, rankings: true, rankingPeriods: ['daily', 'weekly', 'monthly'], payments: false, paymentMode: 'disabled', onlineAllowed: true };
const state: AccountViewState = { localCoins: 10000, snapshot: { balance: 45, inventory: {}, onlineCosmetics: [], recoverable: true, gameplayEarned: 0, missionEarned: 0, adBonusClaims: 0, transactions: [] } };

describe('account aid controls', () => {
  it('requires verified account coins instead of spending an arbitrary legacy local balance', () => {
    expect(canBuyAid(state, flags, 'guide-10')).toBe(true);
    expect(canBuyAid(state, flags, 'second-chance')).toBe(false);
    expect(canBuyAid({ ...state, snapshot: null }, flags, 'guide-5')).toBe(false);
    expect(canBuyAid({ ...state, snapshot: { ...state.snapshot!, recoverable: false } }, flags, 'guide-5')).toBe(false);
  });

  it('disables spending while offline, unauthorized, or waiting for the server', () => {
    expect(canBuyAid(state, { ...flags, economy: false }, 'guide-5')).toBe(false);
    expect(canBuyAid(state, { ...flags, onlineAllowed: false }, 'guide-5')).toBe(false);
    expect(canBuyAid({ ...state, busy: true }, flags, 'guide-5')).toBe(false);
  });

  it('only equips owned aids and allows deselecting even after an inventory refresh', () => {
    expect(canSelectAid([], {}, 'preview')).toBe(false);
    expect(canSelectAid([], { preview: 1 }, 'preview')).toBe(true);
    expect(canSelectAid(['preview'], {}, 'preview')).toBe(true);
    expect(canSelectAid([], { preview: Number.NaN }, 'preview')).toBe(false);
  });

  it('enforces two aids and incompatible guide variants before emitting a loadout', () => {
    expect(canSelectAid(['preview', 'focus'], { skip: 1 }, 'skip')).toBe(false);
    expect(canSelectAid(['guide-5'], { 'guide-10': 1 }, 'guide-10')).toBe(false);
    expect(canSelectAid(['guide-10'], { 'guide-5': 1 }, 'guide-5')).toBe(false);
    expect(canSelectAid(['guide-10'], { 'second-chance': 1 }, 'second-chance')).toBe(true);
  });
});
