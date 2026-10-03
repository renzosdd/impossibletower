import { expect, test, type Page } from '@playwright/test';

interface Snapshot { state: string; objectsPlaced: number; height: number; score: number; seed: string; assisted?: boolean; }
interface Result { coins: number; height: number; score: number; assisted?: boolean; }
interface DebugController {
  snapshot(): Snapshot;
  result(): Result;
  appearance(): string;
  debug(command: string, value?: string): void;
}
interface StoredProfile { coins: number; runs: number; selectedCosmetics: { effect: string }; unlockedCosmetics: string[]; }
interface Ledger { coinClaims: number; day: string; pendingTrial: boolean; }
interface ObservedAds { started: number; dialogsDuringAds: number; }

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => (window as unknown as { __tower: DebugController }).__tower.snapshot());
}
async function result(page: Page): Promise<Result> {
  return page.evaluate(() => (window as unknown as { __tower: DebugController }).__tower.result());
}
async function appearance(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { __tower: DebugController }).__tower.appearance());
}
async function profile(page: Page): Promise<StoredProfile> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('impossible-tower.profile')!));
}
async function ledger(page: Page): Promise<Ledger | null> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('impossible-tower.rewards.v1') ?? 'null'));
}
async function debug(page: Page, command: string, value?: string): Promise<void> {
  await page.evaluate(({ command, value }) => {
    (window as unknown as { __tower: DebugController }).__tower.debug(command, value);
  }, { command, value });
}
async function panelCommand(page: Page, name: string): Promise<void> {
  await page.locator('.debug-panel summary').click();
  await page.getByRole('button', { name, exact: true }).click();
  await page.locator('.debug-panel summary').click();
}
async function setAd(page: Page, success = true): Promise<void> {
  await panelCommand(page, success ? 'Ad success' : 'Ad error');
}
async function skins(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Skins$/i }).click();
  await expect(page.getByRole('dialog', { name: 'Un poco de estilo.' })).toBeVisible();
}
async function closeSkins(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Cerrar Un poco de estilo.' }).click();
}
async function observeShopAds(page: Page): Promise<void> {
  await page.evaluate(() => {
    const tracked = window as unknown as { observedAds: ObservedAds };
    tracked.observedAds = { started: 0, dialogsDuringAds: 0 };
    new MutationObserver(() => {
      if (!document.querySelector('#game-shell')!.hasAttribute('inert')) return;
      tracked.observedAds.started++;
      tracked.observedAds.dialogsDuringAds += document.querySelectorAll('.ui-dialog[open]').length;
    }).observe(document.querySelector('#game-shell')!, { attributes: true, attributeFilter: ['inert'] });
  });
}
async function play(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^JUGAR$/i }).click();
  await expect.poll(async () => (await snapshot(page)).state).toBe('ready');
}
async function recoverableMiss(page: Page): Promise<void> {
  for (let count = 1; count <= 3; count++) {
    await debug(page, 'center');
    await page.locator('canvas').tap({ position: { x: 150, y: 400 } });
    await expect.poll(async () => (await snapshot(page)).objectsPlaced, { timeout: 12_000 }).toBe(count);
  }
  await debug(page, 'force-object', 'box');
  await debug(page, 'miss');
  await page.locator('canvas').tap({ position: { x: 150, y: 400 } });
  await expect.poll(async () => (await snapshot(page)).state, { timeout: 12_000 }).toBe('over');
  await expect(page.getByRole('button', { name: /Segunda oportunidad/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Duplicar coins/i })).toBeVisible();
}

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(() => { expect(errors).toEqual([]); });

