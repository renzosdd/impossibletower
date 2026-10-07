import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, resolve, sep } from 'node:path';

interface StoredProfile {
  coins: number;
  personalBest: number;
  publicName: string;
  selectedCosmetics: { effect: string };
  unlockedCosmetics: string[];
  settings: { music: boolean; sfx: boolean; haptics: boolean };
}

interface DebugController {
  snapshot(): { state: string; objectsPlaced: number };
  appearance(): string;
  debug(command: string, value?: string): void;
}

function entryScript(html: string): string {
  const entry = /<script[^>]+src="(\/assets\/index-[^"]+\.js)"/.exec(html)?.[1];
  if (!entry) throw new Error('A production entry script is required.');
  return entry;
}

function previousBuildHtml(root: string): string {
  const commits = execFileSync('git', ['log', '-n', '12', '--format=%H', '--', 'index.html'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  for (const commit of commits) {
    const html = execFileSync('git', ['show', `${commit}:index.html`], { cwd: root, encoding: 'utf8' });
    const entry = /<script[^>]+src="(\/assets\/index-[^"]+\.js)"/.exec(html)?.[1];
    if (entry && existsSync(resolve(root, entry.slice(1)))) return html;
  }
  throw new Error('The preserved previous production bundle is required for the upgrade fixture.');
}

async function profile(page: Page): Promise<StoredProfile> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('impossible-tower.profile')!));
}

test('a previous production PWA upgrades, resets local coins, preserves cosmetics and remains playable offline', async ({ page, context }) => {
  test.skip(process.env.PLAYWRIGHT_PWA !== '1', 'Requires a production build and PLAYWRIGHT_PWA=1.');
  test.setTimeout(60_000);
  const root = process.cwd();
  const previousHtml = previousBuildHtml(root);
  const currentHtml = await readFile(resolve(root, 'dist/index.html'), 'utf8');
  const previousEntry = entryScript(previousHtml);
  const currentEntry = entryScript(currentHtml);
  expect(currentEntry).not.toBe(previousEntry);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const contentTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  };
  let updated = false;
  let updateWorkerRequests = 0;
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
      const directory = updated ? resolve(root, 'dist') : root;
      const name = pathname === '/' ? 'index.html' : pathname.slice(1);
      const filename = resolve(directory, name);
      if (!filename.startsWith(`${directory}${sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const body = !updated && name === 'index.html' ? previousHtml : await readFile(filename);
      if (updated && name === 'sw.js') updateWorkerRequests++;
      response.writeHead(200, { 'Content-Type': contentTypes[extname(filename)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await page.clock.setFixedTime(new Date('2026-10-03T12:00:00Z'));
    await page.goto(`${origin}/?debug=1`);
    await expect(page.getByRole('button', { name: /^(JUGAR|Juego libre)$/i })).toBeVisible();
    await expect(page.locator('script[type="module"][src]')).toHaveAttribute('src', previousEntry);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('impossible-tower.profile')!);
      saved.coins = 731;
      saved.personalBest = 42;
      saved.unlockedCosmetics=[...new Set([...saved.unlockedCosmetics,'crane-gold'])];
      saved.selectedCosmetics.crane='crane-gold';
      saved.publicName = 'PWA upgrade';
      saved.settings = { music: false, sfx: false, haptics: false };
      localStorage.setItem('impossible-tower.profile', JSON.stringify(saved));
      localStorage.setItem('impossible-tower.rewards.v1', JSON.stringify({ version: 1, day: '2026-10-03', coinClaims: 2, pendingTrial: true }));
    });
    await page.reload();
    await expect(page.getByRole('button', { name: /^(JUGAR|Juego libre)$/i })).toBeVisible();
    const preservedProfile = await profile(page);
    expect(preservedProfile.coins).toBe(731);
    updated = true;
    const navigation = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame(), timeout: 20_000 });
    await page.evaluate(() => {
      navigator.serviceWorker.addEventListener('controllerchange', () => sessionStorage.setItem('pwa-upgrade-controller', 'changed'), { once: true });
      void navigator.serviceWorker.ready.then(registration => registration.update());
    });
    await navigation;
    await expect(page.locator('script[type="module"][src]')).toHaveAttribute('src', currentEntry);
    await expect(page.getByRole('button', { name: /^Juego libre$/i })).toBeVisible();
    expect(updateWorkerRequests).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('pwa-upgrade-controller'))).toBe('changed');
    expect(await profile(page)).toMatchObject({
      coins: 0, personalBest: preservedProfile.personalBest, publicName: preservedProfile.publicName,
      selectedCosmetics: preservedProfile.selectedCosmetics, unlockedCosmetics: preservedProfile.unlockedCosmetics, settings: preservedProfile.settings,
    });
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('script[type="module"][src]')).toHaveAttribute('src', currentEntry);
    await expect(page.getByRole('button', { name: /^Juego libre$/i })).toBeVisible();
    await expect(page.getByRole('button',{name:/\+25 (coins|monedas)/i})).toHaveCount(0);
    await page.getByRole('button', { name: /^Juego libre$/i }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __tower: DebugController }).__tower.snapshot().state)).toBe('ready');
    expect(await page.evaluate(() => (window as unknown as { __tower: DebugController }).__tower.appearance())).toBe('effect-confetti');
    expect((await profile(page)).selectedCosmetics.effect).toBe(preservedProfile.selectedCosmetics.effect);
    expect((await profile(page)).unlockedCosmetics).not.toContain('effect-confetti');
    await page.evaluate(() => (window as unknown as { __tower: DebugController }).__tower.debug('center'));
    await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __tower: DebugController }).__tower.snapshot().objectsPlaced), { timeout: 12_000 }).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await context.setOffline(false);
    await page.goto('about:blank');
    server.closeAllConnections();
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  }
});

 test.beforeEach(async({page})=>{await page.addInitScript(()=>{if(!localStorage.getItem('impossible-tower.profile'))localStorage.setItem('impossible-tower.profile',JSON.stringify({version:2,economyVersion:3,publicName:'Tester'}));});});
