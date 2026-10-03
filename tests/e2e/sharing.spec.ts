import { expect, test } from '@playwright/test';
import { decodeChallenge } from '../../src/services/sharing/challenge';

test('sharing a result renders an actual 1080×1920 PNG file with its challenge URL', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        const file = data.files?.[0];
        if (!file) throw new Error('Expected an actual image file');
        const bitmap = await createImageBitmap(file);
        (window as any).sharedImage = {
          width: bitmap.width, height: bitmap.height, mimeType: file.type,
          name: file.name, url: data.url, text: data.text, size: file.size,
        };
        bitmap.close();
      },
    });
  });
  await page.goto('/?debug=1');
  await page.getByRole('button', { name: /^JUGAR$/i }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__tower?.snapshot()?.state)).toBe('ready');
  await page.evaluate(() => (window as any).__tower.debug('center'));
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => (window as any).__tower?.snapshot()?.objectsPlaced), { timeout: 12_000 }).toBe(1);
  const run = await page.evaluate(() => (window as any).__tower.snapshot());
  await page.evaluate(() => (window as any).__tower.debug('end-run'));
  await page.getByRole('button', { name: /COMPARTIR RESULTADO/i }).click();
  await expect.poll(() => page.evaluate(() => (window as any).sharedImage?.width)).toBe(1080);
  const image = await page.evaluate(() => (window as any).sharedImage);
  expect(image.height).toBe(1920);
  expect(image.mimeType).toBe('image/png');
  expect(image.name).toBe('impossible-tower.png');
  expect(image.size).toBeGreaterThan(10_000);
  const challenge = decodeChallenge(new URL(image.url).searchParams.get('challenge')!);
  expect(challenge?.seed).toBe(run.seed);
  expect(challenge?.height).toBe(run.height);
  expect(challenge?.score).toBe(run.score);
  expect(errors).toEqual([]);
});
