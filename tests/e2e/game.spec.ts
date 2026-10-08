import { expect, test, type Page } from '@playwright/test';
import { encodeChallenge } from '../../src/services/sharing/challenge';

interface Snapshot {
  state: string;
  mode: string;
  seed: string;
  height: number;
  score: number;
  objectsPlaced: number;
  perfectDrops: number;
  duration: number;
  objectIds: string[];
}
interface DebugController { snapshot(): Snapshot | undefined; debug(command: string, value?: string): void; }

async function snapshot(page: Page): Promise<Snapshot | undefined> {
  return page.evaluate(() => (window as unknown as { __tower?: DebugController }).__tower?.snapshot());
}
async function debug(page: Page, command: string, value?: string): Promise<void> {
  await page.evaluate(({ command, value }) => {
    (window as unknown as { __tower: DebugController }).__tower.debug(command, value);
  }, { command, value });
}
async function start(page: Page, mode: 'casual' | 'daily' = 'casual'): Promise<void> {
  await page.goto('/?debug=1');
  await page.getByRole('button', { name: mode === 'casual' ? /^Juego libre$/i : /DAILY TOWER/i }).click();
  await expect.poll(async () => (await snapshot(page))?.state).toBe('ready');
}
async function landFirstBox(page: Page): Promise<void> {
  await debug(page, 'center');
  // Real keyboard input and the actual Matter simulation; no synthetic placement.
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snapshot(page))?.objectsPlaced, { timeout: 12_000 }).toBe(1);
  expect((await snapshot(page))?.objectIds).toEqual(['box']);
  expect((await snapshot(page))?.height).toBeGreaterThan(4);
}

let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  await page.addInitScript(()=>{if(!localStorage.getItem('impossible-tower.profile'))localStorage.setItem('impossible-tower.profile',JSON.stringify({version:2,economyVersion:3,publicName:'Tester'}));});
  pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
});
test.afterEach(() => { expect(pageErrors).toEqual([]); });

test('loads menu without backend, ads or a debug interface for normal users', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Juego libre$/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /DAILY TOWER/i })).toBeVisible();
  expect(await page.evaluate(() => '__tower' in window)).toBe(false);
  expect(await page.locator('script[src*="crazygames"],script[src*="poki-sdk"]').count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('places a real box, saves a record and restarts immediately', async ({ page }) => {
  await start(page);
  await landFirstBox(page);
  const height = (await snapshot(page))!.height;
  await debug(page, 'end-run');
  await expect(page.getByRole('button', { name: /JUGAR DE NUEVO/i })).toBeVisible();
  const storedBest = await page.evaluate(() => JSON.parse(localStorage.getItem('impossible-tower.profile')!).personalBest);
  expect(storedBest).toBe(height);
  await page.getByRole('button', { name: /JUGAR DE NUEVO/i }).click();
  await expect.poll(async () => (await snapshot(page))?.state).toBe('ready');
  expect((await snapshot(page))?.objectsPlaced).toBe(0);
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('impossible-tower.profile')!).personalBest)).toBe(height);
});

test('three centered tutorial pieces stay perfect and support a fourth real drop', async ({ page }) => {
  test.setTimeout(45_000);
  await start(page);
  for (let count = 1; count <= 3; count += 1) {
    await debug(page, 'center');
    await page.locator('canvas').click({ position: { x: 150, y: 400 } });
    await expect.poll(async () => (await snapshot(page))?.objectsPlaced, { timeout: 12_000 }).toBe(count);
  }
  const tutorial = (await snapshot(page))!;
  expect(tutorial.objectIds[0]).toBe('box');
  expect(tutorial.objectIds).toHaveLength(3);
  expect(tutorial.perfectDrops).toBe(3);
  expect(tutorial.height).toBeGreaterThan(10);
  await debug(page, 'force-object', 'box');
  await debug(page, 'center');
  await page.locator('canvas').click({ position: { x: 150, y: 400 } });
  await expect.poll(async () => (await snapshot(page))?.objectsPlaced, { timeout: 12_000 }).toBe(4);
  const loaded = (await snapshot(page))!;
  expect(loaded.height).toBeGreaterThan(15);
  // Observe the loaded tower for two more simulated seconds, beyond placement.
  await expect.poll(async () => (await snapshot(page))?.duration, { timeout: 8_000 }).toBeGreaterThanOrEqual(loaded.duration + 2);
  expect((await snapshot(page))?.objectsPlaced).toBe(4);
  expect((await snapshot(page))?.state).toBe('ready');
});

