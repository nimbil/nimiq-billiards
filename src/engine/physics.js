import {
  TABLE, BALL_RADIUS, FRICTION, MIN_VELOCITY,
} from './constants.js';

export class PhysicsEngine {
  constructor() {
    this.substeps = 4;
  }

  step(balls) {
    for (let s = 0; s < this.substeps; s++) {
      this._moveBalls(balls);
      this._resolveBallCollisions(balls);
      this._resolveWallCollisions(balls);
      this._checkPockets(balls);
    }
    this._applyFriction(balls);
  }

  _moveBalls(balls) {
    for (const b of balls) {
      if (b.pocketed) continue;
      b.x += b.vx / this.substeps;
      b.y += b.vy / this.substeps;
    }
  }

  _applyFriction(balls) {
    for (const b of balls) {
      if (b.pocketed) continue;
      b.vx *= FRICTION;
      b.vy *= FRICTION;
      const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (speed < MIN_VELOCITY) {
        b.vx = 0;
        b.vy = 0;
      }
    }
  }

  _resolveBallCollisions(balls) {
    const active = balls.filter(b => !b.pocketed);
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = BALL_RADIUS * 2;

        if (dist < minDist && dist > 0) {
          const nx = dx / dist;
          const ny = dy / dist;

          const dvx = a.vx - b.vx;
          const dvy = a.vy - b.vy;
          const dot = dvx * nx + dvy * ny;

          if (dot > 0) {
            a.vx -= dot * nx;
            a.vy -= dot * ny;
            b.vx += dot * nx;
            b.vy += dot * ny;
          }

          const overlap = minDist - dist;
          a.x -= (overlap / 2) * nx;
          a.y -= (overlap / 2) * ny;
          b.x += (overlap / 2) * nx;
          b.y += (overlap / 2) * ny;
        }
      }
    }
  }

  _resolveWallCollisions(balls) {
    const minX = TABLE.RAIL_WIDTH + BALL_RADIUS;
    const maxX = TABLE.WIDTH - TABLE.RAIL_WIDTH - BALL_RADIUS;
    const minY = TABLE.RAIL_WIDTH + BALL_RADIUS;
    const maxY = TABLE.HEIGHT - TABLE.RAIL_WIDTH - BALL_RADIUS;

    for (const b of balls) {
      if (b.pocketed) continue;
      if (b.x < minX) { b.x = minX; b.vx = Math.abs(b.vx) * 0.85; }
      if (b.x > maxX) { b.x = maxX; b.vx = -Math.abs(b.vx) * 0.85; }
      if (b.y < minY) { b.y = minY; b.vy = Math.abs(b.vy) * 0.85; }
      if (b.y > maxY) { b.y = maxY; b.vy = -Math.abs(b.vy) * 0.85; }
    }
  }

  _checkPockets(balls) {
    for (const b of balls) {
      if (b.pocketed) continue;
      for (const p of TABLE.POCKETS) {
        const dx = b.x - p.x;
        const dy = b.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const pocketR = TABLE.POCKET_RADIUS;
        if (dist < pocketR + BALL_RADIUS * 0.8) {
          b.pocketed = true;
          b.vx = 0;
          b.vy = 0;
          break;
        }
      }
    }
  }

  allBallsStopped(balls) {
    return balls.every(b => b.pocketed || (Math.abs(b.vx) < MIN_VELOCITY && Math.abs(b.vy) < MIN_VELOCITY));
  }
}
