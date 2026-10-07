import { getLanguage, setLanguage, t, localizeDocument } from './services/i18n';
import { registerSW } from 'virtual:pwa-register';
import { Interface } from './ui/Interface';
import { OrientationController } from './ui/orientation';
import './ui/styles.css';
import './ui/rewards.css';
import type { UIAction, RunConfig, RunResult, Profile, GameSnapshot, Challenge } from './types';
import { beginSession, recordRun, recordShare, buyCosmetic } from './services/storage/progress';
import { loadProfile, saveProfile, defaultProfile, migrateProfile, STORAGE_KEY } from './services/storage/profile';
import { dailySeed, randomSeed } from './utils/rng';
import { decodeChallenge, shareResult } from './services/sharing/challenge';
import { createAdProvider, GoogleH5AdProvider, MockAdProvider, type AdResult } from './services/ads';
import { RewardLedger, REWARDS_STORAGE_KEY } from './services/ads/rewards';
import { createAnalytics, type AnalyticsProperties } from './services/analytics';
import { AudioManager } from './game/systems/AudioManager';
import { BackendService, sanitizePublicName, requiredPublicName } from './services/backend';
import type { TowerScene } from './game/scenes/TowerScene';
import { CURRENT_OBJECT_CATALOG, isObjectCatalog } from './content/objects';
import { privacyConsent } from './services/privacy';
import { AccountService } from './services/account';
import { AccountInterface, type AccountAction } from './ui/AccountInterface';
import type { AccountRun, AccountSnapshot, RunTicket } from './types/account';
import { ACCOUNT_COSMETICS, COSMETICS } from './content/cosmetics';
import './ui/account.css';
import { connectGoogleTcfConsent } from './services/privacy/tcf';

