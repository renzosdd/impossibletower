begin;
create index ad_intents_run_id on tower_economy.ad_intents(run_id);
create index payment_events_order_id on tower_economy.payment_events(order_id);
commit;
