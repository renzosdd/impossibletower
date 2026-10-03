import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const mocks = vi.hoisted(() => ({ db: { auth: { getUser: vi.fn(), getSession: vi.fn(), updateUser: vi.fn(), verifyOtp: vi.fn(), signInWithOtp: vi.fn() }, rpc: vi.fn() }, createClient: vi.fn(), consent: { ageGroup: 'adult', guardianAuthorized: false } }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('../../src/services/privacy', () => ({ privacyConsent: { load: () => mocks.consent } }));
import handler from '../../netlify/functions/account';
import webhook from '../../netlify/functions/paypal-webhook';
import settle from '../../netlify/functions/settle';
import settleBackground from '../../netlify/functions/settle-background';
import { AccountService } from '../../src/services/account';
import { amountCents, captureOrder, createOrder, paypalBase } from '../../netlify/functions/_shared/paypal';
import { validateReplay, type ReplayJob } from '../../netlify/functions/_shared/replay';
import { AID_CATALOG, COIN_PACKS, dailyPoints, prizeSlots, rankingPrize, validLoadout } from '../../src/content/economy';
import { TowerSimulation } from '../../src/game/simulation/TowerSimulation';

const userId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
let values: Record<string, string>;
const req = (action: string, payload: Record<string, unknown> = {}) => new Request('https://tower.example/api/account', { method: 'POST', headers: { Authorization: 'Bearer session', 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ageGroup: 'adult', guardianAuthorized: false, ...payload }) });
beforeEach(() => {
 vi.clearAllMocks();
 values = { SERVER_ECONOMY_ENABLED: 'true', SERVER_RANKINGS_ENABLED: 'true', SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test', APP_URL: 'https://tower.example', REPLAY_WORKER_SECRET: 'x'.repeat(48), PAYPAL_CLIENT_ID: 'client', PAYPAL_CLIENT_SECRET: 'secret', PAYPAL_WEBHOOK_ID: 'webhook', PAYPAL_MERCHANT_ID: 'MERCHANT1234' };
 vi.stubGlobal('Netlify', { env: { get: (name: string) => values[name] } });
 mocks.createClient.mockReturnValue(mocks.db);
 mocks.db.auth.getUser.mockResolvedValue({ data: { user: { id: userId, email: 'person@example.test', email_confirmed_at: '2026-10-03T00:00:00Z', is_anonymous: false } }, error: null });
 mocks.db.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'session' } }, error: null });
 mocks.db.rpc.mockResolvedValue({ data: { balance: 100 }, error: null });
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({})));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('server account boundary', () => {
 it('disabled flags do not initialize an admin client', async () => { values.SERVER_ECONOMY_ENABLED = 'false'; expect((await handler(req('snapshot'))).status).toBe(503); expect(mocks.createClient).not.toHaveBeenCalled(); });
 it('rejects privileged credit actions', async () => { expect((await handler(req('payment-event'))).status).toBe(400); expect(mocks.db.rpc).not.toHaveBeenCalled(); });
 it('verifies Auth server-side and denies stale users', async () => { mocks.db.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'gone' } }); expect((await handler(req('snapshot'))).status).toBe(401); expect(mocks.db.rpc).not.toHaveBeenCalled(); });
 it('extracts ownership from verified user instead of body', async () => { await handler(req('snapshot', { userId: requestId, p_user: requestId })); expect(mocks.db.rpc).toHaveBeenCalledWith('tower_account_api', expect.objectContaining({ p_user: userId, p_action: 'snapshot' })); });
 it.each(['unknown', 'under13'])('blocks %s account declarations', async ageGroup => { expect((await handler(req('snapshot', { ageGroup }))).status).toBe(403); expect(mocks.db.rpc).not.toHaveBeenCalled(); });
 it('requires teen guardian authorization and keeps purchases adult', async () => { expect((await handler(req('snapshot', { ageGroup: 'teen', guardianAuthorized: false }))).status).toBe(403); expect((await handler(req('snapshot', { ageGroup: 'teen', guardianAuthorized: true }))).status).toBe(200); values.SERVER_PAYPAL_ENABLED = 'true'; expect((await handler(req('paypal-order', { ageGroup: 'teen', guardianAuthorized: true, requestId, packId: 'small', adultConfirmed: true }))).status).toBe(403); });
 it('server catalog overrides caller and defaults to first expansion', async () => { await handler(req('start-run', { requestId, mode: 'daily', aids: [], catalog: 'extended-30' })); expect(mocks.db.rpc).toHaveBeenCalledWith('tower_account_api', expect.objectContaining({ p_data: expect.objectContaining({ catalog: 'extended-24' }) })); });
 it('linked email is required for authoritative runs', async () => { mocks.db.auth.getUser.mockResolvedValue({ data: { user: { id: userId, is_anonymous: true } }, error: null }); expect((await handler(req('start-run', { requestId, mode: 'casual', aids: [] }))).status).toBe(403); });
 it('guests cannot buy, activate, submit or claim authoritative rewards', async () => { mocks.db.auth.getUser.mockResolvedValue({ data: { user: { id: userId, is_anonymous: true } }, error: null }); for(const action of ['buy-aid','buy-cosmetic','use-aid','finish-run','ad-intent','ad-complete','double-coins']) expect((await handler(req(action))).status).toBe(403); expect(mocks.db.rpc).not.toHaveBeenCalled(); });
 it('rankings enable daily before other periods', async () => { expect((await handler(req('leaderboard',{period:'daily'}))).status).toBe(200); expect((await handler(req('leaderboard',{period:'weekly'}))).status).toBe(503); values.SERVER_RANKING_PERIODS='daily,weekly';expect((await handler(req('leaderboard',{period:'weekly'}))).status).toBe(200);expect((await handler(req('leaderboard',{period:'monthly'}))).status).toBe(503); });
 it('rejects invalid loadout before database', async () => { expect((await handler(req('start-run', { requestId, mode: 'daily', aids: ['guide-5','guide-10'] }))).status).toBe(400); expect(mocks.db.rpc).not.toHaveBeenCalled(); });
 it('ad intents have independent disabled-by-default gate', async () => { expect((await handler(req('ad-intent', { reward: 'coin-bonus', provider: 'google-h5' }))).status).toBe(503); expect(mocks.db.rpc).not.toHaveBeenCalled(); });
 it('simulated providers cannot grant remote reward', async () => { values.SERVER_AD_REWARDS_ENABLED = 'true'; expect((await handler(req('ad-complete', { intentId: requestId, viewed: true, provider: 'mock', evidence: 'browser-callback' }))).status).toBe(400); expect((await handler(req('ad-complete', { intentId: requestId, viewed: true, provider: 'google-h5', evidence: 'debug-success' }))).status).toBe(400); expect(mocks.db.rpc).not.toHaveBeenCalled(); });
 it('worker dispatch failure keeps submitted result pending', async () => { vi.mocked(fetch).mockRejectedValue(new Error('unreachable')); mocks.db.rpc.mockResolvedValue({ data: { status: 'pending' }, error: null }); const response = await handler(req('finish-run', { runId: requestId, finalTick: 100, events: [] })); expect(response.status).toBe(202); expect(await response.json()).toEqual({ status: 'pending' }); });
});

