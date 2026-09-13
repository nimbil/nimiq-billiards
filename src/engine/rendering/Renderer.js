/**
 * Renderer - Canvas rendering for billiards game
 * 
 * Separated from game logic - ONLY handles drawing:
 * - Table surface and rails
 * - Balls with proper colors/patterns
 * - Aim guide and cue stick
 * - Game overlays
 * - Animations
 * 
 * This renderer is passive - it draws what it's told.
 * No game logic lives here.
 */

import { TABLE, BALL_RADIUS, BALL_COLORS } from '../constants.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    
    // Rendering state
    this.aimAngle = 0;
    this.aimPower = 0;
    this.isAiming = false;
    this.cueBall = null;
    
    // Animation state
    this animations = [];
    this.lastFrameTime = 0;
  }

  /**
   * Render a frame
   * @param {Ball[]} balls - Ball positions
   * @param {Object} gameState - Current game state
   * @param {number} timestamp - Animation timestamp
   */
  render(balls, gameState, timestamp = 0) {
    const ctx = this.ctx;
    const dt = timestamp - this.lastFrameTime;
    this.lastFrameTime = timestamp;

    // Clear canvas
    ctx.clearRect(0, 0, TABLE.WIDTH, TABLE.HEIGHT);

    // Draw layers
    this._drawTable(ctx);
    this._drawPockets(ctx);
    this._drawBalls(ctx, balls);
    this._drawAimGuide(ctx, balls);
    this._drawCueStick(ctx, balls);
    this._drawAnimations(ctx, dt);
    this._drawGameOverlay(ctx, gameState);
  }

  /**
   * Draw table surface
   * @private
   */
  _drawTable(ctx) {
    // Rail border
    ctx.fillStyle = TABLE.RAIL_COLOR;
    ctx.fillRect(0, 0, TABLE.WIDTH, TABLE.HEIGHT);

    // Felt surface
    const RW = TABLE.RAIL_WIDTH;
    ctx.fillStyle = TABLE.FELT_COLOR;
    ctx.fillRect(RW, RW, TABLE.WIDTH - RW * 2, TABLE.HEIGHT - RW * 2);

    // Felt texture (subtle gradient)
    const gradient = ctx.createRadialGradient(
      TABLE.WIDTH / 2, TABLE.HEIGHT / 2, 50,
      TABLE.WIDTH / 2, TABLE.HEIGHT / 2, TABLE.WIDTH / 2
    );
    gradient.addColorStop(0, 'rgba(255,255,255,0.04)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.06)');
    ctx.fillStyle = gradient;
    ctx.fillRect(RW, RW, TABLE.WIDTH - RW * 2, TABLE.HEIGHT - RW * 2);

    // Rail inner edge
    ctx.strokeStyle = '#3a2208';
    ctx.lineWidth = 2;
    ctx.strokeRect(RW, RW, TABLE.WIDTH - RW * 2, TABLE.HEIGHT - RW * 2);

    // Center line
    ctx.beginPath();
    ctx.moveTo(TABLE.WIDTH / 2, RW);
    ctx.lineTo(TABLE.WIDTH / 2, TABLE.HEIGHT - RW);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Foot spot
    const spotX = TABLE.WIDTH * 0.72;
    ctx.beginPath();
    ctx.arc(spotX, TABLE.HEIGHT / 2, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fill();

    // Head spot
    const headX = TABLE.WIDTH * 0.25;
    ctx.beginPath();
    ctx.arc(headX, TABLE.HEIGHT / 2, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Draw pockets
   * @private
   */
  _drawPockets(ctx) {
    for (const p of TABLE.POCKETS) {
      // Pocket hole
      ctx.beginPath();
      ctx.arc(p.x, p.y, TABLE.POCKET_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = '#0a0a0a';
      ctx.fill();

      // Pocket rim
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Inner shadow
      const shadow = ctx.createRadialGradient(
        p.x, p.y, TABLE.POCKET_RADIUS * 0.3,
        p.x, p.y, TABLE.POCKET_RADIUS
      );
      shadow.addColorStop(0, 'rgba(0,0,0,0.5)');
      shadow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = shadow;
      ctx.fill();
    }
  }

  /**
   * Draw all balls
   * @private
   */
  _drawBalls(ctx, balls) {
    // Draw shadow first
    for (const ball of balls) {
      if (ball.pocketed) continue;
      this._drawBallShadow(ctx, ball);
    }

    // Draw balls
    for (const ball of balls) {
      if (ball.pocketed) continue;
      this._drawBall(ctx, ball);
    }
  }

  /**
   * Draw ball shadow
   * @private
   */
  _drawBallShadow(ctx, ball) {
    const { x, y } = ball;
    const r = BALL_RADIUS;

    ctx.beginPath();
    ctx.arc(x + 2, y + 2, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();
  }

  /**
   * Draw a single ball
   * @private
   */
  _drawBall(ctx, ball) {
    const { x, y, id, stripe } = ball;
    const r = BALL_RADIUS;

    // Create gradient
    const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    const baseColor = BALL_COLORS[id];

    if (id === 0) {
      // Cue ball - white with subtle shading
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#e0e0d8');
    } else if (stripe) {
      // Stripe ball - white with colored stripe
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.45, '#ffffff');
      grad.addColorStop(0.46, baseColor);
      grad.addColorStop(1, baseColor);
    } else {
      // Solid ball - solid color with highlight
      grad.addColorStop(0, this._lightenColor(baseColor, 40));
      grad.addColorStop(1, baseColor);
    }

    // Draw ball body
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Ball edge
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Draw number circle for numbered balls
    if (id > 0) {
      // Number background
      ctx.beginPath();
      ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();

      // Ball number
      ctx.fillStyle = '#222';
      ctx.font = `bold ${r * 0.65}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(id.toString(), x, y + 0.5);
    }

    // Specular highlight
    ctx.beginPath();
    ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();
  }

  /**
   * Draw aim guide
   * @private
   */
  _drawAimGuide(ctx, balls) {
    if (!this.isAiming || !this.cueBall || this.cueBall.pocketed) return;

    const cueBall = balls.find(b => b.id === 0);
    if (!cueBall || cueBall.pocketed) return;

    const angle = this.aimAngle;
    const length = 400;

    // Draw dotted guide line
    ctx.beginPath();
    ctx.moveTo(cueBall.x, cueBall.y);
    ctx.lineTo(
      cueBall.x + Math.cos(angle) * length,
      cueBall.y + Math.sin(angle) * length
    );
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 8]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw predicted collision point
    const collision = this._predictCollision(cueBall, balls, angle);
    if (collision) {
      ctx.beginPath();
      ctx.arc(collision.x, collision.y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /**
   * Predict first collision point
   * @private
   */
  _predictCollision(cueBall, balls, angle) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    let closest = null;
    let minDist = Infinity;

    for (const ball of balls) {
      if (ball.id === 0 || ball.pocketed) continue;

      // Ray-circle intersection
      const ox = cueBall.x - ball.x;
      const oy = cueBall.y - ball.y;

      const a = dx * dx + dy * dy;
      const b = 2 * (ox * dx + oy * dy);
      const c = ox * ox + oy * oy - (BALL_RADIUS * 2) * (BALL_RADIUS * 2);

      const discriminant = b * b - 4 * a * c;
      if (discriminant < 0) continue;

      const t = (-b - Math.sqrt(discriminant)) / (2 * a);
      if (t > 0 && t < minDist) {
        minDist = t;
        closest = {
          x: cueBall.x + dx * t,
          y: cueBall.y + dy * t,
          ball: ball,
        };
      }
    }

    return closest;
  }

  /**
   * Draw cue stick
   * @private
   */
  _drawCueStick(ctx, balls) {
    if (!this.isAiming) return;

    const cueBall = balls.find(b => b.id === 0);
    if (!cueBall || cueBall.pocketed) return;

    const angle = this.aimAngle;
    const pullBack = this.aimPower * 80;
    const cueLength = 200;

    // Cue tip position
    const startX = cueBall.x - Math.cos(angle) * (BALL_RADIUS + 4 + pullBack);
    const startY = cueBall.y - Math.sin(angle) * (BALL_RADIUS + 4 + pullBack);

    // Cue end position
    const endX = startX - Math.cos(angle) * cueLength;
    const endY = startY - Math.sin(angle) * cueLength;

    // Draw cue body
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = '#d4a056';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Draw cue ferrule (white part)
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(
      startX - Math.cos(angle) * 20,
      startY - Math.sin(angle) * 20
    );
    ctx.strokeStyle = '#f0e6d2';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Draw cue tip
    ctx.beginPath();
    ctx.arc(startX, startY, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1a1a';
    ctx.fill();
  }

  /**
   * Draw animations
   * @private
   */
  _drawAnimations(ctx, dt) {
    this.animations = this.animations.filter(anim => {
      anim.progress += dt / anim.duration;
      if (anim.progress >= 1) return false;

      anim.draw(ctx, anim.progress);
      return true;
    });
  }

  /**
   * Add pocket animation
   */
  addPocketAnimation(x, y, color) {
    this.animations.push({
      progress: 0,
      duration: 300,
      draw: (ctx, progress) => {
        const alpha = 1 - progress;
        const radius = BALL_RADIUS + progress * 20;

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 215, 0, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      },
    });
  }

  /**
   * Draw game overlay
   * @private
   */
  _drawGameOverlay(ctx, gameState) {
    if (!gameState) return;

    // Foul overlay
    if (gameState.foul) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.1)';
      ctx.fillRect(0, 0, TABLE.WIDTH, TABLE.HEIGHT);

      // Foul text
      ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
      ctx.font = 'bold 24px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('FOUL', TABLE.WIDTH / 2, TABLE.HEIGHT / 2);
    }

    // Ball in hand indicator
    if (gameState.state === 'ball_in_hand') {
      ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
      ctx.fillRect(0, 0, TABLE.WIDTH, TABLE.HEIGHT);

      ctx.fillStyle = 'rgba(59, 130, 246, 0.8)';
      ctx.font = 'bold 18px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('BALL IN HAND - Click to place', TABLE.WIDTH / 2, TABLE.HEIGHT / 2);
    }
  }

  /**
   * Lighten a color
   * @private
   */
  _lightenColor(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, (num >> 16) + percent);
    const g = Math.min(255, ((num >> 8) & 0x00FF) + percent);
    const b = Math.min(255, (num & 0x0000FF) + percent);
    return `rgb(${r},${g},${b})`;
  }

  /**
   * Set aim state
   */
  setAimState(angle, power, isAiming) {
    this.aimAngle = angle;
    this.aimPower = power;
    this.isAiming = isAiming;
  }

  /**
   * Set cue ball reference
   */
  setCueBall(cueBall) {
    this.cueBall = cueBall;
  }
}

export default Renderer;
