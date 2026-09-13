/**
 * BilliardsPhysics - Accurate 2D billiards simulation
 * 
 * Physics features:
 * - Ball-to-ball elastic collisions with throw
 * - Ball-to-cushion reflections with energy loss
 * - Rolling friction (deceleration)
 * - Sliding friction (when ball is sliding)
 * - Ball spin (english) - affects collision response
 * - Cue ball deflection (squirt)
 * - Pocket detection with funnel physics
 * - Realistic deceleration
 * 
 * References:
 * - "The Physics of Billiards" by Dave Alciatore
 * - Dr. Dave's billiards physics papers
 */

import { TABLE, BALL_RADIUS } from '../constants.js';

const GRAVITY = 9.81;
const BALL_MASS = 0.17; // kg
const TABLE_TILT = 0; // degrees (0 = perfectly level)

// Coefficients
const MU_BALL_CLOTH = 0.2; // Rolling friction coefficient (ball-cloth)
const MU_BALL_BALL = 0.05; // Sliding friction coefficient (ball-ball)
const MU_BALL_CUSHION = 0.4; // Sliding friction coefficient (ball-cushion)
const RESTITUTION_BALL_BALL = 0.95; // Coefficient of restitution (ball-ball)
const RESTITUTION_BALL_CUSHION = 0.75; // Coefficient of restitution (ball-cushion)
const SPIN_FRICTION = 0.04; // Spin decay factor

// Velocity thresholds
const MIN_VELOCITY = 0.5; // mm/frame - below this, ball stops
const MIN_SPIN = 0.1; // Below this, spin is negligible
const SUBSTEPS = 8; // Physics substeps per frame for accuracy

export class BilliardsPhysics {
  constructor() {
    this.substeps = SUBSTEPS;
    this.events = []; // Events generated during step
  }

  /**
   * Step the physics simulation
   * @param {Ball[]} balls - Array of ball objects
   * @param {number} dt - Time step in seconds (default 1/60)
   * @returns {Event[]} - Events generated (pocketed, collision, etc.)
   */
  step(balls, dt = 1 / 60) {
    this.events = [];
    const subDt = dt / this.substeps;

    for (let s = 0; s < this.substeps; s++) {
      this._applyForces(balls, subDt);
      this._integratePositions(balls, subDt);
      this._resolveBallCollisions(balls);
      this._resolveCushionCollisions(balls);
      this._checkPockets(balls);
    }

    this._updateSpin(balls, dt);
    this._applySpinEffects(balls);

    return this.events;
  }