test('coin bonuses persist through reload, stop at three and reset on the next UTC day', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-03T23:59:50.000Z'));
  await page.goto('/?debug=1');
  await setAd(page);
  await skins(page);
  await observeShopAds(page);
  const bonus = page.getByRole('button', { name: /\+25 coins/i });
  for (let count = 1; count <= 2; count++) {
    await bonus.click();
    await expect.poll(async () => (await profile(page)).coins).toBe(count * 25);
    await expect(page.getByRole('dialog', { name: 'Un poco de estilo.' })).toBeVisible();
  }
  expect(await page.evaluate(() => (window as unknown as { observedAds: ObservedAds }).observedAds)).toEqual({ started: 2, dialogsDuringAds: 0 });
  expect(await ledger(page)).toMatchObject({ day: '2026-10-03', coinClaims: 2 });
  await page.reload();
  await setAd(page);
  await skins(page);
  await expect(bonus).toContainText('1/3 HOY');
  await bonus.click();
  await expect.poll(async () => (await profile(page)).coins).toBe(75);
  await expect(bonus).toBeDisabled();
  await page.reload();
  await setAd(page);
  await skins(page);
  await expect(bonus).toBeDisabled();
  expect(await ledger(page)).toMatchObject({ day: '2026-10-03', coinClaims: 3 });
  await page.clock.setFixedTime(new Date('2026-10-04T00:00:01.000Z'));
  await closeSkins(page);
  await skins(page);
  await expect(bonus).toBeEnabled();
  await expect(bonus).toContainText('3/3 HOY');
  await bonus.click();
  await expect.poll(async () => (await profile(page)).coins).toBe(100);
  expect(await ledger(page)).toMatchObject({ day: '2026-10-04', coinClaims: 1 });
});

test('a pending Confetti trial survives reload and UTC rollover without another offer or permanent unlock', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-03T23:59:50.000Z'));
  await page.goto('/?debug=1');
  await setAd(page);
  await skins(page);
  await page.getByRole('button', { name: /Probar Confeti/i }).click();
  await expect.poll(async () => (await ledger(page))?.pendingTrial).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Un poco de estilo.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Probar Confeti/i })).toHaveCount(0);
  expect((await profile(page)).unlockedCosmetics).not.toContain('effect-confetti');
  await page.clock.setFixedTime(new Date('2026-10-04T00:00:01.000Z'));
  await page.reload();
  await setAd(page);
  await skins(page);
  await expect(page.getByRole('button', { name: /Probar Confeti/i })).toHaveCount(0);
  expect((await ledger(page))?.pendingTrial).toBe(true);
  await closeSkins(page);
  await play(page);
  expect(await appearance(page)).toBe('effect-confetti');
  expect((await ledger(page))?.pendingTrial).toBe(false);
  expect((await profile(page)).selectedCosmetics.effect).toBe('effect-default');
});

test('purchased Confetti removes the optional trial and remains purchased after reload', async ({ page }) => {
  await page.goto('/?debug=1');
  await panelCommand(page, 'Agregar coins');
  await setAd(page);
  await skins(page);
  await page.locator('[data-id="effect-confetti"]').click();
  await expect.poll(async () => (await profile(page)).unlockedCosmetics).toContain('effect-confetti');
  await expect(page.getByRole('button', { name: /Probar Confeti/i })).toHaveCount(0);
  await page.reload();
  await setAd(page);
  await skins(page);
  await expect(page.getByRole('button', { name: /Probar Confeti/i })).toHaveCount(0);
  expect((await profile(page)).selectedCosmetics.effect).toBe('effect-confetti');
  expect((await ledger(page))?.pendingTrial ?? false).toBe(false);
});

test('Confetti lasts through a second chance, restores the selected effect and allows the final coin double', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?debug=1');
  await panelCommand(page, 'Agregar coins');
  await setAd(page);
  await skins(page);
  await page.locator('[data-id="effect-sparks"]').click();
  await page.getByRole('button', { name: /Probar Confeti/i }).click();
  await expect.poll(async () => (await ledger(page))?.pendingTrial).toBe(true);
  const initial = await profile(page);
  await closeSkins(page);
  await play(page);
  expect(await appearance(page)).toBe('effect-confetti');
  await recoverableMiss(page);
  expect(await appearance(page)).toBe('effect-confetti');
  const failed = await result(page);
  const seed = (await snapshot(page)).seed;
  await page.getByRole('button', { name: /Segunda oportunidad/i }).click();
  await expect.poll(async () => (await snapshot(page)).state).toBe('ready');
  expect((await snapshot(page)).seed).toBe(seed);
  expect((await snapshot(page)).objectsPlaced).toBe(3);
  expect(await appearance(page)).toBe('effect-confetti');
  expect((await profile(page)).coins).toBe(initial.coins);
  expect((await profile(page)).runs).toBe(initial.runs);
  expect((await profile(page)).selectedCosmetics.effect).toBe('effect-sparks');
  await debug(page, 'end-run');
  await expect(page.getByRole('button', { name: /Duplicar coins/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Segunda oportunidad/i })).toHaveCount(0);
  const final = await result(page);
  expect(final.assisted).toBe(true);
  expect(final.coins).toBe(failed.coins);
  expect((await profile(page)).runs).toBe(initial.runs + 1);
  expect((await profile(page)).coins).toBe(initial.coins + final.coins);
  expect(await appearance(page)).toBe('effect-sparks');
  await page.getByRole('button', { name: /Duplicar coins/i }).click();
  await expect(page.getByRole('button', { name: /Duplicar coins/i })).toHaveCount(0);
  expect((await profile(page)).coins).toBe(initial.coins + final.coins * 2);
  expect((await result(page)).height).toBe(final.height);
  expect((await result(page)).score).toBe(final.score);
  expect((await profile(page)).unlockedCosmetics).not.toContain('effect-confetti');
  await page.getByRole('button', { name: /JUGAR DE NUEVO/i }).click();
  await expect.poll(async () => (await snapshot(page)).state).toBe('ready');
  expect(await appearance(page)).toBe('effect-sparks');
});

