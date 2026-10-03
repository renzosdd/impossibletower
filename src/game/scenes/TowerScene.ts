import Phaser from 'phaser';
import Matter from 'matter-js';
import type { GameControls, GameSnapshot, RunConfig, RunResult, RunStats, ObjectDefinition, Profile } from '../../types';
import { objectAt, getObject, craneSpeed } from '../../content/objects';
import { accuracyFor, towerHeight, updateCombo, scoreDrop, calculateScore } from '../../utils/scoring';
import { advanceStability, isSettled, hasSignificantCollapse } from '../../utils/stability';
import { createObjectTextures } from '../objects/textures';
import { COSMETICS } from '../../content/cosmetics';
import { createObjectBody } from '../objects/bodies';

interface Piece {body:Matter.Body;sprite:Phaser.GameObjects.Image;def:ObjectDefinition;placed:boolean;index:number;settledY:number;fallen:boolean;}
interface Particle {x:number;y:number;vx:number;vy:number;life:number;color:number;}
interface Hooks { snapshot(s:GameSnapshot):void; over(r:RunResult):void; event(name:string,data?:Record<string,unknown>):void; effect(name:string,weight?:number):void; moment(text:string):void; }
export class TowerScene extends Phaser.Scene implements GameControls {
 private engine!:Matter.Engine; private ground!:Matter.Body;
 private pieces:Piece[]=[]; private falling?:Piece; private held?:Phaser.GameObjects.Image;
 private background!:Phaser.GameObjects.Graphics; private foreground!:Phaser.GameObjects.Graphics;
 private debugGraphics!:Phaser.GameObjects.Graphics;
 private config:RunConfig={mode:'casual',seed:'preview'};
 private stats:RunStats={mode:'casual',seed:'preview',height:0,score:0,objectsPlaced:0,perfectDrops:0,combo:0,maxCombo:0,maxPerfectCombo:0,duration:0,objectIds:[]};
 private state:GameSnapshot['state']='over'; private pausedState:GameSnapshot['state']='ready';
 private cameraY=0; private cameraTarget=0; private topY=650; private peakTopY=650;
 private elapsed=0; private phase=0; private craneX=210; private stableMs=0; private dropElapsed=0;
 private support?:Matter.Body; private accumulator=0; private precision=0; private perfectCombo=0;
 private def!:ObjectDefinition; private lastEmit=0; private forcedObject?:string; private fixedX?:number;
 private particles:Particle[]=Array.from({length:48},()=>({x:0,y:0,vx:0,vy:0,life:0,color:0}));
 private showBodies=false; private assisted=false; private auto=false; private touched=false; private ready=false; private slowMs=0;
 private retrySnapshot:{piece:Piece;x:number;y:number;angle:number}[]=[];
 private profile?:Profile; private milestones=new Set<string>(); private latestAccuracy?:GameSnapshot['accuracy'];
 readonly whenReady:Promise<void>; private resolveReady!:()=>void;
 constructor(private hooks:Hooks){super('Tower');this.whenReady=new Promise(resolve=>{this.resolveReady=resolve;});}
 create(){
  createObjectTextures(this);this.background=this.add.graphics();this.foreground=this.add.graphics().setDepth(20);this.debugGraphics=this.add.graphics().setDepth(21);
  this.engine=Matter.Engine.create({enableSleeping:true,positionIterations:8,velocityIterations:8});this.engine.gravity.y=1.15;
  this.ground=Matter.Bodies.rectangle(210,666,230,32,{isStatic:true,friction:1,restitution:0,label:'ground'});Matter.Composite.add(this.engine.world,this.ground);
  Matter.Events.on(this.engine,'collisionStart',(event:Matter.IEventCollision<Matter.Engine>)=>{
   if(!this.falling || this.touched)return;
   for(const pair of event.pairs){
    if(pair.bodyA.parent===this.falling.body || pair.bodyB.parent===this.falling.body){
     const other=(pair.bodyA.parent===this.falling.body?pair.bodyB:pair.bodyA).parent;
     if(other.position.y>=this.falling.body.position.y){this.support=other;this.touched=true;this.state='settling';this.burst(this.falling.body.position.x,this.falling.body.bounds.max.y,this.falling.def.mass);this.hooks.effect(this.falling.def.mass>7?'impact_heavy':'impact_light',this.falling.def.mass);if(this.falling.def.mass>7){this.cameras.main.shake(85,.0014);this.slowMs=90;}break;}
    }
   }
  });
  this.input.on('pointerdown',()=>this.drop());
  this.input.keyboard?.on('keydown-SPACE',(event:KeyboardEvent)=>{if((event.target as HTMLElement)?.closest?.('input,textarea,select,dialog[open],.debug-panel'))return;event.preventDefault();if(!event.repeat)this.drop();});
  this.events.once('shutdown',()=>{Matter.Events.off(this.engine,'collisionStart');Matter.Engine.clear(this.engine);});
  this.ready=true; this.paintBackground();this.resolveReady();
 }
 setProfile(profile:Profile){this.profile=profile;}
 start(config:RunConfig){
  if(!this.ready){void this.whenReady.then(()=>this.start(config));return;}
  for(const p of this.pieces)p.sprite.destroy();this.pieces=[];this.falling=undefined;this.held?.destroy();
  Matter.Composite.clear(this.engine.world,false);Matter.Composite.add(this.engine.world,this.ground);Matter.Engine.clear(this.engine);
  this.config=config;this.stats={mode:config.mode,seed:config.seed,height:0,score:0,objectsPlaced:0,perfectDrops:0,combo:0,maxCombo:0,maxPerfectCombo:0,duration:0,objectIds:[]};
  this.state='ready';this.cameraY=0;this.cameraTarget=0;this.topY=650;this.peakTopY=650;this.elapsed=0;this.phase=.7;this.stableMs=0;this.precision=0;this.perfectCombo=0;this.assisted=false;this.auto=false;this.fixedX=undefined;this.milestones.clear();this.accumulator=0;this.latestAccuracy=undefined;
  this.nextObject();this.emit();
 }
 private nextObject(){
  this.def=this.forcedObject?getObject(this.forcedObject):objectAt(this.config.seed,this.stats.objectsPlaced);this.forcedObject=undefined;
  this.held?.destroy();this.held=this.add.image(this.craneX,225,'object-'+this.def.id).setDepth(11);this.state='ready';this.support=undefined;this.touched=false;this.stableMs=0;
 }
 drop(){
  if(this.state!=='ready' || !this.held)return;
  this.retrySnapshot=this.pieces.filter(p=>p.placed && !p.fallen).map(piece=>({piece,x:piece.body.position.x,y:piece.body.position.y,angle:piece.body.angle}));
  const x=this.fixedX??this.craneX,y=this.cameraY+225;const d=this.def;
  const body=createObjectBody(d,x,y);
  Matter.Composite.add(this.engine.world,body);
  const sprite=this.held;this.held=undefined;const piece:Piece={body,sprite,def:d,placed:false,index:this.stats.objectsPlaced,settledY:y,fallen:false};this.pieces.push(piece);this.falling=piece;this.state='falling';this.dropElapsed=0;this.fixedX=undefined;
  this.hooks.effect('drop');this.hooks.event('object_drop',{object:d.id,index:this.stats.objectsPlaced});this.emit();
 }
 pause(paused:boolean){
  if(paused && this.state!=='paused'){this.pausedState=this.state;this.state='paused';}
  else if(!paused && this.state==='paused')this.state=this.pausedState;
  this.accumulator=0;this.emit();
 }
 canSecondChance(){return (this.state==='over' || this.state==='paused' && this.pausedState==='over') && !this.assisted && !!this.falling && !this.falling.placed;}
 secondChance(){
  if(this.state!=='over' || this.assisted || !this.falling)return false;
  const failed=this.falling;Matter.Composite.remove(this.engine.world,failed.body);failed.sprite.destroy();this.pieces=this.pieces.filter(p=>p!==failed);
  for(const saved of this.retrySnapshot){if(saved.piece.fallen){Matter.Composite.add(this.engine.world,saved.piece.body);saved.piece.fallen=false;saved.piece.sprite.setVisible(true);}Matter.Body.setPosition(saved.piece.body,{x:saved.x,y:saved.y});Matter.Body.setAngle(saved.piece.body,saved.angle);Matter.Body.setVelocity(saved.piece.body,{x:0,y:0});Matter.Body.setAngularVelocity(saved.piece.body,0);Matter.Sleeping.set(saved.piece.body,false);}
  this.assisted=true;this.stats.assisted=true;this.falling=undefined;this.nextObject();this.emit();return true;
 }
 snapshot():GameSnapshot{return {...this.stats,objectIds:[...this.stats.objectIds],duration:Math.round(this.elapsed/1000),state:this.state,nextObject:this.def?.name??'',accuracy:this.latestAccuracy,fps:Math.round(this.game.loop.actualFps)};}
 private emit(){this.hooks.snapshot(this.snapshot());}
 update(_time:number,delta:number){
  const dt=Math.min(50,delta);
  if(this.state!=='over' && this.state!=='paused'){
   this.elapsed+=dt;this.phase+=dt/1000*craneSpeed(this.stats.objectsPlaced)/150;this.craneX=this.fixedX??210+Math.sin(this.phase)*145;
   this.slowMs=Math.max(0,this.slowMs-dt);this.engine.timing.timeScale=this.slowMs>0?.65:1;
   this.accumulator+=dt;while(this.accumulator>=1000/60){Matter.Engine.update(this.engine,1000/60);this.accumulator-=1000/60;this.simulation(1000/60);if((this.state as GameSnapshot['state'])==='over')break;}
   this.cameraY+=(this.cameraTarget-this.cameraY)*(1-Math.exp(-dt/240));
   if(this.auto && this.state==='ready'){const top=this.pieces.filter(p=>p.placed && !p.fallen).sort((a,b)=>a.body.bounds.min.y-b.body.bounds.min.y)[0];this.fixedX=top?.body.position.x??210;this.craneX=this.fixedX;if(Math.abs(this.cameraTarget-this.cameraY)<2)this.drop();}
  }
  this.paintBackground();this.paintWorld(dt);
  if(_time-this.lastEmit>100){this.lastEmit=_time;this.emit();}
 }
 private simulation(dt:number){
  for(const p of this.pieces){const killY=p===this.falling&&!p.placed?Math.min(800,this.cameraY+860):800;if(!p.fallen && p.body.position.y>killY){p.fallen=true;Matter.Composite.remove(this.engine.world,p.body);p.sprite.setVisible(false);if(p===this.falling && !p.placed){this.finish('miss');return;}}}
  const placed=this.pieces.filter(p=>p.placed && !p.fallen);
  const currentTop=placed.length?Math.min(...placed.map(p=>p.body.bounds.min.y)):650;
  if(hasSignificantCollapse(this.pieces.filter(p=>p.placed).map(p=>({placedIndex:p.index,settledY:p.settledY,y:p.body.position.y,speed:p.body.speed,fallen:p.fallen})),this.peakTopY,currentTop)){this.finish('collapse');return;}
  if(!this.falling || this.falling.placed)return;
  this.dropElapsed+=dt;const p=this.falling;
  const hasSupport=this.touched && Matter.Query.collides(p.body,[this.ground,...placed.map(v=>v.body)]).length>0;
  this.stableMs=advanceStability(this.stableMs,p.body.speed,Math.abs(p.body.angularVelocity),dt,hasSupport);
  if(isSettled(this.stableMs)){this.land(p);return;}
  if(this.dropElapsed>14000){this.finish('timeout');}
 }
 private land(p:Piece){
  p.placed=true;p.settledY=p.body.position.y;
  const candidates=[this.ground,...this.pieces.filter(v=>v!==p&&v.placed&&!v.fallen).map(v=>v.body)];
  const contacts=Matter.Query.collides(p.body,candidates).map(pair=>(pair.bodyA.parent===p.body?pair.bodyB:pair.bodyA).parent).filter(body=>body.position.y>=p.body.position.y);
  const overlap=(body:Matter.Body)=>Math.max(0,Math.min(body.bounds.max.x,p.body.bounds.max.x)-Math.max(body.bounds.min.x,p.body.bounds.min.x));
  const below=contacts.sort((a,b)=>overlap(b)-overlap(a))[0]??this.support??this.ground;
  const supportWidth=below.bounds.max.x-below.bounds.min.x;
  const objectCenter=(p.body.bounds.min.x+p.body.bounds.max.x)/2,surfaceCenter=(below.bounds.min.x+below.bounds.max.x)/2;
  const accuracy=accuracyFor(objectCenter-surfaceCenter,Math.min(p.def.width,supportWidth));this.latestAccuracy=accuracy;
  this.stats.combo=updateCombo(accuracy,this.stats.combo);this.stats.maxCombo=Math.max(this.stats.maxCombo,this.stats.combo);this.perfectCombo=accuracy==='PERFECT'?this.perfectCombo+1:0;this.stats.maxPerfectCombo=Math.max(this.stats.maxPerfectCombo??0,this.perfectCombo);
  this.stats.objectsPlaced++;this.stats.objectIds.push(p.def.id);if(accuracy==='PERFECT')this.stats.perfectDrops++;
  this.precision+=scoreDrop(accuracy,this.stats.combo);
  this.topY=Math.min(...this.pieces.filter(v=>v.placed&&!v.fallen).map(v=>v.body.bounds.min.y));this.peakTopY=Math.min(this.peakTopY,this.topY);
  this.stats.height=towerHeight(this.topY);this.stats.score=calculateScore(this.stats.height,this.stats.objectsPlaced,this.precision);
  this.cameraTarget=Math.min(0,this.topY-440);
  this.hooks.event('object_landed',{object:p.def.id,accuracy,height:this.stats.height});
  if(accuracy==='PERFECT'){this.hooks.event('perfect_drop');this.hooks.effect('perfect');}
  else if(accuracy==='RISKY')this.hooks.moment('¡Por un pelo!');
  if(this.stats.combo>=2){this.hooks.event('combo_reached',{combo:this.stats.combo});this.hooks.effect('combo');}
  if(this.stats.objectsPlaced===1)this.hooks.event('tutorial_complete');
  for(const height of [50,100,200,300])if(this.stats.height>=height && !this.milestones.has('h'+height)){this.milestones.add('h'+height);this.hooks.moment(height===50?'¡Tocaste las nubes!':height===100?'100 m. Cero miedo.':height===200?'Entraste en modo caos':'¡Hola, estratósfera!');}
  if(this.perfectCombo===5)this.hooks.moment('Cinco PERFECT. Una obra de arte.');
  if(this.profile && this.stats.height>this.profile.personalBest && !this.milestones.has('record')){this.milestones.add('record');this.hooks.event('personal_best');this.hooks.effect('new_record');if(this.profile.personalBest>0)this.hooks.moment('¡Nuevo récord personal!');}
  this.falling=undefined;this.nextObject();this.emit();
 }
 private finish(reason:RunResult['reason']){
  if(this.state==='over')return;this.state='over';this.held?.setVisible(false);this.hooks.effect(reason==='collapse'?'collapse':'game_over');
  const won=this.config.challenge?this.stats.height>this.config.challenge.height:undefined;
  const moments=[...this.milestones];if(reason==='collapse'){moments.push('dramatic-collapse');this.hooks.moment('La gravedad pidió revancha.');}
  if(won)moments.push('challenge-victory');else if(this.config.challenge&&this.config.challenge.height-this.stats.height<10)moments.push('close-challenge');
  this.hooks.over({...this.stats,objectIds:[...this.stats.objectIds],duration:Math.round(this.elapsed/1000),reason,coins:0,personalBest:this.stats.height>(this.profile?.personalBest??0),challengeWon:won,moments});this.emit();
 }
 debug(command:string,value?:string){
  if(!new URLSearchParams(location.search).has('debug') || new URLSearchParams(location.search).get('debug')!=='1')return;
  if(command==='center' || command==='miss'){this.fixedX=command==='center'?210:25;this.craneX=this.fixedX;}
  if(command==='auto-stack')this.auto=!this.auto;
  if(command==='bodies')this.showBodies=!this.showBodies;
  if(command==='force-object'){this.forcedObject=value;if(this.state==='ready')this.nextObject();}
  if(command==='height'){const target=Math.max(0,Math.min(1000,Number(value)||50));const shift=target*10;for(const p of this.pieces)Matter.Body.translate(p.body,{x:0,y:-shift});this.cameraTarget-=shift;this.cameraY=this.cameraTarget;this.topY-=shift;this.peakTopY-=shift;this.stats.height=towerHeight(this.topY);}
  if(command==='end-run')this.finish('miss');this.emit();
 }
 private cosmeticColor(category:'crane'|'trail'|'effect',fallback:number){const id=this.profile?.selectedCosmetics[category];const hex=COSMETICS.find(c=>c.id===id)?.color;return hex?Phaser.Display.Color.HexStringToColor(hex).color:fallback;}
 private burst(x:number,y:number,mass:number){let count=Math.min(12,Math.ceil(mass+4));const color=this.cosmeticColor('effect',0xefe18c);for(const p of this.particles){if(p.life>0)continue;p.x=x;p.y=y;p.vx=(Math.random()-.5)*2;p.vy=-Math.random()*1.8;p.life=450;p.color=color;if(--count<=0)break;}}
 private paintBackground(){
  const g=this.background;g.clear();const h=this.stats.height;const aurora=this.profile?.selectedCosmetics.background==='background-aurora';
  const sunset=this.profile?.selectedCosmetics.background==='background-sunset';
  const col=h>=200?0x202e4c:h>=100?0x315f77:h>=50?0x477f8b:aurora?0x555478:sunset?0x936e73:0x335b65;g.fillStyle(col);g.fillRect(0,0,420,746);
  g.fillStyle(0xc5dbbf,.11);g.fillCircle(344,196,98);g.fillStyle(0xf8efd7,.5);g.fillCircle(338,185,29);
  const skyline=665-this.cameraY*.24;
  for(let layer=0;layer<2;layer++){g.fillStyle(layer?0x284751:0x416d72,.8);for(let i=0;i<10;i++){const width=38+(i*17%24),height=50+(i*37%130);g.fillRoundedRect(i*48-17,skyline-height+layer*45,width,height+250,2);if(layer){g.fillStyle(0xf1d988,.22);for(let j=0;j<5;j++)for(let k=0;k<2;k++)g.fillRect(i*48-8+k*13,skyline-height+65+j*21,5,8);g.fillStyle(0x284751,.8);}}}
  for(let i=0;i<4;i++){const cx=((i*151+this.elapsed*.002)%560)-70,cy=300+i*125+(this.cameraY*.08)%100;g.fillStyle(0xe2efe5,.08);g.fillEllipse(cx,cy,120,27);g.fillEllipse(cx+35,cy-8,65,33);}
  if(h>=200){g.fillStyle(0xf8efd7,.5);for(let i=0;i<30;i++)g.fillCircle((i*113)%420,100+(i*73)%550,1);}
 }
 private paintWorld(dt:number){
  const g=this.foreground;g.clear();const groundY=650-this.cameraY;
  g.fillStyle(0x172e38,.22);g.fillEllipse(210,groundY+37,270,20);
  g.fillStyle(0x172e38);g.fillRoundedRect(95,groundY,230,35,5);g.fillStyle(0xc9ded0);g.fillRoundedRect(95,groundY,230,9,3);
  g.lineStyle(2,0x172e38,.45);for(let x=106;x<325;x+=20)g.lineBetween(x,groundY+14,x+9,groundY+23);
  g.lineStyle(3,0xb5cdc2,.7);g.lineBetween(0,154,420,154);
  const craneColor=this.cosmeticColor('crane',0xf1df72);
  g.fillStyle(craneColor);g.fillRoundedRect(this.craneX-22,143,44,22,5);g.fillStyle(0x172e38);g.fillCircle(this.craneX-12,155,4);g.fillCircle(this.craneX+12,155,4);
  if(this.held && this.state==='ready'){g.lineStyle(2,0xf4eacb,.85);g.lineBetween(this.craneX,165,this.craneX,225-this.def.height/2);this.held.setPosition(this.craneX,225).setRotation(0);}
  for(const p of this.pieces){const offset=p.def.centerOfMassOffset??{x:0,y:0};const a=p.body.angle;p.sprite.setPosition(p.body.position.x-offset.x*Math.cos(a)+offset.y*Math.sin(a),p.body.position.y-offset.x*Math.sin(a)-offset.y*Math.cos(a)-this.cameraY).setRotation(a).setVisible(!p.fallen);}
  if(this.falling && this.profile?.selectedCosmetics.trail!=='trail-default' && !this.falling.placed){g.lineStyle(3,this.cosmeticColor('trail',0xccebc7),.3);const pos=this.falling.body.position;g.lineBetween(pos.x,pos.y-this.cameraY-15,pos.x,pos.y-this.cameraY-65);}
  for(const p of this.particles){if(p.life<=0)continue;p.life-=dt;p.x+=p.vx*dt*.06;p.y+=p.vy*dt*.06;p.vy+=dt*.002;const y=p.y-this.cameraY,alpha=Math.max(0,p.life/450),effect=this.profile?.selectedCosmetics.effect;g.fillStyle(p.color,alpha);if(effect==='effect-confetti')g.fillRect(p.x,y,4,3);else if(effect==='effect-stars'){g.lineStyle(2,p.color,alpha);g.lineBetween(p.x-3,y,p.x+3,y);g.lineBetween(p.x,y-3,p.x,y+3);}else if(effect==='effect-sparks'){g.lineStyle(2,p.color,alpha);g.lineBetween(p.x,y,p.x-p.vx*4,y-p.vy*4);}else if(effect==='effect-bubbles'){g.lineStyle(1,p.color,alpha);g.strokeCircle(p.x,y,3);}else g.fillCircle(p.x,y,2);}
  const debug=this.debugGraphics;debug.clear();if(this.showBodies){debug.lineStyle(1,0xff7070,.8);for(const p of this.pieces){debug.beginPath();p.body.vertices.forEach((v,i)=>{if(i===0)debug.moveTo(v.x,v.y-this.cameraY);else debug.lineTo(v.x,v.y-this.cameraY);});debug.closePath();debug.strokePath();debug.fillStyle(0xffff00);debug.fillCircle(p.body.position.x,p.body.position.y-this.cameraY,3);}}
 }
}
