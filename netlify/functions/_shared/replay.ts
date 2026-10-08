import { replayRun, type ReplayEvent } from '../../../src/game/simulation/TowerSimulation';
import type { AidId, RunConfig } from '../../../src/types';
import type { RunResult } from '../../../src/types';

export interface ReplayJob { id: string; userId: string; mode: 'casual' | 'daily'; seed: string; catalog: RunConfig['catalog']; ruleset: 'v2' | 'v3'; aids: AidId[]; aidRulesVersion?:1|2; authorizedAids: { id: AidId; tick: number }[]; events: ReplayEvent[]; finalTick: number; workerId: string; startedAt: string; receivedAt: string; }
export function validateReplay(job: ReplayJob): RunResult {
  if (!['legacy-18', 'extended-24', 'extended-30'].includes(job.catalog || '') || !['v2','v3'].includes(job.ruleset)) throw new Error('Unknown ruleset');
  if (!Number.isInteger(job.finalTick) || job.finalTick > 144000 || job.finalTick < 1 || !Array.isArray(job.events) || job.events.length > 510) throw new Error('Invalid replay');
  const wallTicks = Math.ceil((Date.parse(job.receivedAt) - Date.parse(job.startedAt)) * 60 / 1000) + 120;
  if (!Number.isFinite(wallTicks) || job.finalTick > wallTicks) throw new Error('Replay exceeds elapsed time');
  const uses = job.events.filter(event => event.action === 'aid');
  if (uses.length !== job.authorizedAids.length || uses.some(event => !job.aids.includes(event.aid!) || !job.authorizedAids.some(use => use.id === event.aid && use.tick === event.tick))) throw new Error('Aid not authorized');
  return replayRun({ mode: job.mode, seed: job.seed, catalog: job.catalog, ruleset: job.ruleset,aidRulesVersion:job.aidRulesVersion??1 }, job.events, job.finalTick);
}
