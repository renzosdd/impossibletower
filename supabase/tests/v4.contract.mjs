import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.TOWER_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('✓', name); } catch (e) { throw new Error(`${name}: ${e.message}`, {cause:e}); } };
const id = () => crypto.randomUUID();
const api = async(action,user,data={}) => (await db.query('select public.tower_account_api($1,$2,$3) as value',[action,user,data])).rows[0].value;
const snapshot = user => api('snapshot',user);
const start = (user,mode='daily',extra={}) => api('start-run',user,{mode,aids:[],publicName:'Player',requestId:id(),...extra});
await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create table auth.identities(user_id uuid references auth.users,provider text,provider_id text,created_at timestamptz default clock_timestamp());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
const migrationFiles=(await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
for(const file of migrationFiles.filter(f=>f<'20261008135602'))await db.exec(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
const previousUser=id();await db.query('insert into auth.users values($1,$2,now())',[previousUser,'prior@example.test']);await db.query("insert into auth.identities(user_id,provider,provider_id)values($1,'google',$1::uuid::text)",[previousUser]);await snapshot(previousUser);
await db.query("select tower_economy.apply_event($1,'prior-purchase','fixture',100,'{\"preview\":2}')",[previousUser]);
await db.query("update tower_economy.progress set daily_best=88,badge_progress='{\"first-stack\":1}',achievements='[\"first-stack\"]' where user_id=$1",[previousUser]);
await db.query("insert into public.profiles(user_id,public_name,data)values($1,'Prior',$2)",[previousUser,{version:2,economyVersion:3,personalBest:120,daily:{'2026-10-07':{best:88,attempts:1}},unlockedCosmetics:['crane-coral'],achievements:['first-stack'],badgeProgress:{'first-stack':1}}]);
const legacyTicket=await start(previousUser,'casual');
const frozenRules=(await db.query("select economic_rules from tower_economy.periods where kind='monthly' order by start_day desc limit 1")).rows[0].economic_rules;
for(const file of migrationFiles.filter(f=>f>='20261008135602'))await db.exec(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
const newUser = async(google=true,createdAt=null) => {
 const user=id(); await db.exec('reset role');
 await db.query('insert into auth.users values($1,$2,$3)',[user,google?'test@example.test':null,google?new Date():null]);
 if(google)await db.query("insert into auth.identities(user_id,provider,provider_id,created_at) values($1,'google',$1::uuid::text,coalesce($2,clock_timestamp()))",[user,createdAt]);
 await db.exec('set role service_role'); return user;
};
const qualify = async(user,mode='daily',extra={}) => {
 const ticket=await start(user,mode);
 await api('finish-run',user,{runId:ticket.id,finalTick:1200,events:[]});
 const job=await api('claim-job',null);
 assert.equal(job.id,ticket.id);
 const result={height:30,heightCentimeters:3000,score:750,objectsPlaced:5,perfectDrops:3,maxPerfectCombo:3,maxCombo:3,duration:20,objectIds:['box'],aidsUsed:[],...extra};
 const accepted=await api('verify-run',null,{runId:ticket.id,workerId:job.workerId,result});
 assert.equal(accepted.status,'accepted'); assert.equal(accepted.result.height,result.height);
 return {ticket,job,accepted,result};
};
try {
await test('migration resets only badges and schedules next UTC Monday',async()=>{
 const settings=(await db.query('select weekly_start from tower_economy.release_settings')).rows[0];assert.equal(new Date(settings.weekly_start).getUTCDay(),1);
 const u=await newUser();const s=await snapshot(u);assert.equal(s.balance,60);assert.equal(s.progress.badgeCatalogVersion,2);assert.equal(Object.keys(s.progress.badgeProgress).length,36);assert.deepEqual(s.progress.achievements,[]);
});
await test('migration preserves purchased assets, current records and frozen promises; old sync cannot restore badges',async()=>{
 const prior=await snapshot(previousUser);assert.equal(prior.balance,160);assert.equal(prior.inventory.preview,2);assert.equal(prior.dailyBest,88);assert.deepEqual(prior.progress.achievements,[]);
 assert.deepEqual((await db.query("select economic_rules from tower_economy.periods where kind='monthly' order by start_day desc limit 1")).rows[0].economic_rules,frozenRules);
 let cloud=(await db.query('select data from public.profiles where user_id=$1',[previousUser])).rows[0].data;assert.equal(cloud.personalBest,120);assert.deepEqual(cloud.unlockedCosmetics,['crane-coral']);assert.deepEqual(cloud.achievements,[]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[previousUser]);await db.exec('reset role;set role authenticated');await db.query('select public.sync_profile($1,$2)',['Prior',{...cloud,badgeCatalogVersion:1,achievements:['first-stack'],badgeProgress:{'first-stack':1}}]);await db.exec('reset role;set role service_role');
 cloud=(await db.query('select data from public.profiles where user_id=$1',[previousUser])).rows[0].data;assert.equal(cloud.badgeCatalogVersion,2);assert.deepEqual(cloud.achievements,[]);assert.equal((await api('start-run',previousUser,{mode:'casual',requestId:(await db.query('select request_id from tower_economy.runs where id=$1',[legacyTicket.id])).rows[0].request_id})).aidRulesVersion,1);
});
await test('new tickets authorize inventory at use, never reserve or auto-prepare',async()=>{
 const u=await newUser();await snapshot(u);await db.query("select tower_economy.apply_event($1,'fixture','fixture',200)",[u]);
 await api('buy-aid',u,{id:'guide-5',requestId:id()});await api('buy-aid',u,{id:'guide-10',requestId:id()});await api('buy-aid',u,{id:'focus',requestId:id()});await api('buy-aid',u,{id:'preview',requestId:id()});
 const ticket=await start(u,'casual',{aids:['preview','focus']});assert.equal(ticket.aidRulesVersion,2);assert.deepEqual(ticket.aids,[]);
 const requestId=id();await api('use-aid',u,{runId:ticket.id,id:'guide-5',tick:60,requestId});await api('use-aid',u,{runId:ticket.id,id:'guide-5',tick:60,requestId});assert.equal((await snapshot(u)).inventory['guide-5'],0);
 await assert.rejects(api('use-aid',u,{runId:ticket.id,id:'guide-10',tick:61,requestId:id()}),/Guides/);
 await api('use-aid',u,{runId:ticket.id,id:'focus',tick:61,requestId:id()});await assert.rejects(api('use-aid',u,{runId:ticket.id,id:'preview',tick:62,requestId:id()}),/Aid limit/);
});
await test('five missions pay at most 10 with canonical replay idempotency',async()=>{
 const u=await newUser();await snapshot(u);await qualify(u,'daily');await qualify(u,'daily');await qualify(u,'casual');await qualify(u,'casual');const run=await qualify(u,'casual');
 const s=await snapshot(u);assert.equal(s.missionEarned,10);assert.equal(s.balance,70);assert.equal(Object.keys(s.progress.missions).length,5);assert.equal(s.progress.missions['daily-two'].claimed,true);assert.equal(s.progress.missions['daily-objects'].claimed,true);
 assert.equal(await api('verify-run',null,{runId:run.ticket.id,workerId:run.job.workerId,result:run.result}),null);assert.equal((await snapshot(u)).balance,70);
});
await test('badge progress is canonical; silver/gold claims are unique and guest writes denied',async()=>{
 const u=await newUser();await snapshot(u);await qualify(u,'casual',{height:150,heightCentimeters:15000,objectsPlaced:25,perfectDrops:10,maxPerfectCombo:10,objectIds:['rocket','rocket','box','table']});
 const s=await snapshot(u);assert.equal(s.progress.badgeProgress['v2:height:gold'],150);assert.equal(s.progress.badgeProgress['v2:rockets:bronze'],1);assert.equal(s.progress.badgeProgress['v2:variety:bronze'],3);
 const amount=s.balance;await api('claim-badge',u,{id:'v2:height:silver',requestId:id()});await api('claim-badge',u,{id:'v2:height:silver',requestId:id()});await api('claim-badge',u,{id:'v2:height:gold',requestId:id()});assert.equal((await snapshot(u)).balance,amount+15);
 await api('claim-badge',u,{id:'v2:stack:gold',requestId:id()});assert.equal((await snapshot(u)).inventory['guide-5'],1);
 await assert.rejects(api('claim-badge',u,{id:'v2:daily-days:gold',requestId:id()}),/not earned/);await assert.rejects(api('claim-badge',await newUser(false),{id:'v2:height:gold',requestId:id()}),/Google/);
 const total=(await db.query('select sum(coins) coins from tower_economy.badge_catalog')).rows[0].coins;assert.equal(Number(total),90);
});
await test('podium notifications persist and acknowledgement belongs to the player',async()=>{
 const u=await newUser();await qualify(u);const a=await snapshot(u);assert.ok(a.notifications.some(n=>n.period==='daily'&&!n.final));const count=a.notifications.length;
 await qualify(u);assert.equal((await snapshot(u)).notifications.length,count);
 const other=await newUser();await api('ack-notification',other,{id:a.notifications[0].id});assert.equal((await snapshot(u)).notifications.length,count);
 await api('ack-notification',u,{id:a.notifications[0].id});assert.equal((await snapshot(u)).notifications.length,count-1);
});
await test('promo redemption is atomic, quota bounded and retries cannot duplicate credit',async()=>{
 const u=await newUser(),v=await newUser();await snapshot(u);await snapshot(v);
 await db.query("insert into tower_economy.promo_campaigns(company,code,coins,starts_at,expires_at,max_redemptions)values('Company','PROMO-TEST',20,now()-interval '1 hour',now()+interval '1 day',1)");
 const requestId=id();const responses=await Promise.all([api('redeem-code',u,{code:'PROMO-TEST',requestId}),api('redeem-code',u,{code:'PROMO-TEST',requestId})]);assert.equal(responses[0].balance,80);assert.equal(responses[1].balance,80);
 assert.match((await api('redeem-code',u,{code:'PROMO-TEST',requestId:id()})).error,/Ya canjeaste/);assert.match((await api('redeem-code',v,{code:'PROMO-TEST',requestId:id()})).error,/agotado/);assert.equal((await snapshot(v)).balance,60);
 for(let n=0;n<10;n++)await api('redeem-code',v,{code:'WRONG',requestId:id()});assert.match((await api('redeem-code',v,{code:'WRONG',requestId:id()})).error,/minuto/);
});
await test('expired and paused promo campaigns do not credit',async()=>{
 const u=await newUser();await snapshot(u);
 await db.query("insert into tower_economy.promo_campaigns(company,code,coins,starts_at,expires_at,max_redemptions,active)values('Company','EXPIRED',20,now()-interval '2 day',now()-interval '1 day',2,true),('Company','PAUSED',20,now()-interval '1 day',now()+interval '1 day',2,false)");
 assert.match((await api('redeem-code',u,{code:'EXPIRED',requestId:id()})).error,/vencido/);assert.match((await api('redeem-code',u,{code:'PAUSED',requestId:id()})).error,/disponible/);assert.equal((await snapshot(u)).balance,60);
});
await test('all-time uses one best valid Daily per identity, excludes practice and legacy',async()=>{
 const u=await newUser();await qualify(u,'daily',{height:40,heightCentimeters:4000});await qualify(u,'daily',{height:80,heightCentimeters:8000});await qualify(u,'casual',{height:200,heightCentimeters:20000});
 const s=await api('leaderboard',u,{period:'all-time'});assert.equal(s.ownEntry.height,80);assert.equal(s.ownEntry.coins,0);assert.equal(s.rewardState,'none');assert.equal(s.endUTC,null);
});
await test('weekly counts best three days and unique 19/20 participants; settlement is once',async()=>{
 const week=(await db.query("select (date_trunc('week',now() at time zone 'UTC')-interval '7 days')::date::text w")).rows[0].w;
 await db.query('update tower_economy.release_settings set weekly_start=$1',[week]);
 const users=[];for(let n=0;n<20;n++){const u=await newUser();await snapshot(u);users.push(u);}
 for(let day=0;day<4;day++){
  const date=(await db.query('select ($1::date+$2::integer)::text d',[week,day])).rows[0].d;
  const entries=users.slice(0,19).map((u,i)=>({userId:u,rank:i+1,name:'Player',height:100-i,score:1000-i,points:i===0?[90,80,70,10][day]:Math.max(10,60-i),wins:i===0?1:0,firstReceivedAt:new Date(date+'T12:00:00Z').toISOString(),aidsUsed:[],coins:0,items:{}}));
  await db.query("insert into tower_economy.periods(kind,start_day,end_at,status,entries,ruleset,economic_rules,podium_processed)values('daily',$1,$1::date+interval '1 day','settled',$2,'v3',tower_economy.v4_rules(),true)",[date,entries]);
  await db.query("insert into tower_economy.runs(user_id,request_id,mode,seed,day,expires_at,ruleset,status,coin_eligible,result)values($1,$2,'daily','fixture',$3,now(),'v3','accepted',true,$4)",[users[0],id(),date,{height:100,heightCentimeters:10000,objectsPlaced:5,score:1000}]);
 }
 let board=await api('leaderboard',users[0],{period:'weekly',periodKey:week});assert.equal(board.participants,19);assert.equal(board.ownEntry.points,240);assert.equal(board.ownEntry.coins,0);assert.equal(board.ownEntry.countedDays.length,3);
 const extra={userId:users[19],rank:20,name:'Player',height:1,score:1,points:10,wins:0,firstReceivedAt:new Date(week+'T12:00:00Z').toISOString(),aidsUsed:[],coins:0,items:{}};
 await db.query("update tower_economy.periods set entries=entries||$2::jsonb where kind='daily' and start_day=$1",[week,[extra]]);
 await db.query("insert into tower_economy.periods(kind,start_day,end_at,ruleset,economic_rules,badge_catalog_version)values('weekly',$1,$1::date+interval '7 days','v3',tower_economy.v4_rules(),2)",[week]);
 board=await api('leaderboard',users[0],{period:'weekly',periodKey:week});assert.equal(board.participants,20);assert.equal(board.ownEntry.coins,60);
 const before=(await snapshot(users[0])).balance;await api('settle',null,{periods:['daily','weekly','monthly']});await api('settle',null,{periods:['daily','weekly','monthly']});assert.equal((await snapshot(users[0])).balance,before+60);
 board=await api('leaderboard',users[0],{period:'weekly',periodKey:week});assert.equal(board.status,'settled');assert.equal(board.rewardState,'paid');assert.ok((await snapshot(users[0])).notifications.some(n=>n.period==='weekly'&&n.final&&n.coins===60));
 assert.equal((await snapshot(users[0])).progress.badgeProgress['v2:weekly-podium:bronze'],1);
});
await test('nineteen-player week closes with no coins and a final no-minimum celebration',async()=>{
 const week=(await db.query("select (date_trunc('week',now() at time zone 'UTC')-interval '14 days')::date::text w")).rows[0].w;await db.query('update tower_economy.release_settings set weekly_start=$1',[week]);
 const u=await newUser();await snapshot(u);await db.query("insert into tower_economy.runs(user_id,request_id,mode,seed,day,expires_at,ruleset,status,coin_eligible,received_at,result)values($1,$2,'daily','fixture',$3,now(),'v3','accepted',true,$3::date+interval '12 hours',$4)",[u,id(),week,{height:30,heightCentimeters:3000,objectsPlaced:5,score:100,perfectDrops:0,aidsUsed:[]}]);
 await db.query("insert into tower_economy.periods(kind,start_day,end_at,ruleset,economic_rules,badge_catalog_version)values('daily',$1,$1::date+interval '1 day','v3',tower_economy.v4_rules(),2),('weekly',$1,$1::date+interval '7 days','v3',tower_economy.v4_rules(),2)",[week]);
 const before=(await snapshot(u)).balance;await api('settle',null,{periods:['daily','weekly','monthly']});const board=await api('leaderboard',u,{period:'weekly',periodKey:week});assert.equal(board.status,'settled');assert.equal(board.rewardState,'no-minimum');assert.equal(board.ownEntry.coins,0);assert.equal((await snapshot(u)).balance,before);assert.ok((await snapshot(u)).notifications.some(n=>n.period==='weekly'&&n.final&&!n.minimumMet&&n.coins===0));
});
await test('weekly ties use counted wins, height, receipt and internal identity in order',async()=>{
 const week=(await db.query("select (date_trunc('week',now() at time zone 'UTC')-interval '21 days')::date::text w")).rows[0].w;await db.query('update tower_economy.release_settings set weekly_start=$1',[week]);const users=[];for(let n=0;n<5;n++){users.push(await newUser());await snapshot(users[n]);}
 const receipt=new Date(week+'T12:00:00Z').toISOString();const entries=users.map((u,i)=>({userId:u,rank:i+1,name:'Tie',height:i===0?1:i===1?100:80,score:100,points:90,wins:i===0?1:0,firstReceivedAt:i===2?new Date(week+'T11:00:00Z').toISOString():receipt,aidsUsed:[],coins:0,items:{}}));await db.query("insert into tower_economy.periods(kind,start_day,end_at,status,entries,ruleset,economic_rules,podium_processed)values('daily',$1,$1::date+interval '1 day','settled',$2,'v3',tower_economy.v4_rules(),true)",[week,entries]);await db.query("insert into tower_economy.runs(user_id,request_id,mode,seed,day,expires_at,ruleset,status,coin_eligible,result)values($1,$2,'daily','fixture',$3,now(),'v3','accepted',true,$4)",[users[0],id(),week,{height:1,heightCentimeters:100,objectsPlaced:5,score:100}]);
 const ranked=(await db.query("select tower_economy.entries('weekly',$1) value",[week])).rows[0].value;assert.deepEqual(ranked.map(e=>e.userId),[users[0],users[1],users[2],...users.slice(3).sort()]);
});
await test('UTC rollover restores free lives and missions without restoring spent or advertised lives',async()=>{
 const u=await newUser();await snapshot(u);await db.query("insert into tower_economy.daily_attempts(user_id,day,free_used,ad_awarded,ad_used,purchased_remaining) values($1,(now() at time zone 'UTC')::date-1,3,2,2,5)",[u]);await db.query("insert into tower_economy.mission_progress(user_id,day,total_objects,qualifying_daily,claimed)values($1,(now() at time zone 'UTC')::date-1,25,2,array['daily-objects','daily-two'])",[u]);const fresh=await snapshot(u);assert.equal(fresh.attempts.freeRemaining,3);assert.equal(fresh.attempts.purchasedRemaining,0);assert.equal(fresh.attempts.adAvailable,2);assert.equal(fresh.progress.missions['daily-objects'].progress,0);assert.equal(fresh.progress.missions['daily-two'].claimed,false);assert.equal(new Date(fresh.missionsRenewAt).getUTCHours(),0);
});
await test('PayPal order is priced on server and cannot be created by guests',async()=>{
 const u=await newUser();const requestId=id();const order=await api('paypal-order',u,{packId:'small',adultConfirmed:true,requestId});assert.equal(order.amountCents,299);assert.equal(order.coins,200);assert.equal((await api('paypal-order',u,{packId:'small',adultConfirmed:true,requestId})).id,order.id);
 await assert.rejects(api('paypal-order',await newUser(false),{packId:'small',adultConfirmed:true,requestId:id()}),/Google/);
});
await test('promo admin has an explicit quota and server-only operations',async()=>{
 const admin=async(action,data={})=>(await db.query('select public.tower_promo_admin($1,$2) as value',[action,data])).rows[0].value;
 const campaign=await admin('create',{company:'Partner',code:'PARTNER-26',coins:10,startsAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),maxRedemptions:50});assert.equal(campaign.maximumCoinEmission,500);assert.equal((await admin('pause',{code:'PARTNER-26'})).active,false);assert.equal((await admin('resume',{code:'PARTNER-26'})).active,true);assert.ok((await admin('list')).some(c=>c.code==='PARTNER-26'));
 await assert.rejects(admin('create',{company:'No cap',code:'NO-CAP',coins:10,startsAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()}),/null/);
 for(const role of ['anon','authenticated']){await db.exec(`reset role;set role ${role}`);await assert.rejects(admin('list'),/permission/);}await db.exec('reset role;set role service_role');
});
await test('capture, webhook, partial refund and reversal reconcile only once',async()=>{
 const u=await newUser();await snapshot(u);const order=await api('paypal-order',u,{packId:'small',adultConfirmed:true,requestId:id()});await api('paypal-attach',u,{id:order.id,orderId:'ORDERTEST01',approvalUrl:'https://www.sandbox.paypal.com/checkout'});
 const paid={eventId:'capture:CAPTURETEST1',kind:'paid',orderId:'ORDERTEST01',captureId:'CAPTURETEST1',amountCents:299,currency:'USD'};await api('payment-event',null,paid);await api('payment-event',null,paid);assert.equal((await snapshot(u)).balance,260);
 const refund={eventId:'refund:REFUNDTEST1',kind:'refund',orderId:'ORDERTEST01',captureId:'CAPTURETEST1',refundCents:149,originalAmountCents:299,currency:'USD'};await api('payment-event',null,refund);await api('payment-event',null,refund);const partial=(await snapshot(u)).balance;assert.equal(partial,161);
 const reversal={eventId:'reversal:CAPTURETEST1',kind:'reversal',orderId:'ORDERTEST01',captureId:'CAPTURETEST1',refundedCents:299,originalAmountCents:299,currency:'USD'};await api('payment-event',null,reversal);await api('payment-event',null,reversal);assert.equal((await snapshot(u)).balance,60);await api('payment-event',null,paid);assert.equal((await snapshot(u)).balance,60);
});
await test('new economic tables and functions are inaccessible to browser roles',async()=>{
 for(const role of ['anon','authenticated']){await db.exec(`reset role;set role ${role}`);await assert.rejects(db.query('select * from tower_economy.promo_campaigns'),/permission/);await assert.rejects(api('redeem-code',id(),{code:'PROMO-TEST',requestId:id()}),/permission/);}
 await db.exec('reset role;set role service_role');
});
await test('administrative emission report executes against the complete schema',async()=>{await db.exec(await readFile(new URL('../reports/v4-economy.sql',import.meta.url),'utf8'));});
console.log(`${passed} v4 contracts passed`);
} catch(e){console.error(e.message,e.cause?.message,e.cause?.query);process.exitCode=1;} finally{await db.close();}
