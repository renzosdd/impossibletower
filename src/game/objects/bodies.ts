import Matter from 'matter-js';
import type { ObjectDefinition } from '../../types';

/**
 * Build convex pieces in texture coordinates: (0, 0) is the top-left corner.
 * No concave decomposition dependency is needed; the parent hull is broad-phase
 * only and Matter tests actual child parts when resolving collisions.
 */
export function createObjectBody(def: ObjectDefinition, x: number, y: number): Matter.Body {
  const w = def.width;
  const h = def.height;
  const options: Matter.IChamferableBodyDefinition = {
    label: def.id,
    friction: def.friction,
    frictionStatic: 1,
    frictionAir: 0.006,
    restitution: def.restitution,
    // At the fixed 60 Hz simulation rate this requires ~900 ms of low motion.
    sleepThreshold: 54,
  };
  const parts: Matter.Body[] = [];
  const worldX = (textureX: number) => x - w / 2 + textureX;
  const worldY = (textureY: number) => y - h / 2 + textureY;
  const rectangle = (left: number, top: number, width: number, height: number) => {
    parts.push(Matter.Bodies.rectangle(worldX(left + width / 2), worldY(top + height / 2), width, height, options));
  };
  const circle = (textureX: number, textureY: number, radius: number) => {
    parts.push(Matter.Bodies.circle(worldX(textureX), worldY(textureY), radius, options, 20));
  };
  const polygon = (points: Matter.Vector[]) => {
    // fromVertices centers its polygon at the supplied point. Preserve the
    // authored texture coordinates by giving it the polygon's own centroid.
    const centroid = Matter.Vertices.centre(points);
    parts.push(Matter.Bodies.fromVertices(worldX(centroid.x), worldY(centroid.y), [points], options));
  };

  switch (def.visualType) {
    case 'table':
      rectangle(2, 0, w - 4, 12);
      rectangle(20, 10, 10, h - 10);
      rectangle(w - 30, 10, 10, h - 10);
      break;
    case 'chair':
      rectangle(5, 0, w - 10, h * 0.48);
      rectangle(0, h * 0.42, w, h * 0.14);
      rectangle(5, h * 0.54, 8, h * 0.46);
      rectangle(w - 13, h * 0.54, 8, h * 0.46);
      break;
    case 'bathtub':
      polygon([
        { x: 0, y: 0 }, { x: w, y: 0 },
        { x: w * 0.87, y: h - 6 }, { x: w * 0.13, y: h - 6 },
      ]);
      rectangle(10, h - 7, 10, 7);
      rectangle(w - 20, h - 7, 10, 7);
      break;
    case 'piano':
      rectangle(0, 0, w, h * 0.8);
      rectangle(10, h * 0.79, 9, h * 0.21);
      rectangle(w - 19, h * 0.79, 9, h * 0.21);
      break;
    case 'motorbike':
      circle(w * 0.2, h * 0.75, h * 0.22);
      circle(w * 0.8, h * 0.75, h * 0.22);
      rectangle(w * 0.2, h * 0.35, w * 0.57, h * 0.25);
      rectangle(w * 0.25, 5, w * 0.32, 7);
      // A slim convex fork connects the handlebars and front wheel.
      polygon([
        { x: w * 0.68, y: 8 }, { x: w * 0.72, y: 8 },
        { x: w * 0.82, y: h * 0.73 }, { x: w * 0.78, y: h * 0.73 },
      ]);
      break;
    case 'car':
      rectangle(1, h * 0.35, w - 2, h * 0.5);
      rectangle(w * 0.22, 0, w * 0.58, h * 0.46);
      circle(w * 0.22, h * 0.8, h * 0.2);
      circle(w * 0.78, h * 0.8, h * 0.2);
      break;
    case 'statue':
      rectangle(w * 0.12, h * 0.78, w * 0.76, h * 0.22);
      polygon([
        { x: w * 0.5, y: h * 0.22 },
        { x: w * 0.12, y: h * 0.79 }, { x: w * 0.88, y: h * 0.79 },
      ]);
      circle(w * 0.5, h * 0.16, h * 0.13);
      break;
    case 'boat':
      polygon([
        { x: 0, y: h * 0.5 }, { x: w, y: h * 0.5 },
        { x: w * 0.8, y: h }, { x: w * 0.2, y: h },
      ]);
      rectangle(w * 0.5, 0, 4, h * 0.65);
      polygon([
        { x: w * 0.49, y: 3 }, { x: w * 0.13, y: h * 0.49 }, { x: w * 0.49, y: h * 0.49 },
      ]);
      polygon([
        { x: w * 0.55, y: 8 }, { x: w * 0.89, y: h * 0.49 }, { x: w * 0.55, y: h * 0.49 },
      ]);
      break;
    case 'rocket':
      rectangle(w * 0.19, h * 0.18, w * 0.62, h * 0.66);
      polygon([
        { x: w * 0.19, y: h * 0.2 }, { x: w * 0.5, y: 0 }, { x: w * 0.81, y: h * 0.2 },
      ]);
      polygon([
        { x: 0, y: h }, { x: w * 0.23, y: h * 0.56 }, { x: w * 0.3, y: h * 0.87 },
      ]);
      polygon([
        { x: w, y: h }, { x: w * 0.77, y: h * 0.56 }, { x: w * 0.7, y: h * 0.87 },
      ]);
      rectangle(w * 0.35, h * 0.84, w * 0.3, h * 0.16);
      break;
    case 'satellite':
      rectangle(0, h * 0.23, w * 0.3, h * 0.52);
      rectangle(w * 0.7, h * 0.23, w * 0.3, h * 0.52);
      rectangle(w * 0.3, h * 0.05, w * 0.4, h * 0.85);
      break;
    default:
      if (def.shape === 'circle') circle(w / 2, h / 2, w / 2);
      else if (def.shape === 'trapezoid') polygon([
        { x: w * 0.13, y: 0 }, { x: w * 0.87, y: 0 }, { x: w, y: h }, { x: 0, y: h },
      ]);
      else rectangle(0, 0, w, h);
  }

  const body = parts.length === 1 ? parts[0] : Matter.Body.create({ ...options, parts });
  Matter.Body.setMass(body, def.mass);
  // Compound silhouettes have asymmetric native centroids. Anchor the authored
  // texture center first without moving its collision vertices; the explicit
  // gameplay COM is then the sole sprite offset, just as with simple bodies.
  Matter.Body.setCentre(body, { x, y }, false);
  if (def.centerOfMassOffset) Matter.Body.setCentre(body, def.centerOfMassOffset, true);
  return body;
}