describe('economy definitions', () => {
 it('prices and packs are exact', () => { expect(Object.values(AID_CATALOG).map(a => a.price)).toEqual([25,45,20,35,50,90]); expect(COIN_PACKS.small).toEqual({ coins: 200, amount: '2.99', currency: 'USD' }); });
 it('never permits duplicate or conflicting guides', () => { expect(validLoadout(['guide-5','guide-10'])).toBe(false); expect(validLoadout(['skip','skip'])).toBe(false); expect(validLoadout(['guide-5','skip'])).toBe(true); });
 it('rewards scale with eligible population', () => { expect([4,5,9,10,24,25,99,100].map(prizeSlots)).toEqual([0,1,1,3,3,10,10,25]); expect(rankingPrize('monthly',1,100)).toEqual({ coins:600,items:{'guide-10':3,focus:2} }); expect(rankingPrize('weekly',4,10).coins).toBe(0); });
 it('single participant has no percentile advantage', () => { expect(dailyPoints(1,1)).toBe(10); expect(dailyPoints(1,5)).toBe(100); expect(dailyPoints(5,5)).toBe(10); expect(dailyPoints(0,5)).toBe(0); });
});

describe('scheduled settlement boundary',()=>{
 it('cron dispatches bounded background work instead of querying the database',async()=>{const response=await settle();expect(await response.json()).toEqual({dispatched:true});expect(mocks.db.rpc).not.toHaveBeenCalled();expect(vi.mocked(fetch).mock.calls.map(call=>String(call[0])).sort()).toEqual(['https://tower.example/api/replay-background','https://tower.example/api/settle-background']);});
 it('background settlement requires worker authorization',async()=>{expect((await settleBackground(new Request('https://tower.example/api/settle-background',{method:'POST'}))).status).toBe(401);expect(mocks.db.rpc).not.toHaveBeenCalled();});
 it('settlement initially enables daily only and supports an economy without prizes',async()=>{const request=()=>new Request('https://tower.example/api/settle-background',{method:'POST',headers:{Authorization:`Bearer ${values.REPLAY_WORKER_SECRET}`}});await settleBackground(request());expect(mocks.db.rpc).toHaveBeenLastCalledWith('tower_account_api',expect.objectContaining({p_action:'settle',p_data:{periods:['daily']}}));values.SERVER_RANKINGS_ENABLED='false';await settleBackground(request());expect(mocks.db.rpc).toHaveBeenLastCalledWith('tower_account_api',expect.objectContaining({p_data:{periods:[]}}));});
});

