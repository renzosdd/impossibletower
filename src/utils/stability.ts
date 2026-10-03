/** Matter linear velocity is in pixels/frame; angular velocity is radians/frame. */
export const LINEAR_SETTLE_THRESHOLD = 0.28;
export const ANGULAR_SETTLE_THRESHOLD = 0.018;
export const SETTLE_TIME_MS = 950;

/** A frame gap or background pause cannot instantly make a falling object settled. */
export function advanceStability(
  previousMs: number,
  linearSpeed: number,
  angularSpeed: number,
  deltaMs: number,
  hasSupport = true,
): number {
  if (!hasSupport || !Number.isFinite(linearSpeed) || !Number.isFinite(angularSpeed)
    || Math.abs(linearSpeed) > LINEAR_SETTLE_THRESHOLD
    || Math.abs(angularSpeed) > ANGULAR_SETTLE_THRESHOLD) return 0;
  const elapsed = Number.isFinite(deltaMs) ? Math.max(0, Math.min(100, deltaMs)) : 0;
  return Math.max(0, Number.isFinite(previousMs) ? previousMs : 0) + elapsed;
}

export function isSettled(stableMs: number, requiredMs = SETTLE_TIME_MS): boolean {
  return Number.isFinite(stableMs) && stableMs >= requiredMs;
}

export function isBeyondKillZone(y: number, killZoneY: number): boolean {
  return Number.isFinite(y) && Number.isFinite(killZoneY) && y > killZoneY;
}

export interface CollapseSnapshot {
  placedIndex: number;
  /** Center position recorded when this piece became settled. */
  settledY: number;
  y: number;
  speed: number;
  fallen?: boolean;
}

/**
 * Losing substantial height AND a majority of the recently placed top cohort
 * counts as collapse. Older pieces moving or one recent piece wobbling do not.
 * Retain fallen snapshots until the run ends so missing bodies still count.
 */
export function hasSignificantCollapse(
  bodies: readonly CollapseSnapshot[],
  peakTopY: number,
  currentTopY: number,
  groundY = 650,
): boolean {
  if (bodies.length < 2 || !Number.isFinite(peakTopY) || !Number.isFinite(currentTopY)) return false;
  const height = Math.max(0, groundY - peakTopY);
  const lostHeight = currentTopY - peakTopY;
  // About eight meters or a quarter of a taller tower must be lost.
  if (lostHeight < Math.max(80, Math.min(180, height * 0.25))) return false;
  const cohortSize = Math.min(bodies.length, Math.max(2, Math.min(4, Math.ceil(bodies.length * 0.25))));
  const cohort = [...bodies].sort((a, b) => b.placedIndex - a.placedIndex).slice(0, cohortSize);
  const displaced = cohort.filter(body => body.fallen || (
    Number.isFinite(body.y) && Number.isFinite(body.settledY)
    && body.y - body.settledY >= 70 && Math.abs(body.speed) >= 1.4
  ));
  return displaced.length >= Math.ceil(cohortSize * 0.6);
}
