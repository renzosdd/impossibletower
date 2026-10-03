import { describe, expect, it } from 'vitest';
import { TowerSimulation, replayRun, TICK_MS } from '../../src/game/simulation/TowerSimulation';
import type { RunConfig } from '../../src/types';

const config:RunConfig={mode:'casual',seed:'canonical-replay',catalog:'legacy-18',ruleset:'v2'};
function waitUntil(sim:TowerSimulation,test:()=>boolean,limit=2000){for(let i=0;i<limit&&!test();i++)sim.advance(1);expect(test()).toBe(true);}
function play(sim:TowerSimulation){
 sim.drop();waitUntil(sim,()=>sim.stats.objectsPlaced===1);
 for(let i=0;i<2;i++){
  sim.advance(1);waitUntil(sim,()=>Math.abs(sim.craneX-210)<.8);
  expect(sim.drop()).toBe(true);waitUntil(sim,()=>sim.stats.objectsPlaced===i+2);
 }
 waitUntil(sim,()=>sim.craneX<68);expect(sim.drop()).toBe(true);waitUntil(sim,()=>sim.state==='over');
}

describe('shared fixed tick simulation',()=>{
 it('replays three real tutorial placements and a terminal drop using only input ticks',()=>{
  const sim=new TowerSimulation(config);
  try {
   play(sim);
   expect(sim.stats.objectIds.slice(0,3)).toEqual(['box','box','table']);
   const replay=replayRun(config,sim.events,sim.tick);
   expect(replay).toEqual(sim.result);
   expect(replay.height).toBeGreaterThan(15);
  }finally{sim.dispose();}
 });
 it.each([30,60,120])('render frames at %i FPS do not alter physics or crane state',fps=>{
  const chunked=new TowerSimulation(config),reference=new TowerSimulation(config);
  try{
   chunked.drop();reference.drop();
   let accumulator=0;
   for(let frame=0;frame<fps*4;frame++){
    accumulator+=1000/fps;
    const ticks=Math.floor((accumulator+1e-8)/TICK_MS);accumulator-=ticks*TICK_MS;chunked.advance(ticks);
   }
   reference.advance(240);
   expect(chunked.snapshot()).toEqual(reference.snapshot());
   expect(chunked.craneX).toBe(reference.craneX);
   expect(chunked.cameraY).toBe(reference.cameraY);
   expect(chunked.pieces[0].body.position).toEqual(reference.pieces[0].body.position);
  }finally{chunked.dispose();reference.dispose();}
 });
 it('pauses the full active clock and preserves the seed and tower',()=>{
  const sim=new TowerSimulation(config);sim.drop();sim.advance(30);const before=sim.snapshot();
  sim.pause(true);sim.advance(900);expect(sim.tick).toBe(30);expect(sim.stats.height).toBe(before.height);
  sim.pause(false);sim.advance(1);expect(sim.tick).toBe(31);sim.dispose();
 });
 it('enforces two distinct aids and mutually exclusive guides',()=>{
  const sim=new TowerSimulation(config);
  expect(sim.activateAid('guide-5')).toBe(true);expect(sim.activateAid('guide-10')).toBe(false);
  expect(sim.activateAid('guide-5')).toBe(false);expect(sim.activateAid('focus')).toBe(true);
  expect(sim.activateAid('preview')).toBe(false);expect(sim.stats.aidsUsed).toEqual(['guide-5','focus']);sim.dispose();
 });
 it('activates reserved aids while paused without advancing their tick',()=>{
  const sim=new TowerSimulation(config);sim.pause(true);
  expect(sim.activateAid('guide-5')).toBe(true);expect(sim.activateAid('focus')).toBe(true);
  sim.advance(600);expect(sim.tick).toBe(0);expect(sim.state).toBe('paused');
  expect(sim.events.map(event=>event.tick)).toEqual([0,0]);
  sim.pause(false);expect(sim.drop()).toBe(true);sim.dispose();
 });
 it('reveals only the three upcoming identities purchased by a preview',()=>{
  const sim=new TowerSimulation(config);expect(sim.activateAid('preview')).toBe(true);
  expect(sim.preview()).toHaveLength(3);expect(sim.preview().slice(0,2).map(object=>object.id)).toEqual(['box','table']);
  play(sim);expect(sim.preview()).toEqual([]);sim.dispose();
 });
 it('skip advances the seeded cursor without coins, score or placements',()=>{
  const sim=new TowerSimulation(config);
  expect(sim.activateAid('skip')).toBe(false);
  play(sim);
  if(sim.result?.reason==='miss'){
   expect(sim.activateAid('second-chance')).toBe(true);
   const before=sim.snapshot(),cursor=sim.sequenceCursor;
   expect(sim.activateAid('skip')).toBe(true);expect(sim.sequenceCursor).toBe(cursor+1);
   expect(sim.stats.height).toBe(before.height);expect(sim.stats.score).toBe(before.score);expect(sim.stats.objectsPlaced).toBe(before.objectsPlaced);
   expect(sim.canSecondChance()).toBe(false);
  }else throw new Error('Expected recoverable miss');
  sim.dispose();
 });
 it('guide and focus quotas survive a continuation',()=>{
  const sim=new TowerSimulation(config);expect(sim.activateAid('guide-5')).toBe(true);play(sim);
  const launches=sim.launches,tick=sim.tick;
  expect(sim.activateAid('second-chance')).toBe(true);expect(sim.launches).toBe(launches);expect(sim.tick).toBe(tick);
  expect(sim.aids.size).toBe(2);expect(sim.activateAid('focus')).toBe(false);sim.dispose();
 });
 it('rejects incomplete, out of order and fabricated replay inputs',()=>{
  expect(()=>replayRun(config,[],50)).toThrow('Incomplete');
  expect(()=>replayRun(config,[{tick:5,action:'drop'},{tick:4,action:'drop'}],50)).toThrow();
  expect(()=>replayRun(config,[{tick:0,action:'aid',aid:'skip'}],50)).toThrow('Invalid aid');
  expect(()=>replayRun(config,[{tick:0,action:'drop'},{tick:0,action:'drop'}],50)).toThrow('Invalid drop');
 });
});
