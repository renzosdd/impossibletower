import { expect, test } from '@playwright/test';

/** Run against npm run preview with PLAYWRIGHT_PWA=1, never against a dev SW. */
test('the production manifest and offline shell support a real playable run', async ({ page, context }) => {
  test.skip(process.env.PLAYWRIGHT_PWA !== '1', 'Requires a production preview and PLAYWRIGHT_PWA=1.');
  test.setTimeout(45_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1');
  await expect(page.getByRole('button', { name: /^Juego libre$/i })).toBeVisible();
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
    if (!href) throw new Error('Manifest missing');
    return await (await fetch(href)).json();
  });
  expect(manifest.name).toBe('Impossible Tower');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((icon: { sizes: string }) => icon.sizes === '192x192')).toBe(true);
  expect(manifest.icons.some((icon: { sizes: string }) => icon.sizes === '512x512')).toBe(true);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Juego libre$/i })).toBeVisible();
  await page.getByRole('button', { name: /^Juego libre$/i }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__tower?.snapshot()?.state)).toBe('ready');
  await page.evaluate(() => (window as any).__tower.debug('center'));
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => (window as any).__tower?.snapshot()?.objectsPlaced), { timeout: 12_000 }).toBe(1);
  expect(errors).toEqual([]);
});

 test.beforeEach(async({page})=>{await page.addInitScript(()=>{if(!localStorage.getItem('impossible-tower.profile'))localStorage.setItem('impossible-tower.profile',JSON.stringify({version:2,economyVersion:3,publicName:'Tester'}));});});
