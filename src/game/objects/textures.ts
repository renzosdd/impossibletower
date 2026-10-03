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
  const polygon=(points:{x:number;y:number}[],c=color)=>{g.fillStyle(c);g.fillPoints(points,true);};
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
   case 'books':
    rect(0,0,w,h*.34,color,3);rect(0,h*.33,w,h*.34,0x99b4d8,3);rect(0,h*.66,w,h*.34,0xe5a5b9,3);
    for(let i=0;i<3;i++){rect(8,h*(i/3)+4,w-17,h*.19,cream,1);line(12,h*(i/3)+h*.16,w-15,h*(i/3)+h*.16,dark,.15);}break;
   case 'trunk':
    line(2,h*.35,w-2,h*.35);rect(w*.16,2,9,h-4,cream,1);rect(w*.76,2,9,h-4,cream,1);rect(w*.43,h*.3,w*.14,h*.16,dark,2);rect(w*.39,h*.62,w*.22,7,dark,2);break;
   case 'microwave':
    rect(7,8,w*.68,h-16,dark,4);rect(11,12,w*.59,h-24,0x86bcc1,3);line(14,18,w*.61,18,cream,.6);rect(w*.7,h*.31,4,h*.36,cream,1);circle(w*.86,h*.34,5,dark);circle(w*.86,h*.62,4,cream);break;
   case 'toaster':
    g.clear();rect(w*.18,0,w*.23,h*.25,0xe5a35c,4);rect(w*.55,0,w*.23,h*.25,0xe5a35c,4);rect(w*.21,3,w*.17,h*.16,cream,2);rect(w*.58,3,w*.17,h*.16,cream,2);rect(0,h*.18,w,h*.82,color,7);line(w*.18,h*.25,w*.78,h*.25,cream,.8);circle(w*.75,h*.63,6,dark);rect(w*.12,h*.53,w*.25,8,cream,2);break;
   case 'television':
    g.clear();rect(0,0,w,h*.75,color,6);rect(w*.43,h*.74,w*.14,h*.18,dark,1);rect(w*.18,h*.9,w*.64,h*.1,dark,2);rect(7,7,w*.71,h*.58,dark,7);rect(11,11,w*.62,h*.49,0x86bcc1,5);line(17,18,w*.56,18,cream,.5);circle(w*.88,h*.25,4,cream);circle(w*.88,h*.43,4,dark);break;
   case 'planter':
    g.clear();rect(w*.46,h*.16,w*.08,h*.38,0x67b9a1,1);polygon([{x:w*.5,y:h*.28},{x:w*.08,y:h*.1},{x:w*.13,y:0},{x:w*.46,y:h*.13}],0x67b9a1);polygon([{x:w*.5,y:h*.4},{x:w*.96,y:h*.17},{x:w*.96,y:h*.08},{x:w*.58,y:h*.22}],0x82c8b5);polygon([{x:0,y:h*.46},{x:w,y:h*.46},{x:w*.8,y:h},{x:w*.2,y:h}]);rect(1,h*.46,w-2,8,cream,2);line(w*.3,h*.64,w*.36,h*.9,cream,.45);break;
   case 'traffic-cone':
    g.clear();polygon([{x:w*.5,y:0},{x:w*.12,y:h*.9},{x:w*.88,y:h*.9}]);polygon([{x:w*.373,y:h*.3},{x:w*.627,y:h*.3},{x:w*.678,y:h*.42},{x:w*.322,y:h*.42}],cream);polygon([{x:w*.255,y:h*.58},{x:w*.745,y:h*.58},{x:w*.796,y:h*.7},{x:w*.204,y:h*.7}],cream);rect(0,h*.88,w,h*.12,color,3);break;
   case 'skateboard':
    g.clear();rect(w*.2,h*.38,w*.6,h*.15,dark,1);circle(w*.24,h*.74,h*.26,dark);circle(w*.76,h*.74,h*.26,dark);circle(w*.24,h*.74,h*.13,cream);circle(w*.76,h*.74,h*.13,cream);rect(0,0,w,h*.42,color,5);line(9,h*.2,w-9,h*.2,cream,.6);break;
   case 'teapot':
    g.clear();rect(0,h*.37,w*.12,h*.35,color,2);rect(w*.07,h*.32,w*.18,h*.1,color,2);rect(w*.07,h*.68,w*.18,h*.1,color,2);polygon([{x:w*.63,y:h*.48},{x:w,y:h*.24},{x:w*.94,y:h*.53},{x:w*.68,y:h*.72}]);circle(w*.46,h*.59,h*.32,color);rect(w*.18,h*.25,w*.5,h*.12,cream,3);circle(w*.46,h*.12,h*.1,color);rect(w*.19,h*.88,w*.48,h*.12,color,2);circle(w*.35,h*.54,5,cream);line(w*.25,h*.76,w*.53,h*.76,cream,.5);break;
   case 'accordion':
    g.clear();rect(0,0,w*.22,h,color,3);rect(w*.2,h*.07,w*.6,h*.86,0x796f9e,2);rect(w*.78,0,w*.22,h,color,3);for(let x=w*.26;x<w*.77;x+=7)line(x,h*.11,x,h*.89,cream,.45);rect(3,6,w*.15,h-12,cream,1);for(let y=13;y<h-10;y+=10)line(3,y,w*.16,y,dark,.5);for(let y=12;y<h-8;y+=12)circle(w*.88,y,3,cream);break;
   case 'arcade':
    g.clear();polygon([{x:w*.08,y:0},{x:w*.88,y:0},{x:w*.88,y:h*.4},{x:w,y:h*.5},{x:w*.88,y:h},{x:0,y:h}]);rect(w*.15,5,w*.65,12,0xed826e,2);rect(w*.16,h*.17,w*.61,h*.24,dark,3);rect(w*.21,h*.21,w*.51,h*.16,0x86bcc1,2);circle(w*.66,h*.29,4,cream);rect(w*.13,h*.46,w*.72,10,0xed826e,2);circle(w*.28,h*.47,3,dark);circle(w*.62,h*.5,3,cream);rect(w*.27,h*.72,w*.3,13,dark,2);break;
   case 'balloon':
    g.clear();rect(w*.28,h*.68,w*.04,h*.18,dark,1);rect(w*.68,h*.68,w*.04,h*.18,dark,1);circle(w*.5,h*.36,w*.5,color);g.fillStyle(cream);g.fillEllipse(w*.5,h*.36,w*.4,w*.96);rect(w*.25,h*.83,w*.5,h*.17,0xc48d56,3);line(w*.28,h*.89,w*.72,h*.89,cream,.45);line(w*.39,h*.86,w*.39,h*.98,dark,.3);line(w*.6,h*.86,w*.6,h*.98,dark,.3);break;
  }
  g.generateTexture('object-'+def.id,Math.ceil(w),Math.ceil(h));g.destroy();
 }
}
