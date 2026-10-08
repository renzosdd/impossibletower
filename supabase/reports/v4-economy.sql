-- Administrative aggregates only; never export credentials, identities or redemption tokens.
select (created_at at time zone 'UTC')::date as day,source,
 sum(greatest(coins,0)) emitted,sum(greatest(-coins,0)) spent,count(*) events
from tower_economy.ledger
where created_at>=((now() at time zone 'UTC')::date-13)::timestamp at time zone 'UTC'
group by 1,2 order by 1,2;

-- Zero rows expected: emissions above the five-mission daily cap.
select day,max(missions) maximum_mission_coins,count(*) filter(where missions>10) accounts_above_cap
from tower_economy.daily_limits where day>=(now() at time zone 'UTC')::date-13
group by day having count(*) filter(where missions>10)>0;

-- Each V4 week should emit <=250 and require >=20 unique eligible participants.
select p.start_day,p.status,jsonb_array_length(p.entries) participants,
 coalesce((select sum((e->>'coins')::integer) from jsonb_array_elements(p.entries)e),0) scheduled_coins,
 coalesce((select sum(coins) from tower_economy.ledger where operation_key='prize:weekly:'||p.start_day),0) paid_coins
from tower_economy.periods p where kind='weekly' order by start_day desc;

select company,code,active,starts_at,expires_at,max_redemptions,redeemed,
 coins::bigint*max_redemptions maximum_coin_emission,coins::bigint*redeemed coins_redeemed
from tower_economy.promo_campaigns order by created_at desc;

-- Zero rows expected: badge catalogue coin claims above its lifetime cap.
select sum(coins) badge_coins from tower_economy.ledger where source='badge-reward'
group by user_id having sum(coins)>90;

select status,count(*) orders,sum(amount_cents) cents,sum(coins) catalog_coins,
 sum(refunded_cents) refunded_cents,sum(reversed_coins) reversed_coins
from tower_economy.orders group by status;
