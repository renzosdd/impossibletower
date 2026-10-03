import { registerSW } from 'virtual:pwa-register';
import { Interface } from './ui/Interface';
import { OrientationController } from './ui/orientation';
import './ui/styles.css';
import './ui/rewards.css';
import type { UIAction, RunConfig, RunResult, Profile, GameSnapshot, Challenge } from './types';
import { beginSession, recordRun, recordShare, buyCosmetic } from './services/storage/progress';
import { loadProfile, saveProfile, defaultProfile, STORAGE_KEY } from './services/storage/profile';
import { dailySeed, randomSeed } from './utils/rng';
import { decodeChallenge, shareResult } from './services/sharing/challenge';
import { createAdProvider, GoogleH5AdProvider, MockAdProvider, type AdResult } from './services/ads';
import { RewardLedger, REWARDS_STORAGE_KEY } from './services/ads/rewards';
import { createAnalytics, type AnalyticsProperties } from './services/analytics';
import { AudioManager } from './game/systems/AudioManager';
import { BackendService, sanitizePublicName } from './services/backend';
import type { TowerScene } from './game/scenes/TowerScene';
import { CURRENT_OBJECT_CATALOG, isObjectCatalog } from './content/objects';
import { privacyConsent } from './services/privacy';
import { AccountService } from './services/account';
import { AccountInterface, type AccountAction } from './ui/AccountInterface';
import type { AccountRun, AccountSnapshot, RunTicket } from './types/account';
import { ACCOUNT_COSMETICS } from './content/cosmetics';
import './ui/account.css';
import { connectGoogleTcfConsent } from './services/privacy/tcf';

