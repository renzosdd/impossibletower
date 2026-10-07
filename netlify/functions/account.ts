import type { Config } from '@netlify/functions';
import { AID_CATALOG, validLoadout } from '../../src/content/economy';
import { ApiError, authenticate, database, enabled, env, failure, json, kickReplay, rankingPeriods, readBody, rpc, uuid } from './_shared/runtime';

export default async (request: Request): Promise<Response> => {
  try {
    const actions = new Set(['snapshot', 'buy-aid', 'buy-cosmetic', 'start-run', 'use-aid', 'finish-run', 'run', 'leaderboard', 'ad-intent', 'ad-complete', 'ad-cancel', 'buy-attempt','capture-referral','claim-referral','paypal-order', 'paypal-capture']);
    if (!enabled('SERVER_ECONOMY_ENABLED')) throw new ApiError(503, 'La economía online todavía no está disponible.');
    if (request.method !== 'POST') throw new ApiError(405, 'Método inválido.');
    const body = await readBody(request);
    if (body.ageGroup !== 'adult' && !(body.ageGroup === 'teen' && body.guardianAuthorized === true)) throw new ApiError(403, 'Se requiere autorización para usar la cuenta.');
    if (typeof body.action !== 'string' || !actions.has(body.action)) throw new ApiError(400, 'Operación inválida.');
    const db = database(), user = await authenticate(request, db);
    const action = body.action;
    const google=!!user.identities?.some(identity=>identity.provider==='google')&&!user.is_anonymous&&!!user.email_confirmed_at;
    const guestActions=['snapshot','leaderboard','run','start-run','finish-run','capture-referral'];
    if (!guestActions.includes(action) && !google) throw new ApiError(403, 'Iniciá sesión con Google para usar las monedas.');
    if (['buy-aid', 'buy-cosmetic', 'start-run', 'use-aid', 'paypal-order','buy-attempt','ad-intent'].includes(action) && !uuid(body.requestId)) throw new ApiError(400, 'Identificador inválido.');
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
      if (body.mode==='daily'&&!google||!google&&(body.aids as unknown[]).length>0) throw new ApiError(403,'Iniciá sesión con Google para jugar Daily.');
      if (typeof body.publicName!=='string'||!body.publicName.trim())throw new ApiError(400,'Nombre público obligatorio');
      if (body.mode === 'daily' && !enabled('SERVER_RANKINGS_ENABLED')) throw new ApiError(503, 'El ranking todavía no está disponible.');
      const catalog = env('SERVER_OBJECT_CATALOG') || 'extended-30';
      if (!['legacy-18', 'extended-24', 'extended-30'].includes(catalog)) throw new ApiError(503, 'Catálogo sin configurar.');
      body.catalog = catalog; body.ruleset='v3';
    }
    if (action === 'leaderboard' && !rankingPeriods().includes(String(body.period))) throw new ApiError(503, 'Este ranking todavía no está disponible.');
    if (action.startsWith('paypal-')) throw new ApiError(503, 'Compras próximamente');
    if(action==='ad-intent'&&body.reward!=='daily-attempt')throw new ApiError(400,'Recompensa inválida.');
    if(action==='capture-referral'&&(typeof body.code!=='string'||!uuid(body.code)))throw new ApiError(400,'Invitación inválida.');
    if(action==='claim-referral'&&!uuid(body.token))throw new ApiError(400,'Invitación inválida.');
    const result = await rpc(db, action, user.id, body);
    if (action === 'finish-run') await kickReplay().catch(() => {});
    return json(result, action === 'finish-run' ? 202 : 200);
  } catch (error) { return failure(error); }
};
export const config: Config = { path: '/api/account', method: 'POST' };
