begin;
create schema tower_economy;
revoke all on schema tower_economy from public, anon, authenticated;
grant usage on schema tower_economy to service_role;
grant usage on schema auth to service_role;
grant select(id,email,email_confirmed_at) on auth.users to service_role;

create table tower_economy.wallets (
 user_id uuid primary key, balance bigint not null default 0 check (balance between -1000000000 and 1000000000),
 public_name text not null default 'Anónimo', best_height numeric not null default 0,
 created_at timestamptz not null default clock_timestamp()
);
create table tower_economy.inventory (user_id uuid not null references tower_economy.wallets, item text not null, quantity integer not null default 0 check(quantity >= 0), primary key(user_id,item));
create table tower_economy.ledger (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references tower_economy.wallets,
 operation_key text not null, source text not null, coins bigint not null, items jsonb not null default '{}',
 created_at timestamptz not null default clock_timestamp(), unique(user_id,operation_key)
);
create table tower_economy.daily_limits (
 user_id uuid not null references tower_economy.wallets, day date not null,
 gameplay integer not null default 0 check(gameplay between 0 and 300), missions integer not null default 0 check(missions between 0 and 25),
 record_bonus boolean not null default false, bonus_claims integer not null default 0 check(bonus_claims between 0 and 3), qualifying_runs integer not null default 0, perfect_drops integer not null default 0,
 primary key(user_id,day)
);
create table tower_economy.runs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references tower_economy.wallets, request_id uuid not null,
 mode text not null check(mode in('casual','daily')), seed text not null, catalog text not null default 'extended-24' check(catalog in('legacy-18','extended-24','extended-30')), ruleset text not null default 'v2' check(ruleset='v2'),
 day date not null, aids text[] not null default '{}', paid_aids text[] not null default '{}', ad_aids text[] not null default '{}',
 started_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 status text not null default 'started' check(status in('started','pending','validating','accepted','rejected','verification_timeout')),
 events jsonb, final_tick integer check(final_tick between 1 and 144000), received_at timestamptz, verified_at timestamptz,
 attempts integer not null default 0, lease_until timestamptz, worker_id uuid, result jsonb, error text,
 unique(user_id,request_id), check(cardinality(aids)<=2), check(not(aids @> array['guide-5','guide-10'])),
 check(aids <@ array['guide-5','guide-10','preview','focus','skip','second-chance'])
);
create table tower_economy.aid_uses (run_id uuid not null references tower_economy.runs, user_id uuid not null, aid text not null, tick integer not null check(tick between 0 and 144000), request_id uuid not null, paid boolean not null, primary key(run_id,aid),unique(user_id,request_id));
create table tower_economy.cosmetics (user_id uuid not null references tower_economy.wallets, item text not null, primary key(user_id,item));
create index runs_validation on tower_economy.runs(status,received_at);
create index runs_daily on tower_economy.runs(day,mode,user_id) where status='accepted';
create table tower_economy.ad_intents (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references tower_economy.wallets,
 reward text not null check(reward in('coin-bonus','double-coins','second-chance')), run_id uuid references tower_economy.runs,
 expires_at timestamptz not null default clock_timestamp()+interval '5 minutes', completed_at timestamptz, redeemed_at timestamptz,
 created_at timestamptz not null default clock_timestamp()
);
create index ad_owner on tower_economy.ad_intents(user_id,created_at);
create table tower_economy.periods (
 kind text not null check(kind in('daily','weekly','monthly')), start_day date not null, end_at timestamptz not null,
 catalog text check(catalog in('legacy-18','extended-24','extended-30')), status text not null default 'open' check(status in('open','settled')), entries jsonb not null default '[]', settled_at timestamptz,
 primary key(kind,start_day)
);
create table tower_economy.orders (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references tower_economy.wallets, request_id uuid not null,
 pack_id text not null check(pack_id in('small','medium','large')), coins integer not null, amount_cents integer not null, currency text not null default 'USD',
 provider_id text unique, capture_id text unique, status text not null default 'created' check(status in('created','paid','refunded','reversed')),
 refunded_cents integer not null default 0, reversed_coins integer not null default 0, approval_url text,
 adult_confirmed_at timestamptz not null, created_at timestamptz not null default clock_timestamp(), unique(user_id,request_id)
);
create table tower_economy.payment_events (event_id text primary key, order_id uuid not null references tower_economy.orders, created_at timestamptz not null default clock_timestamp());

create function tower_economy.immutable_ledger() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'Ledger is immutable'; end; $$;
create trigger immutable_ledger before update or delete on tower_economy.ledger for each row execute function tower_economy.immutable_ledger();

