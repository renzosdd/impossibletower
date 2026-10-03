import { describe, expect, it } from 'vitest';
import { OBJECTS, craneSpeed, getObject, objectAt } from '../../src/content/objects';
import { createRng, dailySeed, randomSeed } from '../../src/utils/rng';
import { accuracyFor, calculateScore, scoreDrop, towerHeight, updateCombo } from '../../src/utils/scoring';
import { advanceStability, hasSignificantCollapse, isBeyondKillZone, isSettled, type CollapseSnapshot } from '../../src/utils/stability';

describe('fair, deterministic challenge sequences', () => {
  it('replays a seed and produces numbers within the half-open unit interval', () => {
    const first = createRng('a-friend-challenge');
    const second = createRng('a-friend-challenge');
    const sequence = Array.from({ length: 200 }, () => first());
    expect(sequence).toEqual(Array.from({ length: 200 }, () => second()));
    expect(sequence.every(value => value >= 0 && value < 1)).toBe(true);
    expect(sequence).not.toEqual(Array.from({ length: 200 }, createRng('different-seed')));
  });

  it('generates the same object at an index regardless of lookup order', () => {
    const ordered = Array.from({ length: 80 }, (_, index) => objectAt('same-run', index).id);
    const backwards = Array.from({ length: 80 }, (_, index) => objectAt('same-run', 79 - index).id).reverse();
    expect(ordered).toEqual(backwards);
    expect(ordered.slice(3)).not.toEqual(Array.from({ length: 77 }, (_, index) => objectAt('other-run', index + 3).id));
  });

  it('starts easy for every seed and introduces difficult and rare props progressively', () => {
    expect(Array.from({ length: 3 }, (_, index) => objectAt('any', index).id)).toEqual(['box', 'box', 'table']);
    for (let index = 3; index < 10; index += 1) {
      expect(objectAt('staged', index).difficultyWeight).toBeLessThanOrEqual(index < 5 ? 2 : 3);
      expect(objectAt('staged', index).rare).not.toBe(true);
    }
    expect(new Set(OBJECTS.map(object => object.id)).size).toBe(18);
    expect(OBJECTS.every(object => object.mass > 0 && object.width > 0 && object.height > 0)).toBe(true);
    const later = Array.from({ length: 300 }, (_, index) => objectAt('rare-fairness', index + 26));
    expect(later.some(object => object.rare)).toBe(true);
    expect(getObject('rocket').height).toBeGreaterThan(getObject('box').height);
    expect(craneSpeed(0)).toBeLessThan(craneSpeed(15));
    expect(craneSpeed(200)).toBe(208);
  });

  it('uses UTC dates even when a device has another calendar date', () => {
    expect(dailySeed(new Date('2026-10-02T23:55:00-03:00'))).toBe('tower:daily:2026-10-03:v1');
    expect(dailySeed(new Date('2026-10-03T02:55:00Z'))).toBe(dailySeed(new Date('2026-10-03T23:59:59Z')));
    expect(randomSeed()).toMatch(/^tower:[a-z0-9]+-[a-z0-9]+$/);
  });
});

describe('height and precision scoring', () => {
  it('measures height from logical world coordinates, rounded to tenths', () => {
    expect(towerHeight(526.6)).toBe(12.3);
    expect(towerHeight(700)).toBe(0);
    expect(towerHeight(-50)).toBe(70);
    expect(towerHeight(100, 400)).toBe(30);
    expect(towerHeight(Number.NaN)).toBe(0);
  });

  it('scores alignment relative to the actual support surface', () => {
    expect(accuracyFor(8, 100)).toBe('PERFECT');
    expect(accuracyFor(-18, 100)).toBe('GREAT');
    expect(accuracyFor(32, 100)).toBe('GOOD');
    expect(accuracyFor(33, 100)).toBe('RISKY');
    expect(accuracyFor(12, 200)).toBe('PERFECT');
    expect(accuracyFor(0, 0)).toBe('RISKY');
  });

  it('rewards consecutive precise drops without multiplying height', () => {
    let combo = updateCombo('PERFECT', 0);
    expect(scoreDrop('PERFECT', combo)).toBe(100);
    combo = updateCombo('GREAT', combo);
    expect(combo).toBe(2);
    expect(scoreDrop('GREAT', combo)).toBe(75);
    combo = updateCombo('PERFECT', combo);
    expect(scoreDrop('PERFECT', combo)).toBe(150);
    expect(updateCombo('GOOD', combo)).toBe(0);
    expect(updateCombo('RISKY', combo)).toBe(0);
    expect(calculateScore(12.3, 3, 325)).toBe(523);
    expect(calculateScore(-4, -2, -10)).toBe(0);
  });
});

describe('settling and meaningful collapse', () => {
  it('requires continuous supported stillness for about one second', () => {
    let elapsed = 0;
    for (let frame = 0; frame < 59; frame += 1) elapsed = advanceStability(elapsed, 0.1, 0.005, 16);
    expect(isSettled(elapsed)).toBe(false);
    elapsed = advanceStability(elapsed, 0.1, 0.005, 16);
    expect(isSettled(elapsed)).toBe(true);
    expect(advanceStability(elapsed, 0.5, 0, 16)).toBe(0);
    expect(advanceStability(elapsed, 0, 0.03, 16)).toBe(0);
    expect(advanceStability(elapsed, 0, 0, 16, false)).toBe(0);
    expect(advanceStability(0, 0, 0, 5000)).toBe(100);
  });

  const stack = (): CollapseSnapshot[] => Array.from({ length: 8 }, (_, index) => ({
    placedIndex: index, settledY: 600 - index * 50, y: 600 - index * 50, speed: 0,
  }));

  it('ignores movement of an old piece and a small wobble at the top', () => {
    const pieces = stack();
    pieces[0] = { ...pieces[0], y: 740, speed: 4, fallen: true };
    expect(hasSignificantCollapse(pieces, 220, 340)).toBe(false);
    pieces[7] = { ...pieces[7], y: pieces[7].y + 30, speed: 3 };
    expect(hasSignificantCollapse(pieces, 220, 250)).toBe(false);
  });

  it('detects top collapse only when tower height and multiple recent pieces fall', () => {
    const pieces = stack();
    pieces[7] = { ...pieces[7], y: pieces[7].y + 130, speed: 3 };
    expect(hasSignificantCollapse(pieces, 220, 350)).toBe(false);
    pieces[6] = { ...pieces[6], y: pieces[6].y + 120, speed: 4 };
    expect(hasSignificantCollapse(pieces, 220, 350)).toBe(true);
    expect(hasSignificantCollapse(pieces, 220, 250)).toBe(false);
    expect(isBeyondKillZone(830, 800)).toBe(true);
    expect(isBeyondKillZone(799, 800)).toBe(false);
  });
});
