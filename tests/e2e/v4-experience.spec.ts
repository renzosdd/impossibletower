import { expect,test,type Page } from '@playwright/test';
async function accountHarness(page:Page,view:'account'|'shop'|'coins'|'ranking'='shop'){
 await page.addInitScript(()=>localStorage.setItem('impossible-tower.privacy.v1',JSON.stringify({version:1,ageGroup:'adult',guardianAuthorized:false,adsConsent:'denied',updatedAt:new Date().toISOString()})));
 await page.goto('/');await page.evaluate(async view=>{
  const {AccountInterface}=await import('/src/ui/AccountInterface.ts');const root=document.createElement('div');root.id='v4-account-harness';document.body.append(root);const events:unknown[]=[];
  const ui=new AccountInterface(root,{onAction:action=>{events.push(action);if(['buyAid','buyCosmetic','buyCoins','redeemCode'].includes(action.type))ui.setState({busy:true});}});
  const state={localCoins:0,publicName:'Tester',snapshot:{balance:100,recoverable:true,inventory:{preview:2,focus:1,'guide-5':1},onlineCosmetics:['crane-coral'],gameplayEarned:0,missionEarned:4,adBonusClaims:0,transactions:[{id:'test',source:'daily-missions',coins:2,items:{},createdAt:new Date().toISOString()}]},ownedCosmetics:['crane-classic'],selectedCosmetics:{crane:'crane-classic'}};
  ui.setState(state);ui.setEnabledFlags({economy:true,rankings:true,onlineAllowed:true,payments:true,paymentMode:'sandbox'});
  if(view==='ranking')ui.showLeaderboard({period:'weekly',periodId:'weekly:test',startUTC:new Date(Date.now()-86400000).toISOString(),endUTC:new Date(Date.now()+6*86400000).toISOString(),settlesAt:new Date(Date.now()+6*86400000+4500000).toISOString(),status:'open',rewardState:'eligible',minimumParticipants:20,participants:20,entries:[{rank:1,name:'Tester',height:50,score:1500,points:240,wins:2,aidsUsed:[],coins:60,items:{}},{rank:2,name:'Player',height:40,score:1200,points:220,wins:1,aidsUsed:[],coins:40,items:{}}],ownEntry:{rank:1,name:'Tester',height:50,score:1500,points:240,wins:2,aidsUsed:[],coins:60,items:{}}},'weekly');
  else if(view==='account')ui.showAccount();else if(view==='coins')ui.showCoins();else ui.showShop();
  (window as any).v4Harness={ui,events,state};
 },view);
}
const noOverflow=async(page:Page)=>{expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.locator('dialog[open]').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);};
test('fresh language follows browser order and Settings remains its only control',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'languages',{value:['fr-FR','en-US','es-UY']}));await page.goto('/');
 await expect(page.getByRole('button',{name:'Free play',exact:true})).toBeVisible();await expect(page.locator('.language-toggle')).toHaveCount(0);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.locator('.language-toggle')).toHaveCount(1);await page.getByRole('button',{name:'ES',exact:true}).click();await page.keyboard.press('Escape');await page.reload();await expect(page.getByRole('button',{name:'Juego libre',exact:true})).toBeVisible();
});
test('shop confirms spending, cancels for free, traps focus and emits one purchase',async({page},testInfo)=>{
 await accountHarness(page);const dialog=page.locator('#v4-account-harness dialog');await expect(dialog.locator('.shop-tabs button')).toHaveCount(4);await expect(dialog.locator('[data-account-action="select-aid"]')).toHaveCount(0);
 await dialog.locator('[data-account-action="buy-aid"][data-aid="guide-5"]').click();await expect(dialog.locator('.purchase-confirmation')).toContainText('75');await expect(dialog.locator('[data-account-action="cancel-purchase"]')).toBeFocused();
 for(let i=0;i<8;i++)await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement?.closest('#v4-account-harness dialog'))).toBe(true);
 await page.keyboard.press('Escape');expect(await page.evaluate(()=>(window as any).v4Harness.events)).toEqual([]);
 await dialog.locator('[data-account-action="buy-aid"][data-aid="guide-5"]').click();await noOverflow(page);await page.screenshot({path:testInfo.outputPath('confirmation.png')});
 await dialog.locator('[data-account-action="confirm-purchase"]').click();await expect(dialog.locator('[data-account-action="buy-aid"][data-aid="guide-5"]')).toBeDisabled();expect(await page.evaluate(()=>(window as any).v4Harness.events)).toEqual([{type:'buyAid',id:'guide-5'}]);
});
test('profile groups inventory and social actions and excludes badges',async({page},testInfo)=>{
 await accountHarness(page,'account');const dialog=page.locator('#v4-account-harness dialog');await expect(dialog).toContainText('Inventario');await expect(dialog.locator('.inventory-item')).toHaveCount(7);await expect(dialog.getByRole('button',{name:'Invitar amigos',exact:true})).toBeVisible();await expect(dialog.locator('.achievement-row,.badge-family')).toHaveCount(0);await noOverflow(page);await page.screenshot({path:testInfo.outputPath('profile.png')});
});
test('coins integrates earnings, code and adult confirmation before PayPal',async({page},testInfo)=>{
 await accountHarness(page,'coins');const dialog=page.locator('#v4-account-harness dialog');await expect(dialog.locator('#promo-code')).toBeVisible();await expect(dialog.locator('.coin-paths button')).toHaveCount(4);await noOverflow(page);await page.screenshot({path:testInfo.outputPath('coins.png')});
 await dialog.locator('[data-account-action="buy-coins"][data-pack="small"]').click();const confirm=dialog.locator('[data-account-action="confirm-purchase"]');await expect(confirm).toBeDisabled();await expect(dialog).toContainText('USD 2.99');await dialog.locator('[data-account-adult]').check();await expect(confirm).toBeEnabled();await dialog.locator('[data-account-action="cancel-purchase"]').click();expect(await page.evaluate(()=>(window as any).v4Harness.events)).toEqual([]);
 await dialog.locator('#promo-code').fill('company-26');await dialog.locator('.promo-form button').click();expect(await page.evaluate(()=>(window as any).v4Harness.events)).toEqual([{type:'redeemCode',code:'COMPANY-26'}]);
});
test('ranking focuses on rows, weekly prize and timing with no invitation',async({page},testInfo)=>{
 await accountHarness(page,'ranking');const dialog=page.locator('#v4-account-harness dialog');await expect(dialog.locator('.account-ranking-row')).toHaveCount(2);await expect(dialog.locator('.ranking-prizes')).toContainText('60');await expect(dialog.locator('.renewal-timer')).toBeVisible();await expect(dialog.getByRole('button',{name:'Invitar amigos',exact:true})).toHaveCount(0);await noOverflow(page);await page.screenshot({path:testInfo.outputPath('ranking.png')});
});
test('English badges have twelve families, tier names, symbols and two title lines',async({page},testInfo)=>{
 await page.addInitScript(()=>localStorage.setItem('impossible-tower.language','en'));await page.goto('/');await page.getByRole('button',{name:'Badges',exact:true}).click();const dialog=page.locator('dialog[open]');await expect(dialog.locator('.badge-family')).toHaveCount(12);await expect(dialog.locator('.badge-level')).toHaveCount(36);await expect(dialog.locator('.badge-title')).toHaveText('Small feats.Big wins.');await expect(dialog.locator('.badge-title br')).toHaveCount(1);await expect(dialog).toContainText('Silver');await noOverflow(page);await page.screenshot({path:testInfo.outputPath('badges-en.png')});
});
test('short screen retains reachable actions and reduced motion feedback',async({page},testInfo)=>{
 await page.setViewportSize({width:320,height:568});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');await page.screenshot({path:testInfo.outputPath('home-short.png')});await page.getByRole('button',{name:'Misiones',exact:true}).click();const dialog=page.locator('dialog[open]');await expect(dialog.locator('.mission-card')).toHaveCount(5);await expect(dialog.locator('.renewal-timer')).toBeVisible();await noOverflow(page);await page.screenshot({path:testInfo.outputPath('missions-short.png')});await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Misiones',exact:true})).toBeFocused();
});
