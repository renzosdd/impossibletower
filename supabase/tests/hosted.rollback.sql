begin;
set local statement_timeout='20s';
set local lock_timeout='3s';
select set_config('tower.test.owner_a',gen_random_uuid()::text,true);
select set_config('tower.test.owner_b',gen_random_uuid()::text,true);
select set_config('tower.test.guest',gen_random_uuid()::text,true);
do $$
declare a uuid:=current_setting('tower.test.owner_a')::uuid;b uuid:=current_setting('tower.test.owner_b')::uuid;g uuid:=current_setting('tower.test.guest')::uuid;
begin
 insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,raw_app_meta_data)
 values(a,'authenticated','authenticated',a||'@tower-rollback.invalid',now(),false,'{}'),(b,'authenticated','authenticated',b||'@tower-rollback.invalid',now(),false,'{}'),(g,'authenticated','authenticated',null,null,true,'{}');
 insert into public.profiles(user_id,public_name,data) values(a,'Rollback A','{"version":2,"coins":100}'),(b,'Rollback B','{"version":2,"coins":200}');
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('tower.test.owner_a'),true);
do $$
declare a uuid:=current_setting('tower.test.owner_a')::uuid;b uuid:=current_setting('tower.test.owner_b')::uuid;
begin
 if (select count(*) from public.profiles)<>1 or not exists(select 1 from public.profiles where user_id=a) or exists(select 1 from public.profiles where user_id=b) then raise exception 'Owner RLS failed for A';end if;
 perform public.sync_profile('Rollback A','{"version":2,"coins":10000000}');
 begin update public.profiles set public_name='Foreign' where user_id=b;raise exception 'Unexpected direct write';exception when insufficient_privilege then null;end;
 begin perform public.tower_account_api('snapshot',b,'{}');raise exception 'Unexpected economy RPC access';exception when insufficient_privilege then null;end;
 begin perform email from auth.users;raise exception 'Unexpected Auth access';exception when insufficient_privilege then null;end;
 perform public.submit_run('casual','hosted-rollback',1,135,5,0,0,10,'Rollback A',false);
 if not exists(select 1 from public.scores where user_id=a and seed='hosted-rollback') then raise exception 'V1 run failed';end if;
 begin perform public.submit_run('casual','hosted-rollback',1,135,5,0,0,10,'Rollback A',true);raise exception 'Unexpected assisted score';exception when invalid_parameter_value then null;end;
 perform set_config('tower.test.challenge',public.create_challenge('hosted-rollback',1,135,'Rollback A')::text,true);
end;
$$;
select set_config('request.jwt.claim.sub',current_setting('tower.test.owner_b'),true);
do $$
declare b uuid:=current_setting('tower.test.owner_b')::uuid;
begin
 if (select count(*) from public.profiles)<>1 or not exists(select 1 from public.profiles where user_id=b) or exists(select 1 from public.scores where seed='hosted-rollback') or exists(select 1 from public.challenges where id=current_setting('tower.test.challenge')::uuid) then raise exception 'Owner RLS failed for B';end if;
 perform public.sync_profile('Rollback B','{"version":2,"coins":200}');
 if public.load_challenge(current_setting('tower.test.challenge')::uuid)->>'seed'<>'hosted-rollback' then raise exception 'Shared challenge failed';end if;
end;
$$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$
begin
 perform * from public.read_leaderboard('all-time');
 if public.load_challenge(current_setting('tower.test.challenge')::uuid)->>'seed'<>'hosted-rollback' then raise exception 'Public challenge failed';end if;
 begin perform * from public.profiles;raise exception 'Unexpected anonymous profile access';exception when insufficient_privilege then null;end;
 begin perform public.tower_account_api('snapshot',current_setting('tower.test.owner_a')::uuid,'{}');raise exception 'Unexpected anonymous economy access';exception when insufficient_privilege then null;end;
 begin perform email from auth.users;raise exception 'Unexpected anonymous Auth access';exception when insufficient_privilege then null;end;
