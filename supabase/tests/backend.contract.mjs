import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
// Optional standalone verification dependency, never bundled into the game.
const { PGlite } = await import(process.env.TOWER_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec("create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;");
await db.exec(await readFile(new URL('../migrations/20261003021023_tower_backend.sql', import.meta.url), 'utf8'));
const player = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
await db.query('insert into auth.users(id) values ($1), ($2)', [player, other]);
let passed = 0;
async function denied(sql, params = [], match = /./) {
  await assert.rejects(db.query(sql, params), match); passed++;
}
await db.exec('set role anon');
await denied("select public.submit_run('casual','tower:test',11.6,366,2,2,2,8,'Lucía',false)", [], /permission denied/);
assert.equal((await db.query("select * from public.read_leaderboard('today')")).rows.length, 0); passed++;
await denied('select * from public.profiles', [], /permission denied/);
await db.exec('reset role');
await db.query("select set_config('request.jwt.claim.sub', $1, false)", [player]);
await db.exec('set role authenticated');
await denied("select public.submit_run('wrong','tower:test',11.6,366,2,2,2,8,'Lucía',false)", [], /Implausible run/);
await denied("select public.submit_run('casual','bad seed',11.6,366,2,2,2,8,'Lucía',false)", [], /Implausible run/);
await denied("select public.submit_run('casual','tower:test',9000,366,2,2,2,8,'Lucía',false)", [], /Implausible run/);
await denied("select public.submit_run('casual','tower:test',11.6,999999,2,2,2,8,'Lucía',false)", [], /Implausible run/);
await denied("select public.submit_run('casual','tower:test',11.6,366,2,2,2,.1,'Lucía',false)", [], /Implausible run/);
await denied("select public.submit_run('casual','tower:test',11.6,366,2,2,2,8,'Lucía',true)", [], /Assisted runs/);
await denied("select public.submit_run('daily','tower:daily:2000-01-01:v1',11.6,366,2,2,2,8,'Lucía',false)", [], /Daily seed/);
await db.query("select public.submit_run('casual','tower:test',11.6,366,2,2,2,8,'<Lucía>',false)"); passed++;
await denied("select public.submit_run('casual','tower:test',11.6,366,2,2,2,8,'Lucía',false)", [], /rate limit/);
await denied("insert into public.scores(user_id,mode,seed,height,score,objects_placed,perfect_drops,max_combo,duration) values ($1,'casual','tower:test',11.6,366,2,2,2,8)", [player], /permission denied/);
await denied("select public.create_challenge('not-a-played-seed',11.6,366,'Lucía')", [], /accepted run/);
const challengeId = (await db.query("select public.create_challenge('tower:test',11.6,366,'Lucía') as id")).rows[0].id; passed++;
const board = (await db.query("select * from public.read_leaderboard('all-time')")).rows;
assert.deepEqual(board, [{name:'Lucía',height:'11.6'}]); passed++;
await db.query("select public.sync_profile('Lucía', '{\"version\":2,\"personalBest\":999999}'::jsonb)");
assert.deepEqual((await db.query("select * from public.read_leaderboard('all-time')")).rows, board); passed++;
await db.exec('reset role');
await db.query("select set_config('request.jwt.claim.sub', $1, false)", [other]);
await db.exec('set role authenticated');
for (const table of ['profiles','scores','daily_scores','challenges']) {
  assert.equal((await db.query('select * from public.' + table)).rows.length, 0); passed++;
}
await db.exec('reset role');
await db.query("select set_config('request.jwt.claim.sub', '', false)");
await db.exec('set role anon');
const shared = (await db.query('select public.load_challenge($1) as result', [challengeId])).rows[0].result;
assert.deepEqual(shared, {version:1,seed:'tower:test',height:11.6,score:366,name:'Lucía'}); passed++;
assert.deepEqual((await db.query("select * from public.read_leaderboard('all-time')")).rows, board); passed++;
await db.exec('reset role');
await db.query("select set_config('request.jwt.claim.sub', $1, false)", [player]);
await db.query("update public.scores set created_at=now()-interval '10 seconds'");
await db.exec('set role authenticated');
await db.query("select public.submit_run('daily','tower:daily:' || to_char((now() at time zone 'UTC')::date,'YYYY-MM-DD') || ':v1',17.4,549,3,3,3,12,'Lucía',false)");
assert.deepEqual((await db.query("select * from public.read_leaderboard('today')")).rows,[{name:'Lucía',height:'17.4'}]); passed++;
for (let i=0;i<7;i++) await db.query("select public.create_challenge('tower:test',11.6,366,'Lucía')");
await denied("select public.create_challenge('tower:test',11.6,366,'Lucía')", [], /rate limit/);
await db.close();
console.log('PostgreSQL/PGlite: ' + passed + ' migration, RPC, validation, rate-limit, owner RLS and public-read assertions passed.');
