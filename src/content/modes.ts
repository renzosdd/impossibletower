import type { GameMode } from '../types';
export const GAME_MODES:readonly {id:GameMode;title:string;description:string;competitive:boolean}[]=[
 {id:'daily',title:'Daily Tower',description:'Competí por premios diarios',competitive:true},
 {id:'casual',title:'Juego libre',description:'Practicá y participá en el ranking mensual',competitive:false},
];
