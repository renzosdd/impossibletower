import { expect, test, type Page } from '@playwright/test';
import { AID_CATALOG, type AidId } from '../../src/content/economy';
import { TowerSimulation, replayRun, type ReplayEvent } from '../../src/game/simulation/TowerSimulation';
import { encodeChallenge, decodeChallenge } from '../../src/services/sharing/challenge';
import type { AccountSnapshot, ReplaySubmission, RunTicket } from '../../src/types/account';
import type { GameSnapshot, RunResult } from '../../src/types';

interface Inspector {
  snapshot(): GameSnapshot;
  result(): RunResult;
  replay(): { events: ReplayEvent[]; finalTick: number; tainted: boolean };
  timing(): { tick: number; craneX: number; cameraY: number };
  drop(): void;
}
const seed = 'browser-replay-seed';
const accountTests = process.env.PLAYWRIGHT_ACCOUNT_ENABLED === '1';

async function snapshot(page: Page): Promise<GameSnapshot> {
  return page.evaluate(() => (window as unknown as { __tower: Inspector }).__tower.snapshot());
}

async function dropAt(page: Page, outside = false): Promise<void> {
  await page.evaluate(outside => new Promise<void>((resolve, reject) => {
    const controller = (window as unknown as { __tower: Inspector }).__tower;
    const started = performance.now();
    const check = () => {
      const x = controller.timing().craneX;
      if (controller.snapshot().state === 'ready' && (outside ? x > 353 : Math.abs(x - 210) < 2)) {
        controller.drop();
        resolve();
      } else if (performance.now() - started > 15_000) reject(new Error('Crane never reached the requested drop position'));
      else requestAnimationFrame(check);
    };
    check();
  }), outside);
}

async function threeRealPlacements(page: Page): Promise<void> {
  for (let placed = 1; placed <= 3; placed++) {
    await dropAt(page);
    await expect.poll(async () => (await snapshot(page)).objectsPlaced, { timeout: 12_000 }).toBe(placed);
  }
  if((await snapshot(page)).ruleset==='v2')expect((await snapshot(page)).objectIds).toEqual(['box','box','table']);else expect((await snapshot(page)).objectsPlaced).toBe(3);
}

async function naturalMiss(page: Page): Promise<void> {
  await dropAt(page, true);
  await expect.poll(async () => (await snapshot(page)).state, { timeout: 15_000 }).toBe('over');
}

