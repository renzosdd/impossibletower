import type { Config } from '@netlify/functions';
import { database, enabled, failure, json, required, rpc } from './_shared/runtime';
import { validateReplay, type ReplayJob } from './_shared/replay';

export default async (request: Request): Promise<Response> => {
  if (!enabled('SERVER_ECONOMY_ENABLED')) return json({ enabled: false }, 503);
  if (request.method !== 'POST' || request.headers.get('authorization') !== `Bearer ${required('REPLAY_WORKER_SECRET')}`) return json({ error: 'Forbidden' }, 403);
  const db = database();
  try {
    for (let index = 0; index < 3; index++) {
      const job = await rpc<ReplayJob | null>(db, 'claim-job', null);
      if (!job) break;
      let result;
      try { result = validateReplay(job); }
      catch { await rpc(db, 'reject-run', null, { runId: job.id, workerId: job.workerId }); continue; }
      try {
        await rpc(db, 'verify-run', null, { runId: job.id, workerId: job.workerId, result: { ...result, heightCentimeters: Math.round(result.height * 100) } });
      } catch { await rpc(db, 'retry-run', null, { runId: job.id, workerId: job.workerId }); }
    }
    return json({ processed: true });
  } catch (error) { return failure(error); }
};
export const config: Config = { path: '/api/replay-background', method: 'POST' };
