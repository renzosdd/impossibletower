import { PAYMENTS_RELEASE_ENABLED } from '../../src/content/economy';
import type { Config } from '@netlify/functions';
import { ApiError, database, enabled, failure, json, readBody } from './_shared/runtime';
import { receiveWebhook } from './_shared/paypal';

export default async (request: Request): Promise<Response> => {
  try {
    if (!PAYMENTS_RELEASE_ENABLED || !enabled('SERVER_ECONOMY_ENABLED') || !enabled('SERVER_PAYPAL_ENABLED')) throw new ApiError(503, 'Payments disabled');
    if (request.method !== 'POST') throw new ApiError(405, 'Method not allowed');
    await receiveWebhook(database(), request, await readBody(request));
    return json({ received: true });
  } catch (error) { return failure(error); }
};
export const config: Config = { path: '/api/paypal-webhook', method: 'POST' };
