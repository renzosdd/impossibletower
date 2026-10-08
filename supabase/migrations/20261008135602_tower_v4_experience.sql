begin;
-- Assistance evolves independently from physics. Existing tickets keep version 1.
alter table tower_economy.runs add column aid_rules_version integer not null default 1 check(aid_rules_version in(1,2));
alter table tower_economy.runs add column economy_version integer not null default 3;
alter table tower_economy.progress add column badge_catalog_version integer not null default 2;
alter table tower_economy.progress add column badge_metrics jsonb not null default '{}';
alter table tower_economy.progress add column badge_objects text[] not null default '{}';
alter table tower_economy.progress add column badge_days date[] not null default '{}';
alter table tower_economy.mission_progress add column total_objects integer not null default 0;
alter table tower_economy.mission_progress add column qualifying_daily integer not null default 0;
alter table tower_economy.periods add column podium_processed boolean not null default false;
alter table tower_economy.periods add column badge_catalog_version integer not null default 1;
-- Future podiums count toward the reset catalogue, including periods already open.
-- Their saved economic rules and promised payouts remain unchanged.
update tower_economy.periods set badge_catalog_version=2 where status='open';
update tower_economy.progress set badge_progress='{}',achievements='[]';
-- Clear only badge fields in cloud saves. Old clients cannot restore catalogue 1.
update public.profiles set data=(data-'achievements'-'badgeProgress'-'badgeMetrics'-'badgeObjects'-'badgeLastDaily')||'{"badgeCatalogVersion":2,"achievements":[],"badgeProgress":{},"badgeMetrics":{},"badgeObjects":[],"badgeLastDaily":""}'::jsonb;
create or replace function tower_private.sync_profile(p_name text,p_data jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_data jsonb:=p_data;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or p_data->>'version' is distinct from '2' or octet_length(p_data::text)>65536 then raise exception 'Invalid profile' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_user::text,0));
 if p_data->>'badgeCatalogVersion' is distinct from '2' then
  v_data:=(p_data-'achievements'-'badgeProgress'-'badgeMetrics'-'badgeObjects'-'badgeLastDaily')||coalesce((select jsonb_build_object('badgeCatalogVersion',2,'achievements',data->'achievements','badgeProgress',data->'badgeProgress','badgeMetrics',data->'badgeMetrics','badgeObjects',data->'badgeObjects','badgeLastDaily',data->'badgeLastDaily') from public.profiles where user_id=v_user),'{"badgeCatalogVersion":2,"achievements":[],"badgeProgress":{},"badgeMetrics":{},"badgeObjects":[],"badgeLastDaily":""}'::jsonb);
 end if;
 insert into public.profiles(user_id,public_name,data)values(v_user,tower_private.safe_name(p_name),jsonb_set(v_data,'{publicName}',to_jsonb(tower_private.safe_name(p_name))))
 on conflict(user_id) do update set public_name=excluded.public_name,data=excluded.data,updated_at=now();
end;$$;
update tower_economy.periods set podium_processed=true where status='settled';
-- New weekly rewards start on a whole UTC week, never retroactively.
create table tower_economy.release_settings(id boolean primary key default true check(id),weekly_start date not null);
insert into tower_economy.release_settings values(true,(date_trunc('week',clock_timestamp() at time zone 'UTC')+interval '7 days')::date);
create table tower_economy.badge_catalog (
 id text primary key,family text not null,metric text not null,tier text not null check(tier in('bronze','silver','gold')),
 target integer not null check(target>0),coins integer not null default 0 check(coins>=0),items jsonb not null default '{}'
);
insert into tower_economy.badge_catalog(id,family,metric,tier,target,coins,items)
select 'v2:'||family||':'||tier,family,metric,tier,targets[ord],case when money and ord>1 then case ord when 2 then 5 else 10 end else 0 end,
 case when not money and ord>1 then jsonb_build_object(rewards[ord-1],1) else '{}' end
