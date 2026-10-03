export type GameMode = 'casual' | 'daily' | 'challenge';
export type Accuracy = 'PERFECT' | 'GREAT' | 'GOOD' | 'RISKY';
export interface ObjectDefinition { id: string; name: string; width: number; height: number; mass: number; friction: number; restitution: number; centerOfMassOffset?: {x:number;y:number}; difficultyWeight:number; visualType:string; color:string; material:'wood'|'metal'|'soft'|'ceramic'; shape?:'rectangle'|'circle'|'trapezoid'; rare?:boolean; }
export interface Challenge { version:1; seed:string; height:number; score:number; name?:string; }
export interface RunConfig { mode:GameMode; seed:string; challenge?:Challenge; }
export interface RunStats { mode:GameMode; seed:string; height:number; score:number; objectsPlaced:number; perfectDrops:number; combo:number; maxCombo:number; maxPerfectCombo?:number; assisted?:boolean; duration:number; objectIds:string[]; }
export interface RunResult extends RunStats { reason:'miss'|'collapse'|'timeout'; coins:number; personalBest:boolean; challengeWon?:boolean; moments:string[]; }
export interface GameSnapshot extends RunStats { state:'ready'|'falling'|'settling'|'over'|'paused'; nextObject:string; accuracy?:Accuracy; fps:number; }
export interface Settings { music:boolean; sfx:boolean; haptics:boolean; }
export interface DailyData { best:number; attempts:number; }
export interface Profile { version:2; personalBest:number; bestScore:number; coins:number; unlockedCosmetics:string[]; selectedCosmetics:{crane:string;background:string;trail:string;effect:string}; settings:Settings; achievements:string[]; missions:Record<string,{progress:number;claimed:boolean}>; daily:Record<string,DailyData>; dailyStreak:number; lastDailyDate:string; sessionCount:number; runs:number; tutorialComplete:boolean; publicName:string; }
export interface Cosmetic {id:string;name:string;category:'crane'|'background'|'trail'|'effect';price:number;color:string;}
export interface Achievement {id:string;name:string;description:string;target:number;metric:string;}
export interface Mission {id:string;name:string;target:number;reward:number;metric:string;}
export interface ProgressUpdate {profile:Profile;earnedCoins:number;newAchievements:string[];completedMissions:string[];}
export type UIAction = {type:'play';mode:GameMode} | {type:'restart'} | {type:'menu'} | {type:'drop'} | {type:'pause';paused:boolean} | {type:'share';image:boolean} | {type:'settings';settings:Settings} | {type:'cosmetic';id:string} | {type:'name';name:string} | {type:'reward';reward:'second-chance'|'double-coins'|'cosmetic-trial'} | {type:'leaderboard';kind:'today'|'all-time'} | {type:'install'} | {type:'debug';command:string;value?:string};
export interface GameControls { start(config:RunConfig):void; drop():void; pause(paused:boolean):void; secondChance():boolean; debug(command:string,value?:string):void; }