describe('canonical replay validation', () => {
 const base = (): ReplayJob => ({ id: requestId, userId, mode: 'daily', seed: 'replay-server-contract', catalog: 'extended-24', ruleset: 'v2', aids: [], authorizedAids: [], events: [], finalTick: 144000, workerId: requestId, startedAt: '2026-10-03T00:00:00Z', receivedAt: '2026-10-03T00:40:00Z' });
 it('rejects invented aid permission', () => { const job=base(); job.events=[{ tick:0,action:'aid',aid:'focus' }]; expect(() => validateReplay(job)).toThrow('Aid not authorized'); });
 it('requires exact server authorized aid tick', () => { const job=base(); job.aids=['focus'];job.authorizedAids=[{id:'focus',tick:12}];job.events=[{tick:0,action:'aid',aid:'focus'}]; expect(() => validateReplay(job)).toThrow('Aid not authorized'); });
 it('rejects accelerated client time', () => { const job=base();job.receivedAt=job.startedAt;expect(() => validateReplay(job)).toThrow('elapsed time'); });
 it('verifies a real unmodified simulation input', () => {
  const config={mode:'daily' as const,seed:'replay-server-contract',catalog:'extended-24' as const,ruleset:'v2' as const};const sim=new TowerSimulation(config);
  sim.drop();sim.advance(900);while(sim.state!=='over' && sim.tick<10000){if(sim.state==='ready')sim.drop();sim.advance(1);}
  expect(sim.result).toBeDefined();const job=base();job.events=sim.events;job.finalTick=sim.tick;expect(validateReplay(job)).toEqual(sim.result);sim.dispose();
 });
});

