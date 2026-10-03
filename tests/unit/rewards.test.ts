import { describe, expect, it, vi } from 'vitest';
import { REWARDS_STORAGE_KEY, RewardLedger } from '../../src/services/ads/rewards';

function storage(initial?: string) {
  const values = new Map<string, string>(initial ? [[REWARDS_STORAGE_KEY, initial]] : []);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe('persistent reward ledger', () => {
  it('preserves the published v1 bonus cap and queued Confetti during an upgrade', () => {
    const saved = storage('{"version":1,"day":"2026-10-03","coinClaims":2,"pendingTrial":true}');
    const ledger = new RewardLedger(saved, () => new Date('2026-10-03T12:00:00Z'));
    expect(ledger.bonusRemaining()).toBe(1);
    expect(ledger.canClaimConfetti(false)).toBe(false);
    expect(ledger.grantCoinBonus()).toBe(25);
    expect(new RewardLedger(saved, () => new Date('2026-10-03T13:00:00Z')).bonusRemaining()).toBe(0);
    expect(JSON.parse(saved.getItem(REWARDS_STORAGE_KEY)!)).toEqual({ version: 1, day: '2026-10-03', coinClaims: 3, pendingTrial: true });
    expect(ledger.consumeConfettiTrial()).toBe(true);
  });

  it('limits the 25 coin bonus to three completed rewards per UTC day across reloads', () => {
    const saved = storage();
    let now = new Date('2026-10-03T23:59:00Z');
    let ledger = new RewardLedger(saved, () => now);
    expect(ledger.bonusRemaining()).toBe(3);
    expect(ledger.grantCoinBonus()).toBe(25);
    ledger = new RewardLedger(saved, () => now);
    expect(ledger.bonusRemaining()).toBe(2);
    expect(ledger.grantCoinBonus()).toBe(25);
    expect(ledger.grantCoinBonus()).toBe(25);
    expect(ledger.grantCoinBonus()).toBe(0);
    expect(new RewardLedger(saved, () => now).bonusRemaining()).toBe(0);
    now = new Date('2026-10-04T00:00:00Z');
    expect(ledger.bonusRemaining()).toBe(3);
    expect(ledger.grantCoinBonus()).toBe(25);
    expect(ledger.bonusRemaining()).toBe(2);
  });

  it('uses UTC instead of the player offset at midnight', () => {
    const saved = storage();
    let now = new Date('2026-10-03T20:59:00-03:00');
    const ledger = new RewardLedger(saved, () => now);
    ledger.grantCoinBonus(); ledger.grantCoinBonus(); ledger.grantCoinBonus();
    now = new Date('2026-10-03T21:00:00-03:00');
    expect(ledger.bonusRemaining()).toBe(3);
  });

  it('retains pending Confetti over reloads and day changes and consumes it once', () => {
    const saved = storage();
    const first = new RewardLedger(saved, () => new Date('2026-10-03T12:00:00Z'));
    expect(first.canClaimConfetti(false)).toBe(true);
    expect(first.claimConfetti(false)).toBe(true);
    expect(first.claimConfetti(false)).toBe(false);
    const next = new RewardLedger(saved, () => new Date('2026-10-04T12:00:00Z'));
    next.grantCoinBonus();
    expect(next.canClaimConfetti(false)).toBe(false);
    expect(next.consumeConfettiTrial()).toBe(true);
    expect(new RewardLedger(saved).consumeConfettiTrial()).toBe(false);
    expect(next.canClaimConfetti(false)).toBe(true);
  });

  it('never offers a Confetti trial for a purchased cosmetic', () => {
    const ledger = new RewardLedger(storage());
    expect(ledger.canClaimConfetti(true)).toBe(false);
    expect(ledger.claimConfetti(true)).toBe(false);
    expect(ledger.consumeConfettiTrial()).toBe(false);
  });

  it('refreshes sequential grants from separate instances sharing storage', () => {
    const saved = storage();
    const first = new RewardLedger(saved);
    const second = new RewardLedger(saved);
    expect(first.grantCoinBonus()).toBe(25);
    expect(second.grantCoinBonus()).toBe(25);
    expect(first.grantCoinBonus()).toBe(25);
    expect(second.grantCoinBonus()).toBe(0);
  });

  it.each(['invalid json', 'null', '[]', '{"version":2}', '{"version":1,"bonusDay":"2026-02-30","bonusCount":-5,"confettiPending":"true"}'])('recovers malformed storage %s', (value) => {
    const ledger = new RewardLedger(storage(value));
    expect(ledger.bonusRemaining()).toBe(3);
    expect(ledger.canClaimConfetti(false)).toBe(true);
    expect(ledger.grantCoinBonus()).toBe(25);
  });

  it('clamps malformed counters to the daily maximum', () => {
    const ledger = new RewardLedger(storage('{"version":1,"bonusDay":"2026-10-03","bonusCount":999,"confettiPending":false}'), () => new Date('2026-10-03T12:00:00Z'));
    expect(ledger.bonusRemaining()).toBe(0);
    expect(ledger.grantCoinBonus()).toBe(0);
  });

  it('persists a recovered malformed payload when storage remains writable', () => {
    const saved = storage('invalid json');
    const ledger = new RewardLedger(saved);
    ledger.grantCoinBonus();
    expect(new RewardLedger(saved).bonusRemaining()).toBe(2);
  });

  it.each(['read', 'write'])('retains session limits if storage blocks %s', (operation) => {
    const saved = storage();
    const unavailable = { getItem: operation === 'read' ? () => { throw new Error('blocked'); } : saved.getItem, setItem: () => { throw new Error('blocked'); } };
    const ledger = new RewardLedger(unavailable);
    expect(ledger.grantCoinBonus()).toBe(25);
    expect(ledger.grantCoinBonus()).toBe(25);
    expect(ledger.grantCoinBonus()).toBe(25);
    expect(ledger.grantCoinBonus()).toBe(0);
    expect(ledger.claimConfetti(false)).toBe(true);
    expect(ledger.claimConfetti(false)).toBe(false);
    expect(ledger.consumeConfettiTrial()).toBe(true);
    expect(ledger.consumeConfettiTrial()).toBe(false);
  });

  it('writes only the reward ledger key', () => {
    const saved = { getItem: () => null, setItem: vi.fn() };
    const ledger = new RewardLedger(saved);
    ledger.grantCoinBonus();
    expect(saved.setItem).toHaveBeenCalledWith(REWARDS_STORAGE_KEY, expect.any(String));
    expect(JSON.parse(saved.setItem.mock.calls[0][1])).toEqual(expect.objectContaining({ version: 1, coinClaims: 1 }));
  });
});