let profile = beginSession(loadProfile());
saveProfile(profile);
const analytics = createAnalytics(), ads = createAdProvider(), audio = new AudioManager(profile.settings), backend = new BackendService();
const account = new AccountService(backend.getAuthClient());
let accountSnapshot: AccountSnapshot | null = null, runTicket: RunTicket | null = null, accountRun: AccountRun | null = null;
let accountBusy = false, accountDialogOpen = false, accountEmail = '', accountAuthMode: 'link' | 'sign-in' = 'link', otpSent = false;
let pendingSubmission: Promise<void> | undefined;
let pendingReceipt: Promise<unknown> | undefined;
let rewards = new RewardLedger();
let scene: TowerScene | undefined;
let gameConfig: RunConfig | undefined;
let lastResult: RunResult | undefined;
let beforeRun: Profile = structuredClone(profile);
let snapshot: GameSnapshot | undefined;
let adActive = false, starting = false, manualPaused = false, secondChanceUsed = false, doubleCoinsUsed = false, committed = true, activeTrial = false;
let installPrompt: InstallPrompt | undefined;
interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }>; }
const params = new URLSearchParams(location.search), token = params.get('challenge');
let challenge: Challenge | undefined = (token ? decodeChallenge(token) : null) ?? undefined;
function track(name: string, extra: AnalyticsProperties = {}) {
 analytics.track(name, { mode: gameConfig?.mode, seed: gameConfig?.seed, height: snapshot?.height, score: snapshot?.score, objectsPlaced: snapshot?.objectsPlaced, sessionNumber: profile.sessionCount, runNumber: profile.runs + 1, duration: snapshot?.duration, deviceClass: matchMedia('(pointer:coarse)').matches ? 'mobile' : 'desktop', ...extra });
}
const ui = new Interface(document.querySelector<HTMLElement>('#ui')!, action => { void handle(action); });
const accountUI = new AccountInterface(document.querySelector<HTMLElement>('#ui')!, {
 onAction: action => { void handleAccount(action); },
 onDialogChange: open => { accountDialogOpen = open; applyPause(); },
});
const orientation = new OrientationController(() => { applyPause(); refreshRewards(); });
function applyPause() {
 const paused = !gameConfig || manualPaused || document.hidden || adActive || orientation.blocked || accountBusy || accountDialogOpen || privacyConsent.load().ageGroup === 'under13';
 scene?.pause(paused);
 audio.pause(paused);
 if (paused || lastResult) ads.gameplayStop?.();
 else ads.gameplayStart?.();
}
function applySceneProfile() {
 const appearance = activeTrial ? { ...profile, selectedCosmetics: { ...profile.selectedCosmetics, effect: 'effect-confetti' } } : profile;
 scene?.setProfile(appearance);
}
function refreshRewards() {
 ui.setRewardAvailability(ads.isRewardedAvailable(), canRetry(), !doubleCoinsUsed);
 ui.setShopRewards(usesAccountAds() ? Math.max(0,3-(accountSnapshot?.adBonusClaims??0)) : rewards.bonusRemaining(), rewards.canClaimConfetti(profile.unlockedCosmetics.includes('effect-confetti')));
 if (snapshot) accountUI.setRun(snapshot, { available: runTicket?.aids.filter(id => (accountSnapshot?.inventory[id] ?? 0) > 0) ?? [], used: snapshot.aidsUsed ?? [], canAid: id => !!runTicket && !!scene?.canActivateAid(id) });
}
function usesAccountAds() { return account.enabled && !!accountSnapshot?.recoverable && ads instanceof GoogleH5AdProvider && params.get('debug') !== '1'; }
function updateProfile() {
 saveProfile(profile);
 ui.setProfile(profile);
 applySceneProfile();
 refreshRewards();
 accountUI.setState({localCoins:profile.coins});
 accountUI.renderMenu();
}
ui.setBackendAvailable(backend.enabled);
ui.showMenu(profile, challenge);
accountUI.renderMenu();
applyPause();
track('session_start');
if (challenge) track('challenge_opened', { seed: challenge.seed });
if (token && !challenge && !/^[0-9a-f-]{36}$/i.test(token)) ui.toast('Ese desafío no es válido. Podés jugar una torre nueva.');
connectGoogleTcfConsent(privacyConsent);
void refreshAccount();
registerSW({ immediate: true, onRegisterError: () => {} });
const boot = Promise.all([import('phaser'), import('./game/scenes/TowerScene')]).then(([{ default: Phaser }, { TowerScene }]) => {
 scene = new TowerScene({ snapshot: s => { snapshot = s; ui.update(s); refreshRewards(); }, over: finish, event: (name, data) => {
  track(name, data as AnalyticsProperties);
  if (name === 'tutorial_complete') { profile.tutorialComplete = true; saveProfile(profile); }
 }, effect: (name, weight) => { audio.play(name, weight); if (name.startsWith('impact')) audio.haptic(weight && weight > 7 ? 18 : 8); }, moment: text => ui.showMoment(text) });
 applySceneProfile();
 new Phaser.Game({ type: Phaser.AUTO, parent: 'game-canvas', width: 420, height: 746, backgroundColor: '#335b65', transparent: false, scene: [scene], scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, render: { antialias: true, pixelArt: false }, fps: { target: 60, min: 30 }, audio: { noAudio: true }, banner: false });
 return scene.whenReady.then(() => applyPause());
}).catch(error => { ui.toast('No pudimos cargar el juego. Recargá la página para reintentar.'); console.error('Game initialization failed', error); });
void ads.initialize().then(() => { ads.loadingFinished?.(); refreshRewards(); applyPause(); });
if (privacyConsent.canUseOnlineServices()) void backend.initialize();
privacyConsent.subscribe(() => {
 connectGoogleTcfConsent(privacyConsent);
 if (privacyConsent.canUseOnlineServices()) void backend.initialize();
 else backend.getAuthClient()?.auth.stopAutoRefresh();
 void refreshAccount(); applyPause();
 void ads.initialize().then(refreshRewards);
});
if (token && !challenge && backend.enabled && privacyConsent.canUseOnlineServices()) void backend.loadChallenge(token).then(found => {
 if (found) { challenge = found; if (!gameConfig) ui.showMenu(profile, challenge); track('challenge_opened', { seed: found.seed }); }
 else ui.toast('No se pudo recuperar el desafío. Podés jugar sin conexión.');
});
function commit() {
 if (lastResult && !committed) {
  committed = true;
  const replay = scene?.replay(), ticket = runTicket;
  if (ticket && replay && !replay.tainted && privacyConsent.canUseOnlineServices()) pendingSubmission = submitAccountRun(ticket, replay.events, replay.finalTick);
  if (privacyConsent.canUseOnlineServices() && (!lastResult.catalog || lastResult.catalog === 'legacy-18')) {
   void backend.submitRun(lastResult, profile.publicName);
   void backend.syncProfile(profile);
  }
 }
 activeTrial = false;
 applySceneProfile();
 refreshRewards();
}
function canRetry() {
 return !!lastResult && !committed && lastResult.reason === 'miss' && lastResult.objectsPlaced >= 3 && !secondChanceUsed && !!scene?.canSecondChance();
}
function finish(result: RunResult) {
 ads.gameplayStop?.();
 lastResult = result;
 committed = false;
 const progress = recordRun(profile, result);
 profile = progress.profile;
 result.coins = progress.earnedCoins;
 updateProfile();
 track('game_over', { reason: result.reason, height: result.height, score: result.score, duration: result.duration });
 if (result.mode === 'daily') track('daily_complete');
 if (result.mode === 'challenge') track('challenge_completed', { won: result.challengeWon ?? false });
 for (const id of progress.completedMissions) track('mission_completed', { mission: id });
 ui.showResult(result, profile);
 refreshRewards();
 if (ads.isRewardedAvailable()) track('rewarded_offer_shown');
 if (!canRetry() || !ads.isRewardedAvailable() && (!runTicket?.aids.includes('second-chance') || !(accountSnapshot?.inventory['second-chance'] ?? 0))) commit();
 if (result.challengeWon) ui.showMoment('¡Ganaste el desafío!');
 if (installPrompt && profile.runs >= 3) ui.showInstallAvailable(true);
}
async function start(config: RunConfig) {
 if (adActive || starting || orientation.blocked) return;
 starting = true;
 try {
  if (privacyConsent.load().ageGroup === 'under13') { ui.toast('Impossible Tower es para mayores de 13 años.'); return; }
  config = { ...config, catalog: config.challenge?.version === 1 ? 'legacy-18' : config.challenge?.catalog ?? config.catalog ?? (config.mode === 'daily' ? 'legacy-18' : isObjectCatalog(import.meta.env.VITE_OBJECT_CATALOG) ? import.meta.env.VITE_OBJECT_CATALOG : CURRENT_OBJECT_CATALOG) };
  commit();
  scene?.pause(true);
  audio.pause(true);
  audio.unlock();
  await boot;
  if (!scene) return;
  runTicket = null; accountRun = null;
  if (account.enabled && accountSnapshot?.recoverable && privacyConsent.canUseOnlineServices() && config.mode !== 'challenge' && params.get('debug') !== '1') {
   await pendingReceipt;
   runTicket = await account.startRun(config.mode, accountUI.getLoadout(), undefined, profile.publicName);
   if (runTicket) { config = { ...config, seed: runTicket.seed, catalog: runTicket.catalog, ruleset: 'v2' }; accountUI.clearLoadout(); }
   else ui.toast('La cuenta no respondió. Esta torre se guarda en el dispositivo.');
  }
  manualPaused = false;
  gameConfig = config;
  lastResult = undefined;
  secondChanceUsed = false;
  doubleCoinsUsed = false;
  beforeRun = structuredClone(profile);
  activeTrial = rewards.consumeConfettiTrial();
  applySceneProfile();
  scene.start(config);
  scene.pause(true);
  if (runTicket) for (const id of runTicket.aids.filter(id => ['guide-5','guide-10','preview','focus'].includes(id))) {
   const permitted = await account.useAid(runTicket.id, id, 0);
   if (permitted) scene.activateAid(id);
  }
  ui.showGame(config, profile);
  accountUI.renderMenu();
  refreshRewards();
  applyPause();
  track('game_start');
  if (config.mode === 'daily') track('daily_start');
  if (!profile.tutorialComplete) track('tutorial_start');
 } finally { starting = false; }
}
async function adBreak(operation: () => Promise<AdResult>): Promise<AdResult | undefined> {
 if (adActive) return;
 adActive = true;
 document.body.classList.add('ad-active');
 orientation.setAdActive(true);
 ui.setAdActive(true);
 applyPause();
 document.querySelector('#game-shell')?.setAttribute('inert', '');
 document.querySelector('.desktop-context')?.setAttribute('inert', '');
 try { return await operation(); }
 catch { return undefined; }
 finally {
  document.querySelector('#game-shell')?.removeAttribute('inert');
  document.querySelector('.desktop-context')?.removeAttribute('inert');
  document.body.classList.remove('ad-active');
  adActive = false;
  ui.setAdActive(false);
  orientation.setAdActive(false);
  applyPause();
 }
}
function accountView() { return { localCoins:profile.coins,snapshot:accountSnapshot,email:accountEmail,authMode:accountAuthMode,otpSent,busy:accountBusy,error:account.lastError,run:accountRun,selectedCosmetic:profile.selectedCosmetics.crane }; }
async function refreshAccount() {
 const onlineAllowed=privacyConsent.canUseOnlineServices();
 const rankingPeriods=(import.meta.env.VITE_RANKING_PERIODS??'daily').split(',').map((value:string)=>value.trim()).filter((value:string)=>['daily','weekly','monthly'].includes(value)) as import('./content/economy').RankingPeriod[];
 accountUI.setEnabledFlags({economy:account.enabled,rankings:account.enabled&&import.meta.env.VITE_SERVER_RANKINGS_ENABLED==='true',rankingPeriods,payments:account.enabled&&import.meta.env.VITE_PAYPAL_ENABLED==='true',paymentMode:import.meta.env.VITE_PAYPAL_ENABLED!=='true'?'disabled':import.meta.env.VITE_PAYPAL_ENVIRONMENT==='live'?'live':'sandbox',onlineAllowed});
 if(account.enabled&&onlineAllowed) {
  await backend.initialize();
  const state=await account.snapshot();
  if(state) {
   accountSnapshot=state;
   const session=await Promise.race([backend.getAuthClient()?.auth.getSession(),new Promise<undefined>(resolve=>setTimeout(resolve,10000))]);accountEmail=session?.data.session?.user.email??'';
   profile.unlockedCosmetics=[...new Set([...profile.unlockedCosmetics,...state.onlineCosmetics])];saveProfile(profile);
  }
 }
 accountUI.setState(accountView());refreshRewards();
 if(account.enabled&&onlineAllowed&&params.get('paypal')==='return'&&params.get('token')) {
  const orderId=params.get('token')!;params.delete('paypal');params.delete('token');params.delete('PayerID');
  const state=await account.captureOrder(orderId);
  if(state){accountSnapshot=state;accountUI.showAccount(accountView());ui.toast('Compra acreditada en tu cuenta.');}
  else accountUI.showAccount({...accountView(),error:account.lastError??'No se pudo confirmar la compra.'});
  const clean=new URL(location.href);clean.searchParams.delete('paypal');clean.searchParams.delete('token');clean.searchParams.delete('PayerID');history.replaceState(null,'',clean);
 }
}
async function submitAccountRun(ticket:RunTicket,events:import('./types/account').ReplayInput[],finalTick:number) {
 const receipt=account.finishRun({runId:ticket.id,events,finalTick});
 pendingReceipt=receipt;
 let status=await receipt;
 if(runTicket?.id===ticket.id){accountRun=status;accountUI.setState(accountView());}
 if(!status)return;
 for(let attempt=0;attempt<6&&['pending','validating'].includes(status.status);attempt++) {
  await new Promise(resolve=>setTimeout(resolve,1000));
  const next=await account.run(ticket.id);if(!next)break;status=next;
 }
 if(runTicket?.id===ticket.id)accountRun=status;
 await refreshAccount();
 if(status.status==='accepted')ui.toast(`Partida validada: +${status.result?.earnedCoins??0} coins de cuenta.`);
 else if(status.status==='rejected'||status.status==='verification_timeout')ui.toast('El resultado quedó local. No se acreditaron coins de cuenta.');
}
function continueTower():boolean {
 if(!scene?.secondChance())return false;
 secondChanceUsed=true;
 const settings=profile.settings,publicName=profile.publicName,tutorialComplete=profile.tutorialComplete;
 profile=structuredClone(beforeRun);profile.settings=settings;profile.publicName=publicName;profile.tutorialComplete=tutorialComplete;
 profile.unlockedCosmetics=[...new Set([...profile.unlockedCosmetics,...(accountSnapshot?.onlineCosmetics??[])])];
 lastResult=undefined;committed=true;updateProfile();ui.showGame(gameConfig!,profile);accountUI.renderMenu();return true;
}
async function handleAccount(action:AccountAction) {
 if(adActive||accountBusy||orientation.blocked)return;
 if(action.type==='ageGroup'){privacyConsent.saveAgeGroup(action.value);return;}
 if(action.type==='guardian'){privacyConsent.saveGuardianAuthorization(action.authorized);return;}
 if(action.type==='adsConsent'){privacyConsent.saveAdsConsent(action.value);return;}
 if(action.type==='loadout')return;
 if(!privacyConsent.canUseOnlineServices()){accountUI.showPrivacySetup();return;}
 if(!account.enabled){accountUI.showAccount({...accountView(),error:'La cuenta online todavía no está habilitada. Tu progreso local sigue disponible.'});return;}
 accountBusy=true;accountUI.setState(accountView());applyPause();
 try {
  switch(action.type) {
   case 'login': {
    await backend.initialize();accountEmail=action.email;accountAuthMode=action.mode;
    otpSent=action.mode==='link'?await account.linkEmail(action.email):await account.signIn(action.email);
    accountUI.showAccount(accountView());break;
   }
   case 'verify': {
    const ok=await account.verifyEmail(action.email,action.token,action.mode==='link'?'email_change':'email');
    if(ok){otpSent=false;await refreshAccount();ui.toast('Cuenta vinculada.');}accountUI.showAccount(accountView());break;
   }
   case 'buyAid': {const state=await account.buyAid(action.id);if(state)accountSnapshot=state;accountUI.showShop(accountView());break;}
   case 'buyCosmetic': {const state=await account.buyCosmetic(action.id);if(state){accountSnapshot=state;profile.unlockedCosmetics=[...new Set([...profile.unlockedCosmetics,...state.onlineCosmetics])];saveProfile(profile);}accountUI.showShop(accountView());break;}
   case 'equipCosmetic': {
    const cosmetic=ACCOUNT_COSMETICS.find(item=>item.id===action.id);
    if(cosmetic&&accountSnapshot?.onlineCosmetics.includes(action.id)){profile.selectedCosmetics[cosmetic.category]=action.id;updateProfile();ui.toast(`${cosmetic.name} equipada.`);}
    break;
   }
   case 'useAid': {
    if(!runTicket||!scene?.canActivateAid(action.id)||action.id==='second-chance'&&!canRetry())break;
    const permitted=await account.useAid(runTicket.id,action.id,scene.replay().finalTick);
    if(permitted){if(action.id==='second-chance')continueTower();else scene.activateAid(action.id);await refreshAccount();}
    else ui.toast(account.lastError??'No se pudo usar la ayuda.');
    break;
   }
   case 'rankings': {const board=await account.leaderboard(action.period);accountUI.showLeaderboard(board,action.period,account.lastError??(!board?'El ranking todavía no está habilitado.':''));break;}
   case 'buyCoins': {
    if(privacyConsent.load().ageGroup!=='adult'){accountUI.showShop({...accountView(),error:'La compra debe realizarla un adulto desde su cuenta.'});break;}
    const order=await account.createOrder(action.packId,action.adultConfirmed);
    if(order){const url=new URL(order.approvalUrl);if(url.protocol!=='https:'||!['www.paypal.com','www.sandbox.paypal.com'].includes(url.hostname))throw new Error('Destino de pago inválido.');location.assign(url.href);}
    else accountUI.showShop(accountView());break;
   }
  }
 }catch(error){ui.toast(error instanceof Error?error.message:'La cuenta no respondió. Podés seguir jugando.');}
 finally{accountBusy=false;accountUI.setState(accountView());applyPause();refreshRewards();}
}
async function handle(action: UIAction) {
 if (adActive || starting || accountBusy || accountDialogOpen || orientation.blocked) return;
 audio.unlock();
 if (action.type !== 'drop') audio.play('button');
 switch (action.type) {
  case 'play': await start({ mode: action.mode, seed: action.mode === 'daily' ? dailySeed() : action.mode === 'challenge' && challenge ? challenge.seed : randomSeed(), challenge: action.mode === 'challenge' ? challenge : undefined }); break;
  case 'restart': await start({ mode: gameConfig?.mode ?? 'casual', seed: gameConfig?.mode === 'casual' ? randomSeed() : gameConfig?.seed ?? dailySeed(), challenge: gameConfig?.challenge }); break;
  case 'drop': scene?.drop(); break;
  case 'pause': manualPaused = action.paused; applyPause(); break;
  case 'menu': commit(); gameConfig = undefined; snapshot = undefined; accountUI.setRun(null); applyPause(); ui.showMenu(profile, challenge); accountUI.renderMenu(); break;
  case 'reward-options': refreshRewards(); break;
  case 'settings': profile.settings = action.settings; audio.setSettings(profile.settings); updateProfile(); break;
  case 'name': profile.publicName = sanitizePublicName(action.name).replace(/^Anónimo$/, ''); updateProfile(); break;
  case 'cosmetic': {
   if (ACCOUNT_COSMETICS.some(item => item.id === action.id)) { await handleAccount({type:'equipCosmetic',id:action.id}); break; }
   const old = profile.unlockedCosmetics.includes(action.id), purchase = buyCosmetic(profile, action.id);
   if (purchase.ok) { profile = purchase.profile; updateProfile(); if (!old) track('cosmetic_unlocked', { cosmetic: action.id }); }
   ui.toast(purchase.message); break;
  }
  case 'share': if (lastResult) {
   const sharedRun = structuredClone(lastResult), name = profile.publicName;
   track('share_clicked'); commit();
   const shared = await shareResult(sharedRun, name, action.image);
   track('challenge_created', { seed: sharedRun.seed });
   if (privacyConsent.canUseOnlineServices() && (!sharedRun.catalog || sharedRun.catalog === 'legacy-18')) void backend.saveChallenge({ version: 1, seed: sharedRun.seed, height: sharedRun.height, score: sharedRun.score, name: name || undefined });
   if (shared.method !== 'manual') {
    const progress = recordShare(profile); profile = progress.profile; updateProfile();
    for (const id of progress.completedMissions) track('mission_completed', { mission: id });
    track('share_success', { method: shared.method });
    ui.toast(shared.method === 'copy' ? 'Enlace copiado. ¡Desafiá a alguien!' : 'Desafío compartido.');
   } else ui.showShareLink(shared.url);
  } break;
  case 'leaderboard': {
   if(!privacyConsent.canUseOnlineServices()){accountUI.showPrivacySetup();break;}
   const entries = await backend.leaderboard(action.kind);
   if (backend.lastError) ui.toast('El ranking no respondió. Podés seguir jugando.');
   if (!gameConfig) ui.showLeaderboard(entries, action.kind);
   break;
  }
  case 'reward': {
   if (!ads.isRewardedAvailable()) return;
   const remote = usesAccountAds() && action.reward !== 'cosmetic-trial';
   if (action.reward === 'second-chance' && !canRetry()) return;
   if (action.reward === 'double-coins' && (!lastResult || doubleCoinsUsed || lastResult.coins <= 0)) return;
   if (action.reward === 'coin-bonus' && (remote ? (accountSnapshot?.adBonusClaims??0)>=3 : rewards.bonusRemaining()<=0)) return;
   if (action.reward === 'cosmetic-trial' && !rewards.canClaimConfetti(profile.unlockedCosmetics.includes('effect-confetti'))) return;
   if (action.reward === 'double-coins') commit();
   accountBusy = remote;
   applyPause();
   let intent: {id:string;expiresAt:string} | null = null;
   try {
   if (remote) {
    if (action.reward === 'double-coins') await pendingSubmission;
    intent = await account.adIntent(action.reward as 'coin-bonus'|'double-coins'|'second-chance', runTicket?.id);
    if (!intent) { ui.toast(account.lastError??'La recompensa no está disponible.'); return; }
   }
   track('rewarded_started', { reward: action.reward });
   const response = await adBreak(() => ads.rewardedAd(action.reward));
   if (!response?.success || remote && response.evidence !== 'browser-callback') {
    if (intent) await account.cancelAd(intent.id);
    track('rewarded_failed'); refreshRewards(); ui.toast('El anuncio no estuvo disponible. Tu partida está guardada.'); return;
   }
   if (intent) {
    const grant = await account.completeAd(intent.id,true,response.evidence);
    if (!grant) { ui.toast(account.lastError??'No se pudo confirmar la recompensa.'); return; }
    if (action.reward === 'second-chance') {
     if (!('seed' in grant)) return;
     runTicket = grant;
     if (!scene || !await account.useAid(grant.id,'second-chance',scene.replay().finalTick)) { ui.toast('No se pudo confirmar la continuación.'); return; }
    } else {
     if (!('balance' in grant)) return;
     accountSnapshot = grant;
     if (action.reward === 'double-coins' && runTicket) {
      const state = await account.doubleCoins(runTicket.id,intent.id);
      if (!state) { ui.toast(account.lastError??'No se pudo confirmar la duplicación.'); return; }
      accountSnapshot = state;
     }
    }
    accountUI.setState(accountView());
   }
   track('rewarded_completed', { reward: action.reward });
   if (action.reward === 'second-chance' && lastResult) {
    continueTower();
   } else if (action.reward === 'double-coins' && lastResult) {
    doubleCoinsUsed = true;
    profile.coins += lastResult.coins;
    lastResult.coins *= 2;
    updateProfile(); if(privacyConsent.canUseOnlineServices())void backend.syncProfile(profile);
    ui.showResult(lastResult, profile); ui.toast('Coins duplicadas.');
   } else if (action.reward === 'coin-bonus') {
    const bonus = rewards.grantCoinBonus();
    profile.coins += bonus; updateProfile();
    ui.toast(remote ? '+25 coins de cuenta.' : bonus > 0 ? '+25 coins. ¡Elegí tu estilo!' : 'Ya usaste los tres bonos de hoy.');
   } else if (action.reward === 'cosmetic-trial') {
    if (rewards.claimConfetti(profile.unlockedCosmetics.includes('effect-confetti'))) ui.toast('Confeti listo para tu próxima torre.');
   }
   refreshRewards();
   } finally { accountBusy=false;applyPause();refreshRewards(); }
   break;
  }
  case 'install': if (installPrompt) { track('pwa_install_prompt'); await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = undefined; ui.showInstallAvailable(false); } break;
  case 'debug': if (params.get('debug') === '1') {
   if (action.command === 'reset') {
    commit();
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(REWARDS_STORAGE_KEY); } catch {}
    rewards = new RewardLedger(); profile = beginSession(defaultProfile()); gameConfig = undefined; lastResult = undefined;
    updateProfile(); ui.showMenu(profile, challenge); applyPause();
   } else if (action.command === 'coins') { profile.coins += 1000; updateProfile(); ui.toast('+1000 coins de prueba'); }
   else if (action.command === 'seed') await start({ mode: 'casual', seed: action.value || 'debug-tower' });
   else if (action.command === 'ad-success' || action.command === 'ad-error') {
    if (ads instanceof MockAdProvider) ads.setDebugResult(action.command === 'ad-success');
    refreshRewards(); ui.toast('Simulación publicitaria configurada.');
   } else scene?.debug(action.command, action.value);
  } break;
 }
}
document.addEventListener('pointerdown', () => { if (!adActive && !orientation.blocked) audio.unlock(); }, { once: true });
document.addEventListener('visibilitychange', () => { applyPause(); refreshRewards(); });
window.addEventListener('beforeinstallprompt', (event: Event) => { event.preventDefault(); installPrompt = event as InstallPrompt; if (profile.runs >= 3) ui.showInstallAvailable(true); });
window.addEventListener('appinstalled', () => { track('pwa_installed'); installPrompt = undefined; ui.showInstallAvailable(false); });
if (params.get('debug') === '1' || import.meta.env.DEV && params.get('inspect') === '1') Object.assign(window, { __tower: {
 snapshot: () => snapshot, result: () => lastResult,
 replay: () => scene?.replay(), timing: () => scene?.timing(),
 ...(params.get('debug') === '1' ? { debug: (command: string, value?: string) => { if (!adActive && !orientation.blocked) scene?.debug(command, value); } } : {}),
 drop: () => { if (!adActive && !orientation.blocked) scene?.drop(); },
 appearance: () => activeTrial ? 'effect-confetti' : profile.selectedCosmetics.effect,
} });