test('a tapped drop outside the platform reaches the kill zone naturally', async ({ page }) => {
  await start(page);
  await debug(page, 'miss');
  await page.locator('canvas').click({ position: { x: 150, y: 400 } });
  await expect.poll(async () => (await snapshot(page))?.state, { timeout: 12_000 }).toBe('over');
  expect((await snapshot(page))?.objectsPlaced).toBe(0);
  await expect(page.getByRole('button', { name: /JUGAR DE NUEVO/i })).toBeVisible();
});

test('Daily starts with the UTC seed and retains it on retry', async ({ page }) => {
  await start(page, 'daily');
  const expectedSeed = `tower:daily:${new Date().toISOString().slice(0, 10)}:v1`;
  expect((await snapshot(page))?.mode).toBe('daily');
  expect((await snapshot(page))?.seed).toBe(expectedSeed);
  await debug(page, 'end-run');
  await page.getByRole('button', { name: /JUGAR DE NUEVO/i }).click();
  await expect.poll(async () => (await snapshot(page))?.state).toBe('ready');
  expect((await snapshot(page))?.seed).toBe(expectedSeed);
});

test('a challenge link loads its target and starts the identical seed', async ({ page }) => {
  const challenge = { version: 1 as const, seed: 'friends-fixed-seed', height: 2, score: 20, name: 'Luna' };
  await page.goto(`/?debug=1&challenge=${encodeChallenge(challenge)}`);
  await expect(page.getByText(/Luna/).first()).toBeVisible();
  await page.getByRole('button', { name: /ACEPTAR.*DESAFÍO/i }).click();
  await expect.poll(async () => (await snapshot(page))?.state).toBe('ready');
  expect((await snapshot(page))?.seed).toBe(challenge.seed);
  expect((await snapshot(page))?.mode).toBe('challenge');
  await landFirstBox(page);
  await debug(page, 'end-run');
  await expect(page.getByText(/GANASTE EL DESAFÍO/i).first()).toBeVisible();
});

test('sharing copies a playable challenge when Web Share is absent', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (value: string) => { (window as unknown as { copiedChallenge: string }).copiedChallenge = value; } },
      configurable: true,
    });
  });
  await start(page);
  await landFirstBox(page);
  const seed = (await snapshot(page))!.seed;
  await debug(page, 'end-run');
  await page.getByRole('button', { name: /DESAFIAR A UN AMIGO/i }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copiedChallenge?: string }).copiedChallenge)).toContain('challenge=');
  const copied = await page.evaluate(() => (window as unknown as { copiedChallenge: string }).copiedChallenge);
  await page.goto(copied.replace('/?challenge=', '/?debug=1&challenge='));
  await page.getByRole('button', { name: /ACEPTAR.*DESAFÍO/i }).click();
  await expect.poll(async () => (await snapshot(page))?.state).toBe('ready');
  expect((await snapshot(page))?.seed).toBe(seed);
});

test('audio settings persist after a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /AJUSTES|SETTINGS/i }).click();
  const music = page.getByRole('switch', { name: /MÚSICA|MUSIC/i });
  const sfx = page.getByRole('switch', { name: /SONIDOS|SFX|EFECTOS DE SONIDO/i });
  await music.click();
  await sfx.click();
  await page.reload();
  await page.getByRole('button', { name: /AJUSTES|SETTINGS/i }).click();
  await expect(music).toHaveAttribute('aria-checked', 'true');
  await expect(sfx).toHaveAttribute('aria-checked', 'false');
});

test('a blocked clipboard presents a persistent selectable challenge link', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async () => { throw new DOMException('Blocked', 'NotAllowedError'); } },
      configurable: true,
    });
  });
  await start(page);
  await debug(page, 'end-run');
  await page.getByRole('button', { name: /DESAFIAR A UN AMIGO/i }).click();
  const link = page.getByRole('textbox', { name: /TU ENLACE DE DESAFÍO/i });
  await expect(link).toBeVisible();
  await expect(link).toHaveValue(/challenge=/);
  await expect(link).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: /Cerrar La revancha/i }).click();
  await page.getByRole('button', { name: /JUGAR DE NUEVO/i }).click();
  await expect.poll(async () => (await snapshot(page))?.state).toBe('ready');
});

