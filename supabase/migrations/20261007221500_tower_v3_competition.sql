begin;
-- New rules are additive; old replays and settled snapshots remain readable.
alter table tower_economy.runs drop constraint runs_ruleset_check;
alter table tower_economy.runs add constraint runs_ruleset_check check(ruleset in('v2','v3'));
alter table tower_economy.runs add column coin_eligible boolean not null default false;
alter table tower_economy.runs add column attempt_source text check(attempt_source in('free','ad','purchased'));
alter table tower_economy.runs add column attempt_compensated boolean not null default false;
alter table tower_economy.periods add column ruleset text not null default 'v2';
alter table tower_economy.periods add column economic_rules jsonb not null default '{"version":2}';
alter table tower_economy.ad_intents drop constraint ad_intents_reward_check;
alter table tower_economy.ad_intents add constraint ad_intents_reward_check check(reward in('coin-bonus','double-coins','second-chance','daily-attempt'));
alter table tower_economy.ad_intents add column request_id uuid;
create unique index ad_intents_request on tower_economy.ad_intents(user_id,request_id);
create table tower_economy.members (
 user_id uuid primary key references tower_economy.wallets, google_id text not null unique,
 joined_at timestamptz not null default clock_timestamp(), referral_code uuid not null unique default gen_random_uuid()
);
create table tower_economy.daily_attempts (
 user_id uuid not null references tower_economy.wallets,day date not null,
 free_used integer not null default 0 check(free_used between 0 and 3),
 ad_awarded integer not null default 0 check(ad_awarded between 0 and 2),
 ad_used integer not null default 0 check(ad_used between 0 and ad_awarded),
 purchased_remaining integer not null default 0 check(purchased_remaining>=0),primary key(user_id,day)
);
create table tower_economy.progress (
 user_id uuid primary key references tower_economy.wallets,runs integer not null default 0,
 daily_best numeric not null default 0,badge_progress jsonb not null default '{}',achievements jsonb not null default '[]',
 last_daily date,streak integer not null default 0
);
create table tower_economy.mission_progress (
 user_id uuid not null references tower_economy.wallets,day date not null,
 qualifying_runs integer not null default 0,perfect_drops integer not null default 0,height numeric not null default 0,
 claimed text[] not null default '{}',primary key(user_id,day)
);
create table tower_economy.referrals (
 token uuid primary key default gen_random_uuid(),visitor_id uuid not null unique references tower_economy.wallets,
 referrer_id uuid not null references tower_economy.members,user_id uuid unique references tower_economy.members,
 captured_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default clock_timestamp()+interval '7 days',
 status text not null default 'captured' check(status in('captured','claimed','credited','capped','ineligible')),
 qualified_at timestamptz
);
create index referrals_referrer on tower_economy.referrals(referrer_id,qualified_at);
create index runs_v3_rank on tower_economy.runs(mode,day,user_id) where ruleset='v3' and status='accepted';
grant select(user_id,provider,provider_id,created_at) on auth.identities to service_role;
-- Freeze V1 history. New results must enter through server-issued replay tickets.
revoke execute on function public.submit_run(text,text,numeric,integer,integer,integer,integer,double precision,text,boolean) from public,anon,authenticated;
revoke execute on function tower_private.submit_run(text,text,numeric,integer,integer,integer,integer,double precision,text,boolean) from public,anon,authenticated;

create function tower_economy.is_google(p_user uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from auth.identities i join auth.users u on u.id=i.user_id where i.user_id=p_user and i.provider='google' and u.email_confirmed_at is not null);
$$;
create or replace function tower_economy.ensure_account(p_user uuid) returns void language plpgsql set search_path='' as $$
declare g text;fresh boolean;
begin
 if p_user is null or not exists(select 1 from auth.users where id=p_user) then raise exception 'Authentication required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,2));
 insert into tower_economy.wallets(user_id) values(p_user) on conflict do nothing;
 insert into tower_economy.progress(user_id) values(p_user) on conflict do nothing;
 insert into tower_economy.daily_limits(user_id,day) values(p_user,(clock_timestamp() at time zone 'UTC')::date) on conflict do nothing;
 if tower_economy.is_google(p_user) then
  select provider_id into g from auth.identities where user_id=p_user and provider='google';
  insert into tower_economy.members(user_id,google_id) values(p_user,g) on conflict(user_id) do nothing;
  fresh:=found;
  if fresh then
   -- Guest completions remain claimed without coins; linking preserves progress
   -- and never pays rewards completed before Google sign-in.
   perform tower_economy.apply_event(p_user,'starter:v3','starter',60);
  end if;
 end if;
