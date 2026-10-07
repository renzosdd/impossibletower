import { expect, test, type CDPSession, type Page } from '@playwright/test';

interface Snapshot {
  state: string;
  seed: string;
  height: number;
  score: number;
  objectsPlaced: number;
  duration: number;
  objectIds: string[];
}

interface DebugController {
  snapshot(): Snapshot | undefined;
  debug(command: string, value?: string): void;
}

async function snapshot(page: Page): Promise<Snapshot | undefined> {
  return page.evaluate(() => (window as unknown as { __tower: DebugController }).__tower.snapshot());
}

async function debug(page: Page, command: string): Promise<void> {
  await page.evaluate(command => (window as unknown as { __tower: DebugController }).__tower.debug(command), command);
}

async function metrics(page: Page, session: CDPSession, landscape: boolean, keyboard = false): Promise<void> {
  if (!keyboard) await page.setViewportSize({ width: landscape ? 851 : 393, height: landscape ? 393 : 851 });
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: landscape ? 851 : 393,
    height: keyboard ? 260 : landscape ? 393 : 851,
    screenWidth: landscape ? 851 : 393,
    screenHeight: landscape ? 393 : 851,
    deviceScaleFactor: 2.75,
    mobile: true,
    screenOrientation: { type: landscape ? 'landscapePrimary' : 'portraitPrimary', angle: landscape ? 90 : 0 },
  });
}

test.beforeEach(async ({ page },testInfo) => {
  test.skip(testInfo.project.name==='chromium-desktop'&&!testInfo.title.includes('desktop landscape'),'Orientation blocking is specific to touch devices.');
  await page.addInitScript(() => {
    Object.defineProperty(screen.orientation, 'lock', { configurable: true, value: () => Promise.reject(new DOMException('Portrait lock unsupported', 'NotSupportedError')) });
  });
});

async function start(page: Page): Promise<void> {
  await page.goto('/?debug=1');
  await page.getByRole('button', { name: /^Juego libre$/i }).click();
  await expect.poll(async () => (await snapshot(page))?.state).toBe('ready');
}

async function landFirstBox(page: Page): Promise<void> {
  await debug(page, 'center');
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snapshot(page))?.objectsPlaced, { timeout: 12_000 }).toBe(1);
}

test('mobile landscape blocks the menu and Escape cannot dismiss the guard', async ({ page, context }) => {
  const session = await context.newCDPSession(page);
  await metrics(page, session, true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Girá tu dispositivo' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Juego libre$/i })).not.toBeVisible();
  await expect(page.locator('.desktop-context')).not.toBeVisible();
  await page.screenshot({ path: test.info().outputPath('landscape-guard.png') });
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => screen.orientation.type)).toBe('landscape-primary');
  await expect(page.locator('#orientation-guard')).toBeVisible();
  await metrics(page, session, false);
  await expect(page.locator('#orientation-guard')).not.toBeVisible();
  await expect(page.getByRole('button', { name: /^Juego libre$/i })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('portrait-menu.png') });
});

test('rotation freezes a real tower and restores its seed, height, score and input', async ({ page, context }) => {
  const session = await context.newCDPSession(page);
  await metrics(page, session, false);
  await start(page);
  await landFirstBox(page);
  const before = (await snapshot(page))!;
  await page.screenshot({ path: test.info().outputPath('portrait-tower.png') });
  await metrics(page, session, true);
  await expect(page.locator('#orientation-guard')).toBeVisible();
  await expect.poll(async () => (await snapshot(page))?.state).toBe('paused');
  const paused = (await snapshot(page))!;
  await page.keyboard.press('Space');
  await page.waitForTimeout(1_100);
  const frozen = (await snapshot(page))!;
  expect(frozen.duration).toBe(paused.duration);
  expect(frozen.objectsPlaced).toBe(before.objectsPlaced);
  expect(frozen.objectIds).toEqual(before.objectIds);
  expect(frozen.seed).toBe(before.seed);
  expect(frozen.height).toBe(before.height);
  expect(frozen.score).toBe(before.score);
  await metrics(page, session, false);
  await expect(page.locator('#orientation-guard')).not.toBeVisible();
  await expect.poll(async () => (await snapshot(page))?.state).toBe('ready');
  await debug(page, 'center');
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snapshot(page))?.objectsPlaced, { timeout: 12_000 }).toBe(2);
  expect((await snapshot(page))?.seed).toBe(before.seed);
});

test('manual pause remains after a landscape round trip', async ({ page, context }) => {
  const session = await context.newCDPSession(page);
  await metrics(page, session, false);
  await start(page);
  await page.getByRole('button', { name: 'Pausar partida' }).click();
  await expect.poll(async () => (await snapshot(page))?.state).toBe('paused');
  await metrics(page, session, true);
  await expect(page.locator('#orientation-guard')).toBeVisible();
  await metrics(page, session, false);
  await expect(page.locator('#orientation-guard')).not.toBeVisible();
  await expect(page.getByRole('button', { name: /SEGUIR JUGANDO/i })).toBeVisible();
  expect((await snapshot(page))?.state).toBe('paused');
  await page.keyboard.press('Space');
  expect((await snapshot(page))?.state).toBe('paused');
  await page.getByRole('button', { name: /SEGUIR JUGANDO/i }).click();
  await expect.poll(async () => (await snapshot(page))?.state).toBe('ready');
});

test('a portrait keyboard resize does not activate the rotation guard', async ({ page, context }) => {
  const session = await context.newCDPSession(page);
  await metrics(page, session, false);
  await page.goto('/');
  await page.getByRole('button', { name: /AJUSTES/i }).click();
  await page.getByRole('textbox', { name: /NOMBRE PÚBLICO/i }).fill('Teclado');
  await metrics(page, session, false, true);
  await expect(page.locator('#orientation-guard')).not.toBeVisible();
  expect(await page.evaluate(() => screen.orientation.type)).toBe('portrait-primary');
  expect(await page.evaluate(() => document.body.classList.contains('orientation-blocked'))).toBe(false);
  await expect(page.getByRole('textbox', { name: /NOMBRE PÚBLICO/i })).toHaveValue('Teclado');
  await metrics(page, session, false);
  await expect(page.getByRole('button', { name: /Guardar nombre/i })).toBeVisible();
});

test('desktop landscape preserves the normal presentation', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, baseURL });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('#orientation-guard')).not.toBeVisible();
  await expect(page.getByRole('button', { name: /^Juego libre$/i })).toBeVisible();
  await expect(page.locator('.desktop-context')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});

test('a result keeps restart available after rotation and cannot invoke removed coin ads',async({page,context})=>{
 const session=await context.newCDPSession(page);await metrics(page,session,false);await start(page);await landFirstBox(page);await debug(page,'end-run');await expect(page.getByRole('button',{name:/Duplicar coins/i})).toHaveCount(0);await metrics(page,session,true);await expect(page.locator('#orientation-guard')).toBeVisible();await metrics(page,session,false);await expect(page.locator('#orientation-guard')).not.toBeVisible();await expect(page.getByRole('button',{name:/JUGAR DE NUEVO/i})).toBeEnabled();
});

 test.beforeEach(async({page})=>{await page.addInitScript(()=>{if(!localStorage.getItem('impossible-tower.profile'))localStorage.setItem('impossible-tower.profile',JSON.stringify({version:2,economyVersion:3,publicName:'Tester'}));});});