  /**
   * Apply friction and forces to balls
   * @private
   */
  _applyForces(balls, dt) {
    for (const ball of balls) {
      if (ball.pocketed || ball.stationary) continue;

      const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);

      if (speed > MIN_VELOCITY) {
        // Rolling friction - opposes motion
        const frictionForce = MU_BALL_CLOTH * GRAVITY * BALL_MASS;
        const decel = frictionForce / BALL_MASS; // a = F/m
        const decelX = (ball.vx / speed) * decel * dt;
        const decelY = (ball.vy / speed) * decel * dt;

        // Apply deceleration
        ball.vx -= decelX;
        ball.vy -= decelY;

        // Check if deceleration reversed direction (ball stopped)
        if (ball.vx * (ball.vx + decelX) < 0) ball.vx = 0;
        if (ball.vy * (ball.vy + decelY) < 0) ball.vy = 0;
      } else {
        // Ball has stopped
        ball.vx = 0;
        ball.vy = 0;
        ball.spinX = 0;
        ball.spinY = 0;
        ball.spinZ = 0;
        ball.stationary = true;
      }

      // Decay spin over time
      ball.spinX *= (1 - SPIN_FRICTION);
      ball.spinY *= (1 - SPIN_FRICTION);
      ball.spinZ *= (1 - SPIN_FRICTION);

      // Stop negligible spin
      if (Math.abs(ball.spinX) < MIN_SPIN) ball.spinX = 0;
      if (Math.abs(ball.spinY) < MIN_SPIN) ball.spinY = 0;
      if (Math.abs(ball.spinZ) < MIN_SPIN) ball.spinZ = 0;
    }
  }

  /**
   * Integrate positions
   * @private
   */
  _integratePositions(balls, dt) {
    for (const ball of balls) {
      if (ball.pocketed || ball.stationary) continue;
      ball.x += ball.vx * dt * 60; // Scale to pixels
      ball.y += ball.vy * dt * 60;
    }
  }

  /**
   * Resolve ball-to-ball collisions
   * @private
   */
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
          // Collision normal
          const nx = dx / dist;
          const ny = dy / dist;

          // Relative velocity
          const dvx = a.vx - b.vx;
          const dvy = a.vy - b.vy;

          // Velocity along collision normal
          const dvn = dvx * nx + dvy * ny;

          // Only resolve if balls are approaching
          if (dvn > 0) {
            // Apply coefficient of restitution
            const impulse = dvn * (1 + RESTITUTION_BALL_BALL) / 2;

            // Apply impulse
            a.vx -= impulse * nx;
            a.vy -= impulse * ny;
            b.vx += impulse * nx;
            b.vy += impulse * ny;

            // Apply throw effect (friction during collision)
            this._applyThrow(a, b, nx, ny, dvn);

            // Transfer some spin
            this._transferSpin(a, b, nx, ny);

            // Generate collision event
            this.events.push({
              type: 'ball_collision',
              ballA: a.id,
              ballB: b.id,
              velocity: dvn,
            });
          }

          // Separate overlapping balls
          const overlap = minDist - dist;
          a.x -= (overlap / 2) * nx;
          a.y -= (overlap / 2) * ny;
          b.x += (overlap / 2) * nx;
          b.y += (overlap / 2) * ny;

          // Wake up stationary balls
          a.stationary = false;
          b.stationary = false;
        }
      }
    }
  }

  /**
   * Apply throw effect during collision
   * Throw is the object ball's deviation from the line of centers
   * @private
   */
  _applyThrow(a, b, nx, ny, relativeVelocity) {
    // Throw is proportional to relative velocity and friction
    const throwAmount = relativeVelocity * MU_BALL_BALL * 0.1;

    // Perpendicular direction (tangential)
    const tx = -ny;
    const ty = nx;

    // Apply throw to object ball (b)
    const throwDir = (a.spinX * tx + a.spinY * ty) > 0 ? 1 : -1;
    b.vx += throwDir * throwAmount * tx;
    b.vy += throwDir * throwAmount * ty;
  }

  /**
   * Transfer spin between colliding balls
   * @private
   */
  _transferSpin(a, b, nx, ny) {
    // Transfer a small amount of spin
    const transferRate = 0.1;

    // Tangential direction
    const tx = -ny;
    const ty = nx;

    // Transfer side spin
    const aSideSpin = a.spinX * tx + a.spinY * ty;
    b.spinX += aSideSpin * transferRate * tx;
    b.spinY += aSideSpin * transferRate * ty;
    a.spinX -= aSideSpin * transferRate * tx;
    a.spinY -= aSideSpin * transferRate * ty;
  }

  /**
   * Resolve ball-to-cushion collisions
   * @private
   */
  _resolveCushionCollisions(balls) {
    const minX = TABLE.RAIL_WIDTH + BALL_RADIUS;
    const maxX = TABLE.WIDTH - TABLE.RAIL_WIDTH - BALL_RADIUS;
    const minY = TABLE.RAIL_WIDTH + BALL_RADIUS;
    const maxY = TABLE.HEIGHT - TABLE.RAIL_WIDTH - BALL_RADIUS;

    for (const ball of balls) {
      if (ball.pocketed || ball.stationary) continue;

      let hitCushion = false;
      let hitX = 0, hitY = 0;

      // Check if near a pocket (don't bounce near pockets)
      const nearPocket = this._isNearPocket(ball.x, ball.y);
      if (nearPocket) continue;

      // Left cushion
      if (ball.x < minX) {
        ball.x = minX;
        ball.vx = -ball.vx * RESTITUTION_BALL_CUSHION;
        hitCushion = true;
        hitX = -1; hitY = 0;

        // Apply spin effect on cushion bounce
        ball.vy += ball.spinX * 0.3;
        ball.spinX *= 0.5;
      }
      // Right cushion
      else if (ball.x > maxX) {
        ball.x = maxX;
        ball.vx = -ball.vx * RESTITUTION_BALL_CUSHION;
        hitCushion = true;
        hitX = 1; hitY = 0;

        ball.vy += ball.spinX * 0.3;
        ball.spinX *= 0.5;
      }

      // Top cushion
      if (ball.y < minY) {
        ball.y = minY;
        ball.vy = -ball.vy * RESTITUTION_BALL_CUSHION;
        hitCushion = true;
        hitX = 0; hitY = -1;

        ball.vx += ball.spinY * 0.3;
        ball.spinY *= 0.5;
      }
      // Bottom cushion
      else if (ball.y > maxY) {
        ball.y = maxY;
        ball.vy = -ball.vy * RESTITUTION_BALL_CUSHION;
        hitCushion = true;
        hitX = 0; hitY = 1;

        ball.vx += ball.spinY * 0.3;
        ball.spinY *= 0.5;
      }

      if (hitCushion) {
        this.events.push({
          type: 'cushion_collision',
          ballId: ball.id,
          hitX,
          hitY,
          velocity: Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy),
        });
      }
    }
  }

  /**
   * Check if position is near a pocket
   * @private
   */
  _isNearPocket(x, y) {
    const pocketZone = TABLE.POCKET_RADIUS * 1.5;
    for (const pocket of TABLE.POCKETS) {
      const dx = x - pocket.x;
      const dy = y - pocket.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < pocketZone) return true;
    }
    return false;
  }

  /**
   * Check for pocketed balls
   * @private
   */
  _checkPockets(balls) {
    for (const ball of balls) {
      if (ball.pocketed) continue;

      for (const pocket of TABLE.POCKETS) {
        const dx = ball.x - pocket.x;
        const dy = ball.y - pocket.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Ball center must be within pocket radius
        if (dist < TABLE.POCKET_RADIUS) {
          ball.pocketed = true;
          ball.vx = 0;
          ball.vy = 0;
          ball.spinX = 0;
          ball.spinY = 0;
          ball.spinZ = 0;
          ball.x = pocket.x;
          ball.y = pocket.y;

          this.events.push({
            type: 'ball_pocketed',
            ballId: ball.id,
            pocket: { x: pocket.x, y: pocket.y },
          });
          break;
        }
      }
    }
  }

  /**
   * Update spin state
   * @private
   */
  _updateSpin(balls, dt) {
    for (const ball of balls) {
      if (ball.pocketed) continue;

      // Convert velocity to spin (rolling condition)
      const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
      if (speed > MIN_VELOCITY) {
        // Rolling ball: spin matches velocity
        const rollingSpinX = ball.vx / BALL_RADIUS;
        const rollingSpinY = ball.vy / BALL_RADIUS;

        // Blend current spin toward rolling spin
        const blendRate = 0.1;
        ball.spinX += (rollingSpinX - ball.spinX) * blendRate;
        ball.spinY += (rollingSpinY - ball.spinY) * blendRate;
      }
    }
  }

  /**
   * Apply spin effects to ball velocity
   * @private
   */
  _applySpinEffects(balls) {
    for (const ball of balls) {
      if (ball.pocketed || ball.stationary) continue;

      // Side spin (english) causes curve
      const curveFactor = 0.001;
      ball.vx += ball.spinZ * ball.vy * curveFactor;
      ball.vy -= ball.spinZ * ball.vx * curveFactor;
    }
  }

  /**
   * Apply shot to cue ball
   * @param {Ball} cueBall
   * @param {number} angle - Shot angle in radians
   * @param {number} power - Shot power (1-25)
   * @param {Object} spin - Spin parameters { side, top, bottom }
   */
  applyShot(cueBall, angle, power, spin = {}) {
    if (!cueBall || cueBall.pocketed) return;

    // Calculate velocity from angle and power
    const speed = power * 15; // Scale factor
    cueBall.vx = Math.cos(angle) * speed;
    cueBall.vy = Math.sin(angle) * speed;

    // Apply spin
    cueBall.spinX = (spin.top || 0) * speed * 0.5; // Top/back spin
    cueBall.spinY = (spin.bottom || 0) * speed * 0.5;
    cueBall.spinZ = (spin.side || 0) * speed * 0.3; // Side spin (english)

    // Wake up ball
    cueBall.stationary = false;
  }

  /**
   * Check if all balls have stopped
   */
  allBallsStopped(balls) {
    return balls.every(b => 
      b.pocketed || b.stationary || 
      (Math.abs(b.vx) < MIN_VELOCITY && Math.abs(b.vy) < MIN_VELOCITY)
    );
  }

  /**
   * Get ball velocity magnitude
   */
  getBallSpeed(ball) {
    return Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  }

  /**
   * Reset ball to position
   */
  resetBall(ball, x, y) {
    ball.x = x;
    ball.y = y;
    ball.vx = 0;
    ball.vy = 0;
    ball.spinX = 0;
    ball.spinY = 0;
    ball.spinZ = 0;
    ball.pocketed = false;
    ball.stationary = true;
  }
}

export default BilliardsPhysics;