create function tower_economy.apply_event(p_user uuid,p_key text,p_source text,p_coins bigint,p_items jsonb default '{}',p_allow_debt boolean default false)
returns boolean language plpgsql set search_path='' as $$
declare v_item record; v_balance bigint;
begin
 select balance into v_balance from tower_economy.wallets where user_id=p_user for update;
 if not found then raise exception 'Account missing'; end if;
 if exists(select 1 from tower_economy.ledger where user_id=p_user and operation_key=p_key) then
  if not exists(select 1 from tower_economy.ledger where user_id=p_user and operation_key=p_key and coins=p_coins and items=p_items and source=p_source) then raise exception 'Request already used';end if;
  return false;
 end if;
 if jsonb_typeof(p_items)<>'object' or p_coins is null then raise exception 'Invalid ledger event'; end if;
 if not p_allow_debt and v_balance+p_coins<0 and (p_coins<0 or exists(select 1 from jsonb_each_text(p_items) where value::integer<0)) then raise exception 'Insufficient coins'; end if;
 for v_item in select key,value from jsonb_each_text(p_items) loop
  if v_item.key not in('guide-5','guide-10','preview','focus','skip','second-chance') or v_item.value !~ '^-?[0-9]+$' then raise exception 'Invalid inventory event'; end if;
  insert into tower_economy.inventory(user_id,item,quantity) values(p_user,v_item.key,0) on conflict do nothing;
  update tower_economy.inventory set quantity=quantity+v_item.value::integer where user_id=p_user and item=v_item.key;
 end loop;
 update tower_economy.wallets set balance=balance+p_coins where user_id=p_user;
 insert into tower_economy.ledger(user_id,operation_key,source,coins,items) values(p_user,p_key,p_source,p_coins,p_items);
 return true;
end; $$;

create function tower_economy.ensure_account(p_user uuid) returns void language plpgsql set search_path='' as $$
begin
 if p_user is null or not exists(select 1 from auth.users where id=p_user) then raise exception 'Authentication required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,2));
 insert into tower_economy.wallets(user_id) values(p_user) on conflict do nothing;
 if exists(select 1 from auth.users where id=p_user and email is not null and email_confirmed_at is not null) then perform tower_economy.apply_event(p_user,'starter:v2','starter',100);end if;
 insert into tower_economy.daily_limits(user_id,day) values(p_user,(clock_timestamp() at time zone 'UTC')::date) on conflict do nothing;
end; $$;