async function mockAccount(page: Page, inventory: Partial<Record<AidId, number>>, age: 'adult' | 'unknown' = 'adult', finishDelay = 0) {
  const state: AccountSnapshot = { balance: 100, inventory: { ...inventory }, onlineCosmetics: [], recoverable: true, gameplayEarned: 0, missionEarned: 0, adBonusClaims: 0, transactions: [] };
  const calls: { action: string; [key: string]: unknown }[] = [];
  let ticket: RunTicket | undefined;
  let submission: ReplaySubmission | undefined;
  let accepted: RunResult | undefined;
  let runsStarted = 0;
  let receiptCompleted = false;
  const used = new Set<AidId>();
  await page.addInitScript(({ age }) => {
    localStorage.setItem('impossible-tower.privacy.v1', JSON.stringify({ version: 1, ageGroup: age, guardianAuthorized: false, adsConsent: 'denied', updatedAt: new Date().toISOString() }));
    localStorage.setItem('impossible-tower.profile',JSON.stringify({version:2,economyVersion:3,publicName:'Tester'}));localStorage.setItem('impossible-tower.owner','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'parent@example.com', email_confirmed_at: new Date().toISOString(), is_anonymous: false, app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: {} };
    const token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: user.id, exp: expires, role: 'authenticated', aud: 'authenticated' }))}.mock-signature`;
    localStorage.setItem('sb-tower-test-auth-token', JSON.stringify({ access_token: token, refresh_token: 'mock-refresh-token', expires_at: expires, expires_in: 3600, token_type: 'bearer', user }));
  }, { age });
  await page.route('https://tower-test.supabase.co/**', route => route.fulfill({ status: 200, json: [] }));
  await page.route('**/api/account', async route => {
    const body = route.request().postDataJSON() as typeof calls[number];
    calls.push(body);
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    let response: unknown = state;
    if (body.action === 'buy-aid') {
      const id = body.id as AidId;
      state.balance -= AID_CATALOG[id].price;
      state.inventory[id] = (state.inventory[id] ?? 0) + 1;
    }
    if (body.action === 'start-run') {
      if (runsStarted) expect(receiptCompleted).toBe(true);
      const ids = body.aids as AidId[];
      expect(ids.length).toBeLessThanOrEqual(2);
      for (const id of ids) expect(state.inventory[id]).toBeGreaterThan(0);
      used.clear();
      const id = `bbbbbbbb-bbbb-4bbb-8bbb-${String(++runsStarted).padStart(12, '0')}`;
      receiptCompleted = false;
      ticket = { id, mode: body.mode as 'casual' | 'daily', seed, catalog: 'extended-30', ruleset: 'v3', startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), aids: ids };
      response = ticket;
    }
    if (body.action === 'use-aid') {
      const id = body.id as AidId;
      if(id==='second-chance'&&!ticket?.aids.includes(id)){expect(ticket!.aids.length).toBeLessThan(2);if(!(state.inventory[id]??0)){expect(state.balance).toBeGreaterThanOrEqual(90);state.balance-=90;state.inventory[id]=1;}ticket!.aids.push(id);}
      expect(ticket?.aids).toContain(id);
      expect(used.has(id)).toBe(false);
      expect(state.inventory[id]).toBeGreaterThan(0);
      state.inventory[id] = (state.inventory[id] ?? 0) - 1;
      used.add(id);
      response = { id, tick: body.tick };
    }
    if (body.action === 'finish-run') {
      submission = body as unknown as ReplaySubmission;
      accepted = replayRun({ mode: ticket!.mode, seed, catalog: ticket!.catalog, ruleset: 'v3' }, submission.events, submission.finalTick);
      response = { id: ticket!.id, status: 'accepted', result: { ...accepted, earnedCoins: 0 } };
      if (finishDelay) await new Promise(resolve => setTimeout(resolve, finishDelay));
      receiptCompleted = true;
    }
    if (body.action === 'leaderboard') response = { period: body.period, periodId: '2026-10-03', startUTC: '2026-10-03T00:00:00Z', endUTC: '2026-10-04T00:00:00Z', settlesAt: '2026-10-04T01:15:00Z', status: 'open', participants: 1, ownEntry: null, entries: [{ rank: 1, name: 'Participante real <b>', height: 18.5, score: 830, points: 10, wins: 0, aidsUsed: ['guide-5'], coins: 0, items: {} }] };
    await route.fulfill({ status: 200, json: structuredClone(response) });
  });
  return { state, calls, get ticket() { return ticket; }, get submission() { return submission; }, get accepted() { return accepted; } };
}

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://tower-test.supabase.co/**', route => route.fulfill({ status: 200, json: [] }));
});
test.afterEach(() => { expect(errors).toEqual([]); });

test('privacy setup requires a responsible adult for teen online features', async ({ page }) => {
  if (accountTests) await mockAccount(page, {}, 'unknown');
  await page.goto('/?inspect=1');
  await page.locator('[data-account-action="account"]').click();
  await expect(page.getByRole('dialog', { name: 'Antes de conectar.' })).toBeVisible();
  await page.locator('input[name="account-age"][value="teen"]').check();
  await expect(page.locator('[data-account-action="privacy-continue"]')).toBeDisabled();
  await page.locator('[data-account-guardian]').check();
  await expect(page.locator('[data-account-action="privacy-continue"]')).toBeEnabled();
  await page.locator('[data-account-action="close"]').click();
  await expect(page.getByRole('button', { name: /^Juego libre$/i })).toBeVisible();
});

test('one ranking panel offers Daily and monthly with no weekly tab',async({page})=>{
 await page.goto('/?inspect=1');await page.evaluate(async()=>{const {AccountInterface}=await import('/src/ui/AccountInterface.ts');const root=document.createElement('div');root.id='period-test-ui';document.body.append(root);const events:unknown[]=[];const ui=new AccountInterface(root,{onAction:action=>events.push(action)});ui.setEnabledFlags({rankings:true,rankingPeriods:['daily','monthly']});ui.showLeaderboard(null,'daily');(window as any).periodHarness={ui,events};});
 const tabs=page.locator('#period-test-ui .account-tabs');await expect(tabs.locator('[data-period="daily"]')).toBeEnabled();await expect(tabs.locator('[data-period="monthly"]')).toBeEnabled();await expect(tabs.locator('[data-period="weekly"]')).toHaveCount(0);await tabs.locator('[data-period="monthly"]').click();expect(await page.evaluate(()=>(window as any).periodHarness.events)).toEqual([{type:'rankings',period:'monthly'}]);
});

for (const fps of [30, 60, 120]) test(`browser physics at ${fps} requested frames/s matches the canonical Node replay and shares a v2 challenge`, async ({ page }) => {
  test.setTimeout(75_000);
  const challenge = { version: 2 as const, catalog: 'extended-30' as const, seed, height: 0, score: 0, name: 'Prueba de física' };
  await page.addInitScript(fps => {
    window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 1000 / fps);
    window.cancelAnimationFrame = id => clearTimeout(id);
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (value: string) => { (window as unknown as { copiedChallenge: string }).copiedChallenge = value; } }, configurable: true });
  }, fps);
  await page.goto(`/?inspect=1&challenge=${encodeChallenge(challenge)}`);
  expect(await page.evaluate(() => typeof (window as unknown as { __tower: Inspector & { debug?: unknown } }).__tower?.debug)).toBe('undefined');
  await page.getByRole('button', { name: /ACEPTAR.*DESAFÍO/i }).click();
  await expect.poll(async () => (await snapshot(page)).state).toBe('ready');
  await threeRealPlacements(page);
  await naturalMiss(page);
  const observed = await page.evaluate(() => {
    const controller = (window as unknown as { __tower: Inspector }).__tower;
    return { replay: controller.replay(), result: controller.result() };
  });
  expect(observed.replay.tainted).toBe(false);
  expect(observed.replay.events.every(event => event.action === 'drop')).toBe(true);
  const canonical = replayRun({ mode: 'challenge', seed, catalog: 'extended-30', challenge }, observed.replay.events, observed.replay.finalTick);
  expect(canonical.height).toBe(observed.result.height);
  expect(canonical.score).toBe(observed.result.score);
  expect(canonical.objectIds).toEqual(observed.result.objectIds);
  expect(canonical.perfectDrops).toBe(observed.result.perfectDrops);
  await page.getByRole('button', { name: /DESAFIAR A UN AMIGO/i }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copiedChallenge?: string }).copiedChallenge)).toContain('challenge=');
  const link = await page.evaluate(() => (window as unknown as { copiedChallenge: string }).copiedChallenge);
  const decoded = decodeChallenge(new URL(link).searchParams.get('challenge')!);
  expect(decoded).toMatchObject({ version: 2, catalog: 'extended-30', seed, height: observed.result.height, score: observed.result.score });
  const replayUrl = new URL(link); replayUrl.searchParams.set('inspect', '1');
  await page.goto(replayUrl.toString());
  await page.getByRole('button', { name: /ACEPTAR.*DESAFÍO/i }).click();
  await expect.poll(async () => (await snapshot(page)).seed).toBe(seed);
  expect((await snapshot(page)).catalog).toBe('extended-30');
});

test.describe('account API mocks with public client build flags enabled', () => {
  test.skip(!accountTests, 'Requires the dedicated Vite build with public fake Supabase config and PLAYWRIGHT_ACCOUNT_ENABLED=1');

  test('buying and preparing aids spends only account coins, registers the loadout and pauses input in the aid panel', async ({ page }) => {
    const model = await mockAccount(page, { preview: 1, focus: 1 });
    await page.goto('/?inspect=1');
    await page.locator('[data-account-action="shop"]').click();
    await expect(page.locator('[data-account-action="buy-aid"][data-aid="guide-5"]')).toBeEnabled();
    await page.locator('[data-account-action="buy-aid"][data-aid="guide-5"]').click();
    await expect.poll(() => model.state.balance).toBe(75);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('impossible-tower.profile')!).coins)).toBe(0);
    await page.locator('[data-account-action="select-aid"][data-aid="guide-5"]').click();
    await expect(page.locator('[data-account-action="select-aid"][data-aid="guide-10"]')).toBeDisabled();
    await page.locator('[data-account-action="select-aid"][data-aid="preview"]').click();
    await expect(page.locator('[data-account-action="select-aid"][data-aid="focus"]')).toBeDisabled();
    await expect(page.locator('[data-account-action="buy-coins"]:enabled')).toHaveCount(0);
    await page.locator('[data-account-action="close"]').click();
    await page.getByRole('button', { name: /^Juego libre$/i }).click();
    await expect.poll(async () => (await snapshot(page)).aidsUsed).toEqual(['guide-5', 'preview']);
    expect(model.ticket?.aids).toEqual(['guide-5', 'preview']);
    expect(model.state.inventory['guide-5']).toBe(0);
    expect(model.state.inventory.preview).toBe(0);
    await page.locator('.account-hud-button').click();
    await expect.poll(async () => (await snapshot(page)).state).toBe('paused');
    const paused = await page.evaluate(() => (window as unknown as { __tower: Inspector }).__tower.replay().finalTick);
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as unknown as { __tower: Inspector }).__tower.replay().finalTick)).toBe(paused);
    expect((await snapshot(page)).objectsPlaced).toBe(0);
    await page.locator('[data-account-action="close"]').click();
    await expect.poll(async () => (await snapshot(page)).state).toBe('ready');
  });

  test('focus slows the real crane, preview is drawn and both aid events enter the untainted trace', async ({ page }, testInfo) => {
    await mockAccount(page, { focus: 1, preview: 1 });
    await page.goto('/?inspect=1');
    await page.locator('[data-account-action="shop"]').click();
    await expect(page.locator('[data-account-action="select-aid"][data-aid="focus"]')).toBeEnabled();
    await page.locator('[data-account-action="select-aid"][data-aid="focus"]').click();
    await page.locator('[data-account-action="select-aid"][data-aid="preview"]').click();
    await page.locator('[data-account-action="close"]').click();
    await page.getByRole('button', { name: /^Juego libre$/i }).click();
    await expect.poll(async () => (await snapshot(page)).aidsUsed).toEqual(['focus', 'preview']);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __tower: Inspector }).__tower.timing().tick)).toBeGreaterThan(90);
    const observed = await page.evaluate(() => {
      const controller = (window as unknown as { __tower: Inspector }).__tower;
      return { timing: controller.timing(), replay: controller.replay() };
    });
    const expected = new TowerSimulation({ mode: 'casual', seed, catalog: 'extended-30' });
    const unassisted = new TowerSimulation({ mode: 'casual', seed, catalog: 'extended-30' });
    try {
      expected.activateAid('focus'); expected.activateAid('preview'); expected.advance(observed.timing.tick);
      unassisted.advance(observed.timing.tick);
      expect(observed.timing.craneX).toBeCloseTo(expected.craneX, 8);
      expect(observed.timing.craneX).not.toBeCloseTo(unassisted.craneX, 4);
      expect(observed.replay.tainted).toBe(false);
      expect(observed.replay.events).toEqual([{ tick: 0, action: 'aid', aid: 'focus' }, { tick: 0, action: 'aid', aid: 'preview' }]);
      await page.locator('canvas').screenshot({ path: testInfo.outputPath('focus-and-preview.png') });
    } finally { expected.dispose(); unassisted.dispose(); }
  });

  test('reserved guide and revival restore the tower and finalize one canonical replay without duplicate local progress', async ({ page }, testInfo) => {
    test.setTimeout(100_000);
    const model = await mockAccount(page, { 'guide-5': 1, 'second-chance': 1 }, 'adult', 750);
    await page.goto('/?inspect=1');
    await page.locator('[data-account-action="shop"]').click();
    await expect(page.locator('[data-account-action="select-aid"][data-aid="guide-5"]')).toBeEnabled();
    await page.locator('[data-account-action="select-aid"][data-aid="guide-5"]').click();
    await page.locator('[data-account-action="select-aid"][data-aid="second-chance"]').click();
    await page.locator('[data-account-action="close"]').click();
    await page.getByRole('button', { name: /^Juego libre$/i }).click();
    await expect.poll(async () => (await snapshot(page)).aidsUsed).toEqual(['guide-5']);
    await page.locator('canvas').screenshot({ path: testInfo.outputPath('guide.png') });
    await threeRealPlacements(page);
    await naturalMiss(page);
    expect(model.calls.filter(call => call.action === 'finish-run')).toHaveLength(0);
    await expect(page.locator('.account-revive-result')).toBeVisible();
    const tower = await snapshot(page);
    await page.locator('.account-revive-result').click();
    await expect.poll(async () => (await snapshot(page)).state).toBe('ready');
    expect((await snapshot(page)).height).toBe(tower.height);
    expect((await snapshot(page)).objectsPlaced).toBe(3);
    expect((await snapshot(page)).aidsUsed).toEqual(['guide-5', 'second-chance']);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('impossible-tower.profile')!).runs)).toBe(0);
    await naturalMiss(page);
    await expect.poll(() => model.calls.filter(call => call.action === 'finish-run').length).toBe(1);
    await expect(page.locator('.account-revive-result')).toHaveCount(0);
    expect(model.calls.filter(call => call.action === 'use-aid' && call.id === 'second-chance')).toHaveLength(1);
    expect(model.state.inventory['second-chance']).toBe(0);
    expect(model.accepted?.aidsUsed).toEqual(['guide-5', 'second-chance']);
    expect(model.accepted?.height).toBe((await snapshot(page)).height);
    expect(model.accepted?.score).toBe((await snapshot(page)).score);
    expect(await page.evaluate(() => (window as unknown as { __tower: Inspector }).__tower.replay().tainted)).toBe(false);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('impossible-tower.profile')!).runs)).toBe(1);
    const firstRun = model.ticket!.id;
    await page.getByRole('button', { name: /JUGAR DE NUEVO/i }).click();
    await expect.poll(() => model.calls.filter(call => call.action === 'start-run').length).toBe(2);
    await expect.poll(async () => (await snapshot(page)).state).toBe('ready');
    expect(model.ticket!.id).not.toBe(firstRun);
    expect(model.ticket!.aids).toEqual([]);
    expect((await snapshot(page)).aidsUsed).toEqual([]);
    expect(model.calls.filter(call => call.action === 'finish-run')).toHaveLength(1);
  });

  test('a second chance can be bought directly at the result without preparation',async({page})=>{
    test.setTimeout(80_000);
    const model=await mockAccount(page,{});
    await page.goto('/?inspect=1');
    await page.getByRole('button',{name:/^Juego libre$/i}).click();
    await threeRealPlacements(page);await naturalMiss(page);
    expect(model.ticket!.aids).toEqual([]);
    expect(model.calls.filter(c=>c.action==='finish-run')).toHaveLength(0);
    await expect(page.locator('.account-revive-result')).toHaveText('Segunda chance · 90 monedas');
    await page.locator('.account-revive-result').click();
    await expect.poll(async()=>(await snapshot(page)).state).toBe('ready');
    expect(model.state.balance).toBe(10);
    expect(model.state.inventory['second-chance']).toBe(0);
    expect(model.ticket!.aids).toEqual(['second-chance']);
    await naturalMiss(page);
    await expect.poll(()=>model.calls.filter(c=>c.action==='finish-run').length).toBe(1);
    await expect(page.locator('.account-revive-result')).toHaveCount(0);
    expect(model.accepted?.aidsUsed).toEqual(['second-chance']);
  });

  test('ranking tabs request real rows and render participant text safely without announcing premature prizes', async ({ page }) => {
    const model = await mockAccount(page, {});
    await page.goto('/?inspect=1');
    await page.locator('[data-account-action="ranking"][data-period="daily"]').click();
    await expect(page.locator('.account-ranking-list')).toContainText('Participante real <b>');
    await expect(page.locator('.account-ranking-list b')).toHaveCount(0);
    await expect(page.locator('.account-rank-prize')).toHaveText('—');
    await expect(page.locator('.account-tabs [data-period="weekly"]')).toHaveCount(0);
    await page.locator('.account-tabs [data-period="monthly"]').click();
    await expect.poll(() => model.calls.filter(call => call.action === 'leaderboard').map(call => call.period)).toEqual(['daily','monthly']);
  });

  test('a prepared replacement remains available after revival refreshes the consumed inventory', async ({ page }) => {
    test.setTimeout(80_000);
    const model = await mockAccount(page, { skip: 1, 'second-chance': 1 });
    await page.goto('/?inspect=1');
    await page.locator('[data-account-action="shop"]').click();
    await expect(page.locator('[data-account-action="select-aid"][data-aid="skip"]')).toBeEnabled();
    await page.locator('[data-account-action="select-aid"][data-aid="skip"]').click();
    await page.locator('[data-account-action="select-aid"][data-aid="second-chance"]').click();
    await page.locator('[data-account-action="close"]').click();
    await page.getByRole('button', { name: /^Juego libre$/i }).click();
    await expect.poll(async () => (await snapshot(page)).state).toBe('ready');
    await threeRealPlacements(page);
    await naturalMiss(page);
    await page.locator('.account-revive-result').click();
    await expect.poll(async () => (await snapshot(page)).state).toBe('ready');
    await expect.poll(() => model.calls.filter(call => call.action === 'snapshot').length).toBeGreaterThan(1);
    expect(model.state.inventory).toEqual({ skip: 1, 'second-chance': 0 });
    await page.locator('.account-hud-button').click();
    await expect(page.locator('[data-account-action="use-aid"][data-aid="skip"]')).toBeEnabled();
    await page.locator('[data-account-action="use-aid"][data-aid="skip"]').click();
    await expect.poll(async () => (await snapshot(page)).aidsUsed).toEqual(['second-chance', 'skip']);
    expect(model.calls.filter(call => call.action === 'use-aid').map(call => call.id)).toEqual(['second-chance', 'skip']);
    expect(model.state.inventory).toEqual({ skip: 0, 'second-chance': 0 });
    await naturalMiss(page);
    await expect.poll(() => model.calls.filter(call => call.action === 'finish-run').length).toBe(1);
    expect(model.accepted?.aidsUsed).toEqual(['second-chance', 'skip']);
    expect(await page.evaluate(() => (window as unknown as { __tower: Inspector }).__tower.replay().tainted)).toBe(false);
  });
});

 test.beforeEach(async({page})=>{await page.addInitScript(()=>{if(!localStorage.getItem('impossible-tower.profile'))localStorage.setItem('impossible-tower.profile',JSON.stringify({version:2,economyVersion:3,publicName:'Tester'}));});});
