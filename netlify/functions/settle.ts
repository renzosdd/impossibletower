import type { Config } from '@netlify/functions';
import { enabled, failure, json, kickReplay, kickSettlement } from './_shared/runtime';

export default async (): Promise<Response> => {
  if (!enabled('SERVER_ECONOMY_ENABLED')) return json({ enabled: false });
  try {
    await Promise.all([kickSettlement(), kickReplay()]);
    return json({ dispatched: true });
  } catch (error) { return failure(error); }
};
export const config: Config = { schedule: '*/5 * * * *' };