create function tower_economy.account_state(p_user uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('balance',w.balance,'recoverable',exists(select 1 from auth.users u where u.id=w.user_id and u.email_confirmed_at is not null and u.email is not null),
 'onlineCosmetics',coalesce((select jsonb_agg(item) from tower_economy.cosmetics where user_id=p_user),'[]'),'inventory',coalesce((select jsonb_object_agg(item,quantity) from tower_economy.inventory where user_id=p_user),'{}'),
 'gameplayEarned',coalesce(d.gameplay,0),'missionEarned',coalesce(d.missions,0),'adBonusClaims',coalesce(d.bonus_claims,0),
 'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'source',q.source,'coins',q.coins,'items',q.items,'createdAt',q.created_at) order by q.created_at desc) from (select * from tower_economy.ledger where user_id=p_user order by created_at desc limit 30)q),'[]'))
 from tower_economy.wallets w left join tower_economy.daily_limits d on d.user_id=w.user_id and d.day=(now() at time zone 'UTC')::date where w.user_id=p_user;
$$;
create function tower_economy.ticket(p_run uuid) returns jsonb language sql stable set search_path='' as $$ select jsonb_build_object('id',id,'mode',mode,'seed',seed,'catalog',catalog,'ruleset',ruleset,'startedAt',started_at,'expiresAt',expires_at,'aids',aids) from tower_economy.runs where id=p_run; $$;
create function tower_economy.run_state(p_run uuid) returns jsonb language sql stable set search_path='' as $$ select jsonb_build_object('id',id,'status',status,'error',error,'result',result) from tower_economy.runs where id=p_run; $$;

create function tower_economy.prize(p_kind text,p_rank integer,p_n integer) returns jsonb language plpgsql immutable set search_path='' as $$
declare v_slots integer;v_coins integer;v_items jsonb:='{}';v_band integer;
begin
 v_slots:=case when p_n<5 then 0 when p_n<10 then 1 when p_n<25 then 3 when p_n<100 then 10 else 25 end;
 if p_rank<1 or p_rank>v_slots then return jsonb_build_object('coins',0,'items',v_items); end if;
 v_band:=case when p_rank<=3 then p_rank when p_rank<=10 then 4 else 5 end;
 v_coins:=case p_kind when 'daily' then (array[60,40,25,10,5])[v_band] when 'weekly' then (array[200,140,100,40,15])[v_band] when 'monthly' then (array[600,400,250,100,35])[v_band] else 0 end;
 if p_kind='daily' then v_items:=case p_rank when 1 then '{"guide-5":1}'::jsonb when 2 then '{"preview":1}'::jsonb else '{}'::jsonb end;
 elsif p_kind='weekly' then v_items:=case when p_rank=1 then '{"guide-10":1,"focus":1}'::jsonb when p_rank=2 then '{"guide-10":1}'::jsonb when p_rank=3 then '{"guide-5":1}'::jsonb when p_rank<=10 then '{"preview":1}'::jsonb else '{}'::jsonb end;
 elsif p_kind='monthly' then v_items:=case when p_rank=1 then '{"guide-10":3,"focus":2}'::jsonb when p_rank=2 then '{"guide-10":2,"focus":1}'::jsonb when p_rank=3 then '{"guide-10":1}'::jsonb when p_rank<=10 then '{"guide-5":1}'::jsonb else '{}'::jsonb end; end if;
 return jsonb_build_object('coins',v_coins,'items',v_items);
end; $$;

create function tower_economy.entries(p_kind text,p_start date) returns jsonb language plpgsql stable set search_path='' as $$
declare v_result jsonb;v_end date;v_days integer;v_min integer;
begin
 if p_kind='daily' then
  with best as (
   select r.*, row_number() over(partition by r.user_id order by (r.result->>'heightCentimeters')::integer desc,(r.result->>'score')::integer desc,(r.result->>'objectsPlaced')::integer desc,r.received_at,r.id) as rn
   from tower_economy.runs r join auth.users u on u.id=r.user_id
   where r.day=p_start and r.mode='daily' and r.status='accepted' and (r.result->>'objectsPlaced')::integer>=5 and u.email_confirmed_at is not null and u.email is not null
  ), ordered as (
   select b.*,row_number() over(order by (result->>'heightCentimeters')::integer desc,(result->>'score')::integer desc,(result->>'objectsPlaced')::integer desc,received_at,user_id) as place,count(*) over() as n from best b where rn=1
  ) select coalesce(jsonb_agg(jsonb_build_object('userId',o.user_id,'runId',o.id,'rank',o.place,'name',w.public_name,'height',((o.result->>'heightCentimeters')::numeric/100),'score',(o.result->>'score')::integer,'points',case when n=1 then 10 else round(10+90.0*(n-place)/(n-1))::integer end,'wins',case when place=1 and n>=2 then 1 else 0 end,'objectsPlaced',(o.result->>'objectsPlaced')::integer,'firstReceivedAt',o.received_at,'aidsUsed',coalesce(o.result->'aidsUsed','[]'))||tower_economy.prize(p_kind,place::integer,n::integer) order by place),'[]') into v_result from ordered o join tower_economy.wallets w on w.user_id=o.user_id;
 else
  v_end:=case when p_kind='weekly' then p_start+7 else (p_start+interval '1 month')::date end;
  v_days:=case when p_kind='weekly' then 5 else 20 end;v_min:=case when p_kind='weekly' then 3 else 10 end;
  with daily as (
   select p.start_day,e,(e->>'userId')::uuid as user_id,(e->>'points')::integer as points,(e->>'wins')::integer as wins,(e->>'firstReceivedAt')::timestamptz as received
   from tower_economy.periods p cross join lateral jsonb_array_elements(p.entries)e
   where p.kind='daily' and p.status='settled' and p.start_day>=p_start and p.start_day<v_end
  ), chosen as (
   select *,row_number() over(partition by user_id order by points desc,wins desc,received,start_day) as rn,count(*) over(partition by user_id) as played from daily
  ), totals as (
   select user_id,sum(points)::integer as points,sum(wins)::integer as wins,max(received) as last_received,jsonb_agg(start_day order by start_day) as counted_days from chosen where rn<=v_days and played>=v_min group by user_id
  ), ordered as (
   select *,row_number() over(order by points desc,wins desc,last_received,user_id) as place,count(*) over() as n from totals
  ) select coalesce(jsonb_agg(jsonb_build_object('userId',o.user_id,'rank',o.place,'name',w.public_name,'height',0,'score',0,'points',o.points,'wins',o.wins,'firstReceivedAt',o.last_received,'countedDays',o.counted_days,'aidsUsed','[]'::jsonb)||tower_economy.prize(p_kind,place::integer,n::integer) order by place),'[]') into v_result from ordered o join tower_economy.wallets w on w.user_id=o.user_id;
 end if;
 return v_result;
end; $$;

create function tower_economy.settle(p_kinds text[] default array['daily','weekly','monthly']) returns integer language plpgsql set search_path='' set statement_timeout='8s' as $$
declare v_run record;v_period record;v_entry jsonb;v_entries jsonb;v_refund jsonb;v_count integer:=0;
begin
 if not p_kinds <@ array['daily','weekly','monthly'] then raise exception 'Unknown ranking period';end if;
 if not pg_try_advisory_xact_lock(726163986) then return 0;end if;
 for v_run in select * from tower_economy.runs where status in('pending','validating') and (clock_timestamp()>=received_at+interval '10 minutes' or clock_timestamp()>=((day+1)::timestamp at time zone 'UTC')+interval '75 minutes') order by received_at limit 100 loop
  perform pg_advisory_xact_lock(hashtextextended(v_run.user_id::text,2));
  if not exists(select 1 from tower_economy.runs where id=v_run.id and status in('pending','validating') for update) then continue;end if;
  select coalesce(jsonb_object_agg(a,1),'{}') into v_refund from (select aid as a from tower_economy.aid_uses where run_id=v_run.id and paid)q;
  perform tower_economy.apply_event(v_run.user_id,'timeout:'||v_run.id,'infrastructure-compensation',0,v_refund);
  update tower_economy.runs set status='verification_timeout',error='Verification unavailable',worker_id=null,lease_until=null where id=v_run.id;
 end loop;
 update tower_economy.runs set status='rejected',error='Ticket expired' where id in(select id from tower_economy.runs where status='started' and expires_at<=clock_timestamp() order by expires_at limit 100);
 for v_period in select p.* from tower_economy.periods p where p.status='open' and p.kind=any(p_kinds) and p.end_at+interval '75 minutes'<=clock_timestamp() and (p.kind='daily' or not exists(select 1 from tower_economy.periods d where d.kind='daily' and d.status='open' and d.start_day>=p.start_day and d.end_at<=p.end_at)) order by case p.kind when 'daily' then 0 when 'weekly' then 1 else 2 end,p.start_day limit 3 for update loop
  v_entries:=tower_economy.entries(v_period.kind,v_period.start_day);
  for v_entry in select value from jsonb_array_elements(v_entries) where (value->>'rank')::integer<=25 loop
   if (v_entry->>'coins')::integer>0 or v_entry->'items'<>'{}'::jsonb then
    perform tower_economy.apply_event((v_entry->>'userId')::uuid,'prize:'||v_period.kind||':'||v_period.start_day,'ranking-'||v_period.kind,(v_entry->>'coins')::integer,v_entry->'items');
   end if;
  end loop;
  update tower_economy.periods set status='settled',entries=v_entries,settled_at=clock_timestamp() where kind=v_period.kind and start_day=v_period.start_day;
  v_count:=v_count+1;
 end loop;
 return v_count;
end; $$;

create function tower_economy.api(p_action text,p_user uuid,p_data jsonb default '{}') returns jsonb language plpgsql set search_path='' as $$
declare v_now timestamptz:=clock_timestamp();v_day date:=(v_now at time zone 'UTC')::date;v_run tower_economy.runs%rowtype;v_intent tower_economy.ad_intents%rowtype;v_order tower_economy.orders%rowtype;
 v_limits tower_economy.daily_limits%rowtype;v_id uuid;v_aids text[];v_items jsonb;v_price integer;v_kind text;v_start date;v_end timestamptz;v_entries jsonb;v_result jsonb;v_amount integer;v_base integer;v_mission integer;v_key text;v_n integer;v_own jsonb;v_use tower_economy.aid_uses%rowtype;v_catalog text;v_record integer;v_baseline integer;
begin
 if p_action='settle' then return to_jsonb(tower_economy.settle(case when p_data ? 'periods' then array(select jsonb_array_elements_text(p_data->'periods')) else array['daily','weekly','monthly'] end)); end if;
 if p_action='claim-job' then
  select * into v_run from tower_economy.runs where (status='pending' or(status='validating' and lease_until<v_now)) and attempts<3 and received_at+interval '10 minutes'>v_now and ((day+1)::timestamp at time zone 'UTC')+interval '75 minutes'>v_now order by received_at for update skip locked limit 1;
  if not found then return 'null'; end if;
  v_id:=gen_random_uuid();update tower_economy.runs set status='validating',attempts=attempts+1,lease_until=v_now+interval '3 minutes',worker_id=v_id where id=v_run.id;
  return jsonb_build_object('id',v_run.id,'userId',v_run.user_id,'mode',v_run.mode,'seed',v_run.seed,'catalog',v_run.catalog,'ruleset',v_run.ruleset,'aids',v_run.aids,'authorizedAids',coalesce((select jsonb_agg(jsonb_build_object('id',aid,'tick',tick)) from tower_economy.aid_uses where run_id=v_run.id),'[]'),'startedAt',v_run.started_at,'receivedAt',v_run.received_at,'events',v_run.events,'finalTick',v_run.final_tick,'workerId',v_id);
 end if;
 if p_action in('verify-run','reject-run','retry-run') then
  select user_id into v_id from tower_economy.runs where id=(p_data->>'runId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(v_id::text,2));
  select * into v_run from tower_economy.runs where id=(p_data->>'runId')::uuid and worker_id=(p_data->>'workerId')::uuid and status='validating' for update;
  if not found then return 'null'; end if;
  if p_action='retry-run' then update tower_economy.runs set status='pending',lease_until=null,worker_id=null where id=v_run.id;return 'null';end if;
  if p_action='reject-run' then update tower_economy.runs set status='rejected',error='Invalid replay',worker_id=null where id=v_run.id;return tower_economy.run_state(v_run.id);end if;
  if v_now>=v_run.received_at+interval '10 minutes' or v_now>=((v_run.day+1)::timestamp at time zone 'UTC')+interval '75 minutes' then return 'null';end if;
  v_result:=p_data->'result';
  if v_result is null or (v_result->>'objectsPlaced')::integer not between 0 and 500 or (v_result->>'heightCentimeters')::integer not between 0 and 500000 or (v_result->>'score')::integer not between 0 and 1000000 or (v_result->>'perfectDrops')::integer not between 0 and (v_result->>'objectsPlaced')::integer or not array(select jsonb_array_elements_text(coalesce(v_result->'aidsUsed','[]'))) <@ v_run.aids then raise exception 'Invalid canonical result';end if;
  perform tower_economy.ensure_account(v_run.user_id);
  insert into tower_economy.daily_limits(user_id,day) values(v_run.user_id,v_run.day) on conflict do nothing;
  select * into v_limits from tower_economy.daily_limits where user_id=v_run.user_id and day=v_run.day for update;
  v_base:=least(120,(v_result->>'objectsPlaced')::integer*2+floor((v_result->>'height')::numeric/5)::integer+(v_result->>'perfectDrops')::integer);
  v_record:=0;
  if not v_limits.record_bonus and (v_result->>'height')::numeric>(select best_height from tower_economy.wallets where user_id=v_run.user_id) then v_record:=10;end if;
  v_baseline:=least(v_base,300-v_limits.gameplay);
  v_record:=least(v_record,300-v_limits.gameplay-v_baseline);
  v_amount:=v_baseline+v_record;
  perform tower_economy.apply_event(v_run.user_id,'run:'||v_run.id,'gameplay',v_baseline);
  if v_record>0 then perform tower_economy.apply_event(v_run.user_id,'record:'||v_run.day,'personal-best',v_record);end if;
  v_mission:=0;
  if (v_result->>'objectsPlaced')::integer>=5 and v_limits.qualifying_runs<2 and v_limits.qualifying_runs+1>=2 then v_mission:=v_mission+10;end if;
  if v_limits.perfect_drops<5 and v_limits.perfect_drops+(v_result->>'perfectDrops')::integer>=5 then v_mission:=v_mission+15;end if;
  v_mission:=least(v_mission,25-v_limits.missions);
  if v_mission>0 then perform tower_economy.apply_event(v_run.user_id,'missions:'||v_run.id,'daily-missions',v_mission);end if;
  update tower_economy.daily_limits set gameplay=gameplay+v_amount,record_bonus=record_bonus or v_record>0,missions=missions+v_mission,qualifying_runs=qualifying_runs+case when (v_result->>'objectsPlaced')::integer>=5 then 1 else 0 end,perfect_drops=perfect_drops+(v_result->>'perfectDrops')::integer where user_id=v_run.user_id and day=v_run.day;
  update tower_economy.wallets set best_height=greatest(best_height,(v_result->>'height')::numeric) where user_id=v_run.user_id;
  update tower_economy.runs set status='accepted',verified_at=v_now,result=v_result||jsonb_build_object('earnedCoins',v_amount,'missionCoins',v_mission,'baseCoins',v_baseline,'recordCoins',v_record),worker_id=null,lease_until=null where id=v_run.id;
  return tower_economy.run_state(v_run.id);
 end if;
 if p_action='payment-order' then
  select * into v_order from tower_economy.orders where provider_id=p_data->>'orderId';
  if not found then raise exception 'Unknown order';end if;
  return jsonb_build_object('id',v_order.id,'orderId',v_order.provider_id,'userId',v_order.user_id,'amountCents',v_order.amount_cents,'currency',v_order.currency,'status',v_order.status);
 end if;
 if p_action='payment-event' then
  select user_id into v_id from tower_economy.orders where provider_id=p_data->>'orderId';
  perform pg_advisory_xact_lock(hashtextextended(v_id::text,2));
  select * into v_order from tower_economy.orders where provider_id=p_data->>'orderId' for update;
  if not found then raise exception 'Unknown order';end if;
  if exists(select 1 from tower_economy.payment_events where event_id=p_data->>'eventId') then return tower_economy.account_state(v_order.user_id);end if;
  if p_data->>'kind'='paid' then
   if (p_data->>'amountCents')::integer is distinct from v_order.amount_cents or p_data->>'currency' is distinct from v_order.currency or nullif(p_data->>'captureId','') is null then raise exception 'Payment mismatch';end if;
   if v_order.status='created' then perform tower_economy.apply_event(v_order.user_id,'purchase:'||v_order.id,'purchase',v_order.coins);update tower_economy.orders set status='paid',capture_id=p_data->>'captureId' where id=v_order.id;end if;
  elsif p_data->>'kind' in('refund','reversal') then
   if v_order.status='created' then
    if p_data->>'captureId' is null or (p_data->>'originalAmountCents')::integer is distinct from v_order.amount_cents or p_data->>'currency' is distinct from v_order.currency then raise exception 'Unknown capture';end if;
    perform tower_economy.apply_event(v_order.user_id,'purchase:'||v_order.id,'purchase',v_order.coins);
    update tower_economy.orders set status='paid',capture_id=p_data->>'captureId' where id=v_order.id;
    v_order.capture_id:=p_data->>'captureId';v_order.status:='paid';
   end if;
   if v_order.capture_id is distinct from p_data->>'captureId' then raise exception 'Unknown capture';end if;
   if p_data->>'currency' is distinct from v_order.currency then raise exception 'Refund currency mismatch';end if;
   if p_data->>'kind'='refund' and ((p_data->>'refundCents')::integer is null or (p_data->>'refundCents')::integer not between 1 and v_order.amount_cents) then raise exception 'Refund mismatch';end if;
   v_amount:=case when p_data->>'kind'='reversal' then (p_data->>'refundedCents')::integer when v_order.status='reversed' then v_order.refunded_cents else v_order.refunded_cents+(p_data->>'refundCents')::integer end;
   if v_amount is null or v_amount<0 or v_amount>v_order.amount_cents then raise exception 'Refund mismatch';end if;
   v_base:=floor(v_order.coins::numeric*v_amount/v_order.amount_cents)::integer;
   if v_base>v_order.reversed_coins then perform tower_economy.apply_event(v_order.user_id,'refund:'||v_order.id||':'||v_amount,'payment-reversal',-(v_base-v_order.reversed_coins),'{}',true);end if;
   update tower_economy.orders set status=case when p_data->>'kind'='reversal' or v_order.status='reversed' then 'reversed' else 'refunded' end,refunded_cents=greatest(refunded_cents,v_amount),reversed_coins=greatest(reversed_coins,v_base) where id=v_order.id;
  else raise exception 'Unknown payment event';end if;
  insert into tower_economy.payment_events(event_id,order_id) values(p_data->>'eventId',v_order.id);
  return tower_economy.account_state(v_order.user_id);
 end if;
 perform tower_economy.ensure_account(p_user);
 if p_action not in('snapshot','leaderboard','run') and not exists(select 1 from auth.users where id=p_user and email is not null and email_confirmed_at is not null) then raise exception 'Verify your email to use the economy';end if;
 if p_action='snapshot' then
  if exists(select 1 from public.profiles where user_id=p_user) then update tower_economy.wallets set public_name=(select public_name from public.profiles where user_id=p_user) where user_id=p_user;end if;
  return tower_economy.account_state(p_user);
 elsif p_action='buy-aid' then
  v_price:=case p_data->>'id' when 'guide-5' then 25 when 'guide-10' then 45 when 'preview' then 20 when 'focus' then 35 when 'skip' then 50 when 'second-chance' then 90 end;
  if v_price is null then raise exception 'Unknown aid';end if;
  v_id:=(p_data->>'requestId')::uuid;
  perform tower_economy.apply_event(p_user,'buy:'||v_id,'aid-purchase',-v_price,jsonb_build_object(p_data->>'id',1));
  return tower_economy.account_state(p_user);
 elsif p_action='buy-cosmetic' then
  v_price:=case p_data->>'id' when 'crane-copper' then 300 when 'crane-cobalt' then 600 when 'crane-obsidian' then 1200 end;
  if v_price is null then raise exception 'Unknown cosmetic';end if;
  if not exists(select 1 from tower_economy.cosmetics where user_id=p_user and item=p_data->>'id') then
   perform tower_economy.apply_event(p_user,'cosmetic:'||(p_data->>'requestId')::uuid,'cosmetic-purchase',-v_price);
   insert into tower_economy.cosmetics(user_id,item) values(p_user,p_data->>'id');
  end if;
  return tower_economy.account_state(p_user);
 elsif p_action='use-aid' then
  select * into v_run from tower_economy.runs where id=(p_data->>'runId')::uuid and user_id=p_user for update;
  if not found then raise exception 'Run not found';end if;
  select * into v_use from tower_economy.aid_uses where user_id=p_user and request_id=(p_data->>'requestId')::uuid;
  if found then
   if v_use.run_id<>v_run.id or v_use.aid<>p_data->>'id' then raise exception 'Request already used';end if;
   return jsonb_build_object('id',v_use.aid,'tick',v_use.tick);
  end if;
  if v_run.status<>'started' or v_run.expires_at<=v_now or not (p_data->>'id'=any(v_run.aids)) then raise exception 'Aid not reserved';end if;
  if exists(select 1 from tower_economy.aid_uses where run_id=v_run.id and aid=p_data->>'id') then raise exception 'Aid already used';end if;
  v_n:=(p_data->>'tick')::integer;
  if v_n is null or v_n<0 or v_n>144000 or v_n>ceil(extract(epoch from(v_now-v_run.started_at))*60)+120 then raise exception 'Invalid aid tick';end if;
  v_items:=case when p_data->>'id'=any(v_run.ad_aids) then '{}'::jsonb else jsonb_build_object(p_data->>'id',-1) end;
  perform tower_economy.apply_event(p_user,'use:'||v_run.id||':'||(p_data->>'id'),'aid-use',0,v_items);
  insert into tower_economy.aid_uses(run_id,user_id,aid,tick,request_id,paid) values(v_run.id,p_user,p_data->>'id',v_n,(p_data->>'requestId')::uuid,not(p_data->>'id'=any(v_run.ad_aids)));
  return jsonb_build_object('id',p_data->>'id','tick',v_n);
 elsif p_action='start-run' then
  select * into v_run from tower_economy.runs where user_id=p_user and request_id=(p_data->>'requestId')::uuid;
  if found then return tower_economy.ticket(v_run.id);end if;
  if p_data->>'mode' not in('casual','daily') then raise exception 'Invalid mode';end if;
  if not exists(select 1 from auth.users where id=p_user and email is not null and email_confirmed_at is not null) then raise exception 'Verify your email to compete';end if;
  v_aids:=array(select jsonb_array_elements_text(coalesce(p_data->'aids','[]')));
  if cardinality(v_aids)>2 or cardinality(v_aids)<>(select count(distinct a) from unnest(v_aids)a) or v_aids @> array['guide-5','guide-10'] or not v_aids <@ array['guide-5','guide-10','preview','focus','skip','second-chance'] then raise exception 'Invalid loadout';end if;
  if (select count(*) from tower_economy.runs where user_id=p_user and started_at>v_now-interval '1 minute')>=30 then raise exception 'Too many requests';end if;
  update tower_economy.wallets set public_name=coalesce(nullif(left(trim(regexp_replace(coalesce(p_data->>'publicName',''),'[^[:alnum:] _-]','','g')),24),''),'Anónimo') where user_id=p_user;
  v_id:=gen_random_uuid();if exists(select 1 from unnest(v_aids)a where not exists(select 1 from tower_economy.inventory i where i.user_id=p_user and i.item=a and i.quantity>0)) then raise exception 'Aid unavailable';end if;
  update tower_economy.runs set status='rejected',error='Superseded by new attempt' where user_id=p_user and status='started';
  insert into tower_economy.periods(kind,start_day,end_at,catalog) values('daily',v_day,(v_day+1)::timestamp at time zone 'UTC',coalesce(p_data->>'catalog','extended-24')) on conflict do nothing;
  select catalog into v_catalog from tower_economy.periods where kind='daily' and start_day=v_day for update;
  insert into tower_economy.runs(id,user_id,request_id,mode,seed,catalog,day,aids,paid_aids,started_at,expires_at)
  values(v_id,p_user,(p_data->>'requestId')::uuid,p_data->>'mode',case when p_data->>'mode'='daily' then 'tower:daily:'||v_day||':v2:'||v_catalog else 'tower:casual:'||v_id||':v2' end,case when p_data->>'mode'='daily' then v_catalog else coalesce(p_data->>'catalog','extended-24') end,v_day,v_aids,v_aids,v_now,v_now+interval '60 minutes');
  insert into tower_economy.periods(kind,start_day,end_at) values('daily',v_day,(v_day+1)::timestamp at time zone 'UTC'),('weekly',date_trunc('week',v_day::timestamp)::date,(date_trunc('week',v_day::timestamp)+interval '7 days') at time zone 'UTC'),('monthly',date_trunc('month',v_day::timestamp)::date,(date_trunc('month',v_day::timestamp)+interval '1 month') at time zone 'UTC') on conflict do nothing;
  return tower_economy.ticket(v_id);
 elsif p_action in('finish-run','run') then
  select * into v_run from tower_economy.runs where id=(p_data->>'runId')::uuid and user_id=p_user for update;
  if not found then raise exception 'Run not found';end if;
  if p_action='run' or v_run.status<>'started' then return tower_economy.run_state(v_run.id);end if;
  if v_now>=v_run.expires_at or v_now>=((v_run.day+1)::timestamp at time zone 'UTC')+interval '60 minutes' then raise exception 'Ticket expired';end if;
  if jsonb_typeof(p_data->'events') is distinct from 'array' or jsonb_array_length(p_data->'events')>510 or octet_length((p_data->'events')::text)>65536 or (p_data->>'finalTick')::integer not between 1 and 144000 then raise exception 'Invalid replay';end if;
  update tower_economy.runs set status='pending',events=p_data->'events',final_tick=(p_data->>'finalTick')::integer,received_at=v_now where id=v_run.id;
  return tower_economy.run_state(v_run.id);
 elsif p_action='ad-intent' then
  if p_data->>'reward' not in('coin-bonus','double-coins','second-chance') then raise exception 'Unknown reward';end if;
  if exists(select 1 from tower_economy.ad_intents where user_id=p_user and completed_at is null and expires_at>v_now) then raise exception 'Another reward is pending';end if;
  if (select count(*) from tower_economy.ad_intents where user_id=p_user and created_at>v_now-interval '1 minute')>=10 then raise exception 'Too many requests';end if;
  if p_data->>'reward'='coin-bonus' and (select bonus_claims from tower_economy.daily_limits where user_id=p_user and day=v_day)>=3 then raise exception 'Daily bonus exhausted';end if;
  if p_data->>'reward'<>'coin-bonus' then
   select * into v_run from tower_economy.runs where id=(p_data->>'runId')::uuid and user_id=p_user;
   if not found then raise exception 'Run not found';end if;
   if p_data->>'reward'='second-chance' and (v_run.status<>'started' or cardinality(v_run.aids)>=2 or 'second-chance'=any(v_run.aids) or v_run.expires_at<=v_now) then raise exception 'Continuation unavailable';end if;
   if p_data->>'reward'='double-coins' and (v_run.status not in('pending','validating','accepted') or exists(select 1 from tower_economy.ad_intents where run_id=v_run.id and reward='double-coins' and completed_at is not null)) then raise exception 'Doubling unavailable';end if;
  end if;
  insert into tower_economy.ad_intents(user_id,reward,run_id) values(p_user,p_data->>'reward',case when p_data->>'reward'='coin-bonus' then null else v_run.id end) returning id into v_id;
  return jsonb_build_object('id',v_id,'expiresAt',v_now+interval '5 minutes');
 elsif p_action='ad-cancel' then
  update tower_economy.ad_intents set expires_at=v_now where id=(p_data->>'intentId')::uuid and user_id=p_user and completed_at is null;
  return tower_economy.account_state(p_user);
 elsif p_action='ad-complete' then
  select * into v_intent from tower_economy.ad_intents where id=(p_data->>'intentId')::uuid and user_id=p_user for update;
  if not found then raise exception 'Reward not found';end if;
  if v_intent.completed_at is not null then if v_intent.reward='second-chance' then return tower_economy.ticket(v_intent.run_id);else return tower_economy.account_state(p_user);end if;end if;
  if v_intent.expires_at<=v_now or p_data->>'viewed' is distinct from 'true' then raise exception 'Reward not completed';end if;
  if v_intent.reward='coin-bonus' then
   select * into v_limits from tower_economy.daily_limits where user_id=p_user and day=v_day for update;
   if v_limits.bonus_claims>=3 then raise exception 'Daily bonus exhausted';end if;
   perform tower_economy.apply_event(p_user,'ad:'||v_intent.id,'ad-bonus-unverified',25);
   update tower_economy.daily_limits set bonus_claims=bonus_claims+1 where user_id=p_user and day=v_day;
  elsif v_intent.reward='second-chance' then
   select * into v_run from tower_economy.runs where id=v_intent.run_id and user_id=p_user for update;
   if v_run.status<>'started' or v_run.expires_at<=v_now or cardinality(v_run.aids)>=2 or 'second-chance'=any(v_run.aids) then raise exception 'Continuation unavailable';end if;
   update tower_economy.runs set aids=array_append(aids,'second-chance'),ad_aids=array_append(ad_aids,'second-chance') where id=v_run.id;
  end if;
  update tower_economy.ad_intents set completed_at=v_now where id=v_intent.id;
  if v_intent.reward='second-chance' then return tower_economy.ticket(v_run.id);end if;
  return tower_economy.account_state(p_user);
 elsif p_action='double-coins' then
  select * into v_intent from tower_economy.ad_intents where id=(p_data->>'intentId')::uuid and user_id=p_user and reward='double-coins' and run_id=(p_data->>'runId')::uuid for update;
  if not found or v_intent.completed_at is null then raise exception 'Reward not completed';end if;
  if v_intent.redeemed_at is not null then return tower_economy.account_state(p_user);end if;
  select * into v_run from tower_economy.runs where id=v_intent.run_id and user_id=p_user and status='accepted';
  if not found then raise exception 'Result still pending';end if;
  select * into v_limits from tower_economy.daily_limits where user_id=p_user and day=v_run.day for update;
  v_amount:=least((v_run.result->>'baseCoins')::integer,300-v_limits.gameplay);
  perform tower_economy.apply_event(p_user,'double:'||v_run.id,'ad-doubling-unverified',v_amount);
  update tower_economy.daily_limits set gameplay=gameplay+v_amount where user_id=p_user and day=v_run.day;
  update tower_economy.ad_intents set redeemed_at=v_now where id=v_intent.id;
  return tower_economy.account_state(p_user);
 elsif p_action='leaderboard' then
  v_kind:=p_data->>'period';if v_kind not in('daily','weekly','monthly') then raise exception 'Invalid period';end if;
  v_start:=coalesce(nullif(p_data->>'periodKey','')::date,case v_kind when 'daily' then v_day when 'weekly' then date_trunc('week',v_day::timestamp)::date else date_trunc('month',v_day::timestamp)::date end);
  if(v_kind='weekly' and extract(isodow from v_start)<>1) or(v_kind='monthly' and extract(day from v_start)<>1) then raise exception 'Invalid period key';end if;
  v_end:=(case v_kind when 'daily' then v_start+interval '1 day' when 'weekly' then v_start+interval '7 days' else v_start+interval '1 month' end) at time zone 'UTC';
  select entries into v_entries from tower_economy.periods where kind=v_kind and start_day=v_start and status='settled';
  if not found then v_entries:=tower_economy.entries(v_kind,v_start);end if;
  select e-'userId'-'runId'-'firstReceivedAt' into v_own from jsonb_array_elements(v_entries)e where e->>'userId'=p_user::text;
  select coalesce(jsonb_agg(e-'userId'-'runId'-'firstReceivedAt'),'[]') into v_result from (select e from jsonb_array_elements(v_entries)e limit 50)q;
  return jsonb_build_object('period',v_kind,'periodId',v_kind||':'||v_start,'startUTC',v_start::timestamp at time zone 'UTC','endUTC',v_end,'settlesAt',v_end+interval '75 minutes','status',case when exists(select 1 from tower_economy.periods where kind=v_kind and start_day=v_start and status='settled') then 'settled' else 'open' end,'participants',jsonb_array_length(v_entries),'entries',v_result,'ownEntry',v_own);
 elsif p_action='paypal-order' then
  if p_data->>'adultConfirmed' is distinct from 'true' or not exists(select 1 from auth.users where id=p_user and email is not null and email_confirmed_at is not null) then raise exception 'Adult confirmation and verified email required';end if;
  select * into v_order from tower_economy.orders where user_id=p_user and request_id=(p_data->>'requestId')::uuid;
  if not found then
   v_price:=case p_data->>'packId' when 'small' then 299 when 'medium' then 699 when 'large' then 1299 end;v_amount:=case p_data->>'packId' when 'small' then 200 when 'medium' then 600 when 'large' then 1400 end;
   if v_price is null then raise exception 'Unknown pack';end if;
   insert into tower_economy.orders(user_id,request_id,pack_id,coins,amount_cents,adult_confirmed_at) values(p_user,(p_data->>'requestId')::uuid,p_data->>'packId',v_amount,v_price,v_now) returning * into v_order;
  end if;
  return jsonb_build_object('id',v_order.id,'orderId',v_order.provider_id,'approvalUrl',v_order.approval_url,'coins',v_order.coins,'amountCents',v_order.amount_cents,'currency',v_order.currency,'status',v_order.status);
 elsif p_action='paypal-attach' then
  update tower_economy.orders set provider_id=p_data->>'orderId',approval_url=p_data->>'approvalUrl' where id=(p_data->>'id')::uuid and user_id=p_user and provider_id is null;
  select * into v_order from tower_economy.orders where id=(p_data->>'id')::uuid and user_id=p_user;
  return jsonb_build_object('orderId',v_order.provider_id,'approvalUrl',v_order.approval_url);
 elsif p_action='paypal-find' then
  select * into v_order from tower_economy.orders where provider_id=p_data->>'orderId' and user_id=p_user;
  if not found then raise exception 'Order not found';end if;
  return jsonb_build_object('id',v_order.id,'orderId',v_order.provider_id,'captureId',v_order.capture_id,'status',v_order.status,'amountCents',v_order.amount_cents,'currency',v_order.currency);
 end if;
 raise exception 'Unknown account action';
end; $$;

create function public.tower_account_api(p_action text,p_user uuid,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select tower_economy.api(p_action,p_user,p_data); $$;
revoke all on function public.tower_account_api(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.tower_account_api(text,uuid,jsonb) to service_role;
revoke all on all functions in schema tower_economy from public,anon,authenticated;
grant execute on all functions in schema tower_economy to service_role;
grant all on all tables in schema tower_economy to service_role;
grant select on public.profiles to service_role;
alter table tower_economy.wallets enable row level security;
alter table tower_economy.inventory enable row level security;
alter table tower_economy.ledger enable row level security;
alter table tower_economy.daily_limits enable row level security;
alter table tower_economy.runs enable row level security;
alter table tower_economy.aid_uses enable row level security;
alter table tower_economy.cosmetics enable row level security;
alter table tower_economy.ad_intents enable row level security;
alter table tower_economy.periods enable row level security;
alter table tower_economy.orders enable row level security;
alter table tower_economy.payment_events enable row level security;
commit;
