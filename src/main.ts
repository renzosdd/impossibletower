import { registerSW } from 'virtual:pwa-register';
import { Interface } from './ui/Interface';
import './ui/styles.css';
import type { UIAction, RunConfig, RunResult, Profile, GameSnapshot, Challenge } from './types';
import { beginSession, recordRun, recordShare, buyCosmetic } from './services/storage/progress';
import { loadProfile, saveProfile, defaultProfile, STORAGE_KEY } from './services/storage/profile';
import { dailySeed, randomSeed } from './utils/rng';
import { decodeChallenge, shareResult } from './services/sharing/challenge';
import { createAdProvider, MockAdProvider } from './services/ads';
import { createAnalytics, type AnalyticsProperties } from './services/analytics';
import { AudioManager } from './game/systems/AudioManager';
import { BackendService, sanitizePublicName } from './services/backend';
import type { TowerScene } from './game/scenes/TowerScene';

let profile=beginSession(loadProfile());saveProfile(profile);
const analytics=createAnalytics(),ads=createAdProvider(),audio=new AudioManager(profile.settings),backend=new BackendService();
let scene:TowerScene|undefined;let gameConfig:RunConfig|undefined;let lastResult:RunResult|undefined;let beforeRun:Profile=structuredClone(profile);
let snapshot:GameSnapshot|undefined;let adActive=false;let manualPaused=false;let rewardedUsed=false;let committed=true;let trialPrevious:string|undefined;let trialNext=false;let installPrompt:InstallPrompt|undefined;let lastCommercialRun=-1;
interface InstallPrompt extends Event {prompt():Promise<void>;userChoice:Promise<{outcome:string}>;}
const params=new URLSearchParams(location.search),token=params.get('challenge');
let challenge:Challenge|undefined=(token?decodeChallenge(token):null)??undefined;
function track(name:string,extra:AnalyticsProperties={}){analytics.track(name,{mode:gameConfig?.mode,seed:gameConfig?.seed,height:snapshot?.height,score:snapshot?.score,objectsPlaced:snapshot?.objectsPlaced,sessionNumber:profile.sessionCount,runNumber:profile.runs+1,duration:snapshot?.duration,deviceClass:matchMedia('(pointer:coarse)').matches?'mobile':'desktop',...extra});}
const ui=new Interface(document.querySelector<HTMLElement>('#ui')!,action=>{void handle(action);});
ui.setBackendAvailable(backend.enabled);ui.showMenu(profile,challenge);
track('session_start');if(challenge)track('challenge_opened',{seed:challenge.seed});
if(token&&!challenge&&!/^[0-9a-f-]{36}$/i.test(token))ui.toast('Ese desafío no es válido. Podés jugar una torre nueva.');
registerSW({immediate:true,onRegisterError:()=>{/* Cached shell is optional during development. */}});
const boot=Promise.all([import('phaser'),import('./game/scenes/TowerScene')]).then(([{default:Phaser},{TowerScene}])=>{
 scene=new TowerScene({snapshot:s=>{snapshot=s;ui.update(s);},over:finish,event:(name,data)=>{track(name,data as AnalyticsProperties);if(name==='tutorial_complete'){profile.tutorialComplete=true;saveProfile(profile);}},effect:(name,weight)=>{audio.play(name,weight);if(name.startsWith('impact'))audio.haptic(weight&&weight>7?18:8);},moment:text=>ui.showMoment(text)});
 scene.setProfile(profile);
 new Phaser.Game({type:Phaser.AUTO,parent:'game-canvas',width:420,height:746,backgroundColor:'#335b65',transparent:false,scene:[scene],scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH},render:{antialias:true,pixelArt:false},fps:{target:60,min:30},audio:{noAudio:true},banner:false});
 return scene.whenReady;
}).catch(error=>{ui.toast('No pudimos cargar el juego. Recargá la página para reintentar.');console.error('Game initialization failed',error);throw error;});
void ads.initialize().then(()=>{ads.loadingFinished?.();if(gameConfig&&!lastResult&&!manualPaused&&!document.hidden&&!adActive)ads.gameplayStart?.();if(lastResult)ui.setRewardAvailability(ads.isRewardedAvailable()&&!rewardedUsed,canRetry());});
void backend.initialize();
if(token&&!challenge&&backend.enabled)void backend.loadChallenge(token).then(found=>{if(found){challenge=found;ui.showMenu(profile,challenge);track('challenge_opened',{seed:found.seed});}else ui.toast('No se pudo recuperar el desafío. Podés jugar sin conexión.');});
function updateProfile(){saveProfile(profile);ui.setProfile(profile);scene?.setProfile(profile);}
function commit(){if(lastResult&&!committed){committed=true;void backend.submitRun(lastResult,profile.publicName);void backend.syncProfile(profile);}}
function canRetry(){return !!lastResult && !committed && lastResult.reason==='miss' && lastResult.objectsPlaced>=3 && !lastResult.assisted && !rewardedUsed;}
function finish(result:RunResult){
 ads.gameplayStop?.();lastResult=result;committed=false;const progress=recordRun(profile,result);profile=progress.profile;result.coins=progress.earnedCoins;updateProfile();
 if(trialPrevious){profile.selectedCosmetics.effect=trialPrevious;trialPrevious=undefined;updateProfile();}
 track('game_over',{reason:result.reason,height:result.height,score:result.score,duration:result.duration});
 if(result.mode==='daily')track('daily_complete');if(result.mode==='challenge')track('challenge_completed',{won:result.challengeWon??false});
 for(const id of progress.completedMissions)track('mission_completed',{mission:id});
 ui.showResult(result,profile);ui.setRewardAvailability(ads.isRewardedAvailable()&&!rewardedUsed,canRetry());
 if(ads.isRewardedAvailable()&&!rewardedUsed)track('rewarded_offer_shown');
 if(!canRetry()||!ads.isRewardedAvailable())commit();
 if(result.challengeWon)ui.showMoment('¡Ganaste el desafío!');
 if(installPrompt&&profile.runs>=3)ui.showInstallAvailable(true);
}
async function start(config:RunConfig){
 if(adActive)return;commit();audio.unlock();audio.pause(false);await boot;manualPaused=false;gameConfig=config;lastResult=undefined;rewardedUsed=false;beforeRun=structuredClone(profile);
 if(trialNext){trialPrevious=profile.selectedCosmetics.effect;profile.selectedCosmetics.effect='effect-confetti';trialNext=false;}
 scene!.setProfile(profile);scene!.start(config);ui.showGame(config,profile);ads.gameplayStart?.();track('game_start');
 if(config.mode==='daily')track('daily_start');if(!profile.tutorialComplete)track('tutorial_start');
}
async function adBreak(operation:()=>Promise<unknown>){
 if(adActive)return;adActive=true;scene?.pause(true);audio.pause(true);ads.gameplayStop?.();
 document.querySelector('#game-shell')?.setAttribute('inert','');
 try{return await operation();}catch{return undefined;}finally{document.querySelector('#game-shell')?.removeAttribute('inert');adActive=false;const shouldPause=!gameConfig||manualPaused||document.hidden;scene?.pause(shouldPause);audio.pause(shouldPause);if(gameConfig&&!lastResult&&!shouldPause)ads.gameplayStart?.();}
}
async function handle(action:UIAction){
 if(adActive)return;
 audio.unlock();if(action.type!=='drop')audio.play('button');
 switch(action.type){
  case 'play':await start({mode:action.mode,seed:action.mode==='daily'?dailySeed():action.mode==='challenge'&&challenge?challenge.seed:randomSeed(),challenge:action.mode==='challenge'?challenge:undefined});break;
  case 'restart':await start({mode:gameConfig?.mode??'casual',seed:gameConfig?.mode==='casual'?randomSeed():gameConfig?.seed??dailySeed(),challenge:gameConfig?.challenge});break;
  case 'drop':scene?.drop();break;
  case 'pause':manualPaused=action.paused;scene?.pause(action.paused);audio.pause(action.paused);if(action.paused)ads.gameplayStop?.();else ads.gameplayStart?.();break;
  case 'menu':commit();scene?.pause(true);ads.gameplayStop?.();gameConfig=undefined;ui.showMenu(profile,challenge);if(profile.runs>0&&profile.runs%4===0&&lastCommercialRun!==profile.runs){lastCommercialRun=profile.runs;track('commercial_break',{context:'menu'});await adBreak(()=>ads.commercialBreak('menu'));}break;
  case 'settings':profile.settings=action.settings;audio.setSettings(profile.settings);updateProfile();break;
  case 'name':profile.publicName=sanitizePublicName(action.name).replace(/^Anónimo$/,'');updateProfile();break;
  case 'cosmetic':{const old=profile.unlockedCosmetics.includes(action.id);const purchase=buyCosmetic(profile,action.id);if(purchase.ok){profile=purchase.profile;updateProfile();if(!old)track('cosmetic_unlocked',{cosmetic:action.id});}ui.toast(purchase.message);break;}
  case 'share':if(lastResult){const sharedRun=structuredClone(lastResult),name=profile.publicName;track('share_clicked');commit();const shared=await shareResult(sharedRun,name,action.image);track('challenge_created',{seed:sharedRun.seed});void backend.saveChallenge({version:1,seed:sharedRun.seed,height:sharedRun.height,score:sharedRun.score,name:name||undefined});if(shared.method!=='manual'){const progress=recordShare(profile);profile=progress.profile;updateProfile();for(const id of progress.completedMissions)track('mission_completed',{mission:id});track('share_success',{method:shared.method});ui.toast(shared.method==='copy'?'Enlace copiado. ¡Desafiá a alguien!':'Desafío compartido.');}else ui.showShareLink(shared.url);}
   break;
  case 'leaderboard':{const entries=await backend.leaderboard(action.kind);if(backend.lastError)ui.toast('El ranking no respondió. Podés seguir jugando.');ui.showLeaderboard(entries,action.kind);break;}
  case 'reward':{
   if(rewardedUsed||!ads.isRewardedAvailable())return;
   if(action.reward==='second-chance'&&!canRetry())return;
   if(action.reward==='double-coins'&&!lastResult)return;
   track('rewarded_started',{reward:action.reward});const response=await adBreak(()=>ads.rewardedAd(action.reward)) as {success:boolean}|undefined;
   if(!response?.success){track('rewarded_failed');ui.toast('El anuncio no estuvo disponible. Tu partida está guardada.');return;}
   rewardedUsed=true;track('rewarded_completed',{reward:action.reward});
   if(action.reward==='second-chance'&&lastResult){scene?.pause(false);if(scene?.secondChance()){const settings=profile.settings,publicName=profile.publicName;profile=structuredClone(beforeRun);profile.settings=settings;profile.publicName=publicName;updateProfile();lastResult=undefined;committed=true;ui.showGame(gameConfig!,profile);if(document.hidden)scene.pause(true);else ads.gameplayStart?.();}}
   else if(action.reward==='double-coins'&&lastResult){profile.coins+=lastResult.coins;lastResult.coins*=2;updateProfile();void backend.syncProfile(profile);ui.showResult(lastResult,profile);ui.toast('Coins duplicadas.');}
   else {trialNext=true;ui.toast('Efecto coral disponible para tu próxima torre.');}
   ui.setRewardAvailability(false,false);break;
  }
  case 'install':if(installPrompt){track('pwa_install_prompt');await installPrompt.prompt();await installPrompt.userChoice;installPrompt=undefined;ui.showInstallAvailable(false);}break;
  case 'debug':if(params.get('debug')==='1'){
   if(action.command==='reset'){try{localStorage.removeItem(STORAGE_KEY);}catch{}profile=beginSession(defaultProfile());updateProfile();ui.showMenu(profile,challenge);scene?.pause(true);}
   else if(action.command==='coins'){profile.coins+=1000;updateProfile();ui.toast('+1000 coins de prueba');}
   else if(action.command==='seed'){await start({mode:'casual',seed:action.value||'debug-tower'});}
   else if(action.command==='ad-success'||action.command==='ad-error'){if(ads instanceof MockAdProvider)ads.setDebugResult(action.command==='ad-success');ui.setRewardAvailability(true,canRetry());ui.toast('Simulación publicitaria configurada.');}
   else scene?.debug(action.command,action.value);
  }break;
 }
}
document.addEventListener('pointerdown',()=>audio.unlock(),{once:true});
document.addEventListener('visibilitychange',()=>{const paused=!gameConfig||document.hidden||manualPaused||adActive;scene?.pause(paused);audio.pause(paused);if(paused)ads.gameplayStop?.();else if(gameConfig&&!lastResult)ads.gameplayStart?.();});
window.addEventListener('beforeinstallprompt',(event:Event)=>{event.preventDefault();installPrompt=event as InstallPrompt;if(profile.runs>=3)ui.showInstallAvailable(true);});
window.addEventListener('appinstalled',()=>{track('pwa_installed');installPrompt=undefined;ui.showInstallAvailable(false);});
if(params.get('debug')==='1')Object.assign(window,{__tower:{snapshot:()=>snapshot,result:()=>lastResult,debug:(command:string,value?:string)=>scene?.debug(command,value),drop:()=>scene?.drop()}});