from (values
 ('stack','objectsPlaced',array[1,10,25],false,array['preview','guide-5']),
 ('height','height',array[30,75,150],true,array[]::text[]),
 ('combo','maxPerfectCombo',array[3,5,10],true,array[]::text[]),
 ('perfects','totalPerfect',array[10,50,200],false,array['focus','skip']),
 ('runs','qualifyingRuns',array[5,25,100],false,array['guide-5','guide-10']),
 ('objects','totalObjects',array[25,150,750],false,array['guide-5','focus']),
 ('daily-days','dailyDays',array[3,10,30],true,array[]::text[]),
 ('streak','dailyStreak',array[3,7,14],true,array[]::text[]),
 ('rockets','rockets',array[1,5,15],false,array['preview','skip']),
 ('variety','uniqueObjects',array[5,15,25],false,array['preview','focus']),
 ('weekly-podium','weeklyPodium',array[1,3,6],true,array[]::text[]),
 ('monthly-podium','monthlyPodium',array[1,3,6],true,array[]::text[])
)f(family,metric,targets,money,rewards) cross join (values('bronze',1),('silver',2),('gold',3))t(tier,ord);
create table tower_economy.badge_claims(user_id uuid references tower_economy.wallets,id text references tower_economy.badge_catalog,claimed_at timestamptz not null default clock_timestamp(),primary key(user_id,id));
create index badge_claims_badge on tower_economy.badge_claims(id);
create table tower_economy.notifications (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references tower_economy.wallets,
 period text not null,period_id text not null,final boolean not null,rank integer not null check(rank between 1 and 3),
 coins integer not null default 0,minimum_met boolean not null default true,created_at timestamptz not null default clock_timestamp(),seen_at timestamptz,
 unique(user_id,period,period_id,final)
);
create index notifications_unseen on tower_economy.notifications(user_id,created_at) where seen_at is null;
create table tower_economy.promo_campaigns (
 id uuid primary key default gen_random_uuid(),company text not null,code text not null unique check(code ~ '^[-A-Z0-9]{3,64}$'),
 coins integer not null check(coins between 1 and 10000),starts_at timestamptz not null,expires_at timestamptz not null,
 max_redemptions integer not null check(max_redemptions>0),redeemed integer not null default 0 check(redeemed>=0 and redeemed<=max_redemptions),
 active boolean not null default true,created_at timestamptz not null default clock_timestamp(),check(expires_at>starts_at)
);
create table tower_economy.promo_redemptions(user_id uuid references tower_economy.wallets,campaign_id uuid references tower_economy.promo_campaigns,request_id uuid not null,created_at timestamptz not null default clock_timestamp(),primary key(user_id,campaign_id),unique(user_id,request_id));
create index promo_redemptions_campaign on tower_economy.promo_redemptions(campaign_id);
create table tower_economy.promo_attempts(user_id uuid primary key references tower_economy.wallets,window_start timestamptz not null,count integer not null check(count>0));

create function tower_economy.v4_rules() returns jsonb language sql immutable set search_path='' as $$
 select '{"version":4,"minimumParticipants":20,"prizes":[0,0,0,0,0],"weeklyPrizes":[60,40,20,10,4],"countedDays":3,"missionCoins":2,"missionDailyMaximum":10,"attemptPrice":30,"freeAttempts":3,"adAttempts":2}'::jsonb;
$$;
create or replace function tower_economy.ticket(p_run uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',id,'mode',mode,'seed',seed,'catalog',catalog,'ruleset',ruleset,'startedAt',started_at,'expiresAt',expires_at,'aids',aids,'aidRulesVersion',aid_rules_version) from tower_economy.runs where id=p_run;
$$;
create function tower_economy.refresh_badges(p_user uuid) returns void language sql set search_path='' as $$
 update tower_economy.progress p set badge_progress=(select coalesce(jsonb_object_agg(b.id,least(b.target,coalesce((p.badge_metrics->>b.metric)::numeric,0))),'{}') from tower_economy.badge_catalog b),
 achievements=(select coalesce(jsonb_agg(b.id order by b.id),'[]') from tower_economy.badge_catalog b where coalesce((p.badge_metrics->>b.metric)::numeric,0)>=b.target),badge_catalog_version=2 where user_id=p_user;
$$;
alter function tower_economy.account_state(uuid) rename to account_state_v3;
create function tower_economy.account_state(p_user uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare s jsonb;p tower_economy.progress%rowtype;d date:=(now() at time zone 'UTC')::date;m tower_economy.mission_progress%rowtype;
begin
 s:=tower_economy.account_state_v3(p_user);select * into p from tower_economy.progress where user_id=p_user;select * into m from tower_economy.mission_progress where user_id=p_user and day=d;
 return s||jsonb_build_object('missionsRenewAt',(d+1)::timestamp at time zone 'UTC','progress',s->'progress'||jsonb_build_object(
 'badgeCatalogVersion',2,'achievements',coalesce((select jsonb_agg(b.id) from tower_economy.badge_catalog b where coalesce((p.badge_metrics->>b.metric)::numeric,0)>=b.target),'[]'),
 'badgeProgress',coalesce((select jsonb_object_agg(b.id,least(b.target,coalesce((p.badge_metrics->>b.metric)::numeric,0))) from tower_economy.badge_catalog b),'{}'),
 'badgeClaims',coalesce((select jsonb_agg(id) from tower_economy.badge_claims where user_id=p_user),'[]'),
 'missions',s->'progress'->'missions'||jsonb_build_object(
 'daily-objects',jsonb_build_object('progress',least(25,coalesce(m.total_objects,0)),'claimed','daily-objects'=any(coalesce(m.claimed,'{}'))),
 'daily-two',jsonb_build_object('progress',least(2,coalesce(m.qualifying_daily,0)),'claimed','daily-two'=any(coalesce(m.claimed,'{}'))))),
 'notifications',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'period',q.period,'periodId',q.period_id,'rank',q.rank,'final',q.final,'coins',q.coins,'minimumMet',q.minimum_met) order by q.created_at) from(select * from tower_economy.notifications where user_id=p_user and seen_at is null order by created_at limit 10)q),'[]'));
