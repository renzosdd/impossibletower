import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.TOWER_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
let passed = 0;
const player = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const guest = '33333333-3333-4333-8333-333333333333';
const request = () => crypto.randomUUID();
const api = async (action, data = {}, user = player) => (await db.query('select public.tower_account_api($1,$2,$3) as value', [action, user, data])).rows[0].value;
const test = async (name, action) => { try { await action(); passed++; } catch (error) { throw new Error(`${name}: ${error.message}`, { cause: error }); } };
const state = () => api('snapshot');
const start = (aids = [], mode = 'daily', user = player, extras = {}) => api('start-run', { requestId: request(), mode, aids, ...extras }, user);
await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text);alter table auth.users enable row level security;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
await db.exec(await readFile(new URL('../migrations/20261003021023_tower_backend.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('../migrations/20261003200135_tower_economy_v2.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('../migrations/20261003221035_tower_economy_indexes.sql', import.meta.url), 'utf8'));
await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now()),($5,null,null)', [player, 'p@example.test', other, 'q@example.test', guest]);
for (const role of ['anon', 'authenticated']) {
 await db.exec(`set role ${role}`);
 await test(`${role} cannot credit`, () => assert.rejects(api('snapshot'), /permission denied/));
 await test(`${role} cannot read private wallet`, () => assert.rejects(db.query('select * from tower_economy.wallets'), /permission denied/));
 await test(`${role} cannot read Auth users`, () => assert.rejects(db.query('select id,email,email_confirmed_at from auth.users'), /permission denied/));
 await db.exec('reset role');
}
await db.exec('set role service_role');
await test('all economic foreign keys have a covering index',async()=>{assert.deepEqual((await db.query("select con.conname from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where con.contype='f' and n.nspname='tower_economy' and not exists(select 1 from pg_index i where i.indrelid=con.conrelid and i.indisvalid and i.indisready and i.indpred is null and con.conkey <@ (i.indkey::smallint[])[0:cardinality(con.conkey)-1])")).rows,[]);});
await test('service role can read only the three granted Auth columns',async()=>{assert.equal((await db.query('select id,email,email_confirmed_at from auth.users')).rows.length,3);await assert.rejects(db.query('select encrypted_password from auth.users'),/permission denied/);await assert.rejects(db.query('select * from auth.users'),/permission denied/);});
await test('all economic tables enforce RLS and browser roles have no RPC execution',async()=>{const tables=(await db.query("select c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='tower_economy' and c.relkind='r'")).rows;assert.equal(tables.length,11);assert.ok(tables.every(t=>t.rls));for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'public.tower_account_api(text,uuid,jsonb)','EXECUTE') as allowed",[role])).rows[0].allowed,false);});
await test('starter grant once', async () => { assert.equal((await state()).balance, 100); assert.equal((await state()).balance, 100); });
await test('guest wallet starts at zero without grant',async()=>{assert.equal((await api('snapshot',{},guest)).balance,0);});
await test('unlinked guest cannot start economic run', () => assert.rejects(start([], 'daily', guest), /Verify your email/));
await test('unlinked guest cannot buy or activate inventory and rewards',async()=>{for(const action of ['buy-aid','buy-cosmetic','use-aid','finish-run','ad-intent','ad-complete','double-coins'])await assert.rejects(api(action,{},guest),/Verify your email/);});
const buyId = request();
await test('aid purchase retry does not double debit', async () => { await api('buy-aid', { id: 'guide-5', requestId: buyId }); await api('buy-aid', { id: 'guide-5', requestId: buyId }); assert.equal((await state()).balance, 75); assert.equal((await state()).inventory['guide-5'], 1); });
await test('request identifier cannot buy a different item free', () => assert.rejects(api('buy-aid', { id: 'preview', requestId: buyId }), /Request already used/));
await test('unknown aid rejected', () => assert.rejects(api('buy-aid', { id: 'teleport', requestId: request() }), /Unknown aid/));
await test('ledger cannot be rewritten', () => assert.rejects(db.query('update tower_economy.ledger set coins=999'), /immutable/));
await test('ledger cannot be deleted', () => assert.rejects(db.query('delete from tower_economy.ledger'), /immutable/));
await test('two mutually exclusive guides rejected', () => assert.rejects(start(['guide-5','guide-10']), /Invalid loadout/));
await test('three aids rejected', () => assert.rejects(start(['guide-5','preview','skip']), /Invalid loadout/));
await test('duplicate aid rejected', () => assert.rejects(start(['guide-5','guide-5']), /Invalid loadout/));
await test('unowned aid cannot be reserved', () => assert.rejects(start(['skip']), /Aid unavailable/));
const startId = request();
const ticket = await api('start-run', { requestId: startId, mode: 'daily', aids: ['guide-5'], publicName: '<P Uno>' });
await test('reservation preserves inventory', async () => { assert.equal((await state()).inventory['guide-5'], 1); assert.equal(ticket.catalog, 'extended-24'); assert.match(ticket.seed, /extended-24$/); });
await test('ticket retry returns same run', async () => { assert.equal((await api('start-run', { requestId: startId, mode: 'daily', aids: ['guide-5'] })).id, ticket.id); });
await test('foreign run invisible', () => assert.rejects(api('run', { runId: ticket.id }, other), /Run not found/));
await test('unreserved aid rejected', () => assert.rejects(api('use-aid', { runId: ticket.id, id: 'skip', tick: 0, requestId: request() }), /Aid not reserved/));
const useId = request();
await test('aid activation consumes once', async () => { await api('use-aid', { runId: ticket.id, id: 'guide-5', tick: 0, requestId: useId }); await api('use-aid', { runId: ticket.id, id: 'guide-5', tick: 0, requestId: useId }); assert.equal((await state()).inventory['guide-5'], 0); });
await test('same aid cannot activate twice', () => assert.rejects(api('use-aid', { runId: ticket.id, id: 'guide-5', tick: 0, requestId: request() }), /Aid already used/));
const continuation = await api('ad-intent', { reward: 'second-chance', runId: ticket.id });
await test('ad cancel never grants', async () => { await api('ad-cancel', { intentId: continuation.id }); await assert.rejects(api('ad-complete', { intentId: continuation.id, viewed: true }), /Reward not completed/); });
const continuation2 = await api('ad-intent', { reward: 'second-chance', runId: ticket.id });
await test('completed ad reserves second aid', async () => { const updated = await api('ad-complete', { intentId: continuation2.id, viewed: true }); assert.deepEqual(updated.aids, ['guide-5','second-chance']); });
await test('another continuation exceeds run quota', () => assert.rejects(api('ad-intent', { reward: 'second-chance', runId: ticket.id }), /Continuation unavailable/));
await test('ad granted aid consumes no paid inventory', async () => { await api('use-aid', { runId: ticket.id, id: 'second-chance', tick: 0, requestId: request() }); assert.equal((await state()).inventory['second-chance'], undefined); });
await test('submission stores tick input only', async () => { await api('finish-run', { runId: ticket.id, finalTick: 1200, events: [{ tick: 0, action: 'aid', aid: 'guide-5' },{ tick: 0, action: 'aid', aid: 'second-chance' },{ tick: 0, action: 'drop' }], score: 999999 }); assert.equal((await api('run', { runId: ticket.id })).status, 'pending'); });
let job = await api('claim-job', {}, null);
await test('worker lease binds authorized aids', async () => { assert.equal(job.id, ticket.id); assert.deepEqual(job.authorizedAids.map(x => x.id).sort(), ['guide-5','second-chance']); });
const result = { height: 100, heightCentimeters: 10000, score: 5000, objectsPlaced: 20, perfectDrops: 5, maxCombo: 5, duration: 20, aidsUsed: ['guide-5','second-chance'] };
await test('foreign worker cannot verify', async () => { assert.equal(await api('verify-run', { runId: ticket.id, workerId: request(), result }, null), null); });
await test('canonical run receives base and perfect mission', async () => { const accepted = await api('verify-run', { runId: ticket.id, workerId: job.workerId, result }, null); assert.equal(accepted.status, 'accepted'); assert.equal(accepted.result.earnedCoins, 75); assert.equal((await state()).missionEarned, 15); });
await test('same worker result cannot credit twice', async () => { const before = (await state()).balance; assert.equal(await api('verify-run', { runId: ticket.id, workerId: job.workerId, result }, null), null); assert.equal((await state()).balance, before); });
const double = await api('ad-intent', { reward: 'double-coins', runId: ticket.id });
await api('ad-complete', { intentId: double.id, viewed: true });
await test('doubling counted inside cap and once', async () => { await api('double-coins', { intentId: double.id, runId: ticket.id }); await api('double-coins', { intentId: double.id, runId: ticket.id }); assert.equal((await state()).gameplayEarned, 140); });
for (let i = 1; i <= 3; i++) {
 const next = await start(); await api('finish-run', { runId: next.id, finalTick: 1200, events: [{ tick: 0, action: 'drop' }] }); job = await api('claim-job', {}, null);
 await api('verify-run', { runId: next.id, workerId: job.workerId, result: { ...result, height: 100+i, heightCentimeters: 10000+i*100, aidsUsed: [] } }, null);
}
await test('record reward limited once per UTC day', async () => {const rows=(await db.query("select coins from tower_economy.ledger where user_id=$1 and source='personal-best'",[player])).rows;assert.deepEqual(rows,[{coins:10}]);});
await test('gameplay cap and missions separate', async () => { const s = await state(); assert.equal(s.gameplayEarned, 300); assert.equal(s.missionEarned, 25); });
for (let i = 0; i < 3; i++) { const intent = await api('ad-intent', { reward: 'coin-bonus' }); await api('ad-complete', { intentId: intent.id, viewed: true }); await api('ad-complete', { intentId: intent.id, viewed: true }); }
await test('bonus limit persists separately from gameplay', async () => { assert.equal((await state()).adBonusClaims, 3); assert.equal((await state()).gameplayEarned, 300); await assert.rejects(api('ad-intent', { reward: 'coin-bonus' }), /Daily bonus exhausted/); });
await test('browser profile JSON cannot credit wallet', async () => {
 const before = (await state()).balance; await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[player]); await db.exec('set role authenticated'); await db.query("select public.sync_profile('Cliente','{\"version\":2,\"coins\":10000000}'::jsonb)"); await db.exec('reset role'); await db.exec('set role service_role'); assert.equal((await state()).balance, before);
});
await test('catalog frozen across day', async () => { const t = await start([], 'daily', player, { catalog: 'extended-30' }); assert.equal(t.catalog, 'extended-24'); });
await test('casual can use new catalog independently', async () => { const t = await start([], 'casual', player, { catalog: 'extended-30' }); assert.equal(t.catalog, 'extended-30'); });
await test('purchase cosmetic ownership separate from profile', async () => { const id = request(); await api('buy-cosmetic', { id: 'crane-copper', requestId: id }); const after = (await state()).balance; await api('buy-cosmetic', { id: 'crane-copper', requestId: id }); assert.equal((await state()).balance, after); assert.deepEqual((await state()).onlineCosmetics, ['crane-copper']); });
await test('PayPal rejects guest and missing adult confirmation', async () => { await assert.rejects(api('paypal-order', { packId: 'small', requestId: request(), adultConfirmed: false }), /Adult confirmation/); await assert.rejects(api('paypal-order', { packId: 'small', requestId: request(), adultConfirmed: true }, guest), /Verify your email/); });
const order = await api('paypal-order', { packId: 'small', requestId: request(), adultConfirmed: true, amount: '0.01', coins: 100000 });
await test('server pack prices override payload', async () => { assert.equal(order.amountCents, 299); assert.equal(order.coins, 200); });
await api('paypal-attach', { id: order.id, orderId: 'PAYPAL12345678', approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL12345678' });
await test('wrong payment cannot credit', () => assert.rejects(api('payment-event', { eventId: 'wrong', kind: 'paid', orderId: 'PAYPAL12345678', captureId: 'CAPTURE123456', amountCents: 1, currency: 'USD' }, null), /Payment mismatch/));
await test('captured payment credits once across different event IDs', async () => { const before = (await state()).balance; for(const eventId of ['paid-1','paid-2']) await api('payment-event', { eventId, kind: 'paid', orderId: 'PAYPAL12345678', captureId: 'CAPTURE123456', amountCents: 299, currency: 'USD' }, null); assert.equal((await state()).balance, before+200); });
await test('wrong currency refund rejected', () => assert.rejects(api('payment-event', { eventId: 'bad-refund', kind: 'refund', orderId: 'PAYPAL12345678', captureId: 'CAPTURE123456', refundCents: 100, currency: 'EUR' }, null), /currency mismatch/));
await test('partial refund idempotent and proportional', async () => { const before = (await state()).balance; for(let i=0;i<2;i++) await api('payment-event', { eventId: 'refund-1', kind: 'refund', orderId: 'PAYPAL12345678', captureId: 'CAPTURE123456', refundCents: 149, currency: 'USD' }, null); assert.equal((await state()).balance, before-99); });
await test('final refund reverses remaining purchased coins', async () => { const before = (await state()).balance; await api('payment-event', { eventId: 'refund-2', kind: 'refund', orderId: 'PAYPAL12345678', captureId: 'CAPTURE123456', refundCents: 150, currency: 'USD' }, null); assert.equal((await state()).balance, before-101); });
await test('refund received before capture is atomic and late paid does not recredit',async()=>{
 const pending=await api('paypal-order',{packId:'small',requestId:request(),adultConfirmed:true});await api('paypal-attach',{id:pending.id,orderId:'PAYPALOUTOFORDER',approvalUrl:'https://www.sandbox.paypal.com/checkout'});const before=(await state()).balance;
 await api('payment-event',{eventId:'refund:OUTOFORDER1',kind:'refund',orderId:'PAYPALOUTOFORDER',captureId:'CAPTUREOUTOFORDER',refundCents:299,originalAmountCents:299,currency:'USD'},null);assert.equal((await state()).balance,before);
 await api('payment-event',{eventId:'capture:CAPTUREOUTOFORDER',kind:'paid',orderId:'PAYPALOUTOFORDER',captureId:'CAPTUREOUTOFORDER',amountCents:299,currency:'USD'},null);assert.equal((await state()).balance,before);
});
await test('full reversal before capture absorbs delayed partial refund once',async()=>{
 const pending=await api('paypal-order',{packId:'small',requestId:request(),adultConfirmed:true});await api('paypal-attach',{id:pending.id,orderId:'PAYPALREVERSED',approvalUrl:'https://www.sandbox.paypal.com/checkout'});const before=(await state()).balance;
 await api('payment-event',{eventId:'reversal:CAPTUREREVERSED',kind:'reversal',orderId:'PAYPALREVERSED',captureId:'CAPTUREREVERSED',refundedCents:299,originalAmountCents:299,currency:'USD'},null);
 for(let i=0;i<2;i++)await api('payment-event',{eventId:'refund:LATEPARTIAL1',kind:'refund',orderId:'PAYPALREVERSED',captureId:'CAPTUREREVERSED',refundCents:149,currency:'USD'},null);
 assert.equal((await state()).balance,before);assert.equal((await api('payment-order',{orderId:'PAYPALREVERSED'},null)).status,'reversed');
});
await db.query("select tower_economy.apply_event($1,'fixture:debt','payment-reversal',-500,'{}',true)",[player]);
await test('debt blocks spending', () => assert.rejects(api('buy-aid', { id: 'preview', requestId: request() }), /Insufficient coins/));
await test('earned credits can reduce debt', async () => { const before = (await state()).balance; await db.query("select tower_economy.apply_event($1,'fixture:earned','gameplay',20)",[player]); assert.equal((await state()).balance, before+20); });
await db.query("select tower_economy.apply_event($1,'fixture:recovery','fixture',1000)",[player]);
await api('buy-aid', { id: 'preview', requestId: request() });
const timeout = await start(['preview']); await api('use-aid', { runId: timeout.id, id: 'preview', tick: 0, requestId: request() }); await api('finish-run', { runId: timeout.id, finalTick: 10, events: [{ tick: 0, action: 'aid', aid: 'preview' }] });
await db.query("update tower_economy.runs set received_at=now()-interval '11 minutes' where id=$1",[timeout.id]);
await test('infrastructure timeout compensates consumed inventory once', async () => { await api('settle', {}, null); assert.equal((await api('run', { runId: timeout.id })).status,'verification_timeout'); assert.equal((await state()).inventory.preview, 1); await api('settle', {}, null); assert.equal((await state()).inventory.preview, 1); });
for(const n of [1,4,5,9,10,24,25,99,100]) await test(`population prize threshold ${n}`, async () => { const top=(await db.query("select tower_economy.prize('daily',1,$1) as v",[n])).rows[0].v; assert.equal(top.coins,n<5?0:60); });
await test('monthly winner rewards exact', async () => { assert.deepEqual((await db.query("select tower_economy.prize('monthly',1,100) as v")).rows[0].v,{coins:600,items:{'guide-10':3,focus:2}}); });
const yesterday=(await db.query("select ((now() at time zone 'UTC')::date-1)::text as day")).rows[0].day;
for(let i=4;i<9;i++){
 const id=`0000000${i}-4444-4444-8444-444444444444`;
 await db.exec('reset role');await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`p${i}@example.test`]);await db.exec('set role service_role');await api('snapshot',{},id);
 await db.query("insert into tower_economy.runs(user_id,request_id,mode,seed,day,started_at,expires_at,status,received_at,verified_at,result) values($1,$2,'daily','fixture',$3,now()-interval '1 day',now()-interval '1 day', 'accepted',now()-interval '1 day',now()-interval '1 day',$4)",[id,request(),yesterday,{...result,height:20+i,heightCentimeters:2000+i*100,aidsUsed:[]}]);
}
await db.query("insert into tower_economy.periods(kind,start_day,end_at) values('daily',$1,$1::date+interval '1 day')",[yesterday]);
await test('daily closes and only eligible first place paid for N5', async () => { await api('settle',{},null);const b=await api('leaderboard',{period:'daily',periodKey:yesterday});assert.equal(b.status,'settled');assert.equal(b.participants,5);assert.equal(b.entries[0].points,100);assert.equal(b.entries[4].points,10);assert.equal(b.entries[0].coins,60);assert.equal(b.entries[1].coins,0);assert.ok(b.entries.every(e=>!('userId'in e))); });
await test('daily prize duplicate settlement excluded', async () => { const before=(await db.query("select count(*)::integer as n from tower_economy.ledger where source='ranking-daily'")).rows[0].n;await api('settle',{},null);assert.equal((await db.query("select count(*)::integer as n from tower_economy.ledger where source='ranking-daily'")).rows[0].n,before); });
await api('snapshot',{},other);
const cohort=[player,other];
for(let i=0;i<7;i++){
 const day=`2026-09-${21+i}`;
 const entries=cohort.map((id,j)=>({userId:id,rank:j+1,name:`P${j}`,height:30,score:1000,points:j?20+i:100-i,wins:j?0:1,firstReceivedAt:`${day}T12:00:00Z`,aidsUsed:[],coins:0,items:{}}));
 await db.query("insert into tower_economy.periods(kind,start_day,end_at,status,entries) values('daily',$1,$1::date+interval '1 day','settled',$2) on conflict do nothing",[day,entries]);
}
await db.query("insert into tower_economy.periods(kind,start_day,end_at) values('weekly','2026-09-21','2026-09-28')");
await test('daily phase does not settle or pay weekly prizes',async()=>{await api('settle',{periods:['daily']},null);assert.equal((await api('leaderboard',{period:'weekly',periodKey:'2026-09-21'})).status,'open');assert.equal((await db.query("select count(*)::integer as n from tower_economy.ledger where source='ranking-weekly'")).rows[0].n,0);});
await test('weekly uses best five of seven daily point totals', async () => {await api('settle',{},null);const b=await api('leaderboard',{period:'weekly',periodKey:'2026-09-21'});assert.equal(b.status,'settled');assert.equal(b.entries[0].points,490);assert.equal(b.entries[1].points,120);assert.equal(b.ownEntry.points,490);});
for(let i=1;i<=21;i++){
 const day=`2026-08-${String(i).padStart(2,'0')}`;
 const entries=[{userId:player,rank:1,name:'P',height:30,score:1000,points:i,wins:0,firstReceivedAt:`${day}T12:00:00Z`,aidsUsed:[],coins:0,items:{}}];
 await db.query("insert into tower_economy.periods(kind,start_day,end_at,status,entries) values('daily',$1,$1::date+interval '1 day','settled',$2)",[day,entries]);
}
await db.query("insert into tower_economy.periods(kind,start_day,end_at) values('monthly','2026-08-01','2026-09-01')");
await test('monthly uses best twenty days', async () => {await api('settle',{},null);const b=await api('leaderboard',{period:'monthly',periodKey:'2026-08-01'});assert.equal(b.entries[0].points,230);assert.equal(b.entries[0].coins,0);});
await test('historical snapshots stable across account verification changes', async () => {const before=await api('leaderboard',{period:'weekly',periodKey:'2026-09-21'});await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=null where id=$1',[other]);await db.exec('set role service_role');assert.deepEqual(await api('leaderboard',{period:'weekly',periodKey:'2026-09-21'}),before);});
await test('guest conversion keeps UID and grants starter exactly once',async()=>{await db.exec('reset role');await db.query('update auth.users set email=$2,email_confirmed_at=now() where id=$1',[guest,'guest@example.test']);await db.exec('set role service_role');assert.equal((await api('snapshot',{},guest)).balance,100);assert.equal((await api('snapshot',{},guest)).balance,100);});
await test('settlement batches expired attempts and periods without losing work',async()=>{
 await db.query("insert into tower_economy.runs(user_id,request_id,mode,seed,day,started_at,expires_at) select $1,gen_random_uuid(),'casual','batch-fixture','2026-01-01','2026-01-01','2026-01-01' from generate_series(1,205)",[player]);
 await db.exec("insert into tower_economy.periods(kind,start_day,end_at) select 'daily',d::date,d+interval '1 day' from generate_series(timestamp '2026-01-01',timestamp '2026-01-06',interval '1 day')d");
 await api('settle',{periods:['daily']},null);assert.equal((await db.query("select count(*)::integer as n from tower_economy.runs where seed='batch-fixture' and status='rejected'")).rows[0].n,100);assert.equal((await db.query("select count(*)::integer as n from tower_economy.periods where start_day between '2026-01-01' and '2026-01-06' and status='settled'")).rows[0].n,3);
 await api('settle',{periods:['daily']},null);await api('settle',{periods:['daily']},null);assert.equal((await db.query("select count(*)::integer as n from tower_economy.runs where seed='batch-fixture' and status='rejected'")).rows[0].n,205);assert.equal((await db.query("select count(*)::integer as n from tower_economy.periods where start_day between '2026-01-01' and '2026-01-06' and status='settled'")).rows[0].n,6);
});
console.log(`${passed} economy SQL contract checks passed; fixtures simulate Auth and accepted replay results.`);
await db.close();