test('choosing a successful coin double closes the offered second chance and awards it only once', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?debug=1');
  await setAd(page);
  await play(page);
  await recoverableMiss(page);
  const before = await profile(page);
  const earned = await result(page);
  await page.getByRole('button', { name: /Duplicar coins/i }).click();
  await expect(page.getByRole('button', { name: /Segunda oportunidad/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Duplicar coins/i })).toHaveCount(0);
  expect((await profile(page)).coins).toBe(before.coins + earned.coins);
  expect((await profile(page)).runs).toBe(before.runs);
  expect((await result(page)).height).toBe(earned.height);
  expect((await result(page)).score).toBe(earned.score);
  await page.reload();
  expect((await profile(page)).coins).toBe(before.coins + earned.coins);
});

test('choosing a failed coin double still finalizes the result and closes the second chance', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?debug=1');
  await setAd(page, false);
  await play(page);
  await recoverableMiss(page);
  const before = await profile(page);
  const earned = await result(page);
  await page.getByRole('button', { name: /Duplicar coins/i }).click();
  await expect(page.getByText(/El anuncio no estuvo disponible/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Segunda oportunidad/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /JUGAR DE NUEVO/i })).toBeEnabled();
  expect((await profile(page)).coins).toBe(before.coins);
  expect((await profile(page)).runs).toBe(before.runs);
  expect((await result(page)).height).toBe(earned.height);
  expect((await result(page)).score).toBe(earned.score);
  await page.getByRole('button', { name: /JUGAR DE NUEVO/i }).click();
  await expect.poll(async () => (await snapshot(page)).state).toBe('ready');
});

test('failed shop and second-chance ads grant nothing and returning to the menu starts no ad break', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?debug=1');
  await setAd(page, false);
  await skins(page);
  await page.getByRole('button', { name: /\+25 coins/i }).click();
  await expect(page.getByText(/El anuncio no estuvo disponible/i)).toBeVisible();
  await page.getByRole('button', { name: /Probar Confeti/i }).click();
  await expect(page.getByText(/El anuncio no estuvo disponible/i)).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Un poco de estilo.' })).toBeVisible();
  expect((await profile(page)).coins).toBe(0);
  expect(await ledger(page)).toBeNull();
  await closeSkins(page);
  await play(page);
  await recoverableMiss(page);
  const before = await profile(page);
  const earned = await result(page);
  await page.getByRole('button', { name: /Segunda oportunidad/i }).click();
  await expect(page.getByText(/El anuncio no estuvo disponible/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Segunda oportunidad/i })).toBeVisible();
  expect((await snapshot(page)).state).toBe('over');
  expect((await profile(page)).coins).toBe(before.coins);
  expect((await result(page)).score).toBe(earned.score);
  await expect(page.locator('#game-shell')).not.toHaveAttribute('inert', '');
  await page.evaluate(() => {
    const tracked = window as unknown as { automaticAdBreaks: number };
    tracked.automaticAdBreaks = 0;
    new MutationObserver(records => {
      tracked.automaticAdBreaks += records.filter(record => record.attributeName === 'inert').length;
    }).observe(document.querySelector('#game-shell')!, { attributes: true, attributeFilter: ['inert'] });
  });
  await page.getByRole('button', { name: /Volver al menú/i }).click();
  await expect(page.getByRole('button', { name: /^JUGAR$/i })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { automaticAdBreaks: number }).automaticAdBreaks)).toBe(0);
  expect((await profile(page)).coins).toBe(before.coins);
  expect(await ledger(page)).toBeNull();
});