let profile = beginSession(loadProfile());
let profileSync:ReturnType<typeof setTimeout>|undefined;
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
let loginMode: 'daily' | 'casual' = 'daily';
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
localizeDocument();
if(params.has('error'))ui.toast('El acceso con Google se canceló o no se pudo completar. Podés reintentarlo.');
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
 ui.setRewardAvailability(false, false, false);
 ui.setShopRewards(0,false);
 if(snapshot)accountUI.setRun(snapshot,{available:runTicket?.aids??[],used:snapshot.aidsUsed??[],canAid:id=>!!runTicket&&!!scene?.canActivateAid(id)&&(id!=='second-chance'||canRetry())});
}
function updateProfile() {
 saveProfile(profile);
 clearTimeout(profileSync);
 if(accountSnapshot?.recoverable&&privacyConsent.canUseOnlineServices())profileSync=setTimeout(()=>void backend.syncProfile(profile),250);
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
 if(lastResult&&!committed){
  committed=true;
  const replay=scene?.replay(),ticket=runTicket;
  const progress=recordRun(profile,lastResult);profile=progress.profile;lastResult.coins=0;updateProfile();
  if(accountSnapshot?.recoverable&&privacyConsent.canUseOnlineServices())void backend.syncProfile(profile);
  ui.setProvisional(false);ui.showProgress(progress.completedMissions,progress.newAchievements,false);
  if(ticket&&replay&&!replay.tainted&&privacyConsent.canUseOnlineServices())pendingSubmission=submitAccountRun(ticket,replay.events,replay.finalTick);
 }
 activeTrial=false;applySceneProfile();refreshRewards();
}
function canRetry(){return !!lastResult&&!committed&&lastResult.reason!=='timeout'&&lastResult.objectsPlaced>=3&&!secondChanceUsed&&!!scene?.canSecondChance()&&!!runTicket&&!!accountSnapshot?.recoverable&&((accountSnapshot.inventory['second-chance']??0)>0||accountSnapshot.balance>=90);}
function finish(result:RunResult){
 ads.gameplayStop?.();lastResult=result;committed=false;result.coins=0;
 ui.showResult(result,profile);refreshRewards();
 ui.setProvisional(canRetry());
 track('game_over',{reason:result.reason,height:result.height,score:result.score,duration:result.duration});
 if(!canRetry())commit();
 if(result.challengeWon)ui.showMoment('¡Ganaste el desafío!');
}
async function start(config: RunConfig) {
 if (adActive || starting || orientation.blocked) return;
 starting = true;ui.setStarting(true);
 try {
  if (privacyConsent.load().ageGroup === 'under13') { ui.toast('Impossible Tower es para mayores de 13 años.'); return; }
  if(config.mode==='daily'&&params.get('debug')!=='1'&&!accountSnapshot?.recoverable){loginMode='daily';ui.showModeLogin('daily');return;}
  if(config.mode==='daily'&&params.get('debug')!=='1'&&accountSnapshot?.attempts){await refreshAccount();const a=accountSnapshot?.attempts;if(a&&a.freeRemaining+a.adRemaining+a.purchasedRemaining<=0){ui.showDailyRefill();return;}}
  if(!requiredPublicName(profile.publicName)){const name=await ui.requestName();if(!name)return;profile.publicName=name;saveProfile(profile);}
  config = { ...config, ruleset:config.mode==='challenge'?(config.challenge?.version===3?'v3':'v2'):'v3', catalog: config.challenge?.version === 1 ? 'legacy-18' : config.challenge?.catalog ?? config.catalog ?? (config.mode === 'daily' ? 'legacy-18' : isObjectCatalog(import.meta.env.VITE_OBJECT_CATALOG) ? import.meta.env.VITE_OBJECT_CATALOG : CURRENT_OBJECT_CATALOG) };
  commit();
  scene?.pause(true);
  audio.pause(true);
  audio.unlock();
  await boot;
  if (!scene) return;
  runTicket = null; accountRun = null;
  if (account.enabled && privacyConsent.canUseOnlineServices() && config.mode !== 'challenge' && params.get('debug') !== '1') {
   await pendingReceipt;
   runTicket = await account.startRun(config.mode, accountSnapshot?.recoverable?accountUI.getLoadout():[], undefined, profile.publicName);
   if (runTicket) { config = { ...config, seed: runTicket.seed, catalog: runTicket.catalog, ruleset: runTicket.ruleset }; accountUI.clearLoadout(); }
   else if(config.mode==='daily'){if(account.lastError==='No Daily attempts left'){await refreshAccount();ui.showDailyRefill();}else ui.toast(account.lastError??'No se pudo iniciar Daily.');return;}else ui.toast('Sin conexión: esta práctica no participa en rankings ni acredita monedas.');
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
  if(runTicket)await refreshAccount();
  ui.showGame(config, profile);
  if(!runTicket&&config.mode!=='challenge')ui.toast('Sin conexión: esta práctica no participa en rankings ni acredita monedas.');
  accountUI.renderMenu();
  refreshRewards();
  applyPause();
  track('game_start');
  if (config.mode === 'daily') track('daily_start');
  if (!profile.tutorialComplete) track('tutorial_start');
 } finally { starting = false;ui.setStarting(false); }
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
function accountView() { return { localCoins:profile.coins,ownedCosmetics:profile.unlockedCosmetics,selectedCosmetics:profile.selectedCosmetics,achievements:profile.achievements,badgeProgress:profile.badgeProgress,snapshot:accountSnapshot,email:accountEmail,authMode:accountAuthMode,otpSent,busy:accountBusy,error:account.lastError,run:accountRun,selectedCosmetic:profile.selectedCosmetics.crane }; }
async function refreshAccount() {
 const onlineAllowed=privacyConsent.canUseOnlineServices();
 const rankingPeriods=(import.meta.env.VITE_RANKING_PERIODS??'daily,monthly').split(',').map((value:string)=>value.trim()).filter((value:string)=>['daily','monthly'].includes(value)) as import('./content/economy').RankingPeriod[];
 accountUI.setEnabledFlags({economy:account.enabled,rankings:account.enabled&&import.meta.env.VITE_SERVER_RANKINGS_ENABLED==='true',rankingPeriods,payments:false,paymentMode:'disabled',onlineAllowed});
 if(account.enabled&&onlineAllowed) {
  await backend.initialize();
  const state=await account.snapshot();
  if(state) {
   accountSnapshot=state;
   const session=await Promise.race([backend.getAuthClient()?.auth.getSession(),new Promise<undefined>(resolve=>setTimeout(resolve,10000))]);accountEmail=session?.data.session?.user.email??'';
   const owner=session?.data.session?.user.id;
   if(owner){try{const previous=localStorage.getItem('impossible-tower.owner');if(previous!==owner&&state.recoverable){const cloud=await backend.loadCloudProfile();profile=cloud?migrateProfile(cloud):defaultProfile();ui.setProfile(profile);}localStorage.setItem('impossible-tower.owner',owner);}catch{}}

   profile.unlockedCosmetics=[...new Set([...profile.unlockedCosmetics,...state.onlineCosmetics])];
   if(state.progress){profile.missionDay=state.attempts?.day??new Date().toISOString().slice(0,10);profile.achievements=[...new Set([...profile.achievements,...state.progress.achievements])];for(const [id,value]of Object.entries(state.progress.badgeProgress))profile.badgeProgress![id]=Math.max(profile.badgeProgress?.[id]??0,value);for(const [id,value]of Object.entries(state.progress.missions))profile.missions[id]=value;}
   if(state.dailyBest)profile.daily[state.attempts?.day??new Date().toISOString().slice(0,10)]={best:state.dailyBest,attempts:0};saveProfile(profile);
   try{if(params.get('ref')&&!state.recoverable&&!localStorage.getItem('impossible-tower.referral')){const ref=await account.captureReferral(params.get('ref')!);if(ref?.token)localStorage.setItem('impossible-tower.referral',ref.token);}
   const referral=localStorage.getItem('impossible-tower.referral');if(referral&&state.recoverable){await account.claimReferral(referral);localStorage.removeItem('impossible-tower.referral');}}catch{}
  }
 }
 accountUI.setState(accountView());ui.setAccount(accountSnapshot,ads.isRewardedAvailable());refreshRewards();

}
async function submitAccountRun(ticket:RunTicket,events:import('./types/account').ReplayInput[],finalTick:number) {
 const receipt=account.finishRun({runId:ticket.id,ruleset:ticket.ruleset,events,finalTick});
 pendingReceipt=receipt;
 let status=await receipt;
 if(runTicket?.id===ticket.id){accountRun=status;accountUI.setState(accountView());}
 if(!status){ui.toast(account.lastError??'No se pudo enviar el resultado.');return;}
 try{const ids=JSON.parse(localStorage.getItem('impossible-tower.pending-runs')??'[]') as string[];localStorage.setItem('impossible-tower.pending-runs',JSON.stringify([...new Set([...ids,ticket.id])]));}catch{}
 for(let attempt=0;attempt<6&&['pending','validating'].includes(status.status);attempt++) {
  await new Promise(resolve=>setTimeout(resolve,1000));
  const next=await account.run(ticket.id);if(!next)break;status=next;
 }
 if(runTicket?.id===ticket.id)accountRun=status;
 await refreshAccount();
 if(!['pending','validating'].includes(status.status))try{localStorage.setItem('impossible-tower.pending-runs',JSON.stringify((JSON.parse(localStorage.getItem('impossible-tower.pending-runs')??'[]') as string[]).filter(id=>id!==ticket.id)));}catch{}
 if(status.status==='accepted'){if(runTicket?.id===ticket.id){ui.showProgress(status.result?.completedMissions,status.result?.newAchievements,true,status.result?.earnedCoins??0);}ui.toast(`Ganaste ${status.result?.earnedCoins??0} monedas`);}
 else if(status.status==='rejected'||status.status==='verification_timeout')ui.toast('El resultado quedó local. No se acreditaron coins de cuenta.');
}
function continueTower():boolean {
 if(!scene?.secondChance())return false;
 secondChanceUsed=true;
 lastResult=undefined;committed=true;updateProfile();ui.showGame(gameConfig!,profile);accountUI.renderMenu();return true;
}
async function handleAccount(action:AccountAction) {
 if(adActive||accountBusy||orientation.blocked)return;
 if(action.type==='ageGroup'){privacyConsent.saveAgeGroup(action.value);return;}
 if(action.type==='guardian'){privacyConsent.saveGuardianAuthorization(action.authorized);return;}
 if(action.type==='adsConsent'){privacyConsent.saveAdsConsent(action.value);return;}
 if(action.type==='loadout')return;
 if(!account.enabled&&action.type==='google'){ui.showModeLogin(loginMode,'Google todavía no está disponible.');return;}
 if(!privacyConsent.canUseOnlineServices()){if(action.type==='google')ui.closeModeDialog();accountUI.showPrivacySetup(action.type==='google'?action:undefined);return;}
 if(!account.enabled){accountUI.showAccount({...accountView(),error:'La cuenta online todavía no está habilitada. Tu progreso local sigue disponible.'});return;}
 accountBusy=true;accountUI.setState(accountView());if(action.type==='google')ui.setLoginPending(true);applyPause();
 try {
  switch(action.type) {
   case 'google': {accountUI.closeDialog();if(!requiredPublicName(profile.publicName)){ui.closeModeDialog();const name=await ui.requestName();if(!name)break;profile.publicName=name;saveProfile(profile);}ui.showModeLogin(loginMode);ui.setLoginPending(true);await backend.initialize();await refreshAccount();const session=await backend.getAuthClient()?.auth.getSession();const link=!action.recover&&session?.data.session?.user.is_anonymous===true;if(link)await backend.syncProfile(profile);const ok=await account.google(link);if(!ok)ui.showModeLogin(loginMode,account.lastError??'No se pudo iniciar sesión. Reintentá.');break;}
   case 'logout': {commit();if(!await account.signOut()){ui.toast(account.lastError??'No se pudo cerrar la sesión.');break;}accountSnapshot=null;runTicket=null;profile=defaultProfile();updateProfile();accountUI.closeDialog();gameConfig=undefined;lastResult=undefined;snapshot=undefined;accountUI.setRun(null);ui.setAccount(null);ui.showMenu(profile,challenge);break;}
   case 'invite': {await inviteFriends();break;}
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
    const cosmetic=[...COSMETICS,...ACCOUNT_COSMETICS].find(item=>item.id===action.id);
    if(cosmetic&&(accountSnapshot?.onlineCosmetics.includes(action.id)||profile.unlockedCosmetics.includes(action.id))){profile.selectedCosmetics[cosmetic.category]=action.id;updateProfile();ui.toast(`${cosmetic.name} equipada.`);}
    break;
   }
   case 'useAid': {
    if(!runTicket||!scene?.canActivateAid(action.id)||action.id==='second-chance'&&!canRetry())break;
    const permitted=await account.useAid(runTicket.id,action.id,scene.replay().finalTick);
    if(permitted){if(action.id==='second-chance'){if(runTicket&&!runTicket.aids.includes(action.id)){runTicket.aids=runTicket.aids.length>=2?[...(snapshot?.aidsUsed??[]),action.id]:[...runTicket.aids,action.id];}continueTower();}else scene.activateAid(action.id);await refreshAccount();}
    else ui.toast(account.lastError??'No se pudo usar la ayuda.');
    break;
   }
   case 'rankings': {const board=await account.leaderboard(action.period);accountUI.showLeaderboard(board,action.period,account.lastError??(!board?'El ranking todavía no está habilitado.':''));break;}
   case 'buyCoins': {ui.toast('Compras próximamente');break;}
  }
 }catch(error){ui.toast(error instanceof Error?error.message:'La cuenta no respondió. Podés seguir jugando.');}
 finally{accountBusy=false;ui.setLoginPending(false);accountUI.setState(accountView());applyPause();refreshRewards();}
}
async function handle(action: UIAction) {
 if(action.type==='language'){setLanguage(action.language);if(!gameConfig)ui.setAccount(accountSnapshot,ads.isRewardedAvailable());return;}
 if (adActive || starting || accountBusy || accountDialogOpen || orientation.blocked) return;
 audio.unlock();
 if (action.type !== 'drop') audio.play('button');
 switch (action.type) {

  case 'google':await handleAccount({type:'google'});break;
  case 'guest':await start({mode:'casual',seed:randomSeed()});break;
  case 'finalize':commit();accountUI.renderMenu();break;
  case 'invite':await inviteFriends();break;
  case 'buy-attempt':{accountBusy=true;ui.setAttemptPending(true);let purchased=false;try{const state=await account.buyAttempt();if(state){purchased=true;accountSnapshot=state;ui.setAccount(state,ads.isRewardedAvailable());}else ui.toast(account.lastError??'Te faltan monedas.');}finally{accountBusy=false;ui.setAttemptPending(false);}if(purchased){ui.closeModeDialog();await start({mode:'daily',seed:dailySeed()});}}break;
  case 'ad-attempt':await rewardedAttempt();break;
  case 'play': if(action.mode==='casual'&&!accountSnapshot?.recoverable&&params.get('debug')!=='1'){loginMode='casual';ui.showModeLogin('casual');break;}await start({ mode: action.mode, seed: action.mode === 'daily' ? dailySeed() : action.mode === 'challenge' && challenge ? challenge.seed : randomSeed(), challenge: action.mode === 'challenge' ? challenge : undefined }); break;
  case 'restart': await start({ mode: gameConfig?.mode ?? 'casual', seed: gameConfig?.mode === 'casual' ? randomSeed() : gameConfig?.seed ?? dailySeed(), challenge: gameConfig?.challenge }); break;
  case 'drop': scene?.drop(); break;
  case 'pause': manualPaused = action.paused; applyPause(); break;
  case 'menu': commit(); gameConfig = undefined; snapshot = undefined; accountUI.setRun(null); applyPause(); ui.showMenu(profile, challenge); accountUI.renderMenu(); break;
  case 'reward-options': refreshRewards(); break;
  case 'settings': profile.settings = action.settings; audio.setSettings(profile.settings); updateProfile(); break;
  case 'name': profile.publicName = requiredPublicName(action.name); updateProfile(); break;
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
   if (sharedRun.ruleset!=='v3' && privacyConsent.canUseOnlineServices() && (!sharedRun.catalog || sharedRun.catalog === 'legacy-18')) void backend.saveChallenge({ version: 1, seed: sharedRun.seed, height: sharedRun.height, score: sharedRun.score, name: name || undefined });
   if (shared.method !== 'manual') {
    const progress = {completedMissions:[] as string[]};
    for (const id of progress.completedMissions) track('mission_completed', { mission: id });
    track('share_success', { method: shared.method });
    ui.toast(shared.method === 'copy' ? 'Enlace copiado. ¡Desafiá a alguien!' : 'Desafío compartido.');
   } else ui.showShareLink(shared.url);
  } break;
  case 'leaderboard': await handleAccount({type:'rankings',period:action.kind==='today'?'daily':'monthly'});break;
  case 'reward':break; // Coin/continuation advertising was replaced by Daily attempts.
  case 'install': if (installPrompt) { track('pwa_install_prompt'); await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = undefined; ui.showInstallAvailable(false); } break;
  case 'debug': if (params.get('debug') === '1') {
   if (action.command === 'reset') {
    commit();
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(REWARDS_STORAGE_KEY); } catch {}
    rewards = new RewardLedger(); profile = beginSession(defaultProfile()); gameConfig = undefined; lastResult = undefined;
    updateProfile(); ui.showMenu(profile, challenge); applyPause();
   } else if (action.command === 'coins') { ui.toast('Las monedas premium se administran en el servidor.'); }
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

async function inviteFriends(){
 if(!accountSnapshot?.recoverable||!accountSnapshot.referral){loginMode='daily';ui.showModeLogin('daily');return;}
 const url=new URL(location.origin+location.pathname);url.searchParams.set('ref',accountSnapshot.referral.code);
 try{if(navigator.share)await navigator.share({title:'Impossible Tower',text:t('Invitá amigos para activar los premios'),url:url.href});else{await navigator.clipboard.writeText(url.href);ui.toast('Enlace copiado.');}}catch(error){if(!(error instanceof Error&&error.name==='AbortError'))ui.showInviteLink(url.href);}
}
async function rewardedAttempt(){
 if(accountBusy||adActive||!accountSnapshot?.recoverable||!ads.isRewardedAvailable()||(accountSnapshot.attempts?.adAvailable??0)<=0)return;
 accountBusy=true;ui.setAttemptPending(true);applyPause();let intent:{id:string;expiresAt:string}|null=null;let granted=false;
 try{
  intent=await account.adIntent('daily-attempt');if(!intent){ui.toast(account.lastError??'La cuenta no respondió.');return;}
  const response=await adBreak(()=>ads.rewardedAd('daily-attempt'));
  if(!response?.success||response.evidence!=='browser-callback'){await account.cancelAd(intent.id);ui.toast('El anuncio no se completó. No recibiste ni consumiste un intento extra.');return;}
  const state=await account.completeAd(intent.id,true,response.evidence);
  if(state&&'balance'in state){granted=true;accountSnapshot=state;ui.setAccount(state,ads.isRewardedAvailable());accountUI.setState(accountView());}
  else ui.toast(account.lastError??'La cuenta no respondió.');
 }finally{accountBusy=false;ui.setAttemptPending(false);applyPause();refreshRewards();}
 if(granted){ui.closeModeDialog();await start({mode:'daily',seed:dailySeed()});}
}
// Refresh the homepage counters without recreating result buttons during clicks.
setInterval(()=>{if(!accountBusy&&!adActive&&!starting){if(!gameConfig)void refreshAccount();void recoverPendingRuns();}},30000);
async function recoverPendingRuns(){
 if(!account.enabled||!privacyConsent.canUseOnlineServices())return;
 try{const ids=JSON.parse(localStorage.getItem('impossible-tower.pending-runs')??'[]') as string[];const pending:string[]=[];
 for(const id of ids.slice(-20)){const run=await account.run(id);if(!run?account.lastError!=='Run not found':['pending','validating'].includes(run.status))pending.push(id);else if(run?.status==='accepted'){if(runTicket?.id===id)ui.showProgress(run.result?.completedMissions,run.result?.newAchievements,true,run.result?.earnedCoins??0);await refreshAccount();}}
 localStorage.setItem('impossible-tower.pending-runs',JSON.stringify(pending));}catch{}
}
