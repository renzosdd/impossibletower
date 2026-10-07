-- Administrative reporting only. Supply the real activation date/window before review.
-- No player IDs, emails or raw referral tokens are exported by these aggregates.
with days as (select generate_series((now() at time zone 'UTC')::date-13,(now() at time zone 'UTC')::date,interval '1 day')::date as day),
coins as (select (created_at at time zone 'UTC')::date day,
 sum(greatest(coins,0)) minted,sum(greatest(-coins,0)) spent,
 sum(case when source='ranking-daily' then coins else 0 end) daily_prizes,
 sum(case when source='daily-missions' then coins else 0 end) mission_coins,
 sum(case when source='referral' then coins else 0 end) referral_coins
 from tower_economy.ledger where created_at>=((now() at time zone 'UTC')::date-13)::timestamp at time zone 'UTC' group by 1),
ads as (select (completed_at at time zone 'UTC')::date day,count(*) completed from tower_economy.ad_intents where reward='daily-attempt' and completed_at>=((now() at time zone 'UTC')::date-13)::timestamp at time zone 'UTC' group by 1),
runs as (select day,count(*) submitted,count(distinct user_id) verified_players,
 count(distinct user_id) filter(where mode='daily' and coin_eligible and (result->>'objectsPlaced')::integer>=5) daily_players,
 count(*) filter(where mode='daily' and attempt_source='purchased') purchased_daily_runs
 from tower_economy.runs where ruleset='v3' and status='accepted' and day>=(now() at time zone 'UTC')::date-13 group by 1),
refs as (select (qualified_at at time zone 'UTC')::date day,
 count(*) filter(where status='credited') paid,count(*) filter(where status='capped') discarded
 from tower_economy.referrals where qualified_at>=((now() at time zone 'UTC')::date-13)::timestamp at time zone 'UTC' group by 1)
select d.day,coalesce(c.minted,0) minted,coalesce(c.spent,0) spent,coalesce(c.daily_prizes,0) daily_prizes,
 coalesce(c.mission_coins,0) mission_coins,coalesce(c.referral_coins,0) referral_coins,
 coalesce(a.completed,0) completed_ads,coalesce(r.verified_players,0) verified_players,
 coalesce(r.daily_players,0) valid_daily_players,coalesce(r.purchased_daily_runs,0) purchased_daily_runs,
 coalesce(f.paid,0) paid_referrals,coalesce(f.discarded,0) discarded_referrals
from days d left join coins c using(day) left join ads a using(day) left join runs r using(day) left join refs f using(day) order by d.day;
