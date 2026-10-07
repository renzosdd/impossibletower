import { test, expect } from '@playwright/test';

test('legal pages load independently without game or advertising scripts', async ({ page }) => {
 for (const path of ['/privacidad/','/terminos/','/reglas-ranking/','/en/privacidad/','/en/terminos/','/en/reglas-ranking/']) {
  const response=await page.goto(path);
  expect(response?.status()).toBe(200);
  await expect(page.locator('body')).toContainText('Renzo Dogliotti');
  await expect(page.locator('body')).toContainText('newsolutions.uy@gmail.com');
  const scripts=await page.locator('script[src]').evaluateAll(nodes=>nodes.map(node=>(node as HTMLScriptElement).src));
  expect(scripts.filter(src=>!src.includes('/.netlify/scripts/hud'))).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 }
});

test('published functions refuse disabled economy and payments without initializing services', async ({ request }) => {
 test.skip(process.env.PLAYWRIGHT_RELEASE_VERIFY!=='1');
 for (const path of ['/api/account','/api/paypal-webhook']) {
  const response=await request.post(path,{data:{}});
  expect(response.status()).toBe(503);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toHaveProperty('error');
 }
});

test('published Casual uses the selected catalog while V1 challenges retain legacy objects', async ({ page }) => {
 test.skip(process.env.PLAYWRIGHT_RELEASE_VERIFY!=='1');
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/?debug=1');
 await page.getByRole('button', { name: /^Juego libre$/i }).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__tower?.snapshot()?.catalog)).toBe(process.env.PLAYWRIGHT_RELEASE_CATALOG??'extended-24');
 const challenge={version:1,seed:'release-old-challenge',height:10,score:500};
 const token=Buffer.from(JSON.stringify(challenge)).toString('base64url');
 await page.goto('/?debug=1&challenge='+token);
 await page.getByRole('button', { name: /ACEPTAR.*DESAFÍO/i }).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__tower?.snapshot()?.catalog)).toBe('legacy-18');
 expect(errors).toEqual([]);
});

 test.beforeEach(async({page})=>{await page.addInitScript(()=>{if(!localStorage.getItem('impossible-tower.profile'))localStorage.setItem('impossible-tower.profile',JSON.stringify({version:2,economyVersion:3,publicName:'Tester'}));});});
