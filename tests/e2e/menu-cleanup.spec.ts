import { expect, test } from '@playwright/test';

test('home keeps three hearts, separate invitations and one ranking shortcut', async ({ page }) => {
  await page.goto('/');
  const menu=page.locator('.menu-screen');
  await expect(menu.locator('.daily-heart')).toHaveCount(3);
  await expect(menu.locator('.daily-heart.is-full')).toHaveCount(3);
  await expect(menu.locator('.mode-card p,.attempt-summary,.prize-threshold,.identity-controls')).toHaveCount(0);
  await expect(menu).not.toContainText(/Renueva en|Google requerido|20 participantes|Practicá y participá/);
  await expect(menu.getByRole('button',{name:'Jugar como invitado',exact:true})).toHaveCount(0);
  await expect(menu.getByRole('button',{name:'Continuar con Google',exact:true})).toHaveCount(0);
  await expect(menu.locator('.menu-nav').getByRole('button',{name:'Ranking',exact:true})).toBeVisible();
  await expect(menu.locator('.mode-card [data-account-action="ranking"],.mode-card [data-action="invite"]')).toHaveCount(0);
  await expect(menu.getByRole('button',{name:'Invitar amigos',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('Daily opens a compact Google-only dialog, including unavailable service feedback', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button',{name:'Daily Tower',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Daily Tower',exact:true});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Continuar con Google',exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Jugar como invitado',exact:true})).toHaveCount(0);
  await expect(dialog.locator('.account-balances,.achievement-row')).toHaveCount(0);
  await expect(dialog).not.toContainText(/Insignias|MONEDAS|Tu cuenta|20 participantes/);
  await dialog.getByRole('button',{name:'Continuar con Google',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Daily Tower',exact:true})).toContainText('Google todavía no está disponible.');
  await expect(page.locator('.account-dialog[open]')).toHaveCount(0);
});

test('Free play offers both identities and guest selection enters practice', async ({ page }) => {
  await page.addInitScript(()=>localStorage.setItem('impossible-tower.profile',JSON.stringify({version:2,economyVersion:3,publicName:'Tester'})));
  await page.goto('/');
  await page.getByRole('button',{name:'Juego libre',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Juego libre',exact:true});
  await expect(dialog.getByRole('button',{name:'Continuar con Google',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Jugar como invitado',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pausar partida'})).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('mode dialogs translate immediately and Escape returns focus to the mode', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button',{name:'Juego libre',exact:true}).click();
  await page.locator('dialog[open]').getByRole('button',{name:'EN',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Free play',exact:true})).toContainText('Continue with Google');
  await expect(page.locator('dialog[open]').getByRole('button',{name:'Play as guest',exact:true})).toBeVisible();
  await expect(page.locator('.daily-hearts')).toHaveAttribute('aria-label','Lives available: 3');
  await page.locator('dialog[open]').getByRole('button',{name:'ES',exact:true}).click();
  await expect(page.locator('.daily-hearts')).toHaveAttribute('aria-label','Vidas disponibles: 3');
  await page.locator('dialog[open]').getByRole('button',{name:'EN',exact:true}).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Free play',exact:true})).toBeFocused();
});

test('refill dialog exposes available ads and counts purchased extras without a timer', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async()=>{
    const {Interface}=await import('/src/ui/Interface.ts');
    const {defaultProfile}=await import('/src/services/storage/profile.ts');
    const root=document.createElement('div');root.id='refill-harness';document.body.append(root);
    const actions:unknown[]=[];const ui=new Interface(root,action=>actions.push(action));
    ui.showMenu(defaultProfile());
    const state={balance:30,recoverable:true,inventory:{},onlineCosmetics:[],gameplayEarned:0,missionEarned:0,adBonusClaims:0,transactions:[],attempts:{day:'2026-10-07',freeRemaining:0,adRemaining:0,purchasedRemaining:0,adAvailable:2,renewsAt:'2026-10-08T00:00:00Z'}};
    ui.setAccount(state,true);ui.showDailyRefill();(window as any).refillHarness={ui,state,actions};
  });
  const dialog=page.locator('#refill-harness dialog[open]');
  await expect(dialog.locator('.daily-heart.is-empty')).toHaveCount(3);
  await expect(dialog.locator('[data-action="buy-attempt"]')).toBeEnabled();
  await dialog.locator('[data-action="ad-attempt"]').click();
  expect(await page.evaluate(()=>(window as any).refillHarness.actions)).toEqual([{type:'ad-attempt'}]);
  await page.evaluate(()=>{const {ui}=(window as any).refillHarness;ui.setAttemptPending(true);ui.toast('El anuncio no se completó. No recibiste ni consumiste un intento extra.');ui.setAttemptPending(false);});
  await expect(dialog).toContainText('El anuncio no se completó.');
  await expect(dialog.locator('[data-action="ad-attempt"]')).toBeEnabled();
  await page.evaluate(()=>{const {ui,state}=(window as any).refillHarness;state.attempts.adAvailable=0;state.attempts.purchasedRemaining=5;ui.setAccount(state,false);ui.showDailyRefill();});
  await expect(dialog.locator('[data-action="ad-attempt"]')).toHaveCount(0);
  await expect(dialog.locator('.daily-hearts')).toHaveAttribute('aria-label','Vidas disponibles: 5');
  await expect(dialog.locator('.daily-extra')).toHaveText('+2');
  await expect(dialog).not.toContainText(/Renueva en|\d+h \d+m/);
});