describe('PayPal trust boundary', () => {
 const localOrder = () => ({id:requestId,orderId:'ORDER123456',amountCents:299,currency:'USD',status:'created'});
 const providerOrder = () => ({id:'ORDER123456',status:'COMPLETED',purchase_units:[{custom_id:requestId,reference_id:requestId,payee:{merchant_id:'MERCHANT1234'},amount:{currency_code:'USD',value:'2.99'},payments:{captures:[{id:'CAPTURE1234'}]}}]});
 const capture = () => ({id:'CAPTURE1234',status:'COMPLETED',payee:{merchant_id:'MERCHANT1234'},amount:{value:'2.99',currency_code:'USD'},supplementary_data:{related_ids:{order_id:'ORDER123456'}}});
 const signedHeaders = () => Object.fromEntries(['auth-algo','cert-url','transmission-id','transmission-sig','transmission-time'].map(key=>[`paypal-${key}`,'test']));
 const mockCanonical = (captured = capture()) => {
  mocks.db.rpc.mockImplementation(async (_:string,args:Record<string,unknown>)=>({data:['paypal-find','payment-order'].includes(String(args.p_action))?localOrder():{balance:300},error:null}));
  vi.mocked(fetch).mockImplementation(async input=>{const url=String(input);if(url.endsWith('/oauth2/token'))return Response.json({access_token:'oauth'});if(url.includes('verify-webhook-signature'))return Response.json({verification_status:'SUCCESS'});return Response.json(url.includes('/checkout/orders/')?providerOrder():captured);});
 };
 it('rejects ambiguous money representation', () => { expect(amountCents('2.99')).toBe(299); expect(() => amountCents('2.9')).toThrow(); expect(() => amountCents('-1.00')).toThrow(); });
 it('live charges need independent approval', () => {values.PAYPAL_ENVIRONMENT='live';expect(()=>paypalBase()).toThrow(/todavía/);values.SERVER_PAYPAL_LIVE_APPROVED='true';expect(paypalBase()).toBe('https://api-m.paypal.com');});
 it('orders use DB catalog price and stable provider idempotency key', async () => {
  mocks.db.rpc.mockImplementation(async (_: string, args: Record<string, unknown>) => ({ data: args.p_action==='paypal-order'?{id:requestId,amountCents:299,currency:'USD',coins:200}:{orderId:'ORDER123456',approvalUrl:'https://www.sandbox.paypal.com/checkout'},error:null }));
  vi.mocked(fetch).mockImplementation(async (input, init) => String(input).endsWith('/oauth2/token')?Response.json({access_token:'oauth'}):Response.json({id:'ORDER123456',links:[{rel:'payer-action',href:'https://www.sandbox.paypal.com/checkout'}]}));
  await createOrder(mocks.db as unknown as SupabaseClient,userId,{requestId,packId:'small',amountCents:1,coins:999999,adultConfirmed:true});
  const call=vi.mocked(fetch).mock.calls.find(c=>String(c[0]).endsWith('/v2/checkout/orders'))!;expect((call[1]!.headers as Record<string,string>)['PayPal-Request-Id']).toBe(requestId);expect(JSON.parse(String(call[1]!.body)).purchase_units[0].amount.value).toBe('2.99');
 });
 it('capture retries credit the same canonical event without capturing twice', async () => {
  mockCanonical();expect(await captureOrder(mocks.db as unknown as SupabaseClient,userId,'ORDER123456')).toEqual({balance:300});await captureOrder(mocks.db as unknown as SupabaseClient,userId,'ORDER123456');expect(vi.mocked(fetch).mock.calls.every(call=>!String(call[0]).endsWith('/capture'))).toBe(true);const credits=mocks.db.rpc.mock.calls.filter(call=>call[1].p_action==='payment-event');expect(credits).toHaveLength(2);expect(credits.map(call=>call[1].p_data.eventId)).toEqual(['capture:CAPTURE1234','capture:CAPTURE1234']);
 });
 it('wrong recipient cannot credit even a completed capture', async()=>{mockCanonical({...capture(),payee:{merchant_id:'ATTACKER123'}});await expect(captureOrder(mocks.db as unknown as SupabaseClient,userId,'ORDER123456')).rejects.toThrow(/no coincide/);expect(mocks.db.rpc.mock.calls.every(call=>call[1].p_action!=='payment-event')).toBe(true);});
 it('late completed callback cannot credit a currently refunded capture', async()=>{mockCanonical({...capture(),status:'REFUNDED'});await expect(captureOrder(mocks.db as unknown as SupabaseClient,userId,'ORDER123456')).rejects.toThrow(/conciliación/);expect(mocks.db.rpc.mock.calls.every(call=>call[1].p_action!=='payment-event')).toBe(true);});
 it('unsigned webhook cannot credit', async () => { values.SERVER_PAYPAL_ENABLED='true';const response=await webhook(new Request('https://tower.example/api/paypal-webhook',{method:'POST',body:JSON.stringify({event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{id:'CAPTURE1234'}})}));expect(response.status).toBe(400);expect(mocks.db.rpc).not.toHaveBeenCalled(); });
 it('invalid PayPal signature cannot credit', async () => {
  values.SERVER_PAYPAL_ENABLED='true';vi.mocked(fetch).mockImplementation(async input=>String(input).endsWith('/oauth2/token')?Response.json({access_token:'oauth'}):Response.json({verification_status:'FAILURE'}));
  const headers=Object.fromEntries(['auth-algo','cert-url','transmission-id','transmission-sig','transmission-time'].map(key=>[`paypal-${key}`,'test']));const response=await webhook(new Request('https://tower.example/api/paypal-webhook',{method:'POST',headers,body:JSON.stringify({event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{id:'CAPTURE1234'}})}));expect(response.status).toBe(403);expect(mocks.db.rpc).not.toHaveBeenCalled();
 });
 it('valid signature still fetches canonical provider capture', async () => {
  values.SERVER_PAYPAL_ENABLED='true';mockCanonical();
  const response=await webhook(new Request('https://tower.example/api/paypal-webhook',{method:'POST',headers:signedHeaders(),body:JSON.stringify({event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{id:'CAPTURE1234',amount:{value:'0.01'}}})}));expect(response.status).toBe(200);expect(mocks.db.rpc).toHaveBeenCalledWith('tower_account_api',expect.objectContaining({p_action:'payment-event',p_user:null,p_data:expect.objectContaining({amountCents:299,eventId:'capture:CAPTURE1234'})}));
 });
 it('refund uses independently fetched resource and original order amount',async()=>{
  values.SERVER_PAYPAL_ENABLED='true';mockCanonical({...capture(),status:'PARTIALLY_REFUNDED'});const canonicalFetch=vi.mocked(fetch).getMockImplementation()!;vi.mocked(fetch).mockImplementation(async(input,init)=>String(input).includes('/payments/refunds/')?Response.json({id:'REFUND1234',status:'COMPLETED',amount:{currency_code:'USD',value:'1.49'},links:[{rel:'up',href:'https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE1234'}]}):canonicalFetch(input,init));
  const response=await webhook(new Request('https://tower.example/api/paypal-webhook',{method:'POST',headers:signedHeaders(),body:JSON.stringify({event_type:'PAYMENT.CAPTURE.REFUNDED',resource:{id:'REFUND1234',amount:{value:'0.01'}}})}));expect(response.status).toBe(200);expect(mocks.db.rpc).toHaveBeenCalledWith('tower_account_api',expect.objectContaining({p_action:'payment-event',p_data:expect.objectContaining({eventId:'refund:REFUND1234',refundCents:149,originalAmountCents:299})}));
 });
});

