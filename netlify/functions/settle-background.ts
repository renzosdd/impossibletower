import type { Config } from '@netlify/functions';
import { ApiError, database, enabled, failure, json, rankingPeriods, required, rpc } from './_shared/runtime';

export default async (request: Request): Promise<Response> => {
  try {
    if (!enabled('SERVER_ECONOMY_ENABLED')) return json({ enabled: false });
    if (request.method !== 'POST' || request.headers.get('authorization') !== `Bearer ${required('REPLAY_WORKER_SECRET')}`) throw new ApiError(401, 'Worker authorization required');
    return json({ settled: await rpc<number>(database(), 'settle', null, { periods: rankingPeriods() }) });
  } catch (error) { return failure(error); }
};
export const config: Config = { path: '/api/settle-background', method: 'POST' };
