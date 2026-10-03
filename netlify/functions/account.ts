import type { Config } from '@netlify/functions';
import { AID_CATALOG, COIN_PACKS, validLoadout } from '../../src/content/economy';
import { ApiError, authenticate, database, enabled, env, failure, json, kickReplay, rankingPeriods, readBody, rpc, uuid } from './_shared/runtime';
import { captureOrder, createOrder } from './_shared/paypal';

export default async (request: Request): Promise<Response> => {
  try {
    const actions = new Set(['snapshot', 'buy-aid', 'buy-cosmetic', 'start-run', 'use-aid', 'finish-run', 'run', 'leaderboard', 'ad-intent', 'ad-complete', 'ad-cancel', 'double-coins', 'paypal-order', 'paypal-capture']);
    if (!enabled('SERVER_ECONOMY_ENABLED')) throw new ApiError(503, 'La economía online todavía no está disponible.');
    if (request.method !== 'POST') throw new ApiError(405, 'Método inválido.');
    const body = await readBody(request);
    if (body.ageGroup !== 'adult' && !(body.ageGroup === 'teen' && body.guardianAuthorized === true)) throw new ApiError(403, 'Se requiere autorización para usar la cuenta.');
    if (typeof body.action !== 'string' || !actions.has(body.action)) throw new ApiError(400, 'Operación inválida.');
    const db = database(), user = await authenticate(request, db);
    const action = body.action;
    if (!['snapshot', 'leaderboard', 'run'].includes(action) && (!user.email_confirmed_at || !user.email || user.is_anonymous)) throw new ApiError(403, 'Verificá tu email para usar la economía online.');
    if (['buy-aid', 'buy-cosmetic', 'start-run', 'use-aid', 'paypal-order'].includes(action) && !uuid(body.requestId)) throw new ApiError(400, 'Identificador inválido.');
    if (['finish-run', 'run', 'use-aid', 'double-coins'].includes(action) && !uuid(body.runId)) throw new ApiError(400, 'Partida inválida.');
    if (['ad-complete', 'ad-cancel', 'double-coins'].includes(action) && !uuid(body.intentId)) throw new ApiError(400, 'Recompensa inválida.');
    if (action.startsWith('ad-') || action === 'double-coins') {
      if (body.ageGroup !== 'adult') throw new ApiError(403, 'Las recompensas publicitarias requieren una cuenta adulta.');
      if (!enabled('SERVER_AD_REWARDS_ENABLED')) throw new ApiError(503, 'Las recompensas online todavía no están disponibles.');
      if (['ad-intent', 'ad-complete'].includes(action) && (body.provider !== 'google-h5' || body.debug === true)) throw new ApiError(400, 'Proveedor inválido.');
      if (action === 'ad-complete' && body.evidence !== 'browser-callback') throw new ApiError(400, 'Evidencia inválida.');
    }
    if (action === 'buy-aid' && (typeof body.id !== 'string' || !Object.hasOwn(AID_CATALOG, body.id))) throw new ApiError(400, 'Ayuda inválida.');
    if (action === 'start-run') {
      if (!validLoadout(body.aids) || !['casual', 'daily'].includes(String(body.mode))) throw new ApiError(400, 'Configuración inválida.');
      if (!user.email_confirmed_at || !user.email || user.is_anonymous) throw new ApiError(403, 'Verificá tu email para jugar con una cuenta.');
      if (body.mode === 'daily' && !enabled('SERVER_RANKINGS_ENABLED')) throw new ApiError(503, 'El ranking todavía no está disponible.');
      const catalog = env('SERVER_OBJECT_CATALOG') || 'extended-24';
      if (!['legacy-18', 'extended-24', 'extended-30'].includes(catalog)) throw new ApiError(503, 'Catálogo sin configurar.');
      body.catalog = catalog;
    }
    if (action === 'leaderboard' && !rankingPeriods().includes(String(body.period))) throw new ApiError(503, 'Este ranking todavía no está disponible.');
    if (action.startsWith('paypal-')) {
      if (body.ageGroup !== 'adult') throw new ApiError(403, 'Las compras requieren una cuenta adulta.');
      if (!enabled('SERVER_PAYPAL_ENABLED')) throw new ApiError(503, 'Las compras todavía no están disponibles.');
      if (!user.email_confirmed_at || !user.email || user.is_anonymous) throw new ApiError(403, 'Verificá tu email antes de comprar.');
      if (action === 'paypal-order') {
        if (body.adultConfirmed !== true || typeof body.packId !== 'string' || !Object.hasOwn(COIN_PACKS, body.packId)) throw new ApiError(400, 'Confirmá tu mayoría de edad y elegí un pack.');
        return json(await createOrder(db, user.id, body));
      }
      return json(await captureOrder(db, user.id, body.orderId));
    }
    const result = await rpc(db, action, user.id, body);
    if (action === 'finish-run') await kickReplay().catch(() => {});
    return json(result, action === 'finish-run' ? 202 : 200);
  } catch (error) { return failure(error); }
};
export const config: Config = { path: '/api/account', method: 'POST' };