end;$$;

create function tower_economy.v3_rules() returns jsonb language sql immutable set search_path='' as $$
 select '{"version":3,"minimumParticipants":20,"prizes":[30,20,10,5,2],"attemptPrice":30,"welcomeCoins":60,"freeAttempts":3,"adAttempts":2,"secondChancePrice":90,"missionCoins":2,"missionDailyMaximum":6,"referralCoins":5,"referralDailyMaximum":10,"referralDays":7}'::jsonb;
$$;
create or replace function tower_economy.prize(p_kind text,p_rank integer,p_n integer) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('coins',case when p_kind<>'daily' or p_n<20 or p_rank<1 or p_rank>least(25,p_n) then 0 when p_rank=1 then 30 when p_rank=2 then 20 when p_rank=3 then 10 when p_rank<=10 then 5 else 2 end,'items','{}'::jsonb);
$$;
create or replace function tower_economy.entries(p_kind text,p_start date) returns jsonb language plpgsql stable set search_path='' as $$
declare rules jsonb;v_result jsonb;
begin
 if p_kind not in('daily','monthly') then return '[]';end if;
 select economic_rules into rules from tower_economy.periods where kind=p_kind and start_day=p_start;
 rules:=coalesce(rules,tower_economy.v3_rules());
 with best as (
  select r.*,row_number() over(partition by r.user_id order by (result->>'heightCentimeters')::integer desc,(result->>'score')::integer desc,(result->>'objectsPlaced')::integer desc,received_at,id) as rn
  from tower_economy.runs r
  where ruleset='v3' and status='accepted' and (result->>'objectsPlaced')::integer>=5
  and ((p_kind='daily' and mode='daily' and day=p_start and coin_eligible)
  or(p_kind='monthly' and mode='casual' and day>=p_start and day<(p_start+interval '1 month')::date))
 ), ordered as (
  select b.*,row_number() over(order by (result->>'heightCentimeters')::integer desc,(result->>'score')::integer desc,(result->>'objectsPlaced')::integer desc,received_at,user_id) as place,count(*) over() as n from best b where rn=1
 ) select coalesce(jsonb_agg(jsonb_build_object('userId',o.user_id,'runId',o.id,'rank',place,'name',w.public_name,'height',(result->>'height')::numeric,'score',(result->>'score')::integer,'points',0,'wins',0,'firstReceivedAt',received_at,'aidsUsed',coalesce(result->'aidsUsed','[]'),'items','{}'::jsonb,
 'coins',case when p_kind='daily' and n>=coalesce((rules->>'minimumParticipants')::integer,20) and place<=25 then (rules->'prizes'->>(case when place<=3 then place::integer-1 when place<=10 then 3 else 4 end))::integer else 0 end) order by place),'[]') into v_result from ordered o join tower_economy.wallets w on w.user_id=o.user_id;
 return v_result;
end;$$;

