import Matter from 'matter-js';
import type { AidId, GameSnapshot, ObjectDefinition, RunConfig, RunResult, RunStats } from '../../types';
import { objectForRules, getObject, craneSpeed } from '../../content/objects';
import { accuracyFor, towerHeight, updateCombo, scoreDrop, calculateScore } from '../../utils/scoring';
import { advanceStability, isSettled, hasSignificantCollapse } from '../../utils/stability';
import { createObjectBody } from '../objects/bodies';

export const TICK_MS = 1000 / 60;
export const MAX_RUN_TICKS = 40 * 60 * 60;
export interface ReplayEvent { tick:number; action:'drop'|'aid'; aid?:AidId; }
export interface SimulationPiece { body:Matter.Body; def:ObjectDefinition; placed:boolean; index:number; settledY:number; fallen:boolean; }
export interface SimulationHooks { event?(name:string,data?:Record<string,unknown>):void; over?(result:RunResult):void; }
const AID_IDS:readonly AidId[]=['guide-5','guide-10','preview','focus','skip','second-chance'];
type SolverBody=Matter.Body&{sleepCounter:number;deltaTime:number;positionImpulse:Matter.Vector;constraintImpulse:{x:number;y:number;angle:number}};
function bodyDynamics(body:Matter.Body){const b=body as SolverBody;return {force:{...b.force},torque:b.torque,motion:b.motion,sleepCounter:b.sleepCounter,deltaTime:b.deltaTime,positionImpulse:{...b.positionImpulse},constraintImpulse:{...b.constraintImpulse}};}

export class TowerSimulation {
 readonly engine:Matter.Engine;
 readonly ground:Matter.Body;
 readonly config:RunConfig;
 readonly events:ReplayEvent[]=[];
 pieces:SimulationPiece[]=[];
 falling?:SimulationPiece;
 def:ObjectDefinition;
 state:GameSnapshot['state']='ready';
 stats:RunStats;
 result?:RunResult;
 tick=0;
 cameraY=0;
 cameraTarget=0;
 topY=650;
 peakTopY=650;
 craneX=210;
 elapsed=0;
 latestAccuracy?:GameSnapshot['accuracy'];
 sequenceCursor=0;
 launches=0;
 focusUntil=0;
 previewUntil=0;
 tainted=false;
 readonly aids=new Set<AidId>();
 private phase=.7;
 private stableMs=0;
 private dropElapsed=0;
 private slowMs=0;
 private precision=0;
 private perfectCombo=0;
 private support?:Matter.Body;
 private touched=false;
 private retrySnapshot:{piece:SimulationPiece;x:number;y:number;angle:number;vx:number;vy:number;av:number;sleeping:boolean;dynamics:ReturnType<typeof bodyDynamics>}[]=[];
 private retryState?:{stats:RunStats;precision:number;perfectCombo:number;topY:number;peakTopY:number;cameraTarget:number;cameraY:number;phase:number;craneX:number;slowMs:number;sequenceCursor:number;accuracy:GameSnapshot['accuracy']};
 private fixedX?:number;
 private forcedObject?:string;
 private auto=false;
 private pausedState:GameSnapshot['state']='ready';

