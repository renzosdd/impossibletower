import Matter from 'matter-js';
import { describe, expect, it } from 'vitest';
import { OBJECTS, getObject } from '../../src/content/objects';
import { createObjectBody } from '../../src/game/objects/bodies';
import { advanceStability, isSettled } from '../../src/utils/stability';

describe('authored collision silhouettes', () => {
  it('leaves real space between table legs rather than using its parent hull', () => {
    const table = createObjectBody(getObject('table'), 200, 200);
    const probe = Matter.Bodies.rectangle(200, 212, 4, 4);
    expect(table.parts).toHaveLength(4);
    expect(Matter.Query.point([table], { x: 200, y: 212 })).toEqual([]);
    expect(Matter.Query.collides(probe, [table])).toEqual([]);
    expect(Matter.Query.point([table], { x: 165, y: 212 })).toEqual([table]);
    expect(Matter.Query.point([table], { x: 200, y: 182 })).toEqual([table]);
  });

  it('keeps both table feet stable on the tutorial box width using real physics', () => {
    const engine = Matter.Engine.create({ enableSleeping: true });
    const platform = Matter.Bodies.rectangle(0, 120, getObject('box').width, 20, { isStatic: true, friction: 1 });
    const table = createObjectBody(getObject('table'), 0, 0);
    Matter.Composite.add(engine.world, [platform, table]);
    for (let step = 0; step < 300; step++) Matter.Engine.update(engine, 1000 / 60);
    expect(Math.abs(table.angle)).toBeLessThan(0.02);
    expect(Math.abs(table.position.x)).toBeLessThan(5);
    expect(table.bounds.max.y).toBeCloseTo(110, 0);
    expect(table.isSleeping).toBe(true);
    Matter.Engine.clear(engine);
  });

  it('stacks the tutorial table and next box on two dynamic boxes without tipping', () => {
    const engine = Matter.Engine.create({ enableSleeping: true, positionIterations: 8, velocityIterations: 8 });
    engine.gravity.y = 1.15;
    const ground = Matter.Bodies.rectangle(210, 666, 230, 32, { isStatic: true, friction: 1, restitution: 0 });
    Matter.Composite.add(engine.world, ground);
    const placed: Matter.Body[] = [];
    const timestep = 1000 / 60;

    for (const id of ['box', 'box', 'table', 'box']) {
      const x = placed.at(-1)?.position.x ?? 210;
      const body = createObjectBody(getObject(id), x, 225);
      Matter.Composite.add(engine.world, body);
      let stableMs = 0;
      let settled = false;
      for (let step = 0; step < 14_000 / timestep; step++) {
        Matter.Engine.update(engine, timestep);
        const supported = Matter.Query.collides(body, [ground, ...placed]).length > 0;
        stableMs = advanceStability(stableMs, body.speed, Math.abs(body.angularVelocity), timestep, supported);
        if (isSettled(stableMs)) {
          settled = true;
          break;
        }
      }
      expect(settled, `${id} should settle onto the actual dynamic stack`).toBe(true);
      expect(Math.abs(body.angle), `${id} should remain almost level`).toBeLessThan(0.1);
      expect(Math.abs(body.position.x - 210), `${id} should remain centered`).toBeLessThan(5);
      placed.push(body);
    }

    // The table must remain level after a new load wakes the boxes below it.
    for (let step = 0; step < 120; step++) Matter.Engine.update(engine, timestep);
    expect(Math.abs(placed[2].angle)).toBeLessThan(0.1);
    expect(placed.every((body) => body.isSleeping)).toBe(true);
    expect(Math.abs(Math.min(...placed.map((body) => body.bounds.min.y)) - 430)).toBeLessThan(1);
    Matter.Engine.clear(engine);
  });

  it('preserves fridge collision bounds while shifting its mass center', () => {
    const def = getObject('fridge');
    const body = createObjectBody(def, 200, 300);
    expect(body.position).toEqual({ x: 202, y: 291 });
    expect(body.bounds.min.x).toBeCloseTo(200 - def.width / 2);
    expect(body.bounds.max.y).toBeCloseTo(300 + def.height / 2);
    Matter.Body.setAngle(body, Math.PI / 2);
    const offset = def.centerOfMassOffset!;
    const spriteX = body.position.x - offset.x * Math.cos(body.angle) + offset.y * Math.sin(body.angle);
    const spriteY = body.position.y - offset.x * Math.sin(body.angle) - offset.y * Math.cos(body.angle);
    expect((body.bounds.min.x + body.bounds.max.x) / 2).toBeCloseTo(spriteX);
    expect((body.bounds.min.y + body.bounds.max.y) / 2).toBeCloseTo(spriteY);
  });

  it('gives a rocket a narrow nose and separate lower fins', () => {
    const rocket = createObjectBody(getObject('rocket'), 200, 300);
    expect(rocket.parts).toHaveLength(6);
    expect(Matter.Query.point([rocket], { x: 175, y: 240 })).toEqual([]);
    expect(Matter.Query.point([rocket], { x: 200, y: 240 })).toEqual([rocket]);
    expect(Matter.Query.point([rocket], { x: 178, y: 360 })).toEqual([rocket]);
  });

  it('uses the defined material, mass and explicit visual-center convention for every prop', () => {
    for (const def of OBJECTS) {
      const body = createObjectBody(def, 200, 300);
      expect(body.mass).toBeCloseTo(def.mass);
      expect(body.friction).toBe(def.friction);
      expect(body.restitution).toBe(def.restitution);
      expect(body.sleepThreshold).toBe(54);
      expect(body.position.x).toBeCloseTo(200 + (def.centerOfMassOffset?.x ?? 0));
      expect(body.position.y).toBeCloseTo(300 + (def.centerOfMassOffset?.y ?? 0));
      expect(body.bounds.min.x).toBeGreaterThanOrEqual(200 - def.width / 2 - 0.01);
      expect(body.bounds.max.x).toBeLessThanOrEqual(200 + def.width / 2 + 0.01);
      expect(body.bounds.min.y).toBeGreaterThanOrEqual(300 - def.height / 2 - 0.01);
      expect(body.bounds.max.y).toBeLessThanOrEqual(300 + def.height / 2 + 0.01);
    }
  });
});
