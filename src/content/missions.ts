import type { Mission, Profile } from '../types';

export const MISSIONS: Mission[] = [
  { id: 'reach-thirty', name: 'Llegá a 30 metros', target: 30, reward: 25, metric: 'height' },
  { id: 'three-perfect', name: 'Lográ un combo de 3 Perfect', target: 3, reward: 20, metric: 'maxPerfectCombo' },
  { id: 'fifteen-objects', name: 'Apilá 15 objetos', target: 15, reward: 25, metric: 'objectsPlaced' },
  { id: 'play-daily', name: 'Jugá el Daily Tower', target: 1, reward: 15, metric: 'daily' },
  { id: 'new-record', name: 'Superá tu récord personal', target: 1, reward: 15, metric: 'personalBest' },
  { id: 'share-challenge', name: 'Compartí un desafío', target: 1, reward: 15, metric: 'share' },
  { id: 'eight-perfect', name: 'Conseguí 8 Perfect Drops', target: 8, reward: 25, metric: 'perfectDrops' },
  { id: 'three-runs', name: 'Jugá 3 partidas', target: 3, reward: 15, metric: 'runs' },
];

/** Three goals rotate after five runs; completed goals give way to new ones. */
export function getActiveMissions(profile: Pick<Profile, 'runs' | 'missions'>): Mission[] {
  const start = (Math.floor(profile.runs / 5) * 3) % MISSIONS.length;
  return Array.from({ length: MISSIONS.length }, (_, offset) => MISSIONS[(start + offset) % MISSIONS.length])
    .filter((mission) => !profile.missions[mission.id]?.claimed)
    .slice(0, 3);
}

export const DAILY_MISSIONS:Mission[] = [
 {id:'daily-three-runs',name:'Completá 3 torres de al menos 5 objetos',target:3,reward:2,metric:'qualifyingRuns'},
 {id:'daily-eight-perfect',name:'Acumulá 8 colocaciones perfectas',target:8,reward:2,metric:'perfectDrops'},
 {id:'daily-thirty',name:'Alcanzá 30 metros en una partida',target:30,reward:2,metric:'height'},
];
