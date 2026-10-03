import Phaser from 'phaser';
import { OBJECTS } from '../../content/objects';
/** Original vector illustrations rendered once into small reusable textures. */
export function createObjectTextures(scene:Phaser.Scene) {
 for (const def of OBJECTS) {
  const w=def.width,h=def.height,g=scene.make.graphics({x:0,y:0});
  const color=Phaser.Display.Color.HexStringToColor(def.color).color;
  const dark=0x172e38,cream=0xf8f0d9;
  const rect=(x:number,y:number,a:number,b:number,c=color,r=5)=>{g.fillStyle(c);g.fillRoundedRect(x,y,a,b,r);};
  const line=(x:number,y:number,a:number,b:number,c=dark,alpha=.3)=>{g.lineStyle(2,c,alpha);g.lineBetween(x,y,a,b);};
  const circle=(x:number,y:number,r:number,c:number)=>{g.fillStyle(c);g.fillCircle(x,y,r);};
  g.fillStyle(color);g.fillRoundedRect(0,0,w,h,5);
  g.fillStyle(0xffffff,.2);g.fillRoundedRect(2,2,w-4,Math.max(4,h*.12),3);
  g.fillStyle(dark,.18);g.fillRect(w-8,6,8,h-6);g.fillRect(3,h-7,w-3,7);
  switch(def.id){
   case 'box':line(w*.5,1,w*.5,h-1);line(1,h*.48,w-1,h*.48);rect(w*.38,0,w*.24,h*.25,cream,1);rect(w*.36,h*.67,w*.29,h*.2,cream,1);break;
   case 'table':g.clear();rect(2,0,w-4,12);rect(20,10,10,h-10);rect(w-30,10,10,h-10);rect(2,0,w-4,4,cream,2);break;
   case 'chair':g.clear();rect(5,0,w-10,h*.48);rect(0,h*.42,w,h*.14);line(w*.5,4,w*.5,h*.35);rect(5,h*.54,8,h*.46);rect(w-13,h*.54,8,h*.46);break;
   case 'sofa':rect(5,7,w-10,h*.48);rect(12,h*.42,w-24,h*.42,cream);rect(0,14,15,h-14);rect(w-15,14,15,h-14);line(w*.5,h*.45,w*.5,h*.85);break;
   case 'fridge':line(2,h*.34,w-2,h*.34);rect(w-13,10,4,14,dark,1);rect(w-13,h*.45,4,24,dark,1);rect(8,10,13,10,cream,1);break;
   case 'washer':circle(w*.5,h*.58,w*.31,dark);circle(w*.5,h*.58,w*.24,0x86bcc1);g.lineStyle(3,cream);g.strokeCircle(w*.5,h*.58,w*.31);circle(w*.75,10,4,dark);rect(7,6,20,8,cream,1);break;
   case 'bathtub':g.clear();g.fillStyle(color);g.fillPoints([{x:0,y:0},{x:w,y:0},{x:w*.87,y:h-6},{x:w*.13,y:h-6}],true);rect(3,3,w-6,10,cream);rect(10,h-6,10,6,dark,1);rect(w-20,h-6,10,6,dark,1);line(15,17,w-15,17);break;
   case 'piano':g.clear();rect(0,0,w,h*.8);rect(7,h*.48,w-14,h*.22,cream,1);for(let i=1;i<12;i++)line(7+i*(w-14)/12,h*.48,7+i*(w-14)/12,h*.7);rect(10,h*.8,9,h*.2,dark,1);rect(w-19,h*.8,9,h*.2,dark,1);break;
   case 'barrel':g.clear();g.fillStyle(color);g.fillEllipse(w*.5,h*.5,w,h);rect(0,h*.22,w,7,dark,2);rect(0,h*.72,w,7,dark,2);line(w*.35,5,w*.35,h-5);line(w*.66,5,w*.66,h-5);break;
   case 'motorbike':g.clear();circle(w*.2,h*.75,h*.22,dark);circle(w*.8,h*.75,h*.22,dark);circle(w*.2,h*.75,h*.12,cream);circle(w*.8,h*.75,h*.12,cream);rect(w*.2,h*.35,w*.57,h*.25);line(w*.8,h*.7,w*.7,8,color,1);rect(w*.25,5,w*.32,7,dark,2);break;
   case 'car':g.clear();rect(1,h*.35,w-2,h*.5);rect(w*.22,0,w*.58,h*.46);rect(w*.28,5,w*.21,h*.27,0xb7dcdc);rect(w*.53,5,w*.2,h*.27,0xb7dcdc);circle(w*.22,h*.8,h*.2,dark);circle(w*.78,h*.8,h*.2,dark);circle(w*.22,h*.8,h*.09,cream);circle(w*.78,h*.8,h*.09,cream);rect(2,h*.44,7,8,cream,1);break;
   case 'container':for(let i=12;i<w-10;i+=14)line(i,7,i,h-7);rect(0,h-7,w,7,dark,1);break;
   case 'statue':g.clear();rect(w*.12,h*.78,w*.76,h*.22);g.fillStyle(color);g.fillTriangle(w*.5,h*.22,w*.12,h*.79,w*.88,h*.79);circle(w*.5,h*.16,h*.13,color);line(w*.25,h*.36,2,h*.15,color,1);break;
   case 'house':rect(0,0,w,h*.26,dark,2);rect(w*.4,h*.53,w*.22,h*.47,0xb87255,2);rect(w*.1,h*.4,w*.2,h*.22,cream,2);rect(w*.7,h*.4,w*.2,h*.22,cream,2);line(0,h*.26,w,h*.26,cream,.5);break;
   case 'boat':g.clear();g.fillStyle(color);g.fillTriangle(0,h*.5,w,h*.5,w*.8,h);g.fillTriangle(0,h*.5,w*.8,h,w*.2,h);rect(w*.5,0,4,h*.65,dark,1);g.fillStyle(cream);g.fillTriangle(w*.49,3,w*.13,h*.49,w*.49,h*.49);g.fillStyle(0xed8c71);g.fillTriangle(w*.55,8,w*.89,h*.49,w*.55,h*.49);break;
   case 'rocket':g.clear();rect(w*.19,h*.18,w*.62,h*.66,cream,w*.2);g.fillStyle(color);g.fillTriangle(w*.19,h*.2,w*.5,0,w*.81,h*.2);g.fillTriangle(0,h,w*.23,h*.56,w*.3,h*.87);g.fillTriangle(w,h,w*.77,h*.56,w*.7,h*.87);circle(w*.5,h*.37,w*.17,dark);circle(w*.5,h*.37,w*.11,0x9ad2da);rect(w*.35,h*.84,w*.3,h*.16,color,2);break;
   case 'ball':g.clear();circle(w*.5,h*.5,w*.5,color);g.lineStyle(3,cream,.65);g.strokeCircle(w*.5,h*.5,w*.33);line(w*.5,0,w*.5,h,cream,.65);line(0,h*.5,w,h*.5,cream,.65);break;
   case 'satellite':g.clear();rect(0,h*.23,w*.3,h*.52,0x86bcc1,1);rect(w*.7,h*.23,w*.3,h*.52,0x86bcc1,1);rect(w*.3,h*.05,w*.4,h*.85);circle(w*.5,h*.3,h*.16,cream);for(let i=1;i<3;i++){line(w*.1*i,h*.25,w*.1*i,h*.75);line(w*.7+w*.1*i,h*.25,w*.7+w*.1*i,h*.75);}break;
  }
  g.generateTexture('object-'+def.id,Math.ceil(w),Math.ceil(h));g.destroy();
 }
}
