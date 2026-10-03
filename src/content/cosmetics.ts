import type { Cosmetic } from '../types';

/** Cosmetics change presentation only. The simulation never reads these values. */
export const COSMETICS: Cosmetic[] = [
  { id: 'crane-default', name: 'Menta', category: 'crane', price: 0, color: '#25c6ad' },
  { id: 'crane-coral', name: 'Coral', category: 'crane', price: 60, color: '#ff747a' },
  { id: 'crane-gold', name: 'Sol', category: 'crane', price: 100, color: '#ffce64' },
  { id: 'crane-violet', name: 'Lavanda', category: 'crane', price: 140, color: '#a397ed' },
  { id: 'crane-midnight', name: 'Medianoche', category: 'crane', price: 180, color: '#425d82' },
  { id: 'background-default', name: 'Día de torre', category: 'background', price: 0, color: '#b5e9ee' },
  { id: 'background-sunset', name: 'Atardecer', category: 'background', price: 100, color: '#ffc7af' },
  { id: 'background-aurora', name: 'Aurora', category: 'background', price: 160, color: '#d2c5ff' },
  { id: 'trail-default', name: 'Aire', category: 'trail', price: 0, color: '#ffffff' },
  { id: 'trail-coral', name: 'Estela coral', category: 'trail', price: 35, color: '#ff747a' },
  { id: 'trail-mint', name: 'Estela menta', category: 'trail', price: 45, color: '#25c6ad' },
  { id: 'trail-gold', name: 'Polvo de sol', category: 'trail', price: 60, color: '#ffce64' },
  { id: 'trail-comet', name: 'Cometa', category: 'trail', price: 80, color: '#a397ed' },
  { id: 'effect-default', name: 'Polvo suave', category: 'effect', price: 0, color: '#ffffff' },
  { id: 'effect-sparks', name: 'Chispas', category: 'effect', price: 45, color: '#ffce64' },
  { id: 'effect-bubbles', name: 'Burbujas', category: 'effect', price: 55, color: '#25c6ad' },
  { id: 'effect-confetti', name: 'Confeti', category: 'effect', price: 75, color: '#ff747a' },
  { id: 'effect-stars', name: 'Estrellas', category: 'effect', price: 95, color: '#a397ed' },
];

export const DEFAULT_COSMETICS = {
  crane: 'crane-default',
  background: 'background-default',
  trail: 'trail-default',
  effect: 'effect-default',
} as const;

export const ACCOUNT_COSMETICS: readonly Cosmetic[] = Object.freeze([
  { id: 'crane-copper', name: 'Cobre', category: 'crane', price: 300, color: '#cf835e' },
  { id: 'crane-cobalt', name: 'Cobalto', category: 'crane', price: 600, color: '#587ac6' },
  { id: 'crane-obsidian', name: 'Obsidiana', category: 'crane', price: 1200, color: '#273641' },
]);
