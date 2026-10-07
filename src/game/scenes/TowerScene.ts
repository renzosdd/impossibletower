import { t } from '../../services/i18n';
import Phaser from 'phaser';
import type { AidId, GameControls, GameSnapshot, RunConfig, RunResult, Profile } from '../../types';
import { createObjectTextures } from '../objects/textures';
import { COSMETICS, ACCOUNT_COSMETICS } from '../../content/cosmetics';
import { TowerSimulation, TICK_MS, type SimulationPiece } from '../simulation/TowerSimulation';

interface Particle {x:number;y:number;vx:number;vy:number;life:number;color:number;}
interface Hooks {snapshot(s:GameSnapshot):void;over(r:RunResult):void;event(name:string,data?:Record<string,unknown>):void;effect(name:string,weight?:number):void;moment(text:string):void;}
export class TowerScene extends Phaser.Scene implements GameControls {
 private sim!:TowerSimulation;
 private sprites=new Map<SimulationPiece,Phaser.GameObjects.Image>();
 private held?:Phaser.GameObjects.Image;
 private heldId?:string;
 private previewSprites:Phaser.GameObjects.Image[]=[];
 private previewLabel?:Phaser.GameObjects.Text;
 private background!:Phaser.GameObjects.Graphics;
 private foreground!:Phaser.GameObjects.Graphics;
 private debugGraphics!:Phaser.GameObjects.Graphics;
 private accumulator=0;
 private lastEmit=0;
 private showBodies=false;
 private ready=false;
 private profile?:Profile;
 private milestones=new Set<string>();
 private particles:Particle[]=Array.from({length:48},()=>({x:0,y:0,vx:0,vy:0,life:0,color:0}));
 readonly whenReady:Promise<void>;
 private resolveReady!:()=>void;
 constructor(private hooks:Hooks){super('Tower');this.whenReady=new Promise(resolve=>{this.resolveReady=resolve;});}
 private get stats(){return this.sim.stats;}
 private get state(){return this.sim.state;}
 private get cameraY(){return this.sim.cameraY;}
 private get craneX(){return this.sim.craneX;}
 private get elapsed(){return this.sim.elapsed;}
 private get def(){return this.sim.def;}
 private get pieces(){return this.sim.pieces.map(p=>({...p,sprite:this.sprites.get(p)!}));}
 private get falling(){const p=this.sim.falling;return p?{...p,sprite:this.sprites.get(p)!}:undefined;}
 create(){
  createObjectTextures(this);
  this.background=this.add.graphics();this.foreground=this.add.graphics().setDepth(20);this.debugGraphics=this.add.graphics().setDepth(21);
  this.sim=new TowerSimulation({mode:'casual',seed:'preview'});this.sim.pause(true);
  this.input.on('pointerdown',()=>this.drop());
  this.input.keyboard?.on('keydown-SPACE',(event:KeyboardEvent)=>{if((event.target as HTMLElement)?.closest?.('input,textarea,select,dialog[open],.debug-panel'))return;event.preventDefault();if(!event.repeat)this.drop();});
  this.events.once('shutdown',()=>this.sim.dispose());
  this.ready=true;this.paintBackground();this.resolveReady();
 }
 setProfile(profile:Profile){this.profile=profile;}
 start(config:RunConfig){
  if(!this.ready){void this.whenReady.then(()=>this.start(config));return;}
  this.sim.dispose();for(const sprite of this.sprites.values())sprite.destroy();this.sprites.clear();this.held?.destroy();this.held=undefined;this.heldId=undefined;
  this.milestones.clear();this.accumulator=0;
  this.sim=new TowerSimulation(config,{event:(name,data)=>this.onEvent(name,data),over:result=>this.finish(result)});
  this.syncSprites();this.emit();
 }
 drop(){if(this.sim?.drop()){this.syncSprites();this.emit();}}
 pause(paused:boolean){if(!this.sim)return;this.sim.pause(paused);this.accumulator=0;this.emit();}
 canSecondChance(){return !!this.sim?.canSecondChance();}
 secondChance(){const ok=this.sim?.activateAid('second-chance')??false;if(ok){this.syncSprites();this.emit();}return ok;}
 activateAid(id:AidId){const ok=this.sim?.activateAid(id)??false;if(ok){this.syncSprites();this.emit();}return ok;}
 canActivateAid(id:AidId){return this.sim?.canActivateAid(id)??false;}
 replay(){return {ruleset:this.sim.config.ruleset,events:structuredClone(this.sim.events),finalTick:this.sim.tick,tainted:this.sim.tainted};}
 timing(){return {tick:this.sim.tick,craneX:this.sim.craneX,cameraY:this.sim.cameraY};}
 snapshot():GameSnapshot{return this.sim.snapshot(Math.round(this.game.loop.actualFps));}
 private emit(){if(this.sim)this.hooks.snapshot(this.snapshot());}
 private syncSprites(){
  for(const [piece,sprite] of this.sprites)if(!this.sim.pieces.includes(piece)){sprite.destroy();this.sprites.delete(piece);}
  for(const piece of this.sim.pieces)if(!this.sprites.has(piece))this.sprites.set(piece,this.add.image(piece.body.position.x,piece.body.position.y-this.cameraY,'object-'+piece.def.id).setDepth(11));
  if(this.state==='ready'||this.state==='paused'&&!this.sim.result&&!this.sim.falling){
   if(!this.held||this.heldId!==this.def.id){this.held?.destroy();this.held=this.add.image(this.craneX,225,'object-'+this.def.id).setDepth(11);this.heldId=this.def.id;}
   this.held.setVisible(true);
  }else{this.held?.destroy();this.held=undefined;this.heldId=undefined;}
 }
 update(time:number,delta:number){
  if(!this.sim)return;
  const dt=Math.min(50,delta);
  if(this.state!=='over'&&this.state!=='paused'){
   this.accumulator+=dt;
   const ticks=Math.floor((this.accumulator+1e-8)/TICK_MS);
   if(ticks>0){this.accumulator-=ticks*TICK_MS;this.sim.advance(ticks);}
  }
  this.syncSprites();this.paintBackground();this.paintWorld(dt);
  if(time-this.lastEmit>100){this.lastEmit=time;this.emit();}
 }
 private onEvent(name:string,data?:Record<string,unknown>){
  if(name==='impact'){
   this.burst(Number(data?.x),Number(data?.y),Number(data?.mass));
   this.hooks.effect(Number(data?.mass)>7?'impact_heavy':'impact_light',Number(data?.mass));
   if(Number(data?.mass)>7)this.cameras.main.shake(85,.0014);
   return;
  }
  this.hooks.event(name,data);
  if(name==='object_drop')this.hooks.effect('drop');
  if(name==='perfect_drop')this.hooks.effect('perfect');
  if(name==='combo_reached')this.hooks.effect('combo');
  if(name==='object_landed'){
   if(data?.accuracy==='RISKY')this.hooks.moment('¡Por un pelo!');
   for(const height of [50,100,200,300])if(this.stats.height>=height&&!this.milestones.has('h'+height)){this.milestones.add('h'+height);this.hooks.moment(height===50?'¡Tocaste las nubes!':height===100?'100 m. Cero miedo.':height===200?'Entraste en modo caos':'¡Hola, estratósfera!');}
   if(data?.perfectCombo===5)this.hooks.moment('Cinco PERFECT. Una obra de arte.');
   if(this.profile&&this.stats.height>this.profile.personalBest&&!this.milestones.has('record')){this.milestones.add('record');this.hooks.event('personal_best');this.hooks.effect('new_record');if(this.profile.personalBest>0)this.hooks.moment('¡Nuevo récord personal!');}
  }
 }
 private finish(result:RunResult){
  this.hooks.effect(result.reason==='collapse'?'collapse':'game_over');
  const moments=[...this.milestones];
  if(result.reason==='collapse'){moments.push('dramatic-collapse');this.hooks.moment('La gravedad pidió revancha.');}
  if(result.challengeWon)moments.push('challenge-victory');
  this.hooks.over({...result,objectIds:[...result.objectIds],aidsUsed:[...(result.aidsUsed??[])],personalBest:result.height>(this.profile?.personalBest??0),moments});this.emit();
 }
 debug(command:string,value?:string){
  if(new URLSearchParams(location.search).get('debug')!=='1')return;
  if(command==='bodies')this.showBodies=!this.showBodies;else this.sim.debug(command,value);
  this.syncSprites();this.emit();
 }
 private cosmeticColor(category:'crane'|'trail'|'effect',fallback:number){const id=this.profile?.selectedCosmetics[category];const hex=[...COSMETICS,...ACCOUNT_COSMETICS].find(c=>c.id===id)?.color;return hex?Phaser.Display.Color.HexStringToColor(hex).color:fallback;}
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
  if(this.sim.guideActive && this.state==='ready'){g.lineStyle(1,0xf8efd7,.6);g.lineBetween(this.craneX,225, this.craneX,746);}
  const preview=this.sim.preview();
  while(this.previewSprites.length>preview.length)this.previewSprites.pop()!.destroy();
  this.previewLabel?.setVisible(preview.length>0);
  if(preview.length){
   this.previewLabel??=this.add.text(20,288,t('PRÓXIMAS PIEZAS'),{fontFamily:'sans-serif',fontSize:'7px',color:'#bbd1c4'}).setDepth(22);
   this.previewLabel.setText(t('PRÓXIMAS PIEZAS'));
   g.fillStyle(0x172e38,.8);g.fillRoundedRect(12,280,145,80,8);preview.forEach((def,i)=>{
   const sprite=this.previewSprites[i]??(this.previewSprites[i]=this.add.image(0,0,'object-'+def.id).setDepth(22));
   sprite.setTexture('object-'+def.id).setPosition(42+i*44,326).setScale(Math.min(34/def.width,48/def.height));
  });}
  for(const p of this.pieces){const offset=p.def.centerOfMassOffset??{x:0,y:0};const a=p.body.angle;p.sprite.setPosition(p.body.position.x-offset.x*Math.cos(a)+offset.y*Math.sin(a),p.body.position.y-offset.x*Math.sin(a)-offset.y*Math.cos(a)-this.cameraY).setRotation(a).setVisible(!p.fallen);}
  if(this.falling && this.profile?.selectedCosmetics.trail!=='trail-default' && !this.falling.placed){g.lineStyle(3,this.cosmeticColor('trail',0xccebc7),.3);const pos=this.falling.body.position;g.lineBetween(pos.x,pos.y-this.cameraY-15,pos.x,pos.y-this.cameraY-65);}
  for(const p of this.particles){if(p.life<=0)continue;p.life-=dt;p.x+=p.vx*dt*.06;p.y+=p.vy*dt*.06;p.vy+=dt*.002;const y=p.y-this.cameraY,alpha=Math.max(0,p.life/450),effect=this.profile?.selectedCosmetics.effect;g.fillStyle(p.color,alpha);if(effect==='effect-confetti')g.fillRect(p.x,y,4,3);else if(effect==='effect-stars'){g.lineStyle(2,p.color,alpha);g.lineBetween(p.x-3,y,p.x+3,y);g.lineBetween(p.x,y-3,p.x,y+3);}else if(effect==='effect-sparks'){g.lineStyle(2,p.color,alpha);g.lineBetween(p.x,y,p.x-p.vx*4,y-p.vy*4);}else if(effect==='effect-bubbles'){g.lineStyle(1,p.color,alpha);g.strokeCircle(p.x,y,3);}else g.fillCircle(p.x,y,2);}
  const debug=this.debugGraphics;debug.clear();if(this.showBodies){debug.lineStyle(1,0xff7070,.8);for(const p of this.pieces){debug.beginPath();p.body.vertices.forEach((v,i)=>{if(i===0)debug.moveTo(v.x,v.y-this.cameraY);else debug.lineTo(v.x,v.y-this.cameraY);});debug.closePath();debug.strokePath();debug.fillStyle(0xffff00);debug.fillCircle(p.body.position.x,p.body.position.y-this.cameraY,3);}}
 }
}