alter function tower_economy.account_state(uuid) rename to account_state_v2;
create function tower_economy.account_state(p_user uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare d date:=(now() at time zone 'UTC')::date;a tower_economy.daily_attempts%rowtype;p tower_economy.progress%rowtype;m tower_economy.mission_progress%rowtype;code uuid;legacy numeric;missions jsonb;
begin
 select * into a from tower_economy.daily_attempts where user_id=p_user and day=d;
 select * into p from tower_economy.progress where user_id=p_user;
 select * into m from tower_economy.mission_progress where user_id=p_user and day=d;
 select referral_code into code from tower_economy.members where user_id=p_user;
 select coalesce(max(best_height),0) into legacy from public.daily_scores where user_id=p_user;
 missions:=jsonb_build_object('daily-three-runs',jsonb_build_object('progress',least(3,coalesce(m.qualifying_runs,0)),'claimed','daily-three-runs'=any(coalesce(m.claimed,'{}'))),
 'daily-eight-perfect',jsonb_build_object('progress',least(8,coalesce(m.perfect_drops,0)),'claimed','daily-eight-perfect'=any(coalesce(m.claimed,'{}'))),
 'daily-thirty',jsonb_build_object('progress',least(30,coalesce(m.height,0)),'claimed','daily-thirty'=any(coalesce(m.claimed,'{}'))));
 return tower_economy.account_state_v2(p_user)||jsonb_build_object('recoverable',tower_economy.is_google(p_user),'gameplayEarned',0,'adBonusClaims',coalesce(a.ad_awarded,0),
 'attempts',jsonb_build_object('day',d,'freeRemaining',3-coalesce(a.free_used,0),'adRemaining',coalesce(a.ad_awarded,0)-coalesce(a.ad_used,0),'adAvailable',2-coalesce(a.ad_awarded,0),'purchasedRemaining',coalesce(a.purchased_remaining,0),'renewsAt',(d+1)::timestamp at time zone 'UTC'),
 'dailyBest',coalesce(p.daily_best,0),'legacyDailyBest',legacy,'dailyParticipants',jsonb_array_length(tower_economy.entries('daily',d)),
 'progress',jsonb_build_object('runs',coalesce(p.runs,0),'achievements',coalesce(p.achievements,'[]'),'badgeProgress',coalesce(p.badge_progress,'{}'),'missions',missions),
 'referral',case when code is null then null else jsonb_build_object('code',code,'qualified',(select count(*) from tower_economy.referrals where referrer_id=p_user and qualified_at is not null),
 'paid',(select count(*) from tower_economy.referrals where referrer_id=p_user and status='credited'),'paidToday',(select count(*) from tower_economy.referrals where referrer_id=p_user and status='credited' and (qualified_at at time zone 'UTC')::date=d),'earnedCoins',5*(select count(*) from tower_economy.referrals where referrer_id=p_user and status='credited')) end);
end;$$;

-- Preserve workers and legacy replay ingestion; economic v3 operations override old branches.
alter function tower_economy.api(text,uuid,jsonb) rename to api_v2;
create function tower_economy.api(p_action text,p_user uuid,p_data jsonb default '{}') returns jsonb language plpgsql set search_path='' as $$
#variable_conflict use_column
<<v3>>
declare v_now timestamptz:=clock_timestamp();d date:=(v_now at time zone 'UTC')::date;r tower_economy.runs%rowtype;a tower_economy.daily_attempts%rowtype;
 m tower_economy.mission_progress%rowtype;p tower_economy.progress%rowtype;intent tower_economy.ad_intents%rowtype;ref tower_economy.referrals%rowtype;
 id uuid;owner uuid;lock_user uuid;referrer uuid;g boolean;aid text;source text;aids text[];catalog text;kind text;start_day date;end_at timestamptz;entries jsonb;own_entry jsonb;
 result jsonb;metrics jsonb;bp jsonb;ach jsonb;new_ach jsonb:='[]';completed jsonb:='[]';badge record;amount integer:=0;code_id uuid;attempt_day date;
begin
 if p_action in('paypal-order','paypal-capture','paypal-attach','paypal-find','double-coins') then raise exception 'Purchases and coin ads disabled';end if;
 if p_action in('claim-job','reject-run','retry-run','payment-order','payment-event') then return tower_economy.api_v2(p_action,p_user,p_data);end if;
 if p_action='settle' then return to_jsonb(tower_economy.settle(case when p_data ? 'periods' then array(select jsonb_array_elements_text(p_data->'periods')) else array['daily','monthly'] end));end if;
 if p_action='verify-run' then
  select user_id into owner from tower_economy.runs where id=(p_data->>'runId')::uuid;
  if owner is null then return 'null';end if;
  -- Verification can credit an inviter too. Lock both accounts in UUID order.
  select referrer_id into referrer from tower_economy.referrals where user_id=owner and status='claimed';
  for lock_user in select distinct value from unnest(array[owner,referrer]) value where value is not null order by value loop
   perform pg_advisory_xact_lock(hashtextextended(lock_user::text,2));
  end loop;
  perform tower_economy.ensure_account(owner);
  select * into r from tower_economy.runs where id=(p_data->>'runId')::uuid and worker_id=(p_data->>'workerId')::uuid and status='validating' for update;
  if not found then return 'null';end if;
  if r.ruleset='v2' then return tower_economy.api_v2(p_action,p_user,p_data);end if;
  if v_now>=r.received_at+interval '10 minutes' or v_now>=((r.day+1)::timestamp at time zone 'UTC')+interval '75 minutes' then return 'null';end if;
  result:=p_data->'result';
  if result is null or (result->>'objectsPlaced')::integer not between 0 and 500 or (result->>'heightCentimeters')::integer not between 0 and 500000 or (result->>'score')::integer not between 0 and 1000000 or (result->>'perfectDrops')::integer not between 0 and (result->>'objectsPlaced')::integer or not array(select jsonb_array_elements_text(coalesce(result->'aidsUsed','[]'))) <@ r.aids then raise exception 'Invalid canonical result';end if;
  if r.coin_eligible or not tower_economy.is_google(owner) then
  insert into tower_economy.mission_progress(user_id,day) values(owner,r.day) on conflict do nothing;
  update tower_economy.mission_progress set qualifying_runs=qualifying_runs+case when (result->>'objectsPlaced')::integer>=5 then 1 else 0 end,perfect_drops=perfect_drops+(result->>'perfectDrops')::integer,height=greatest(height,(result->>'height')::numeric) where user_id=owner and day=r.day returning * into m;
   if m.qualifying_runs>=3 and not 'daily-three-runs'=any(m.claimed) then completed:=completed||'"daily-three-runs"'::jsonb;end if;
   if m.perfect_drops>=8 and not 'daily-eight-perfect'=any(m.claimed) then completed:=completed||'"daily-eight-perfect"'::jsonb;end if;
   if m.height>=30 and not 'daily-thirty'=any(m.claimed) then completed:=completed||'"daily-thirty"'::jsonb;end if;
  if r.coin_eligible then
   amount:=jsonb_array_length(completed)*2;
   if amount>0 then perform tower_economy.apply_event(owner,'missions:'||r.id,'daily-missions',amount);end if;
   update tower_economy.daily_limits set missions=missions+amount where user_id=owner and day=r.day;
  end if;
  update tower_economy.mission_progress set claimed=claimed||array(select jsonb_array_elements_text(completed)) where user_id=owner and day=r.day;
  end if;
  select * into p from tower_economy.progress where user_id=owner for update;
  if r.mode='daily' then
   if p.last_daily is null or p.last_daily<r.day then p.streak:=case when p.last_daily=r.day-1 then p.streak+1 else 1 end;p.last_daily:=r.day;end if;
   p.daily_best:=greatest(p.daily_best,(result->>'height')::numeric);
  end if;
  metrics:=jsonb_build_object('objectsPlaced',(result->>'objectsPlaced')::integer,'height',(result->>'height')::numeric,'maxPerfectCombo',coalesce((result->>'maxPerfectCombo')::integer,0),'rocket',case when result->'objectIds' ? 'rocket' then 1 else 0 end,'dailyStreak',p.streak);
  bp:=p.badge_progress;ach:=p.achievements;
  for badge in select * from (values('first-stack','objectsPlaced',1),('fifty-meters','height',50),('hundred-meters','height',100),('perfect-five','maxPerfectCombo',5),('perfect-ten','maxPerfectCombo',10),('rocket-scientist','rocket',1),('cloud-toucher','height',150),('chaos-master','height',200),('daily-regular','dailyStreak',3))b(id,metric,target) loop
   bp:=jsonb_set(bp,array[badge.id],to_jsonb(least(badge.target,greatest(coalesce((bp->>badge.id)::numeric,0),coalesce((metrics->>badge.metric)::numeric,0)))));
   if (bp->>badge.id)::numeric>=badge.target and not ach ? badge.id then ach:=ach||to_jsonb(badge.id);new_ach:=new_ach||to_jsonb(badge.id);end if;
  end loop;
  update tower_economy.progress set runs=runs+1,daily_best=p.daily_best,last_daily=p.last_daily,streak=p.streak,badge_progress=bp,achievements=ach where user_id=owner;
  update tower_economy.runs set status='accepted',verified_at=v_now,result=v3.result||jsonb_build_object('earnedCoins',amount,'completedMissions',completed,'newAchievements',new_ach),worker_id=null,lease_until=null where id=r.id;
  if r.mode='daily' and r.coin_eligible and (result->>'objectsPlaced')::integer>=5 and not exists(select 1 from tower_economy.runs previous where previous.user_id=owner and previous.id<>r.id and previous.mode='daily' and previous.ruleset='v3' and previous.status='accepted' and (previous.result->>'objectsPlaced')::integer>=5) then
   select * into ref from tower_economy.referrals where user_id=owner and status='claimed' for update;
   if found then
    if ref.expires_at<=r.received_at then update tower_economy.referrals set status='ineligible' where token=ref.token;
    else
     -- The inviter's account lock also serializes the ten-payment quota.
     if (select count(*) from tower_economy.referrals where referrer_id=ref.referrer_id and status='credited' and (qualified_at at time zone 'UTC')::date=d)<10 then
      perform tower_economy.apply_event(ref.referrer_id,'referral:'||owner,'referral',5);
      update tower_economy.referrals set status='credited',qualified_at=v_now where token=ref.token;
     else update tower_economy.referrals set status='capped',qualified_at=v_now where token=ref.token;end if;
    end if;
   end if;
  end if;
  return tower_economy.run_state(r.id);
 end if;
 perform tower_economy.ensure_account(p_user);g:=tower_economy.is_google(p_user);
 if p_action not in('snapshot','leaderboard','run','start-run','finish-run','capture-referral') and not g then raise exception 'Google account required';end if;
 if p_action='snapshot' then return tower_economy.account_state(p_user);
 elsif p_action='capture-referral' then
  select * into ref from tower_economy.referrals where visitor_id=p_user;
  if found then return jsonb_build_object('token',ref.token);end if;
  if g then return '{}';end if;
  select user_id into owner from tower_economy.members where referral_code=(p_data->>'code')::uuid;
  if owner is null or owner=p_user then return '{}';end if;
  insert into tower_economy.referrals(visitor_id,referrer_id) values(p_user,owner) returning token into id;
  return jsonb_build_object('token',id);
 elsif p_action='claim-referral' then
  select * into ref from tower_economy.referrals where token=(p_data->>'token')::uuid for update;
  if not found or ref.expires_at<=v_now or ref.referrer_id=p_user then return tower_economy.account_state(p_user);end if;
  if ref.status<>'captured' then return tower_economy.account_state(p_user);end if;
  -- Auth identity creation time, not client metadata, proves a new Google registration.
  if exists(select 1 from auth.identities where user_id=p_user and provider='google' and created_at>=ref.captured_at and created_at<ref.expires_at)
   and not exists(select 1 from tower_economy.referrals where user_id=p_user)
   and not exists(select 1 from tower_economy.runs where user_id=p_user and ruleset='v3' and mode='daily' and status='accepted' and (result->>'objectsPlaced')::integer>=5) then
   update tower_economy.referrals set user_id=p_user,status='claimed' where token=ref.token;
  end if;
  return tower_economy.account_state(p_user);
 elsif p_action='buy-cosmetic' then
  amount:=case p_data->>'id' when 'crane-coral' then 60 when 'crane-gold' then 100 when 'crane-violet' then 140 when 'crane-midnight' then 180 when 'background-sunset' then 100 when 'background-aurora' then 160 when 'trail-coral' then 35 when 'trail-mint' then 45 when 'trail-gold' then 60 when 'trail-comet' then 80 when 'effect-sparks' then 45 when 'effect-bubbles' then 55 when 'effect-confetti' then 75 when 'effect-stars' then 95 when 'crane-copper' then 300 when 'crane-cobalt' then 600 when 'crane-obsidian' then 1200 end;
  if amount is null then raise exception 'Unknown cosmetic';end if;
  if not exists(select 1 from tower_economy.cosmetics where user_id=p_user and item=p_data->>'id') then
   if tower_economy.apply_event(p_user,'cosmetic:'||(p_data->>'requestId')::uuid,'cosmetic-purchase',-amount) then
    insert into tower_economy.cosmetics(user_id,item) values(p_user,p_data->>'id');
   else raise exception 'Request already used';end if;
  end if;
  return tower_economy.account_state(p_user);
 elsif p_action='buy-attempt' then
  insert into tower_economy.daily_attempts(user_id,day) values(p_user,d) on conflict do nothing;
  if tower_economy.apply_event(p_user,'attempt:'||(p_data->>'requestId')::uuid,'daily-attempt',-30) then
   update tower_economy.daily_attempts set purchased_remaining=purchased_remaining+1 where user_id=p_user and day=d;
  end if;
  return tower_economy.account_state(p_user);
 elsif p_action='start-run' then
  select * into r from tower_economy.runs where user_id=p_user and request_id=(p_data->>'requestId')::uuid;
  if found then return tower_economy.ticket(r.id);end if;
  if p_data->>'mode' not in('casual','daily') then raise exception 'Invalid mode';end if;
  if p_data->>'mode'='daily' and not g then raise exception 'Google account required';end if;
  aids:=array(select jsonb_array_elements_text(coalesce(p_data->'aids','[]')));
  if cardinality(aids)>2 or cardinality(aids)<>(select count(distinct x) from unnest(aids)x) or aids @> array['guide-5','guide-10'] or not aids <@ array['guide-5','guide-10','preview','focus','skip','second-chance'] or not g and cardinality(aids)>0 then raise exception 'Invalid loadout';end if;
  if coalesce(trim(p_data->>'publicName'),'')='' or coalesce(tower_private.safe_name(p_data->>'publicName'),'Anónimo')='Anónimo' then raise exception 'Public name required';end if;
  if (select count(*) from tower_economy.runs where user_id=p_user and started_at>v_now-interval '1 minute')>=30 then raise exception 'Too many requests';end if;
  if exists(select 1 from unnest(aids)x where not exists(select 1 from tower_economy.inventory i where i.user_id=p_user and item=x and quantity>0)) then raise exception 'Aid unavailable';end if;
  catalog:=coalesce(p_data->>'catalog','extended-30');
  kind:=case when p_data->>'mode'='daily' then 'daily' else 'monthly' end;
  start_day:=case when kind='daily' then d else date_trunc('month',d::timestamp)::date end;
  end_at:=case when kind='daily' then (d+1)::timestamp at time zone 'UTC' else (start_day+interval '1 month') at time zone 'UTC' end;
  insert into tower_economy.periods(kind,start_day,end_at,catalog,ruleset,economic_rules) values(kind,start_day,end_at,catalog,'v3',tower_economy.v3_rules()) on conflict do nothing;
  if kind='monthly' then
   update tower_economy.periods p set ruleset='v3',economic_rules=tower_economy.v3_rules() where p.kind=v3.kind and p.start_day=v3.start_day and p.status='open' and p.ruleset='v2';
  end if;
  if kind='daily' then
   select p.catalog into catalog from tower_economy.periods p where p.kind=v3.kind and p.start_day=v3.start_day and p.ruleset='v3' for update;
   if catalog is null then raise exception 'Daily rules change at next UTC day';end if;
   insert into tower_economy.daily_attempts(user_id,day) values(p_user,d) on conflict do nothing;
   select * into a from tower_economy.daily_attempts where user_id=p_user and day=d for update;
   if a.free_used<3 then source:='free';update tower_economy.daily_attempts set free_used=free_used+1 where user_id=p_user and day=d;
   elsif a.ad_used<a.ad_awarded then source:='ad';update tower_economy.daily_attempts set ad_used=ad_used+1 where user_id=p_user and day=d;
   elsif a.purchased_remaining>0 then source:='purchased';update tower_economy.daily_attempts set purchased_remaining=purchased_remaining-1 where user_id=p_user and day=d;
   else raise exception 'No Daily attempts left';end if;
  end if;
  update tower_economy.wallets set public_name=tower_private.safe_name(p_data->>'publicName') where user_id=p_user;
  update tower_economy.runs set status='rejected',error='Superseded by new attempt' where user_id=p_user and status='started';
  id:=gen_random_uuid();
  insert into tower_economy.runs(id,user_id,request_id,mode,seed,catalog,day,aids,paid_aids,ruleset,coin_eligible,attempt_source,started_at,expires_at)
  values(id,p_user,(p_data->>'requestId')::uuid,p_data->>'mode',case when kind='daily' then 'tower:daily:'||d||':v3:'||catalog else 'tower:casual:'||id||':v3' end,catalog,d,aids,aids,'v3',g,source,v_now,v_now+interval '60 minutes');
  return tower_economy.ticket(id);
 elsif p_action='use-aid' then
  aid:=p_data->>'id';
  if aid='second-chance' then
   select * into r from tower_economy.runs where id=(p_data->>'runId')::uuid and user_id=p_user for update;
   if not found or r.status<>'started' or r.expires_at<=v_now then raise exception 'Continuation unavailable';end if;
   if not aid=any(r.aids) then
    if (select count(*) from tower_economy.aid_uses where run_id=r.id)>=2 then raise exception 'Aid limit reached';end if;
    if cardinality(r.aids)>=2 then
     -- An unused reservation is not an aid use. Keep consumed aids, release
     -- untouched reservations without charging inventory, then reserve revive.
     select coalesce(array_agg(u.aid order by u.tick,u.aid),'{}') into aids from tower_economy.aid_uses u where u.run_id=r.id;
     update tower_economy.runs set aids=v3.aids,paid_aids=v3.aids where id=r.id;
    end if;
    if not exists(select 1 from tower_economy.inventory where user_id=p_user and item=aid and quantity>0) then
     perform tower_economy.apply_event(p_user,'revive-buy:'||r.id,'aid-purchase',-90,jsonb_build_object(aid,1));
    end if;
    update tower_economy.runs set aids=array_append(aids,aid),paid_aids=array_append(paid_aids,aid) where id=r.id;
   end if;
  end if;
  return tower_economy.api_v2(p_action,p_user,p_data);
 elsif p_action in('finish-run','run') then
  -- Legacy ingestion denies anonymous finish; the v3 path checks ownership directly.
  select * into r from tower_economy.runs where id=(p_data->>'runId')::uuid and user_id=p_user for update;
  if not found then raise exception 'Run not found';end if;
  if p_action='run' or r.status<>'started' then return tower_economy.run_state(r.id);end if;
  if p_data ? 'ruleset' and p_data->>'ruleset' is distinct from r.ruleset then raise exception 'Ruleset mismatch';end if;
  if v_now>=r.expires_at or v_now>=((r.day+1)::timestamp at time zone 'UTC')+interval '60 minutes' then raise exception 'Ticket expired';end if;
  if jsonb_typeof(p_data->'events') is distinct from 'array' or jsonb_array_length(p_data->'events')>510 or octet_length((p_data->'events')::text)>65536 or (p_data->>'finalTick')::integer not between 1 and 144000 then raise exception 'Invalid replay';end if;
  update tower_economy.runs set status='pending',events=p_data->'events',final_tick=(p_data->>'finalTick')::integer,received_at=v_now where id=r.id;
  return tower_economy.run_state(r.id);
 elsif p_action='ad-intent' then
  select * into intent from tower_economy.ad_intents where user_id=p_user and request_id=(p_data->>'requestId')::uuid;
  if found then return jsonb_build_object('id',intent.id,'expiresAt',intent.expires_at);end if;
  if p_data->>'reward'<>'daily-attempt' then raise exception 'Unknown reward';end if;
  insert into tower_economy.daily_attempts(user_id,day) values(p_user,d) on conflict do nothing;
  select * into a from tower_economy.daily_attempts where user_id=p_user and day=d for update;
  if a.ad_awarded>=2 then raise exception 'Daily ad limit reached';end if;
  if exists(select 1 from tower_economy.ad_intents where user_id=p_user and completed_at is null and expires_at>v_now) then raise exception 'Another reward is pending';end if;
  if (select count(*) from tower_economy.ad_intents where user_id=p_user and created_at>v_now-interval '1 minute')>=10 then raise exception 'Too many requests';end if;
  insert into tower_economy.ad_intents(user_id,reward,request_id) values(p_user,'daily-attempt',coalesce((p_data->>'requestId')::uuid,gen_random_uuid())) returning id into id;
  return jsonb_build_object('id',id,'expiresAt',v_now+interval '5 minutes');
 elsif p_action='ad-complete' then
  select * into intent from tower_economy.ad_intents where id=(p_data->>'intentId')::uuid and user_id=p_user for update;
  if not found or intent.reward<>'daily-attempt' then raise exception 'Reward not found';end if;
  if intent.completed_at is not null then return tower_economy.account_state(p_user);end if;
  if intent.expires_at<=v_now or p_data->>'viewed' is distinct from 'true' then raise exception 'Reward not completed';end if;
  attempt_day:=(intent.created_at at time zone 'UTC')::date;
  if attempt_day<>d then raise exception 'Reward expired at daily reset';end if;
  update tower_economy.daily_attempts set ad_awarded=ad_awarded+1 where user_id=p_user and day=d and ad_awarded<2;
  if not found then raise exception 'Daily ad limit reached';end if;
  update tower_economy.ad_intents set completed_at=v_now where id=intent.id;
  return tower_economy.account_state(p_user);
 elsif p_action='ad-cancel' then
  update tower_economy.ad_intents set expires_at=v_now where id=(p_data->>'intentId')::uuid and user_id=p_user and completed_at is null;
  return tower_economy.account_state(p_user);
 elsif p_action='leaderboard' then
  kind:=p_data->>'period';if kind not in('daily','monthly') then raise exception 'Invalid period';end if;
  start_day:=coalesce(nullif(p_data->>'periodKey','')::date,case when kind='daily' then d else date_trunc('month',d::timestamp)::date end);
  if kind='monthly' and extract(day from start_day)<>1 then raise exception 'Invalid period key';end if;
  end_at:=(case when kind='daily' then start_day+interval '1 day' else start_day+interval '1 month' end) at time zone 'UTC';
  select p.entries into entries from tower_economy.periods p where p.kind=v3.kind and p.start_day=v3.start_day and p.status='settled';
  if not found then entries:=tower_economy.entries(kind,start_day);end if;
  select e-'userId'-'runId'-'firstReceivedAt' into own_entry from jsonb_array_elements(entries)e where e->>'userId'=p_user::text;
  return jsonb_build_object('period',kind,'periodId',kind||':'||start_day,'startUTC',start_day::timestamp at time zone 'UTC','endUTC',end_at,'settlesAt',end_at+interval '75 minutes','status',case when exists(select 1 from tower_economy.periods p where p.kind=v3.kind and p.start_day=v3.start_day and p.status='settled') then 'settled' else 'open' end,'participants',jsonb_array_length(entries),'entries',(select coalesce(jsonb_agg(e-'userId'-'runId'-'firstReceivedAt'),'[]') from (select e from jsonb_array_elements(entries)e limit 50)q),'ownEntry',own_entry);
 end if;
 return tower_economy.api_v2(p_action,p_user,p_data);
end;$$;

alter function tower_economy.settle(text[]) rename to settle_v2;
create function tower_economy.settle(p_kinds text[] default array['daily','monthly']) returns integer
language plpgsql set search_path='' set statement_timeout='8s' as $$
declare v_now timestamptz:=clock_timestamp();n integer:=0;r record;e jsonb;v_entries jsonb;refund jsonb;uid uuid;
begin
 if not p_kinds <@ array['daily','monthly'] then raise exception 'Invalid period';end if;
 if not pg_try_advisory_xact_lock(726163986) then return 0;end if;
 -- Lock every affected account in one consistent order before any wallet writes.
 -- Monthly practice has no dependency on the Daily classification.
 for uid in
  with due_periods as (
   select kind,start_day from tower_economy.periods where status='open' and kind=any(p_kinds)
    and end_at+interval '75 minutes'<=v_now order by end_at,kind limit 3
  ), due_runs as (
   select user_id from tower_economy.runs where status in('pending','validating')
    and (received_at+interval '10 minutes'<=v_now or ((day+1)::timestamp at time zone 'UTC')+interval '75 minutes'<=v_now)
    order by received_at limit 100
  ), accounts as (
   select user_id from due_runs union
   select (entry->>'userId')::uuid from due_periods p cross join lateral jsonb_array_elements(tower_economy.entries(p.kind,p.start_day)) entry
    where (entry->>'rank')::integer<=case when p.kind='daily' then 25 else 3 end
  ) select user_id from accounts order by user_id
 loop perform pg_advisory_xact_lock(hashtextextended(uid::text,2));end loop;
 for r in select * from tower_economy.runs where status in('pending','validating')
  and (received_at+interval '10 minutes'<=v_now or ((day+1)::timestamp at time zone 'UTC')+interval '75 minutes'<=v_now)
  order by received_at limit 100 for update
 loop
  select coalesce(jsonb_object_agg(aid,1),'{}') into refund from tower_economy.aid_uses where run_id=r.id and paid;
  perform tower_economy.apply_event(r.user_id,'timeout:'||r.id,'infrastructure-compensation',
   case when r.attempt_source='purchased' then 30 else 0 end,refund);
  if r.attempt_source='free' then update tower_economy.daily_attempts set free_used=greatest(0,free_used-1) where user_id=r.user_id and day=r.day;
  elsif r.attempt_source='ad' then update tower_economy.daily_attempts set ad_used=greatest(0,ad_used-1) where user_id=r.user_id and day=r.day;end if;
  update tower_economy.runs set status='verification_timeout',error='Verification unavailable',attempt_compensated=true,worker_id=null,lease_until=null where id=r.id;
 end loop;
 update tower_economy.runs set status='rejected',error='Ticket expired' where id in(
  select id from tower_economy.runs where status='started' and expires_at<=v_now order by expires_at limit 100);
 for r in select * from tower_economy.periods where status='open' and kind=any(p_kinds)
  and end_at+interval '75 minutes'<=v_now order by end_at,kind limit 3 for update
 loop
  v_entries:=tower_economy.entries(r.kind,r.start_day);
  for e in select value from jsonb_array_elements(v_entries) where (value->>'rank')::integer<=25 loop
   if (e->>'coins')::integer>0 then perform tower_economy.apply_event((e->>'userId')::uuid,
    'prize:'||r.kind||':'||r.start_day,'ranking-'||r.kind,(e->>'coins')::integer);end if;
   if r.kind='monthly' and r.ruleset='v3' and (e->>'rank')::integer<=3 then
    update tower_economy.progress set achievements=achievements||'"monthly-podium"'::jsonb,
     badge_progress=jsonb_set(badge_progress,array['monthly-podium'],'1')
     where user_id=(e->>'userId')::uuid and not achievements ? 'monthly-podium';
   end if;
  end loop;
  update tower_economy.periods set status='settled',entries=v_entries,settled_at=v_now where kind=r.kind and start_day=r.start_day;
  n:=n+1;
 end loop;
 return n;
end;$$;

-- Private service-only functions and tables; browser roles cannot bypass the API boundary.
revoke all on all functions in schema tower_economy from public,anon,authenticated;
grant execute on all functions in schema tower_economy to service_role;
grant all on all tables in schema tower_economy to service_role;
grant execute on function tower_private.safe_name(text) to service_role;
grant usage on schema tower_private to service_role;
grant select on public.daily_scores to service_role;
alter table tower_economy.members enable row level security;
alter table tower_economy.daily_attempts enable row level security;
alter table tower_economy.progress enable row level security;
alter table tower_economy.mission_progress enable row level security;
alter table tower_economy.referrals enable row level security;
commit;
