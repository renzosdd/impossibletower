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
import { createAdProvider, MockAdProvider, type AdResult } from './services/ads';
import { RewardLedger, REWARDS_STORAGE_KEY } from './services/ads/rewards';
import { createAnalytics, type AnalyticsProperties } from './services/analytics';
import { AudioManager } from './game/systems/AudioManager';
import { BackendService, sanitizePublicName } from './services/backend';
import type { TowerScene } from './game/scenes/TowerScene';

let profile = beginSession(loadProfile());
saveProfile(profile);
const analytics = createAnalytics(), ads = createAdProvider(), audio = new AudioManager(profile.settings), backend = new BackendService();
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
const orientation = new OrientationController(() => { applyPause(); refreshRewards(); });
function applyPause() {
 const paused = !gameConfig || manualPaused || document.hidden || adActive || orientation.blocked;
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
 ui.setShopRewards(rewards.bonusRemaining(), rewards.canClaimConfetti(profile.unlockedCosmetics.includes('effect-confetti')));
}
function updateProfile() {
 saveProfile(profile);
 ui.setProfile(profile);
 applySceneProfile();
 refreshRewards();
}
ui.setBackendAvailable(backend.enabled);
ui.showMenu(profile, challenge);
applyPause();
track('session_start');
if (challenge) track('challenge_opened', { seed: challenge.seed });
if (token && !challenge && !/^[0-9a-f-]{36}$/i.test(token)) ui.toast('Ese desafío no es válido. Podés jugar una torre nueva.');
registerSW({ immediate: true, onRegisterError: () => {} });
const boot = Promise.all([import('phaser'), import('./game/scenes/TowerScene')]).then(([{ default: Phaser }, { TowerScene }]) => {
 scene = new TowerScene({ snapshot: s => { snapshot = s; ui.update(s); }, over: finish, event: (name, data) => {
  track(name, data as AnalyticsProperties);
  if (name === 'tutorial_complete') { profile.tutorialComplete = true; saveProfile(profile); }
 }, effect: (name, weight) => { audio.play(name, weight); if (name.startsWith('impact')) audio.haptic(weight && weight > 7 ? 18 : 8); }, moment: text => ui.showMoment(text) });
 applySceneProfile();
 new Phaser.Game({ type: Phaser.AUTO, parent: 'game-canvas', width: 420, height: 746, backgroundColor: '#335b65', transparent: false, scene: [scene], scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, render: { antialias: true, pixelArt: false }, fps: { target: 60, min: 30 }, audio: { noAudio: true }, banner: false });
 return scene.whenReady.then(() => applyPause());
}).catch(error => { ui.toast('No pudimos cargar el juego. Recargá la página para reintentar.'); console.error('Game initialization failed', error); });
void ads.initialize().then(() => { ads.loadingFinished?.(); refreshRewards(); applyPause(); });
void backend.initialize();
if (token && !challenge && backend.enabled) void backend.loadChallenge(token).then(found => {
 if (found) { challenge = found; if (!gameConfig) ui.showMenu(profile, challenge); track('challenge_opened', { seed: found.seed }); }
 else ui.toast('No se pudo recuperar el desafío. Podés jugar sin conexión.');
});
function commit() {
 if (lastResult && !committed) {
  committed = true;
  void backend.submitRun(lastResult, profile.publicName);
  void backend.syncProfile(profile);
 }
 activeTrial = false;
 applySceneProfile();
 refreshRewards();
}
function canRetry() {
 return !!lastResult && !committed && lastResult.reason === 'miss' && lastResult.objectsPlaced >= 3 && !lastResult.assisted && !secondChanceUsed && !!scene?.canSecondChance();
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
 if (!canRetry() || !ads.isRewardedAvailable()) commit();
 if (result.challengeWon) ui.showMoment('¡Ganaste el desafío!');
 if (installPrompt && profile.runs >= 3) ui.showInstallAvailable(true);
}
async function start(config: RunConfig) {
 if (adActive || starting || orientation.blocked) return;
 starting = true;
 try {
  commit();
  audio.unlock();
  await boot;
  if (!scene) return;
  manualPaused = false;
  gameConfig = config;
  lastResult = undefined;
  secondChanceUsed = false;
  doubleCoinsUsed = false;
  beforeRun = structuredClone(profile);
  activeTrial = rewards.consumeConfettiTrial();
  applySceneProfile();
  scene.start(config);
  ui.showGame(config, profile);
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
async function handle(action: UIAction) {
 if (adActive || starting || orientation.blocked) return;
 audio.unlock();
 if (action.type !== 'drop') audio.play('button');
 switch (action.type) {
  case 'play': await start({ mode: action.mode, seed: action.mode === 'daily' ? dailySeed() : action.mode === 'challenge' && challenge ? challenge.seed : randomSeed(), challenge: action.mode === 'challenge' ? challenge : undefined }); break;
  case 'restart': await start({ mode: gameConfig?.mode ?? 'casual', seed: gameConfig?.mode === 'casual' ? randomSeed() : gameConfig?.seed ?? dailySeed(), challenge: gameConfig?.challenge }); break;
  case 'drop': scene?.drop(); break;
  case 'pause': manualPaused = action.paused; applyPause(); break;
  case 'menu': commit(); gameConfig = undefined; applyPause(); ui.showMenu(profile, challenge); break;
  case 'reward-options': refreshRewards(); break;
  case 'settings': profile.settings = action.settings; audio.setSettings(profile.settings); updateProfile(); break;
  case 'name': profile.publicName = sanitizePublicName(action.name).replace(/^Anónimo$/, ''); updateProfile(); break;
  case 'cosmetic': {
   const old = profile.unlockedCosmetics.includes(action.id), purchase = buyCosmetic(profile, action.id);
   if (purchase.ok) { profile = purchase.profile; updateProfile(); if (!old) track('cosmetic_unlocked', { cosmetic: action.id }); }
   ui.toast(purchase.message); break;
  }
  case 'share': if (lastResult) {
   const sharedRun = structuredClone(lastResult), name = profile.publicName;
   track('share_clicked'); commit();
   const shared = await shareResult(sharedRun, name, action.image);
   track('challenge_created', { seed: sharedRun.seed });
   void backend.saveChallenge({ version: 1, seed: sharedRun.seed, height: sharedRun.height, score: sharedRun.score, name: name || undefined });
   if (shared.method !== 'manual') {
    const progress = recordShare(profile); profile = progress.profile; updateProfile();
    for (const id of progress.completedMissions) track('mission_completed', { mission: id });
    track('share_success', { method: shared.method });
    ui.toast(shared.method === 'copy' ? 'Enlace copiado. ¡Desafiá a alguien!' : 'Desafío compartido.');
   } else ui.showShareLink(shared.url);
  } break;
  case 'leaderboard': {
   const entries = await backend.leaderboard(action.kind);
   if (backend.lastError) ui.toast('El ranking no respondió. Podés seguir jugando.');
   if (!gameConfig) ui.showLeaderboard(entries, action.kind);
   break;
  }
  case 'reward': {
   if (!ads.isRewardedAvailable()) return;
   if (action.reward === 'second-chance' && !canRetry()) return;
   if (action.reward === 'double-coins' && (!lastResult || doubleCoinsUsed || lastResult.coins <= 0)) return;
   if (action.reward === 'coin-bonus' && rewards.bonusRemaining() <= 0) return;
   if (action.reward === 'cosmetic-trial' && !rewards.canClaimConfetti(profile.unlockedCosmetics.includes('effect-confetti'))) return;
   if (action.reward === 'double-coins') commit();
   track('rewarded_started', { reward: action.reward });
   const response = await adBreak(() => ads.rewardedAd(action.reward));
   if (!response?.success) { track('rewarded_failed'); refreshRewards(); ui.toast('El anuncio no estuvo disponible. Tu partida está guardada.'); return; }
   track('rewarded_completed', { reward: action.reward });
   if (action.reward === 'second-chance' && lastResult) {
    scene?.pause(false);
    if (scene?.secondChance()) {
     secondChanceUsed = true;
     const settings = profile.settings, publicName = profile.publicName, tutorialComplete = profile.tutorialComplete;
     profile = structuredClone(beforeRun); profile.settings = settings; profile.publicName = publicName; profile.tutorialComplete = tutorialComplete;
     lastResult = undefined; committed = true;
     updateProfile(); ui.showGame(gameConfig!, profile);
    }
    applyPause();
   } else if (action.reward === 'double-coins' && lastResult) {
    doubleCoinsUsed = true;
    profile.coins += lastResult.coins;
    lastResult.coins *= 2;
    updateProfile(); void backend.syncProfile(profile);
    ui.showResult(lastResult, profile); ui.toast('Coins duplicadas.');
   } else if (action.reward === 'coin-bonus') {
    const bonus = rewards.grantCoinBonus();
    profile.coins += bonus; updateProfile();
    ui.toast(bonus > 0 ? '+25 coins. ¡Elegí tu estilo!' : 'Ya usaste los tres bonos de hoy.');
   } else if (action.reward === 'cosmetic-trial') {
    if (rewards.claimConfetti(profile.unlockedCosmetics.includes('effect-confetti'))) ui.toast('Confeti listo para tu próxima torre.');
   }
   refreshRewards(); break;
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
if (params.get('debug') === '1') Object.assign(window, { __tower: {
 snapshot: () => snapshot, result: () => lastResult,
 debug: (command: string, value?: string) => { if (!adActive && !orientation.blocked) scene?.debug(command, value); },
 drop: () => { if (!adActive && !orientation.blocked) scene?.drop(); },
 appearance: () => activeTrial ? 'effect-confetti' : profile.selectedCosmetics.effect,
} });
