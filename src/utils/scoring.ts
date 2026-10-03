import type { Accuracy } from '../types';

export const PIXELS_PER_METER = 10;
export const GROUND_Y = 650;

/** World coordinates, independent from the camera, give a tenth-of-a-meter height. */
export function towerHeight(topY: number, groundY = GROUND_Y): number {
  if (!Number.isFinite(topY) || !Number.isFinite(groundY)) return 0;
  return Math.round(Math.max(0, groundY - topY)) / PIXELS_PER_METER;
}

export function accuracyFor(offset: number, supportWidth: number): Accuracy {
  if (!Number.isFinite(offset) || !Number.isFinite(supportWidth) || supportWidth <= 0) return 'RISKY';
  const ratio = Math.abs(offset) / supportWidth;
  if (ratio <= 0.08) return 'PERFECT';
  if (ratio <= 0.18) return 'GREAT';
  if (ratio <= 0.32) return 'GOOD';
  return 'RISKY';
}

export function updateCombo(accuracy: Accuracy, combo: number): number {
  return accuracy === 'PERFECT' || accuracy === 'GREAT' ? Math.max(0, Math.floor(combo)) + 1 : 0;
}

/** Pass the combo returned by updateCombo. Accuracy bonuses never alter physics. */
export function scoreDrop(accuracy: Accuracy, combo: number): number {
  const points: Record<Accuracy, number> = { PERFECT: 100, GREAT: 60, GOOD: 30, RISKY: 10 };
  const multiplier = accuracy === 'PERFECT' || accuracy === 'GREAT'
    ? 1 + Math.min(9, Math.max(0, Math.floor(combo) - 1)) * 0.25
    : 1;
  return Math.round(points[accuracy] * multiplier);
}

export function calculateScore(height: number, objectsPlaced: number, precisionPoints: number): number {
  const clean = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
  return Math.round(clean(height) * 10 + Math.floor(clean(objectsPlaced)) * 25 + clean(precisionPoints));
}
