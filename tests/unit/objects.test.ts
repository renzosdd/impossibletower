import Matter from 'matter-js';
import { describe, expect, it } from 'vitest';
import { CURRENT_OBJECT_CATALOG, LEGACY_OBJECTS, OBJECTS, OBJECT_CATALOGS, getObject, isObjectCatalog, objectAt, type ObjectCatalog } from '../../src/content/objects';
import { createObjectBody } from '../../src/game/objects/bodies';

const additions = OBJECTS.filter(object => !LEGACY_OBJECTS.includes(object));

describe('versioned object catalogs', () => {
  it.each([
    ['same-run', 'box box table box sofa sofa car car box bathtub container house container bathtub bathtub box bathtub piano chair box boat statue motorbike house statue motorbike piano box chair table rocket motorbike ball piano sofa chair rocket washer statue chair barrel barrel chair barrel barrel house piano chair chair satellite'],
    ['tower:daily:2026-10-03:v1', 'box box table box chair box car chair car fridge washer container house barrel piano table sofa chair container car chair chair ball container motorbike box ball boat container ball motorbike rocket sofa container chair chair house container chair sofa satellite motorbike container chair chair chair fridge rocket satellite barrel'],
  ])('preserves the original fifty-piece sequence for %s', (seed, expected) => {
    expect(Array.from({ length: 50 }, (_, index) => objectAt(seed, index).id)).toEqual(expected.split(' '));
    expect(Array.from({ length: 50 }, (_, index) => objectAt(seed, index, 'legacy-18').id)).toEqual(expected.split(' '));
  });

  it('keeps immutable legacy definitions and two independent six-piece releases', () => {
    expect(LEGACY_OBJECTS).toHaveLength(18);
    expect(OBJECT_CATALOGS['extended-24']).toHaveLength(24);
    expect(OBJECT_CATALOGS['extended-30']).toHaveLength(30);
    expect(CURRENT_OBJECT_CATALOG).toBe('extended-30');
    expect(Object.isFrozen(LEGACY_OBJECTS)).toBe(true);
    expect(LEGACY_OBJECTS.every(Object.isFrozen)).toBe(true);
    expect(OBJECT_CATALOGS['extended-24'].slice(0, 18)).toEqual(LEGACY_OBJECTS);
    expect(OBJECT_CATALOGS['extended-30'].slice(0, 24)).toEqual(OBJECT_CATALOGS['extended-24']);
    expect(additions).toHaveLength(12);
    expect(new Set(OBJECTS.map(object => object.id)).size).toBe(30);
    expect(getObject('balloon').id).toBe('balloon');
  });

  it.each(Object.keys(OBJECT_CATALOGS) as ObjectCatalog[])('replays %s in any lookup order without introducing difficulty early', catalog => {
    const expected = Array.from({ length: 500 }, (_, index) => objectAt('catalog-coverage', index, catalog));
    expect(expected.map(object => object.id)).toEqual(Array.from({ length: 500 }, (_, index) => objectAt('catalog-coverage', 499 - index, catalog).id).reverse());
    expect(expected.slice(0, 3).map(object => object.id)).toEqual(['box', 'box', 'table']);
    for (let index = 3; index < 26; index++) {
      const cap = index < 5 ? 2 : index < 10 ? 3 : index < 18 ? 4 : 5;
      expect(expected[index].difficultyWeight).toBeLessThanOrEqual(cap);
      expect(expected[index].rare).not.toBe(true);
    }
    const seen = new Set(expected.map(object => object.id));
    expect(OBJECT_CATALOGS[catalog].every(object => seen.has(object.id))).toBe(true);
    expect(expected.every(object => OBJECT_CATALOGS[catalog].includes(object))).toBe(true);
  });

  it('rejects unknown catalogs and retains legacy behavior for an invalid runtime argument', () => {
    expect(isObjectCatalog('extended-24')).toBe(true);
    expect(isObjectCatalog('toString')).toBe(false);
    expect(isObjectCatalog('extended-99')).toBe(false);
    expect(isObjectCatalog(null)).toBe(false);
    expect(objectAt('same-run', 20, 'unknown' as ObjectCatalog)).toBe(objectAt('same-run', 20));
  });
});

describe('new prop collision geometry', () => {
  it.each(additions.map(object => [object.id, object] as const))('%s falls onto an actual platform under the fixed-step gravity simulation', (_id, def) => {
    const engine = Matter.Engine.create({ enableSleeping: true, positionIterations: 8, velocityIterations: 8 });
    engine.gravity.y = 1.15;
    const floor = Matter.Bodies.rectangle(0, 300, 420, 20, { isStatic: true, friction: 1 });
    const body = createObjectBody(def, 0, 0);
    Matter.Composite.add(engine.world, [floor, body]);
    let touchedFloor = false;
    for (let step = 0; step < 600; step++) {
      Matter.Engine.update(engine, 1000 / 60);
      touchedFloor ||= Matter.Query.collides(body, [floor]).length > 0;
      expect(Number.isFinite(body.position.x + body.position.y + body.angle + body.velocity.x + body.velocity.y)).toBe(true);
      expect(Math.abs(body.position.x)).toBeLessThan(500);
      expect(Math.abs(body.position.y)).toBeLessThan(500);
    }
    expect(touchedFloor).toBe(true);
    expect(body.bounds.max.y).toBeCloseTo(290, 0);
    expect(body.mass).toBeCloseTo(def.mass);
    expect(body.inertia).toBeGreaterThan(0);
    Matter.Engine.clear(engine);
  });

  it.each([
    ['television', 0.1, 0.83],
    ['toaster', 0.48, 0.08],
    ['teapot', 0.14, 0.54],
    ['arcade', 0.95, 0.35],
    ['balloon', 0.5, 0.78],
  ])('keeps the transparent gap of %s open for both point and collision queries', (id, textureX, textureY) => {
    const def = getObject(id);
    const body = createObjectBody(def, 200, 300);
    const point = { x: 200 + def.width * (textureX - 0.5), y: 300 + def.height * (textureY - 0.5) };
    const probe = Matter.Bodies.rectangle(point.x, point.y, 1, 1);
    expect(Matter.Query.point([body], point)).toEqual([]);
    expect(Matter.Query.collides(probe, [body])).toEqual([]);
  });

  it('keeps the balloon subject to gravity and locates each authored mass offset without moving its silhouette', () => {
    for (const def of additions) {
      const body = createObjectBody(def, 200, 300);
      expect(body.position.x).toBeCloseTo(200 + (def.centerOfMassOffset?.x ?? 0));
      expect(body.position.y).toBeCloseTo(300 + (def.centerOfMassOffset?.y ?? 0));
      expect(body.isStatic).toBe(false);
      expect(body.friction).toBe(def.friction);
      expect(body.restitution).toBe(def.restitution);
    }
  });
});
