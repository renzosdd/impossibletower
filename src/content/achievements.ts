import type { Achievement } from '../types';

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-stack', name: 'Primer ladrillo', description: 'Apilá tu primer objeto.', target: 1, metric: 'objectsPlaced' },
  { id: 'fifty-meters', name: 'Mirador', description: 'Alcanzá los 50 metros.', target: 50, metric: 'height' },
  { id: 'hundred-meters', name: 'Cien y contando', description: 'Alcanzá los 100 metros.', target: 100, metric: 'height' },
  { id: 'perfect-five', name: 'Mano firme', description: 'Conseguí un combo de 5 Perfect.', target: 5, metric: 'maxPerfectCombo' },
  { id: 'perfect-ten', name: 'Precisión imposible', description: 'Conseguí un combo de 10 Perfect.', target: 10, metric: 'maxPerfectCombo' },
  { id: 'rocket-scientist', name: 'Ciencia de cohetes', description: 'Apilá un cohete.', target: 1, metric: 'rocket' },
  { id: 'cloud-toucher', name: 'Entre nubes', description: 'Alcanzá los 150 metros.', target: 150, metric: 'height' },
  { id: 'chaos-master', name: 'Domador del caos', description: 'Alcanzá los 200 metros.', target: 200, metric: 'height' },
  { id: 'daily-regular', name: 'Tres amaneceres', description: 'Jugá el Daily Tower tres días seguidos.', target: 3, metric: 'dailyStreak' },
  { id: 'challenge-victory', name: 'Desafío superado', description: 'Superá la altura de un desafío.', target: 1, metric: 'challengeWon' },
];

export const MONTHLY_BADGE:Achievement={id:'monthly-podium',name:'Podio mensual',description:'Terminá entre los tres primeros del ranking de práctica.',target:1,metric:'monthlyPodium'};
export const BADGES=[...ACHIEVEMENTS,MONTHLY_BADGE];
