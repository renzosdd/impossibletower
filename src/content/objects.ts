import type { ObjectDefinition } from '../types';
import { createRng } from '../utils/rng';

/** Original procedural props. Dimensions always use the same logical world. */
export const LEGACY_OBJECTS: readonly ObjectDefinition[] = Object.freeze([
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
]);

const FIRST_EXTENSION: readonly ObjectDefinition[] = Object.freeze([
  { id: 'books', name: 'Pila de libros', width: 94, height: 45, mass: 2.8, friction: 0.82, restitution: 0.025, difficultyWeight: 1, visualType: 'books', color: '#e4c448', material: 'wood', shape: 'rectangle' },
  { id: 'trunk', name: 'Baúl viajero', width: 112, height: 60, mass: 4.4, friction: 0.78, restitution: 0.03, difficultyWeight: 1.5, visualType: 'trunk', color: '#b58365', material: 'wood', shape: 'rectangle', centerOfMassOffset: { x: 0, y: 4 } },
  { id: 'microwave', name: 'Microondas menta', width: 96, height: 62, mass: 4.8, friction: 0.72, restitution: 0.025, difficultyWeight: 2, visualType: 'microwave', color: '#82c8b5', material: 'metal', shape: 'rectangle', centerOfMassOffset: { x: 6, y: 3 } },
  { id: 'toaster', name: 'Tostadora coral', width: 76, height: 60, mass: 2.4, friction: 0.7, restitution: 0.04, difficultyWeight: 2, visualType: 'toaster', color: '#ed826e', material: 'metal', shape: 'rectangle', centerOfMassOffset: { x: 0, y: 4 } },
  { id: 'television', name: 'Televisor retro', width: 90, height: 96, mass: 4.2, friction: 0.62, restitution: 0.035, difficultyWeight: 3, visualType: 'television', color: '#a9a0d8', material: 'metal', shape: 'rectangle', centerOfMassOffset: { x: 0, y: -10 } },
  { id: 'planter', name: 'Maceta tropical', width: 60, height: 92, mass: 3.8, friction: 0.64, restitution: 0.03, difficultyWeight: 3, visualType: 'planter', color: '#e5a5b9', material: 'ceramic', shape: 'trapezoid', centerOfMassOffset: { x: 0, y: 12 } },
]);

const SECOND_EXTENSION: readonly ObjectDefinition[] = Object.freeze([
  { id: 'traffic-cone', name: 'Cono mandarina', width: 74, height: 104, mass: 2.2, friction: 0.78, restitution: 0.04, difficultyWeight: 4, visualType: 'traffic-cone', color: '#f09565', material: 'soft', shape: 'trapezoid', centerOfMassOffset: { x: 0, y: 18 } },
  { id: 'skateboard', name: 'Skate de limón', width: 122, height: 34, mass: 2.2, friction: 0.4, restitution: 0.08, difficultyWeight: 4, visualType: 'skateboard', color: '#e4c448', material: 'wood', shape: 'rectangle', centerOfMassOffset: { x: 0, y: 3 } },
  { id: 'teapot', name: 'Tetera lunar', width: 88, height: 82, mass: 3.8, friction: 0.55, restitution: 0.055, difficultyWeight: 4, visualType: 'teapot', color: '#b5b0e7', material: 'ceramic', shape: 'circle', centerOfMassOffset: { x: -5, y: 6 } },
  { id: 'accordion', name: 'Acordeón lavanda', width: 100, height: 76, mass: 5.5, friction: 0.66, restitution: 0.03, difficultyWeight: 4, visualType: 'accordion', color: '#a397ed', material: 'metal', shape: 'rectangle', centerOfMassOffset: { x: 8, y: 0 } },
  { id: 'arcade', name: 'Arcade medianoche', width: 76, height: 132, mass: 7.8, friction: 0.68, restitution: 0.025, difficultyWeight: 5, visualType: 'arcade', color: '#5d6b8a', material: 'metal', shape: 'trapezoid', centerOfMassOffset: { x: 0, y: -16 } },
  { id: 'balloon', name: 'Globo de bolsillo', width: 108, height: 150, mass: 4.5, friction: 0.42, restitution: 0.1, difficultyWeight: 6, visualType: 'balloon', color: '#ed826e', material: 'soft', shape: 'circle', centerOfMassOffset: { x: 0, y: -18 }, rare: true },
]);

export type ObjectCatalog = 'legacy-18' | 'extended-24' | 'extended-30';
export const CURRENT_OBJECT_CATALOG: ObjectCatalog = 'extended-30';
export const OBJECTS: readonly ObjectDefinition[] = Object.freeze([...LEGACY_OBJECTS, ...FIRST_EXTENSION, ...SECOND_EXTENSION]);
export const OBJECT_CATALOGS: Readonly<Record<ObjectCatalog, readonly ObjectDefinition[]>> = Object.freeze({
  'legacy-18': LEGACY_OBJECTS,
  'extended-24': Object.freeze([...LEGACY_OBJECTS, ...FIRST_EXTENSION]),
  'extended-30': OBJECTS,
});

for (const object of OBJECTS) {
  if (object.centerOfMassOffset) Object.freeze(object.centerOfMassOffset);
  Object.freeze(object);
}

export function isObjectCatalog(value: unknown): value is ObjectCatalog {
  return typeof value === 'string' && Object.hasOwn(OBJECT_CATALOGS, value);
}

export function getObject(id: string): ObjectDefinition {
  return OBJECTS.find(object => object.id === id) ?? OBJECTS[0];
}

/** Index-based progression ensures challenge opponents get identical props. */
export function objectAt(seed: string, index: number, catalog: ObjectCatalog = 'legacy-18'): ObjectDefinition {
  const turn = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  if (turn < 3) return getObject(['box', 'box', 'table'][turn]);
  const selectedCatalog = isObjectCatalog(catalog) ? catalog : 'legacy-18';
  const roster = OBJECT_CATALOGS[selectedCatalog];
  const rng = createRng(`${seed}:object:${turn}:${selectedCatalog === 'legacy-18' ? 'v1' : `v2:${selectedCatalog}`}`);
  const cap = turn < 5 ? 2 : turn < 10 ? 3 : turn < 18 ? 4 : turn < 26 ? 5 : 6;
  const pool = roster.filter(object => object.difficultyWeight <= cap && !object.rare);
  if (turn >= 26 && rng() < 0.13) {
    const rare = roster.filter(object => object.rare);
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
