import { afterEach, describe, expect, it } from 'vitest';
import { browserLanguage, setLanguage, t } from '../../src/services/i18n';
import { BADGE_FAMILIES, BADGES } from '../../src/content/achievements';
import { DAILY_MISSIONS } from '../../src/content/missions';
import { defaultProfile, migrateProfile } from '../../src/services/storage/profile';
import { TowerSimulation, replayRun } from '../../src/game/simulation/TowerSimulation';
import { rankingPrize } from '../../src/content/economy';
afterEach(()=>setLanguage('es'));
describe('v4 content and migration',()=>{
 it('matches the browser preference order, including regions and unsupported languages',()=>{
  expect(browserLanguage(['fr-FR','es-AR','en-US'])).toBe('es');expect(browserLanguage(['en-GB','es-UY'])).toBe('en');expect(browserLanguage(['pt-BR'])).toBe('en');expect(browserLanguage([])).toBe('en');
 });
 it('resets old badges without deleting purchases, preferences or current records',()=>{
  const p=defaultProfile();p.personalBest=125;p.daily={'2026-10-08':{best:70,attempts:1}};p.unlockedCosmetics.push('crane-coral');p.settings.music=true;
  const old={...p,badgeCatalogVersion:1,achievements:['first-stack'],badgeProgress:{'first-stack':1},badgeMetrics:{height:1000}};
  const next=migrateProfile(old);expect(next.achievements).toEqual([]);expect(next.badgeMetrics).toEqual({});expect(next.personalBest).toBe(125);expect(next.daily).toEqual(p.daily);expect(next.unlockedCosmetics).toContain('crane-coral');expect(next.settings.music).toBe(true);
 });
 it('has 12 families, 36 medals, finite rewards and five 2-coin missions',()=>{
  expect(BADGE_FAMILIES).toHaveLength(12);expect(BADGES).toHaveLength(36);expect(new Set(BADGES.map(b=>b.id)).size).toBe(36);
  expect(BADGES.reduce((sum,b)=>sum+(b.reward?.coins??0),0)).toBe(90);expect(BADGES.filter(b=>b.tier==='bronze').every(b=>!b.reward)).toBe(true);
  expect(DAILY_MISSIONS).toHaveLength(5);expect(DAILY_MISSIONS.reduce((sum,m)=>sum+m.reward,0)).toBe(10);
 });
 it('pays only weekly positions, with a 20-player threshold and 250-coin maximum',()=>{
  expect(rankingPrize('weekly',1,19).coins).toBe(0);expect(rankingPrize('weekly',1,20).coins).toBe(60);
  expect(Array.from({length:25},(_,i)=>rankingPrize('weekly',i+1,25).coins).reduce((a,b)=>a+b,0)).toBe(250);
  for(const period of ['daily','monthly','all-time'] as const)expect(rankingPrize(period,1,100).coins).toBe(0);
 });
 it('translates new interface and mission copy',()=>{setLanguage('en');expect(t('Código promocional')).toBe('Promo code');expect(t('Plata')).toBe('Silver');expect(t(DAILY_MISSIONS[4].name)).toContain('2 Dailies');});
});
const wait=(sim:TowerSimulation,condition:()=>boolean)=>{for(let n=0;n<4000&&!condition();n++)sim.advance(1);expect(condition()).toBe(true);};
const stack=(sim:TowerSimulation)=>{wait(sim,()=>sim.state==='ready');wait(sim,()=>Math.abs(sim.craneX-210)<.7);expect(sim.drop()).toBe(true);wait(sim,()=>sim.state==='ready'||sim.state==='over');expect(sim.state).toBe('ready');};
describe('aid rules independent of physics',()=>{
 it('activates a five-drop guide mid-run, expires after five launches and replays canonically',()=>{
  const config={mode:'casual' as const,seed:'v4-guide',ruleset:'v3' as const,catalog:'extended-30' as const,aidRulesVersion:2 as const};const sim=new TowerSimulation(config);
  try{
   for(let n=0;n<3;n++)stack(sim);expect(sim.activateAid('guide-5')).toBe(true);expect(sim.guideActive).toBe(true);expect(sim.activateAid('guide-10')).toBe(false);
   for(let n=0;n<4;n++)stack(sim);expect(sim.guideActive).toBe(true);stack(sim);expect(sim.guideActive).toBe(false);
   expect(sim.activateAid('focus')).toBe(true);expect(sim.activateAid('preview')).toBe(false);
   wait(sim,()=>sim.craneX<66);sim.drop();wait(sim,()=>sim.state==='over');expect(replayRun(config,sim.events,sim.tick)).toEqual(sim.result);
   expect(()=>replayRun({...config,aidRulesVersion:1},sim.events,sim.tick)).toThrow();
  }finally{sim.dispose();}
 });
 it('keeps the opening-only guide rule for existing tickets',()=>{
  const sim=new TowerSimulation({mode:'casual',seed:'v4-old-ticket',ruleset:'v3',aidRulesVersion:1,catalog:'extended-30'});
  try{stack(sim);expect(sim.canActivateAid('guide-5')).toBe(false);}finally{sim.dispose();}
 });
});
