begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $$
declare changed integer;
begin
 if (select count(*) from supabase_migrations.schema_migrations)<>3 then raise exception 'Unexpected migration history';end if;
 if exists(select 1 from pg_trigger where tgrelid='supabase_migrations.schema_migrations'::regclass and not tgisinternal) then raise exception 'Unexpected migration history trigger';end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version in('20261003021023','20261003200135','20261003221035')) then raise exception 'Local versions already recorded';end if;
 if (select count(*) from supabase_migrations.schema_migrations m join (values
  ('20261003220832','tower_backend','a6a4ae5e8bb9ce20941ed049552a8f86'),
  ('20261003220847','tower_economy_v2','69ede45825bcd2dc845dfcc9b19a66ef'),
  ('20261003221120','tower_economy_indexes','12bfbbdadc5552ea79b4751a53929148')
 ) as expected(version,name,hash) on m.version=expected.version and m.name=expected.name and cardinality(m.statements)=1 and md5(array_to_string(m.statements,''))=expected.hash)<>3 then raise exception 'Migration content differs';end if;
 update supabase_migrations.schema_migrations m set version=mapping.local_version from (values
  ('20261003220832','20261003021023'),
  ('20261003220847','20261003200135'),
  ('20261003221120','20261003221035')
 ) as mapping(remote_version,local_version) where m.version=mapping.remote_version;
 get diagnostics changed=row_count;
 if changed<>3 then raise exception 'Unexpected repaired row count';end if;
end;
$$;
commit;
select version,name,md5(array_to_string(statements,'')) as content_hash from supabase_migrations.schema_migrations order by version;
