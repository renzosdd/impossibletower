import type { ObjectDefinition } from '../types';
import { createRng } from '../utils/rng';

/** Original procedural props. Dimensions always use the same logical world. */
export const OBJECTS: ObjectDefinition[] = [
  { id: 'box', name: 'Caja feliz', width: 94, height: 58, mass: 3, friction: 0.82, restitution: 0.03, difficultyWeight: 1, visualType: 'box', color: '#e5a35c', material: 'wood', shape: 'rectangle' },
  { id: 'table', name: 'Mesa de picnic', width: 120, height: 46, mass: 4, friction: 0.8, restitution: 0.02, difficultyWeight: 1, visualType: 'table', color: '#b58365', material: 'wood', shape: 'rectangle' },
  { id: 'chair', name: 'Silla limón', width: 66, height: 78, mass: 2.6, friction: 0.75, restitution: 0.04, difficultyWeight: 2, visualType: 'chair', color: '#e4c448', material: 'wood', shape: 'rectangle', centerOfMassOffset: { x: -5, y: 2 } },
  { id: 'sofa', name: 'Sofá nube', width: 144, height: 62, mass: 5, friction: 0.9, restitution: 0.05, difficultyWeight: 1.5, visualType: 'sofa', color: '#a9a0d8', material: 'soft', shape: 'rectangle' },
  { id: 'fridge', name: 'Heladera polar', width: 62, height: 106, mass: 5.2, friction: 0.67, restitution: 0.03, difficultyWeight: 3, visualType: 'fridge', color: '#b3d4d7', material: 'metal', shape: 'rectangle', centerOfMassOffset: { x: 2, y: -9 } },
  { id: 'washer', name: 'Lavadora orbital', width: 78, height: 77, mass: 6, friction: 0.72, restitution: 0.04, difficultyWeight: 2, visualType: 'washer', color: '#e7edf1', material: 'metal', shape: 'rectangle', centerOfMassOffset: { x: 0, y: 7 } },
  { id: 'bathtub', name: 'Bañera rosa', width: 132, height: 54, mass: 4.4, friction: 0.58, restitution: 0.07, difficultyWeight: 3, visualType: 'bathtub', color: '#e5a5b9', material: 'ceramic', shape: 'trapezoid', centerOfMassOffset: { x: -9, y: 4 } },
  { id: 'piano', name: 'Piano medianoche', width: 122, height: 75, mass: 10, friction: 0.75, restitution: 0.015, difficultyWeight: 3, visualType: 'piano', color: '#5d6b8a', material: 'wood', shape: 'rectangle', centerOfMassOffset: { x: 11, y: 5 } },
  { id: 'barrel', name: 'Barril rodante', width: 70, height: 70, mass: 4.8, friction: 0.32, restitution: 0.08, difficultyWeight: 4, visualType: 'barrel', color: '#c48d56', material: 'wood', shape: 'circle' },
  { id: 'motorbike', name: 'Moto mandarina', width: 94, height: 65, mass: 4, friction: 0.5, restitution: 0.06, difficultyWeight: 4, visualType: 'motorbike', color: '#f09565', material: 'metal', shape: 'trapezoid', centerOfMassOffset: { x: 12, y: -4 } },
  { id: 'car', name: 'Auto aguamarina', width: 148, height: 61, mass: 8, friction: 0.74, restitution: 0.025, difficultyWeight: 3, visualType: 'car', color: '#82c8b5', material: 'metal', shape: 'trapezoid', centerOfMassOffset: { x: -5, y: 8 } },
  { id: 'container', name: 'Contenedor coral', width: 164, height: 82, mass: 12, friction: 0.68, restitution: 0.01, difficultyWeight: 4, visualType: 'container', color: '#d77574', material: 'metal', shape: 'rectangle' },
  { id: 'statue', name: 'Estatua del equilibrio', width: 62, height: 117, mass: 7, friction: 0.62, restitution: 0.015, difficultyWeight: 5, visualType: 'statue', color: '#ddd4c4', material: 'ceramic', shape: 'trapezoid', centerOfMassOffset: { x: -8, y: -18 } },
  { id: 'house', name: 'Casita celeste', width: 123, height: 99, mass: 8.5, friction: 0.77, restitution: 0.02, difficultyWeight: 4, visualType: 'house', color: '#99b4d8', material: 'wood', shape: 'rectangle', centerOfMassOffset: { x: 0, y: -9 } },
  { id: 'boat', name: 'Barco banana', width: 155, height: 73, mass: 6, friction: 0.48, restitution: 0.07, difficultyWeight: 5, visualType: 'boat', color: '#e8c863', material: 'wood', shape: 'trapezoid', centerOfMassOffset: { x: -13, y: -6 } },
  { id: 'rocket', name: 'Cohete de bolsillo', width: 62, height: 148, mass: 8, friction: 0.56, restitution: 0.025, difficultyWeight: 6, visualType: 'rocket', color: '#ed826e', material: 'metal', shape: 'rectangle', centerOfMassOffset: { x: 0, y: -23 }, rare: true },
  { id: 'ball', name: 'Pelota lunar', width: 76, height: 76, mass: 2, friction: 0.24, restitution: 0.18, difficultyWeight: 4.5, visualType: 'ball', color: '#b5b0e7', material: 'soft', shape: 'circle' },
  { id: 'satellite', name: 'Satélite de jardín', width: 155, height: 86, mass: 5.8, friction: 0.53, restitution: 0.04, difficultyWeight: 6, visualType: 'satellite', color: '#a3bad3', material: 'metal', shape: 'rectangle', centerOfMassOffset: { x: 18, y: -6 }, rare: true },
];

export function getObject(id: string): ObjectDefinition {
  return OBJECTS.find(object => object.id === id) ?? OBJECTS[0];
}

/** Index-based progression ensures challenge opponents get identical props. */
export function objectAt(seed: string, index: number): ObjectDefinition {
  const turn = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  if (turn < 3) return getObject(['box', 'box', 'table'][turn]);
  const rng = createRng(`${seed}:object:${turn}:v1`);
  const cap = turn < 5 ? 2 : turn < 10 ? 3 : turn < 18 ? 4 : turn < 26 ? 5 : 6;
  const pool = OBJECTS.filter(object => object.difficultyWeight <= cap && !object.rare);
  if (turn >= 26 && rng() < 0.13) {
    const rare = OBJECTS.filter(object => object.rare);
    return rare[Math.floor(rng() * rare.length)];
  }
  // Gradually favor the newer challenges while retaining occasional easy relief.
  const weighted = pool.map(object => ({ object, weight: 1 + object.difficultyWeight * (turn >= 10 ? 0.4 : 0.1) }));
  let choice = rng() * weighted.reduce((total, entry) => total + entry.weight, 0);
  for (const entry of weighted) {
    choice -= entry.weight;
    if (choice <= 0) return entry.object;
  }
  return pool[pool.length - 1];
}

export function craneSpeed(index: number): number {
  const turn = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  return Math.min(208, 92 + turn * 3.2);
}