test('desktop keeps the physical canvas proportion and has no horizontal overflow', async ({ page },testInfo) => {
  test.skip(testInfo.project.name==='chromium-mobile','Desktop geometry uses the desktop context; mobile rotation is covered separately.');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await start(page);
  const canvas = await page.locator('canvas').boundingBox();
  expect(canvas).not.toBeNull();
  expect(canvas!.width / canvas!.height).toBeCloseTo(420 / 746, 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('pause freezes a ready run and resume restores drop input', async ({ page }) => {
  test.setTimeout(100_000);
  await start(page);
  await page.getByRole('button', { name: /Pausar partida/i }).click();
  await expect.poll(async () => (await snapshot(page))?.state).toBe('paused');
  await page.keyboard.press('Space');
  expect((await snapshot(page))?.objectsPlaced).toBe(0);
  expect((await snapshot(page))?.state).toBe('paused');
  await page.getByRole('button', { name: /SEGUIR JUGANDO/i }).click();
  await expect.poll(async () => (await snapshot(page))?.state).toBe('ready');
  await landFirstBox(page);
});

test('premium coins cannot be gained locally and old ad rewards are absent',async({page})=>{
 await start(page);await landFirstBox(page);await debug(page,'end-run');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('impossible-tower.profile')!).coins)).toBe(0);
 await expect(page.getByRole('button',{name:/Duplicar coins|Segunda oportunidad/i})).toHaveCount(0);
 await page.getByRole('button',{name:/JUGAR DE NUEVO/i}).click();
 await expect.poll(async()=>(await snapshot(page))?.state).toBe('ready');
});

test('language changes in Settings and gameplay has no language toggle',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Ajustes',exact:true}).click();
 await page.getByRole('button',{name:'EN',exact:true}).click();await page.keyboard.press('Escape');
 await page.goto('/?debug=1');await page.getByRole('button',{name:'Free play',exact:true}).click();
 await expect.poll(async()=>(await snapshot(page))?.state).toBe('ready');await landFirstBox(page);
 await expect(page.getByRole('button',{name:'EN',exact:true})).toHaveCount(0);
 await expect(page.getByText('HEIGHT',{exact:true})).toBeVisible();
 await debug(page,'end-run');await expect(page.getByRole('button',{name:/PLAY AGAIN/})).toBeVisible();
 await page.reload();await expect(page.getByRole('button',{name:'Free play',exact:true})).toBeVisible();
});

test('one stable mouse click restarts despite repeated snapshots, rewards and badges',async({page},testInfo)=>{
 test.skip(testInfo.project.name==='chromium-mobile','Mouse geometry is covered by the desktop project.');
 await page.setViewportSize({width:1280,height:720});await start(page);await landFirstBox(page);await debug(page,'end-run');
 const button=page.getByRole('button',{name:/JUGAR DE NUEVO/i});await button.scrollIntoViewIfNeeded();
 const original=await button.elementHandle();const before=await button.boundingBox();expect(before).not.toBeNull();
 await page.mouse.move(before!.x+before!.width/2,before!.y+before!.height/2);
 await page.mouse.down();await page.waitForTimeout(350);
 expect(await original!.evaluate(el=>el.isConnected)).toBe(true);
 const after=await button.boundingBox();expect(after).toEqual(before);
 await page.mouse.up();await expect.poll(async()=>(await snapshot(page))?.state).toBe('ready');
 expect((await snapshot(page))?.objectsPlaced).toBe(0);
});

test('mandatory public name rejects empty input and guests cannot enter competitive Daily',async({page})=>{
 await page.addInitScript(()=>localStorage.removeItem('impossible-tower.profile'));
 await page.goto('/');await page.getByRole('button',{name:'Juego libre',exact:true}).click();
 await page.getByRole('button',{name:'Jugar como invitado',exact:true}).click();
 const name=page.getByRole('textbox',{name:'Nombre público obligatorio'});await expect(name).toBeVisible();
 await name.fill('   ');await page.getByRole('button',{name:'Continuar',exact:true}).click();await expect(name).toBeVisible();
 await name.fill('Tester');await page.getByRole('button',{name:'Continuar',exact:true}).click();
 await expect(page.getByRole('button',{name:'Pausar partida'})).toBeVisible();
 await page.getByRole('button',{name:'Pausar partida'}).click();await page.getByRole('button',{name:'VOLVER AL MENÚ',exact:true}).click();
 await page.getByRole('button',{name:'Daily Tower',exact:true}).click();await expect(page.getByRole('dialog',{name:'Daily Tower',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Continuar con Google',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Jugar como invitado',exact:true})).toHaveCount(0);
});