end;$$;

alter function tower_economy.entries(text,date) rename to entries_v3;
create function tower_economy.entries(p_kind text,p_start date) returns jsonb language plpgsql stable set search_path='' as $$
declare v_result jsonb;rules jsonb;
begin
 if p_kind in('daily','monthly') then
  v_result:=tower_economy.entries_v3(p_kind,p_start);
  if p_kind='daily' then
   select coalesce(jsonb_agg(e||jsonb_build_object('points',case when n=1 then 10 else round(10+90.0*(n-(e->>'rank')::integer)/(n-1))::integer end,'wins',case when (e->>'rank')::integer=1 and n>=2 then 1 else 0 end,'objectsPlaced',coalesce((select (r.result->>'objectsPlaced')::integer from tower_economy.runs r where r.id=(e->>'runId')::uuid),0)) order by (e->>'rank')::integer),'[]') into v_result from jsonb_array_elements(v_result)e cross join lateral(select jsonb_array_length(v_result) n)q;
  end if;return v_result;
 elsif p_kind='all-time' then
  with best as (
   select r.*,row_number() over(partition by user_id order by (result->>'heightCentimeters')::integer desc,(result->>'score')::integer desc,(result->>'objectsPlaced')::integer desc,received_at,id) rn
   from tower_economy.runs r where mode='daily' and ruleset='v3' and status='accepted' and coin_eligible and (result->>'objectsPlaced')::integer>=5
  ),ordered as(select *,row_number() over(order by (result->>'heightCentimeters')::integer desc,(result->>'score')::integer desc,(result->>'objectsPlaced')::integer desc,received_at,user_id) place from best where rn=1)
  select coalesce(jsonb_agg(jsonb_build_object('userId',o.user_id,'rank',place,'name',w.public_name,'height',(result->>'height')::numeric,'score',(result->>'score')::integer,'points',0,'wins',0,'firstReceivedAt',received_at,'aidsUsed',coalesce(result->'aidsUsed','[]'),'coins',0,'items','{}'::jsonb) order by place),'[]') into v_result from ordered o join tower_economy.wallets w on w.user_id=o.user_id;return v_result;
 elsif p_kind='weekly' then
  if p_start<(select weekly_start from tower_economy.release_settings) then return '[]';end if;
  select economic_rules into rules from tower_economy.periods where kind='weekly' and start_day=p_start;rules:=coalesce(rules,tower_economy.v4_rules());
  with days as(select distinct day from tower_economy.runs where mode='daily' and status='accepted' and coin_eligible and ruleset='v3' and day>=p_start and day<p_start+7),
  daily as (
   select day,e,(e->>'userId')::uuid uid,(e->>'points')::integer points,(e->>'wins')::integer wins,(e->>'height')::numeric height,(e->>'firstReceivedAt')::timestamptz received
   from days cross join lateral jsonb_array_elements(coalesce((select entries from tower_economy.periods where kind='daily' and start_day=day and status='settled'),tower_economy.entries('daily',day)))e
  ),chosen as(select *,row_number() over(partition by uid order by points desc,wins desc,height desc,received,day) rn from daily),
  totals as(select uid,sum(points)::integer points,sum(wins)::integer wins,max(height) height,min(received) received,jsonb_agg(day order by day) counted_days from chosen where rn<=3 group by uid),
  ordered as(select *,row_number() over(order by points desc,wins desc,height desc,received,uid) place,count(*) over() n from totals)
  select coalesce(jsonb_agg(jsonb_build_object('userId',o.uid,'rank',place,'name',w.public_name,'height',height,'score',0,'points',points,'wins',wins,'firstReceivedAt',received,'countedDays',counted_days,'aidsUsed','[]'::jsonb,'items','{}'::jsonb,'coins',case when n>=coalesce((rules->>'minimumParticipants')::integer,20) and place<=25 then (rules->'weeklyPrizes'->>(case when place<=3 then place::integer-1 when place<=10 then 3 else 4 end))::integer else 0 end) order by place),'[]') into v_result from ordered o join tower_economy.wallets w on w.user_id=o.uid;
  return v_result;
 end if;return '[]';