describe('optional browser account', () => {
 it('disabled service never sends requests', async () => { const service=new AccountService(mocks.db as unknown as SupabaseClient,false);expect(await service.snapshot()).toBeNull();expect(fetch).not.toHaveBeenCalled(); });
 it('Auth lock timeout leaves game callers a fallback', async () => { vi.useFakeTimers();mocks.db.auth.getSession.mockImplementation(()=>new Promise(()=>{}));const service=new AccountService(mocks.db as unknown as SupabaseClient,true);const pending=service.snapshot();await vi.advanceTimersByTimeAsync(10001);expect(await pending).toBeNull();expect(service.lastError).toMatch(/no respondió/);expect(fetch).not.toHaveBeenCalled(); });
 it('OTP supports email linking and existing-account sign-in', async () => { mocks.db.auth.verifyOtp.mockResolvedValue({error:null});const service=new AccountService(mocks.db as unknown as SupabaseClient,true);expect(await service.verifyEmail('a@example.test','123456','email')).toBe(true);expect(mocks.db.auth.verifyOtp).toHaveBeenCalledWith({email:'a@example.test',token:'123456',type:'email'}); });
 it('lost aid response retries with the same operation and exact frozen tick',async()=>{vi.mocked(fetch).mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce(Response.json({id:'focus',tick:25}));const service=new AccountService(mocks.db as unknown as SupabaseClient,true);expect(await service.useAid(requestId,'focus',25)).toEqual({id:'focus',tick:25});const payloads=vi.mocked(fetch).mock.calls.map(call=>JSON.parse(String(call[1]?.body)));expect(payloads[0]).toEqual(payloads[1]);expect(payloads[0].requestId).toMatch(/^[\da-f-]{36}$/);});
});