 constructor(config:RunConfig,private hooks:SimulationHooks={}) {
  this.config={...config,catalog:config.catalog??config.challenge?.catalog??'legacy-18',ruleset:config.ruleset??'v2'};
  this.stats={mode:config.mode,seed:config.seed,catalog:this.config.catalog,ruleset:this.config.ruleset,height:0,score:0,objectsPlaced:0,perfectDrops:0,combo:0,maxCombo:0,maxPerfectCombo:0,duration:0,objectIds:[],aidsUsed:[]};
  this.engine=Matter.Engine.create({enableSleeping:true,positionIterations:8,velocityIterations:8});
  this.engine.gravity.y=1.15;
  this.ground=Matter.Bodies.rectangle(210,666,230,32,{isStatic:true,friction:1,restitution:0,label:'ground'});
  Matter.Composite.add(this.engine.world,this.ground);
  this.def=this.object(0);
  Matter.Events.on(this.engine,'collisionStart',(event:Matter.IEventCollision<Matter.Engine>)=>{
   if(!this.falling||this.touched)return;
   for(const pair of event.pairs) {
    if(pair.bodyA.parent!==this.falling.body&&pair.bodyB.parent!==this.falling.body)continue;
    const other=(pair.bodyA.parent===this.falling.body?pair.bodyB:pair.bodyA).parent;
    if(other.position.y<this.falling.body.position.y)continue;
    this.support=other;this.touched=true;this.state='settling';
    if(this.falling.def.mass>7)this.slowMs=90;
    this.hooks.event?.('impact',{mass:this.falling.def.mass,x:this.falling.body.position.x,y:this.falling.body.bounds.max.y});
    break;
   }
  });
 }
 private object(index:number) {return objectForRules(this.config.seed,index,this.config.catalog!,this.config.ruleset,index-(this.aids.has('skip')?1:0));}
 private nextObject() {
  this.def=this.forcedObject?getObject(this.forcedObject):this.object(this.sequenceCursor);
  this.forcedObject=undefined;this.state='ready';this.support=undefined;this.touched=false;this.stableMs=0;
 }
 drop():boolean {
  if(this.state!=='ready'||this.pieces.length>=500)return false;
  this.retrySnapshot=this.pieces.filter(p=>p.placed&&!p.fallen).map(piece=>({piece,x:piece.body.position.x,y:piece.body.position.y,angle:piece.body.angle,vx:piece.body.velocity.x,vy:piece.body.velocity.y,av:piece.body.angularVelocity,sleeping:piece.body.isSleeping,dynamics:bodyDynamics(piece.body)}));
  this.retryState={stats:structuredClone(this.stats),precision:this.precision,perfectCombo:this.perfectCombo,topY:this.topY,peakTopY:this.peakTopY,cameraTarget:this.cameraTarget,cameraY:this.cameraY,phase:this.phase,craneX:this.craneX,slowMs:this.slowMs,sequenceCursor:this.sequenceCursor,accuracy:this.latestAccuracy};
  const x=this.fixedX??this.craneX,y=this.cameraY+225;
  const body=createObjectBody(this.def,x,y,this.config.ruleset);
  Matter.Composite.add(this.engine.world,body);
  const piece:SimulationPiece={body,def:this.def,placed:false,index:this.stats.objectsPlaced,settledY:y,fallen:false};
  this.pieces.push(piece);this.falling=piece;this.state='falling';this.dropElapsed=0;this.fixedX=undefined;this.launches++;
  this.events.push({tick:this.tick,action:'drop'});
  this.hooks.event?.('object_drop',{object:this.def.id,index:this.sequenceCursor});
  return true;
 }
 advance(ticks:number):void {
  if(!Number.isSafeInteger(ticks)||ticks<0||ticks>MAX_RUN_TICKS)throw new Error('Invalid tick count');
  for(let i=0;i<ticks;i++) {
   if(this.state==='over'||this.state==='paused')break;
   this.tick++;this.elapsed=this.tick*TICK_MS;
   const focused=this.aids.has('focus')&&this.launches<this.focusUntil;
   this.phase+=TICK_MS/1000*craneSpeed(this.sequenceCursor)/150*(focused?.5:1);
   this.craneX=this.fixedX??210+Math.sin(this.phase)*145;
   this.slowMs=Math.max(0,this.slowMs-TICK_MS);this.engine.timing.timeScale=this.slowMs>0?.65:1;
   Matter.Engine.update(this.engine,TICK_MS);
   this.simulation();
   this.cameraY+=(this.cameraTarget-this.cameraY)*(1-Math.exp(-TICK_MS/240));
   if(this.tick>=MAX_RUN_TICKS&&(this.state as GameSnapshot['state'])!=='over')this.finish('timeout');
   if(this.auto&&this.state==='ready') {
    const top=this.pieces.filter(p=>p.placed&&!p.fallen).sort((a,b)=>a.body.bounds.min.y-b.body.bounds.min.y)[0];
    this.fixedX=top?.body.position.x??210;this.craneX=this.fixedX;
    if(Math.abs(this.cameraTarget-this.cameraY)<2)this.drop();
   }
  }
 }
 pause(paused:boolean):void {
  if(paused&&this.state!=='paused'){this.pausedState=this.state;this.state='paused';}
  else if(!paused&&this.state==='paused')this.state=this.pausedState;
 }
 canSecondChance():boolean {
  return (this.state==='over'||this.state==='paused'&&this.pausedState==='over')&&(this.result?.reason==='miss'||this.config.ruleset==='v3'&&this.result?.reason==='collapse')&&this.stats.objectsPlaced>=3&&!this.aids.has('second-chance')&&this.aids.size<2&&(this.config.ruleset==='v3'?!!this.retryState:!!this.falling&&!this.falling.placed);
 }
 canActivateAid(id:AidId):boolean {
  if(!AID_IDS.includes(id)||this.aids.has(id)||this.aids.size>=2)return false;
  if(id==='second-chance')return this.canSecondChance();
  if((this.state==='paused'?this.pausedState:this.state)!=='ready')return false;
  if(id==='guide-5'||id==='guide-10')return this.launches===0&&!this.aids.has('guide-5')&&!this.aids.has('guide-10');
  if(id==='skip')return this.sequenceCursor>=3;
  return true;
 }
 activateAid(id:AidId):boolean {
  if(!this.canActivateAid(id))return false;
  const wasPaused=this.state==='paused';
  if(id==='second-chance') {
   if(this.config.ruleset==='v3') {
    const keep=new Set(this.retrySnapshot.map(s=>s.piece));
    for(const p of this.pieces)if(!keep.has(p))Matter.Composite.remove(this.engine.world,p.body);
    this.pieces=this.pieces.filter(p=>keep.has(p));
   } else {
    const failed=this.falling!;
    Matter.Composite.remove(this.engine.world,failed.body);
    this.pieces=this.pieces.filter(p=>p!==failed);
   }
   for(const saved of this.retrySnapshot) {
    if(saved.piece.fallen){Matter.Composite.add(this.engine.world,saved.piece.body);saved.piece.fallen=false;}
    Matter.Body.setPosition(saved.piece.body,{x:saved.x,y:saved.y});Matter.Body.setAngle(saved.piece.body,saved.angle);
    const v3=this.config.ruleset==='v3';
    Matter.Body.setVelocity(saved.piece.body,{x:v3?saved.vx:0,y:v3?saved.vy:0});Matter.Body.setAngularVelocity(saved.piece.body,v3?saved.av:0);Matter.Sleeping.set(saved.piece.body,v3?saved.sleeping:false);
    if(v3)Object.assign(saved.piece.body,structuredClone(saved.dynamics));
   }
   if(this.config.ruleset==='v3')Matter.Pairs.clear(this.engine.pairs);
   if(this.config.ruleset==='v3'&&this.retryState){const r=this.retryState;this.stats=structuredClone(r.stats);this.precision=r.precision;this.perfectCombo=r.perfectCombo;this.topY=r.topY;this.peakTopY=r.peakTopY;this.cameraTarget=r.cameraTarget;this.cameraY=r.cameraY;this.phase=r.phase;this.craneX=r.craneX;this.slowMs=r.slowMs;this.sequenceCursor=r.sequenceCursor;this.latestAccuracy=r.accuracy;}
   this.result=undefined;this.falling=undefined;this.nextObject();
  }
  if(id==='focus')this.focusUntil=this.launches+3;
  if(id==='preview')this.previewUntil=this.sequenceCursor+3;
  if(id==='skip'){this.aids.add(id);this.sequenceCursor++;this.nextObject();}
  this.aids.add(id);this.stats.assisted=true;this.stats.aidsUsed=[...this.aids];
  this.events.push({tick:this.tick,action:'aid',aid:id});
  this.hooks.event?.('aid_used',{aid:id});
  if(wasPaused&&this.state!=='paused'){this.pausedState=this.state;this.state='paused';}
  return true;
 }
 get guideActive():boolean {return this.aids.has('guide-10')&&this.launches<10||this.aids.has('guide-5')&&this.launches<5;}
 preview():ObjectDefinition[] {return this.aids.has('preview')?[1,2,3].filter(i=>this.sequenceCursor+i<=this.previewUntil).map(i=>this.object(this.sequenceCursor+i)):[];}
 snapshot(fps=60):GameSnapshot {return {...this.stats,objectIds:[...this.stats.objectIds],aidsUsed:[...this.aids],duration:Math.round(this.elapsed/1000),state:this.state,nextObject:this.def.name,accuracy:this.latestAccuracy,fps};}
 private simulation():void {
  for(const p of this.pieces) {
   const killY=p===this.falling&&!p.placed?Math.min(800,this.cameraY+860):800;
   if(!p.fallen&&p.body.position.y>killY) {
    p.fallen=true;Matter.Composite.remove(this.engine.world,p.body);
    if(p===this.falling&&!p.placed){this.finish('miss');return;}
    if(this.config.ruleset==='v3'){this.finish('collapse');return;}
   }
  }
  const placed=this.pieces.filter(p=>p.placed&&!p.fallen);
  const currentTop=placed.length?Math.min(...placed.map(p=>p.body.bounds.min.y)):650;
  if(this.config.ruleset!=='v3'&&hasSignificantCollapse(this.pieces.filter(p=>p.placed).map(p=>({placedIndex:p.index,settledY:p.settledY,y:p.body.position.y,speed:p.body.speed,fallen:p.fallen})),this.peakTopY,currentTop)){this.finish('collapse');return;}
  if(!this.falling||this.falling.placed)return;
  this.dropElapsed+=TICK_MS;const p=this.falling;
  const hasSupport=this.touched&&Matter.Query.collides(p.body,[this.ground,...placed.map(v=>v.body)]).length>0;
  this.stableMs=advanceStability(this.stableMs,p.body.speed,Math.abs(p.body.angularVelocity),TICK_MS,hasSupport);
  if(isSettled(this.stableMs)){this.land(p);return;}
  if(this.dropElapsed>14000)this.finish('timeout');
 }
 private land(p:SimulationPiece):void {
  p.placed=true;p.settledY=p.body.position.y;
  const candidates=[this.ground,...this.pieces.filter(v=>v!==p&&v.placed&&!v.fallen).map(v=>v.body)];
  const contacts=Matter.Query.collides(p.body,candidates).map(pair=>(pair.bodyA.parent===p.body?pair.bodyB:pair.bodyA).parent).filter(body=>body.position.y>=p.body.position.y);
  const overlap=(body:Matter.Body)=>Math.max(0,Math.min(body.bounds.max.x,p.body.bounds.max.x)-Math.max(body.bounds.min.x,p.body.bounds.min.x));
  const below=contacts.sort((a,b)=>overlap(b)-overlap(a))[0]??this.support??this.ground;
  const supportWidth=below.bounds.max.x-below.bounds.min.x;
  const objectCenter=(p.body.bounds.min.x+p.body.bounds.max.x)/2,surfaceCenter=(below.bounds.min.x+below.bounds.max.x)/2;
  const accuracy=accuracyFor(objectCenter-surfaceCenter,Math.min(p.def.width,supportWidth));this.latestAccuracy=accuracy;
  this.stats.combo=updateCombo(accuracy,this.stats.combo);this.stats.maxCombo=Math.max(this.stats.maxCombo,this.stats.combo);
  this.perfectCombo=accuracy==='PERFECT'?this.perfectCombo+1:0;this.stats.maxPerfectCombo=Math.max(this.stats.maxPerfectCombo??0,this.perfectCombo);
  this.stats.objectsPlaced++;this.stats.objectIds.push(p.def.id);if(accuracy==='PERFECT')this.stats.perfectDrops++;
  this.precision+=scoreDrop(accuracy,this.stats.combo);
  this.topY=Math.min(...this.pieces.filter(v=>v.placed&&!v.fallen).map(v=>v.body.bounds.min.y));this.peakTopY=Math.min(this.peakTopY,this.topY);
  this.stats.height=towerHeight(this.topY);this.stats.score=calculateScore(this.stats.height,this.stats.objectsPlaced,this.precision);
  this.cameraTarget=Math.min(0,this.topY-440);
  this.hooks.event?.('object_landed',{object:p.def.id,accuracy,height:this.stats.height,perfectCombo:this.perfectCombo});
  if(accuracy==='PERFECT')this.hooks.event?.('perfect_drop');
  if(this.stats.combo>=2)this.hooks.event?.('combo_reached',{combo:this.stats.combo});
  if(this.stats.objectsPlaced===1)this.hooks.event?.('tutorial_complete');
  this.falling=undefined;this.sequenceCursor++;this.nextObject();
 }
 private finish(reason:RunResult['reason']):void {
  if(this.state==='over')return;this.state='over';
  const won=this.config.challenge?this.stats.height>this.config.challenge.height:undefined;
  this.result={...this.stats,objectIds:[...this.stats.objectIds],aidsUsed:[...this.aids],duration:Math.round(this.elapsed/1000),reason,coins:0,personalBest:false,challengeWon:won,moments:[]};
  this.hooks.over?.(this.result);
 }
 debug(command:string,value?:string):void {
  this.tainted=true;
  if(command==='center'||command==='miss'){this.fixedX=command==='center'?210:25;this.craneX=this.fixedX;}
  if(command==='auto-stack')this.auto=!this.auto;
  if(command==='force-object'){this.forcedObject=value;if(this.state==='ready')this.nextObject();}
  if(command==='height') {
   const shift=Math.max(0,Math.min(1000,Number(value)||50))*10;
   for(const p of this.pieces)Matter.Body.translate(p.body,{x:0,y:-shift});
   this.cameraTarget-=shift;this.cameraY=this.cameraTarget;this.topY-=shift;this.peakTopY-=shift;this.stats.height=towerHeight(this.topY);
  }
  if(command==='end-run')this.finish('miss');
 }
 dispose():void {Matter.Events.off(this.engine,'collisionStart');Matter.Composite.clear(this.engine.world,false);Matter.Engine.clear(this.engine);}
}

export function replayRun(config:RunConfig,events:ReplayEvent[],finalTick:number):RunResult {
 if(!Number.isSafeInteger(finalTick)||finalTick<1||finalTick>MAX_RUN_TICKS||!Array.isArray(events)||events.length>510)throw new Error('Invalid replay');
 const sim=new TowerSimulation(config);
 try {
  for(const event of events) {
   if(!event||!Number.isSafeInteger(event.tick)||event.tick<sim.tick||event.tick>finalTick)throw new Error('Invalid event tick');
   sim.advance(event.tick-sim.tick);
   if(sim.tick!==event.tick)throw new Error('Event after terminal state');
   if(event.action==='drop'){if(event.aid!==undefined||!sim.drop())throw new Error('Invalid drop');}
   else if(event.action==='aid'){if(!event.aid||!sim.activateAid(event.aid))throw new Error('Invalid aid');}
   else throw new Error('Unknown replay event');
  }
  sim.advance(finalTick-sim.tick);
  if(sim.tick!==finalTick||!sim.result||sim.state!=='over')throw new Error('Incomplete replay');
  return structuredClone(sim.result);
 } finally {sim.dispose();}
}