end;$$;
alter function tower_economy.api(text,uuid,jsonb) rename to api_v3;
create function tower_economy.api(p_action text,p_user uuid,p_data jsonb default '{}') returns jsonb language plpgsql set search_path='' as $$
declare r tower_economy.runs%rowtype;p tower_economy.progress%rowtype;m tower_economy.mission_progress%rowtype;b tower_economy.badge_catalog%rowtype;c tower_economy.promo_campaigns%rowtype;
 v_now timestamptz:=clock_timestamp();d date:=(v_now at time zone 'UTC')::date;v_result jsonb;v_entries jsonb;v_own jsonb;v_metrics jsonb;v_completed jsonb:='[]';v_ach jsonb;v_oldach jsonb;
 v_amount integer:=0;v_kind text;v_start date;v_end timestamptz;v_exists boolean;v_aid text;v_days date[];v_streak integer;v_objects text[];v_n integer;v_claim uuid;v_rules jsonb;v_state text;v_uid uuid;v_request uuid;
begin
 if p_action='settle' then return to_jsonb(tower_economy.settle(case when p_data ? 'periods' then array(select jsonb_array_elements_text(p_data->'periods')) else array['daily','weekly','monthly'] end));end if;
 if p_action='claim-job' then
  v_result:=tower_economy.api_v3(p_action,p_user,p_data);if v_result='null' then return v_result;end if;
  return v_result||jsonb_build_object('aidRulesVersion',(select aid_rules_version from tower_economy.runs where id=(v_result->>'id')::uuid));
 elsif p_action='verify-run' then
  select * into r from tower_economy.runs where id=(p_data->>'runId')::uuid;
  if not found then return 'null';end if;
  -- The legacy verifier locks owner and referral wallets in canonical UUID order.
  v_result:=tower_economy.api_v3(p_action,p_user,p_data);
  if v_result='null' or r.status<>'validating' or r.economy_version<>4 then return v_result;end if;
  select * into p from tower_economy.progress where user_id=r.user_id for update;v_oldach:=p.achievements;
  if r.coin_eligible or not tower_economy.is_google(r.user_id) then
   update tower_economy.mission_progress set total_objects=total_objects+(v_result->'result'->>'objectsPlaced')::integer,
    qualifying_daily=qualifying_daily+case when r.mode='daily' and (v_result->'result'->>'objectsPlaced')::integer>=5 then 1 else 0 end where user_id=r.user_id and day=r.day returning * into m;
   if m.total_objects>=25 and not 'daily-objects'=any(m.claimed) then v_completed:=v_completed||'"daily-objects"'::jsonb;end if;
   if m.qualifying_daily>=2 and not 'daily-two'=any(m.claimed) then v_completed:=v_completed||'"daily-two"'::jsonb;end if;
   if r.coin_eligible then
    select least(jsonb_array_length(v_completed)*2,greatest(0,10-missions)) into v_amount from tower_economy.daily_limits where user_id=r.user_id and day=r.day for update;
    if v_amount>0 then perform tower_economy.apply_event(r.user_id,'missions-extra:'||r.id,'daily-missions',v_amount);end if;
    update tower_economy.daily_limits set missions=missions+v_amount where user_id=r.user_id and day=r.day;
   end if;
   update tower_economy.mission_progress set claimed=claimed||array(select jsonb_array_elements_text(v_completed)) where user_id=r.user_id and day=r.day;
   v_metrics:=p.badge_metrics||jsonb_build_object(
    'objectsPlaced',greatest(coalesce((p.badge_metrics->>'objectsPlaced')::integer,0),(v_result->'result'->>'objectsPlaced')::integer),
    'height',greatest(coalesce((p.badge_metrics->>'height')::numeric,0),(v_result->'result'->>'height')::numeric),
    'maxPerfectCombo',greatest(coalesce((p.badge_metrics->>'maxPerfectCombo')::integer,0),coalesce((v_result->'result'->>'maxPerfectCombo')::integer,0)),
    'totalPerfect',coalesce((p.badge_metrics->>'totalPerfect')::integer,0)+(v_result->'result'->>'perfectDrops')::integer,
    'totalObjects',coalesce((p.badge_metrics->>'totalObjects')::integer,0)+(v_result->'result'->>'objectsPlaced')::integer,
    'qualifyingRuns',coalesce((p.badge_metrics->>'qualifyingRuns')::integer,0)+case when (v_result->'result'->>'objectsPlaced')::integer>=5 then 1 else 0 end,
    'rockets',coalesce((p.badge_metrics->>'rockets')::integer,0)+(select count(*) from jsonb_array_elements_text(coalesce(v_result->'result'->'objectIds','[]'))o where o='rocket'));
   select coalesce(array_agg(distinct o order by o),'{}') into v_objects from unnest(p.badge_objects||array(select jsonb_array_elements_text(coalesce(v_result->'result'->'objectIds','[]'))))o;
   v_days:=p.badge_days;
   if r.mode='daily' and (v_result->'result'->>'objectsPlaced')::integer>=5 then select array_agg(distinct x order by x) into v_days from unnest(v_days||r.day)x;end if;
   with numbered as(select x,x-row_number() over(order by x)::integer g from unnest(v_days)x),islands as(select count(*) n from numbered group by g)select coalesce(max(n),0)::integer into v_streak from islands;
   v_metrics:=v_metrics||jsonb_build_object('uniqueObjects',cardinality(v_objects),'dailyDays',cardinality(v_days),'dailyStreak',v_streak);
   update tower_economy.progress set badge_metrics=v_metrics,badge_objects=v_objects,badge_days=v_days where user_id=r.user_id;
  end if;
  perform tower_economy.refresh_badges(r.user_id);
  select coalesce(jsonb_agg(value),'[]') into v_ach from tower_economy.progress cross join lateral jsonb_array_elements(achievements) where user_id=r.user_id and not v_oldach ? (value#>>'{}');
  update tower_economy.runs set result=result||jsonb_build_object('earnedCoins',coalesce((result->>'earnedCoins')::integer,0)+v_amount,'completedMissions',coalesce(result->'completedMissions','[]')||v_completed,'newAchievements',v_ach) where id=r.id;
  for v_kind in select unnest(array['daily','weekly','monthly','all-time']) loop
   v_start:=case v_kind when 'daily' then r.day when 'weekly' then date_trunc('week',r.day::timestamp)::date when 'monthly' then date_trunc('month',r.day::timestamp)::date else '1970-01-01'::date end;
   if v_kind='daily' and r.mode<>'daily' or v_kind='weekly' and r.mode<>'daily' or v_kind='all-time' and r.mode<>'daily' or v_kind='monthly' and r.mode<>'casual' then continue;end if;
   -- A period already frozen cannot produce a new provisional celebration.
   if exists(select 1 from tower_economy.periods where kind=v_kind and start_day=v_start and status='settled') then continue;end if;
   v_entries:=tower_economy.entries(v_kind,v_start);
   select e into v_own from jsonb_array_elements(v_entries)e where e->>'userId'=r.user_id::text and (e->>'rank')::integer<=3;
   if found then insert into tower_economy.notifications(user_id,period,period_id,final,rank) values(r.user_id,v_kind,v_kind||':'||v_start,false,(v_own->>'rank')::integer) on conflict do nothing;end if;
  end loop;
  return tower_economy.run_state(r.id);
 end if;
 if p_action in('reject-run','retry-run','payment-event','payment-order') then return tower_economy.api_v3(p_action,p_user,p_data);end if;
 perform tower_economy.ensure_account(p_user);
 if p_action='ack-notification' then update tower_economy.notifications set seen_at=v_now where user_id=p_user and id=(p_data->>'id')::uuid;return tower_economy.account_state(p_user);end if;
 if p_action='leaderboard' then
  v_kind:=p_data->>'period';if v_kind not in('daily','weekly','monthly','all-time') then raise exception 'Invalid period';end if;
  v_start:=coalesce(nullif(p_data->>'periodKey','')::date,case v_kind when 'daily' then d when 'weekly' then greatest(date_trunc('week',d::timestamp)::date,(select weekly_start from tower_economy.release_settings)) when 'monthly' then date_trunc('month',d::timestamp)::date else '1970-01-01'::date end);
  if v_kind='weekly' and extract(isodow from v_start)<>1 or v_kind='monthly' and extract(day from v_start)<>1 then raise exception 'Invalid period key';end if;
  v_end:=case v_kind when 'daily' then (v_start+1)::timestamp at time zone 'UTC' when 'weekly' then (v_start+7)::timestamp at time zone 'UTC' when 'monthly' then (v_start+interval '1 month') at time zone 'UTC' else null end;
  select entries,economic_rules into v_entries,v_rules from tower_economy.periods where kind=v_kind and start_day=v_start and status='settled';v_exists:=found;
  if not v_exists then v_entries:=tower_economy.entries(v_kind,v_start);end if;
  v_n:=jsonb_array_length(v_entries);
  v_state:=case when v_kind<>'weekly' then 'none' when v_exists then case when v_n>=20 then 'paid' else 'no-minimum' end when v_now>=v_end then 'settling' when v_n>=20 then 'eligible' else 'locked' end;
  select e-'userId'-'runId'-'firstReceivedAt' into v_own from jsonb_array_elements(v_entries)e where e->>'userId'=p_user::text;
  return jsonb_build_object('period',v_kind,'periodId',v_kind||':'||v_start,'startUTC',case when v_kind='all-time' then null else v_start::timestamp at time zone 'UTC' end,'endUTC',v_end,'settlesAt',v_end+interval '75 minutes','status',case when v_exists then 'settled' else 'open' end,'rewardState',v_state,'minimumParticipants',20,'participants',v_n,'entries',(select coalesce(jsonb_agg(e-'userId'-'runId'-'firstReceivedAt'),'[]') from(select e from jsonb_array_elements(v_entries)e limit 50)q),'ownEntry',v_own);
 end if;
 if p_action='start-run' then
  select * into r from tower_economy.runs where user_id=p_user and request_id=(p_data->>'requestId')::uuid;if found then return tower_economy.ticket(r.id);end if;
  v_kind:=case when p_data->>'mode'='daily' then 'daily' else 'monthly' end;v_start:=case when v_kind='daily' then d else date_trunc('month',d::timestamp)::date end;
  v_exists:=exists(select 1 from tower_economy.periods where kind=v_kind and start_day=v_start);
  v_result:=tower_economy.api_v3(p_action,p_user,p_data||jsonb_build_object('aids','[]'::jsonb));
  update tower_economy.runs set aid_rules_version=2,economy_version=4 where id=(v_result->>'id')::uuid;
  if not v_exists then update tower_economy.periods set badge_catalog_version=2,economic_rules=tower_economy.v4_rules() where kind=v_kind and start_day=v_start;end if;
  if v_kind='daily' and d>=(select weekly_start from tower_economy.release_settings) then
   v_start:=date_trunc('week',d::timestamp)::date;
   insert into tower_economy.periods(kind,start_day,end_at,catalog,ruleset,economic_rules,badge_catalog_version) values('weekly',v_start,(v_start+7)::timestamp at time zone 'UTC',v_result->>'catalog','v3',tower_economy.v4_rules(),2) on conflict do nothing;
  end if;
  return tower_economy.ticket((v_result->>'id')::uuid);
 end if;
 if p_action in('claim-badge','redeem-code','use-aid','paypal-order','paypal-attach','paypal-find','paypal-capture') and not tower_economy.is_google(p_user) then raise exception 'Google account required';end if;
 if p_action='use-aid' then
  select * into r from tower_economy.runs where id=(p_data->>'runId')::uuid and user_id=p_user for update;
  if not found then raise exception 'Run not found';end if;
  if r.aid_rules_version=1 then return tower_economy.api_v3(p_action,p_user,p_data);end if;
  if exists(select 1 from tower_economy.aid_uses where user_id=p_user and request_id=(p_data->>'requestId')::uuid) then return tower_economy.api_v2(p_action,p_user,p_data);end if;
  v_aid:=p_data->>'id';
  if v_aid not in('guide-5','guide-10','preview','focus','skip','second-chance') or r.status<>'started' or r.expires_at<=v_now then raise exception 'Aid unavailable';end if;
  if (select count(*) from tower_economy.aid_uses where run_id=r.id)>=2 then raise exception 'Aid limit reached';end if;
  if v_aid in('guide-5','guide-10') and exists(select 1 from tower_economy.aid_uses where run_id=r.id and aid in('guide-5','guide-10')) then raise exception 'Guides cannot be combined';end if;
  if exists(select 1 from tower_economy.aid_uses where run_id=r.id and aid=v_aid) then raise exception 'Aid already used';end if;
  if not exists(select 1 from tower_economy.inventory where user_id=p_user and item=v_aid and quantity>0) then
   if v_aid<>'second-chance' then raise exception 'Aid unavailable';end if;
   perform tower_economy.apply_event(p_user,'revive-buy:'||r.id,'aid-purchase',-90,jsonb_build_object(v_aid,1));
  end if;
  update tower_economy.runs set aids=array_append(aids,v_aid),paid_aids=array_append(paid_aids,v_aid) where id=r.id;
  return tower_economy.api_v2(p_action,p_user,p_data);
 elsif p_action='claim-badge' then
  select * into b from tower_economy.badge_catalog where id=p_data->>'id' and tier in('silver','gold');if not found then raise exception 'Invalid badge';end if;
  if coalesce((select (badge_metrics->>b.metric)::numeric from tower_economy.progress where user_id=p_user),0)<b.target then raise exception 'Badge not earned';end if;
  if not exists(select 1 from tower_economy.badge_claims where user_id=p_user and id=b.id) then
   perform tower_economy.apply_event(p_user,'badge:'||b.id,'badge-reward',b.coins,b.items);insert into tower_economy.badge_claims values(p_user,b.id,v_now);
  end if;return tower_economy.account_state(p_user);
 elsif p_action='redeem-code' then
  v_request:=(p_data->>'requestId')::uuid;
  select campaign_id into v_claim from tower_economy.promo_redemptions where user_id=p_user and request_id=v_request;
  if found then
   if exists(select 1 from tower_economy.promo_campaigns where id=v_claim and code=upper(trim(p_data->>'code'))) then return tower_economy.account_state(p_user);end if;
   return jsonb_build_object('error','Solicitud ya utilizada.');
  end if;
  insert into tower_economy.promo_attempts values(p_user,v_now,1) on conflict(user_id) do update set window_start=case when promo_attempts.window_start<v_now-interval '1 minute' then v_now else promo_attempts.window_start end,count=case when promo_attempts.window_start<v_now-interval '1 minute' then 1 else promo_attempts.count+1 end returning count into v_n;
  if v_n>10 then return jsonb_build_object('error','Esperá un minuto para volver a canjear.');end if;
  select * into c from tower_economy.promo_campaigns where code=upper(trim(p_data->>'code')) for update;
  if not found then return jsonb_build_object('error','Código inválido.');end if;
  if exists(select 1 from tower_economy.promo_redemptions where user_id=p_user and campaign_id=c.id) then return jsonb_build_object('error','Ya canjeaste este código.');end if;
  if not c.active or c.starts_at>v_now then return jsonb_build_object('error','Código no disponible.');end if;
  if c.expires_at<=v_now then return jsonb_build_object('error','Código vencido.');end if;
  if c.redeemed>=c.max_redemptions then return jsonb_build_object('error','Código agotado.');end if;
  perform tower_economy.apply_event(p_user,'promo:'||c.id,'promo-code',c.coins);
  insert into tower_economy.promo_redemptions(user_id,campaign_id,request_id) values(p_user,c.id,v_request);
  update tower_economy.promo_campaigns set redeemed=redeemed+1 where id=c.id;return tower_economy.account_state(p_user);
 elsif p_action in('paypal-order','paypal-attach','paypal-find','paypal-capture') then return tower_economy.api_v2(p_action,p_user,p_data);
 end if;
 return tower_economy.api_v3(p_action,p_user,p_data);
end;$$;

alter function tower_economy.settle(text[]) rename to settle_v3;
create function tower_economy.settle(p_kinds text[] default array['daily','weekly','monthly']) returns integer language plpgsql set search_path='' set statement_timeout='15s' as $$
declare n integer:=0;r record;e jsonb;v_entries jsonb;v_uid uuid;
begin
 if not p_kinds <@ array['daily','weekly','monthly'] then raise exception 'Invalid period';end if;
 if not pg_try_advisory_xact_lock(726163986) then return 0;end if;
 -- Lock every affected wallet globally before delegating or crediting a prize.
 -- This also covers notifications/podios, preventing lock-order inversion with replay/referrals.
 for v_uid in
  with due as(select * from tower_economy.periods p where (status='open' and kind=any(p_kinds) and end_at+interval '75 minutes'<=clock_timestamp()) or (status='settled' and not podium_processed)),
  accounts as(select user_id uid from tower_economy.runs where status in('pending','validating') and (received_at+interval '10 minutes'<=clock_timestamp() or ((day+1)::timestamp at time zone 'UTC')+interval '75 minutes'<=clock_timestamp())
   union select (entry->>'userId')::uuid from due p cross join lateral jsonb_array_elements(case when p.status='settled' then p.entries else tower_economy.entries(p.kind,p.start_day) end)entry where (entry->>'rank')::integer<=25)
  select uid from accounts order by uid
 loop perform pg_advisory_xact_lock(hashtextextended(v_uid::text,2));end loop;
 -- Keep existing compensation and frozen economic rules. Daily must settle first.
 n:=tower_economy.settle_v3(array(select x from unnest(p_kinds)x where x in('daily','monthly')));
 for r in select * from tower_economy.periods p where status='open' and kind='weekly' and kind=any(p_kinds) and end_at+interval '75 minutes'<=clock_timestamp()
  and not exists(select 1 from tower_economy.periods d where d.kind='daily' and d.status='open' and d.start_day>=p.start_day and d.end_at<=p.end_at) order by start_day limit 3 for update
 loop
  v_entries:=tower_economy.entries(r.kind,r.start_day);
  for v_uid in select (value->>'userId')::uuid from jsonb_array_elements(v_entries) where (value->>'rank')::integer<=25 order by (value->>'userId')::uuid loop perform pg_advisory_xact_lock(hashtextextended(v_uid::text,2));end loop;
  for e in select value from jsonb_array_elements(v_entries) where (value->>'coins')::integer>0 loop perform tower_economy.apply_event((e->>'userId')::uuid,'prize:weekly:'||r.start_day,'ranking-weekly',(e->>'coins')::integer);end loop;
  update tower_economy.periods set status='settled',entries=v_entries,settled_at=clock_timestamp() where kind=r.kind and start_day=r.start_day;n:=n+1;
 end loop;
 for r in select * from tower_economy.periods where status='settled' and not podium_processed order by end_at,kind for update loop
  for v_uid in select (value->>'userId')::uuid from jsonb_array_elements(r.entries) where (value->>'rank')::integer<=3 order by (value->>'userId')::uuid loop perform pg_advisory_xact_lock(hashtextextended(v_uid::text,2));end loop;
  for e in select value from jsonb_array_elements(r.entries) where (value->>'rank')::integer<=3 loop
   insert into tower_economy.notifications(user_id,period,period_id,final,rank,coins,minimum_met) values((e->>'userId')::uuid,r.kind,r.kind||':'||r.start_day,true,(e->>'rank')::integer,(e->>'coins')::integer,jsonb_array_length(r.entries)>=20) on conflict do nothing;
   if r.badge_catalog_version=2 and r.kind in('weekly','monthly') then
    update tower_economy.progress set badge_metrics=jsonb_set(badge_metrics,array[case r.kind when 'weekly' then 'weeklyPodium' else 'monthlyPodium' end],to_jsonb(coalesce((badge_metrics->>(case r.kind when 'weekly' then 'weeklyPodium' else 'monthlyPodium' end))::integer,0)+1)) where user_id=(e->>'userId')::uuid;
    perform tower_economy.refresh_badges((e->>'userId')::uuid);
   end if;
  end loop;
  update tower_economy.periods set podium_processed=true where kind=r.kind and start_day=r.start_day;
 end loop;
 -- Legacy monthly code may have written an old badge; the new catalogue is authoritative.
 update tower_economy.progress set achievements=(select coalesce(jsonb_agg(b.id),'[]') from tower_economy.badge_catalog b where coalesce((badge_metrics->>b.metric)::numeric,0)>=b.target) where achievements ? 'monthly-podium';
 return n;
end;$$;

-- Administrative campaign operations are intentionally unavailable to game accounts.
create function tower_economy.promo_admin(p_action text,p_data jsonb) returns jsonb language plpgsql set search_path='' as $$
declare c tower_economy.promo_campaigns%rowtype;
begin
 if p_action='create' then
  insert into tower_economy.promo_campaigns(company,code,coins,starts_at,expires_at,max_redemptions)
  values(p_data->>'company',upper(trim(p_data->>'code')),(p_data->>'coins')::integer,(p_data->>'startsAt')::timestamptz,(p_data->>'expiresAt')::timestamptz,(p_data->>'maxRedemptions')::integer) returning * into c;
  return to_jsonb(c)||jsonb_build_object('maximumCoinEmission',c.coins::bigint*c.max_redemptions);
 elsif p_action in('pause','resume') then
  update tower_economy.promo_campaigns set active=p_action='resume' where code=upper(trim(p_data->>'code')) returning * into c;
  if not found then raise exception 'Unknown campaign';end if;return to_jsonb(c);
 elsif p_action='list' then return coalesce((select jsonb_agg(to_jsonb(campaign)||jsonb_build_object('maximumCoinEmission',campaign.coins::bigint*campaign.max_redemptions,'coinsRedeemed',campaign.coins::bigint*campaign.redeemed)) from tower_economy.promo_campaigns campaign),'[]');
 end if;raise exception 'Unknown admin operation';
end;$$;
create function public.tower_promo_admin(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select tower_economy.promo_admin(p_action,p_data)$$;
revoke all on function public.tower_promo_admin(text,jsonb) from public,anon,authenticated;
grant execute on function public.tower_promo_admin(text,jsonb) to service_role;

alter table tower_economy.release_settings enable row level security;
alter table tower_economy.badge_catalog enable row level security;
alter table tower_economy.badge_claims enable row level security;
alter table tower_economy.notifications enable row level security;
alter table tower_economy.promo_campaigns enable row level security;
alter table tower_economy.promo_redemptions enable row level security;
alter table tower_economy.promo_attempts enable row level security;
revoke all on all tables in schema tower_economy from public,anon,authenticated;
revoke all on all functions in schema tower_economy from public,anon,authenticated;
grant all on all tables in schema tower_economy to service_role;
grant execute on all functions in schema tower_economy to service_role;
commit;
