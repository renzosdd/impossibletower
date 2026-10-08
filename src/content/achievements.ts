import type { Achievement } from '../types';
import type { AidId } from './economy';

export const BADGE_CATALOG_VERSION = 2;
export type BadgeTier = 'bronze' | 'silver' | 'gold';
export interface BadgeReward { coins:number; items:Partial<Record<AidId,number>>; }
export interface BadgeFamily { id:string; name:string; description:string; metric:string; targets:readonly [number,number,number]; rewards:readonly [BadgeReward,BadgeReward]; }
const coins = (amount:number):BadgeReward => ({coins:amount,items:{}});
const aid = (id:AidId):BadgeReward => ({coins:0,items:{[id]:1}});
const money = [coins(5),coins(10)] as const;
export const BADGE_FAMILIES:readonly BadgeFamily[] = [
 {id:'stack',name:'Primer ladrillo',description:'Objetos en una torre',metric:'objectsPlaced',targets:[1,10,25],rewards:[aid('preview'),aid('guide-5')]},
 {id:'height',name:'Mirador',description:'Altura máxima',metric:'height',targets:[30,75,150],rewards:money},
 {id:'combo',name:'Mano firme',description:'Combo Perfect',metric:'maxPerfectCombo',targets:[3,5,10],rewards:money},
 {id:'perfects',name:'Precisión imposible',description:'Perfect acumulados',metric:'totalPerfect',targets:[10,50,200],rewards:[aid('focus'),aid('skip')]},
 {id:'runs',name:'Una torre más',description:'Torres con al menos 5 objetos',metric:'qualifyingRuns',targets:[5,25,100],rewards:[aid('guide-5'),aid('guide-10')]},
 {id:'objects',name:'Domador del caos',description:'Objetos acumulados',metric:'totalObjects',targets:[25,150,750],rewards:[aid('guide-5'),aid('focus')]},
 {id:'daily-days',name:'Amaneceres',description:'Días con Daily válido',metric:'dailyDays',targets:[3,10,30],rewards:money},
 {id:'streak',name:'Sin perder el ritmo',description:'Racha de Daily válido',metric:'dailyStreak',targets:[3,7,14],rewards:money},
 {id:'rockets',name:'Ciencia de cohetes',description:'Cohetes colocados',metric:'rockets',targets:[1,5,15],rewards:[aid('preview'),aid('skip')]},
 {id:'variety',name:'Coleccionista imposible',description:'Tipos de objetos colocados',metric:'uniqueObjects',targets:[5,15,25],rewards:[aid('preview'),aid('focus')]},
 {id:'weekly-podium',name:'Podio semanal',description:'Podios semanales definitivos',metric:'weeklyPodium',targets:[1,3,6],rewards:money},
 {id:'monthly-podium',name:'Podio mensual',description:'Podios mensuales definitivos',metric:'monthlyPodium',targets:[1,3,6],rewards:money},
];
export const BADGE_TIERS = ['bronze','silver','gold'] as const;
export const BADGES:Achievement[] = BADGE_FAMILIES.flatMap(family=>BADGE_TIERS.map((tier,index)=>({
 id:`v2:${family.id}:${tier}`,family:family.id,tier,name:family.name,description:family.description,
 metric:family.metric,target:family.targets[index],reward:index===0?undefined:family.rewards[index-1],
})));
export const ACHIEVEMENTS = BADGES;
export const MONTHLY_BADGE = BADGES.find(b=>b.family==='monthly-podium'&&b.tier==='bronze')!;