end;
$$;
set local role service_role;
do $$
declare a uuid:=current_setting('tower.test.owner_a')::uuid;b uuid:=current_setting('tower.test.owner_b')::uuid;g uuid:=current_setting('tower.test.guest')::uuid;s jsonb;t jsonb;j jsonb;o jsonb;r uuid:=gen_random_uuid();u uuid:=gen_random_uuid();event text:=gen_random_uuid()::text;provider text:='ORDER'||replace(gen_random_uuid()::text,'-','');capture text:='CAPTURE'||replace(gen_random_uuid()::text,'-','');before_balance integer;
begin
 perform id,email,email_confirmed_at from auth.users where id=a;
 begin perform encrypted_password from auth.users;raise exception 'Unexpected password access';exception when insufficient_privilege then null;end;
 if (public.tower_account_api('snapshot',a,'{}')->>'balance')::integer<>100 or (public.tower_account_api('snapshot',a,'{}')->>'balance')::integer<>100 or (public.tower_account_api('snapshot',g,'{}')->>'balance')::integer<>0 then raise exception 'Starter isolation failed';end if;
 begin perform public.tower_account_api('start-run',g,jsonb_build_object('requestId',gen_random_uuid(),'mode','casual','aids','[]'::jsonb));raise exception 'Unexpected guest ticket';exception when others then if sqlerrm<>'Verify your email to use the economy' then raise;end if;end;
 s:=public.tower_account_api('buy-aid',a,jsonb_build_object('id','preview','requestId',r));
 s:=public.tower_account_api('buy-aid',a,jsonb_build_object('id','preview','requestId',r));
 if (s->>'balance')::integer<>80 or (s->'inventory'->>'preview')::integer<>1 then raise exception 'Purchase retry failed';end if;
 if (public.tower_account_api('snapshot',b,'{}')->>'balance')::integer<>100 then raise exception 'Wallet isolation failed';end if;
 t:=public.tower_account_api('start-run',a,jsonb_build_object('requestId',gen_random_uuid(),'mode','casual','aids','["preview"]'::jsonb,'catalog','extended-24','publicName','Rollback A'));
 if (public.tower_account_api('snapshot',a,'{}')->'inventory'->>'preview')::integer<>1 then raise exception 'Reservation consumed item';end if;
 begin perform public.tower_account_api('run',b,jsonb_build_object('runId',t->>'id'));raise exception 'Unexpected foreign run';exception when others then if sqlerrm<>'Run not found' then raise;end if;end;
 perform public.tower_account_api('use-aid',a,jsonb_build_object('runId',t->>'id','id','preview','tick',0,'requestId',u));
 perform public.tower_account_api('use-aid',a,jsonb_build_object('runId',t->>'id','id','preview','tick',0,'requestId',u));
 if (public.tower_account_api('snapshot',a,'{}')->'inventory'->>'preview')::integer<>0 then raise exception 'Aid consumed twice';end if;
 s:=public.tower_account_api('finish-run',a,jsonb_build_object('runId',t->>'id','finalTick',30,'events','[{"tick":0,"action":"aid","aid":"preview"}]'::jsonb,'score',1000000));
 if s->>'status'<>'pending' or s->'result'<>'null'::jsonb then raise exception 'Submission trusted browser metrics';end if;
 j:=public.tower_account_api('claim-job',null,'{}');
 if j->>'id'<>t->>'id' or j->'authorizedAids'<>'[{"id":"preview","tick":0}]'::jsonb then raise exception 'Worker lease failed';end if;
 s:=public.tower_account_api('verify-run',null,jsonb_build_object('runId',t->>'id','workerId',j->>'workerId','result','{"height":10,"heightCentimeters":1000,"score":500,"objectsPlaced":5,"perfectDrops":0,"maxCombo":0,"duration":10,"aidsUsed":["preview"]}'::jsonb));
 if s->>'status'<>'accepted' or (s->'result'->>'earnedCoins')::integer<>22 then raise exception 'Trusted result accounting failed';end if;
 before_balance:=(public.tower_account_api('snapshot',a,'{}')->>'balance')::integer;
 perform public.tower_account_api('verify-run',null,jsonb_build_object('runId',t->>'id','workerId',j->>'workerId','result',s->'result'));
 if (public.tower_account_api('snapshot',a,'{}')->>'balance')::integer<>before_balance then raise exception 'Result credited twice';end if;
 begin update tower_economy.ledger set coins=999 where user_id=a;raise exception 'Unexpected ledger mutation';exception when others then if sqlerrm<>'Ledger is immutable' then raise;end if;end;
 o:=public.tower_account_api('paypal-order',a,jsonb_build_object('packId','small','requestId',gen_random_uuid(),'adultConfirmed',true,'coins',999999,'amountCents',1));
 if (o->>'coins')::integer<>200 or (o->>'amountCents')::integer<>299 then raise exception 'Server price failed';end if;
 perform public.tower_account_api('paypal-attach',a,jsonb_build_object('id',o->>'id','orderId',provider,'approvalUrl','https://www.sandbox.paypal.com/checkout'));
 perform public.tower_account_api('payment-event',null,jsonb_build_object('eventId',event,'kind','paid','orderId',provider,'captureId',capture,'amountCents',299,'currency','USD'));
 perform public.tower_account_api('payment-event',null,jsonb_build_object('eventId',event,'kind','paid','orderId',provider,'captureId',capture,'amountCents',299,'currency','USD'));
 if (public.tower_account_api('snapshot',a,'{}')->>'balance')::integer<>before_balance+200 then raise exception 'Capture idempotency failed';end if;
 perform public.tower_account_api('payment-event',null,jsonb_build_object('eventId',gen_random_uuid(),'kind','refund','orderId',provider,'captureId',capture,'refundCents',299,'currency','USD'));
 if (public.tower_account_api('snapshot',a,'{}')->>'balance')::integer<>before_balance then raise exception 'Refund failed';end if;
 if tower_economy.prize('daily',1,4)->>'coins'<>'0' or tower_economy.prize('daily',1,5)->>'coins'<>'60' then raise exception 'Prize threshold failed';end if;
end;
$$;
rollback;
select jsonb_build_object('status','passed','fixtures','rolled_back','coverage',array['owner-RLS','role-grants','V1-RPC','wallet-inventory-ledger','V2-tickets','trusted-result-fixture','payment-accounting']) as validation;
