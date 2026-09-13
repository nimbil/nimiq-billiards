import { TABLE, BALL_RADIUS, BALL_COLORS } from './constants.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cueBall = null;
    this.aimAngle = 0;
    this.aimPower = 0;
    this.isAiming = false;
    this.ghostBalls = [];
    this.trajectory = null;
    this.playerTurn = false;
    this.mouseX = 0;
    this.mouseY = 0;
    this._railGrad = null;
    this._feltGrad = null;
    this._lightGrad = null;
  }

  render(balls, gameState) {
    const ctx = this.ctx;
    const W = TABLE.WIDTH;
    const H = TABLE.HEIGHT;
    ctx.clearRect(0, 0, W, H);

    this._drawTable(ctx);
    this._drawDiamonds(ctx);
    this._drawPockets(ctx);
    this._drawBallShadows(ctx, balls);
    this._drawBalls(ctx, balls);

    try {
      const showCue = this.playerTurn && this.cueBall && !this.cueBall.pocketed;
      if (showCue) {
        const cueBall = this.cueBall;
        const dx = this.mouseX - cueBall.x;
        const dy = this.mouseY - cueBall.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 1) {
          this.aimAngle = Math.atan2(dy, dx);
        }
        this._drawAimGuide(ctx, cueBall);
        this._drawTrajectory(ctx, cueBall, balls);
        this._drawCueStick(ctx, cueBall);
      }
    } catch (e) {
      console.error('Cue render error:', e);
      const cb = this.cueBall;
      if (cb && !cb.pocketed) {
        const a = this.aimAngle;
        const ex = cb.x - Math.cos(a) * 270;
        const ey = cb.y - Math.sin(a) * 270;
        ctx.beginPath();
        ctx.moveTo(cb.x - Math.cos(a) * 13, cb.y - Math.sin(a) * 13);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = '#d4a862';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
    }

    if (gameState) {
      this._drawGameOverlay(ctx, gameState);
    }
  }

  // ============================================
  // Table Drawing
  // ============================================

  _drawTable(ctx) {
    const W = TABLE.WIDTH;
    const H = TABLE.HEIGHT;
    const RW = TABLE.RAIL_WIDTH;

    // Outer shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#2a1505';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // Wood rail base
    const woodGrad = ctx.createLinearGradient(0, 0, 0, H);
    woodGrad.addColorStop(0, '#5a3420');
    woodGrad.addColorStop(0.15, '#7a4a28');
    woodGrad.addColorStop(0.3, '#6a3e22');
    woodGrad.addColorStop(0.5, '#8a5a30');
    woodGrad.addColorStop(0.7, '#6a3e22');
    woodGrad.addColorStop(0.85, '#7a4a28');
    woodGrad.addColorStop(1, '#5a3420');
    ctx.fillStyle = woodGrad;
    ctx.fillRect(0, 0, W, H);

    // Wood grain lines (horizontal)
    ctx.save();
    ctx.globalAlpha = 0.08;
    for (let y = 0; y < H; y += 4) {
      ctx.beginPath();
      ctx.moveTo(0, y + Math.sin(y * 0.1) * 2);
      ctx.lineTo(W, y + Math.cos(y * 0.15) * 2);
      ctx.strokeStyle = y % 8 === 0 ? '#3a1a05' : '#a06838';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();

    // Wood grain on vertical rails
    ctx.save();
    ctx.globalAlpha = 0.06;
    for (let x = 0; x < RW; x += 3) {
      ctx.beginPath();
      ctx.moveTo(x + Math.sin(x * 0.2) * 1, 0);
      ctx.lineTo(x + Math.cos(x * 0.15) * 1, H);
      ctx.strokeStyle = '#3a1a05';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    for (let x = W - RW; x < W; x += 3) {
      ctx.beginPath();
      ctx.moveTo(x + Math.sin(x * 0.2) * 1, 0);
      ctx.lineTo(x + Math.cos(x * 0.15) * 1, H);
      ctx.strokeStyle = '#3a1a05';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();

    // Inner bevel / cushion edge
    const bevelW = 6;
    const innerX = RW;
    const innerY = RW;
    const innerW = W - RW * 2;
    const innerH = H - RW * 2;

    // Cushion rubber (green bumpers inside rails)
    ctx.fillStyle = '#1a7a48';
    ctx.fillRect(innerX, innerY, innerW, bevelW);
    ctx.fillRect(innerX, innerY + innerH - bevelW, innerW, bevelW);
    ctx.fillRect(innerX, innerY, bevelW, innerH);
    ctx.fillRect(innerX + innerW - bevelW, innerY, bevelW, innerH);

    // Cushion highlights
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = '#4ae888';
    ctx.fillRect(innerX, innerY, innerW, 2);
    ctx.fillRect(innerX, innerY, 2, innerH);
    ctx.restore();

    // Felt surface
    const feltX = innerX + bevelW;
    const feltY = innerY + bevelW;
    const feltW = innerW - bevelW * 2;
    const feltH = innerH - bevelW * 2;

    const feltGrad = ctx.createRadialGradient(
      W / 2, H / 2, 0,
      W / 2, H / 2, W * 0.55
    );
    feltGrad.addColorStop(0, '#1fa85c');
    feltGrad.addColorStop(0.5, '#1a8a52');
    feltGrad.addColorStop(1, '#147040');
    ctx.fillStyle = feltGrad;
    ctx.fillRect(feltX, feltY, feltW, feltH);

    // Felt texture (subtle noise)
    ctx.save();
    ctx.globalAlpha = 0.03;
    for (let i = 0; i < 800; i++) {
      const px = feltX + Math.random() * feltW;
      const py = feltY + Math.random() * feltH;
      ctx.fillStyle = Math.random() > 0.5 ? '#fff' : '#000';
      ctx.fillRect(px, py, 1, 1);
    }
    ctx.restore();

    // Overhead light cone
    const lightGrad = ctx.createRadialGradient(
      W / 2, H / 2 - 20, 10,
      W / 2, H / 2, W * 0.4
    );
    lightGrad.addColorStop(0, 'rgba(255,255,230,0.12)');
    lightGrad.addColorStop(0.5, 'rgba(255,255,230,0.05)');
    lightGrad.addColorStop(1, 'rgba(0,0,0,0.08)');
    ctx.fillStyle = lightGrad;
    ctx.fillRect(feltX, feltY, feltW, feltH);

    // Head string line
    const headX = W * 0.25;
    ctx.beginPath();
    ctx.moveTo(headX, feltY + 2);
    ctx.lineTo(headX, feltY + feltH - 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Foot spot
    const spotX = W * 0.72;
    ctx.beginPath();
    ctx.arc(spotX, H / 2, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fill();

    // Head spot
    ctx.beginPath();
    ctx.arc(headX, H / 2, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Center spot
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();

    // Rail inner edge shadow
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(feltX - 0.5, feltY - 0.5, feltW + 1, feltH + 1);

    // Rail top highlight (glossy wood effect)
    ctx.save();
    ctx.globalAlpha = 0.1;
    const railHighlight = ctx.createLinearGradient(0, 0, W, 0);
    railHighlight.addColorStop(0, 'transparent');
    railHighlight.addColorStop(0.3, 'rgba(255,255,255,0.3)');
    railHighlight.addColorStop(0.5, 'rgba(255,255,255,0.5)');
    railHighlight.addColorStop(0.7, 'rgba(255,255,255,0.3)');
    railHighlight.addColorStop(1, 'transparent');
    ctx.fillStyle = railHighlight;
    ctx.fillRect(0, 0, W, 8);
    ctx.fillRect(0, H - 8, W, 8);
    ctx.restore();
  }

  _drawDiamonds(ctx) {
    const W = TABLE.WIDTH;
    const H = TABLE.HEIGHT;
    const RW = TABLE.RAIL_WIDTH;
    const diamondSize = 4;

    const topBottomCount = 8;
    const leftRightCount = 4;

    // Top and bottom rail diamonds
    for (let i = 1; i < topBottomCount; i++) {
      const x = RW + (i / topBottomCount) * (W - RW * 2);

      // Top
      this._drawDiamond(ctx, x, RW / 2, diamondSize);
      // Bottom
      this._drawDiamond(ctx, x, H - RW / 2, diamondSize);
    }

    // Left and right rail diamonds
    for (let i = 1; i < leftRightCount; i++) {
      const y = RW + (i / leftRightCount) * (H - RW * 2);

      // Left
      this._drawDiamond(ctx, RW / 2, y, diamondSize);
      // Right
      this._drawDiamond(ctx, W - RW / 2, y, diamondSize);
    }
  }

  _drawDiamond(ctx, x, y, size) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-size / 2 + 1, -size / 2 + 1, size, size);

    // Diamond body
    const grad = ctx.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
    grad.addColorStop(0, '#e8d8c0');
    grad.addColorStop(0.5, '#ffffff');
    grad.addColorStop(1, '#c8b8a0');
    ctx.fillStyle = grad;
    ctx.fillRect(-size / 2, -size / 2, size, size);

    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(-size / 2, -size / 2, size, size / 3);

    ctx.restore();
  }

  // ============================================
  // Pockets
  // ============================================

  _drawPockets(ctx) {
    for (const p of TABLE.POCKETS) {
      const r = TABLE.POCKET_RADIUS;

      // Outer ring
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1008';
      ctx.fill();

      // Pocket hole with depth gradient
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0, '#000000');
      grad.addColorStop(0.6, '#050505');
      grad.addColorStop(1, '#1a1a1a');
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // Inner edge highlight
      ctx.beginPath();
      ctx.arc(p.x, p.y, r - 1, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(40,30,20,0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Rim highlight
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 2, -Math.PI * 0.8, -Math.PI * 0.2);
      ctx.strokeStyle = 'rgba(180,150,110,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // ============================================
  // Ball Shadows
  // ============================================

  _drawBallShadows(ctx, balls) {
    ctx.save();
    for (const b of balls) {
      if (b.pocketed) continue;
      const r = BALL_RADIUS;

      // Shadow offset (light from above-center)
      const shadowX = b.x + 2;
      const shadowY = b.y + 3;

      const grad = ctx.createRadialGradient(shadowX, shadowY, r * 0.3, shadowX, shadowY, r * 1.4);
      grad.addColorStop(0, 'rgba(0,0,0,0.25)');
      grad.addColorStop(0.7, 'rgba(0,0,0,0.12)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.beginPath();
      ctx.ellipse(shadowX, shadowY, r * 1.3, r * 1.0, 0, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }
    ctx.restore();
  }

  // ============================================
  // Ball Drawing
  // ============================================

  _drawBalls(ctx, balls) {
    for (const b of balls) {
      if (b.pocketed) continue;
      this._drawBall(ctx, b);
    }
  }

  _drawBall(ctx, ball) {
    const { x, y, id } = ball;
    const r = BALL_RADIUS;
    const baseColor = BALL_COLORS[id];

    ctx.save();

    // Outer shadow on felt
    ctx.beginPath();
    ctx.arc(x + 1, y + 2, r + 1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fill();

    // Ball base gradient - stronger 3D effect
    const grad = ctx.createRadialGradient(
      x - r * 0.35, y - r * 0.35, r * 0.01,
      x + r * 0.15, y + r * 0.15, r * 1.05
    );

    if (id === 0) {
      // Cue ball - pure white with polished look
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.15, '#ffffff');
      grad.addColorStop(0.5, '#f5f5f0');
      grad.addColorStop(0.8, '#e0e0d8');
      grad.addColorStop(1, '#b8b8b0');
    } else if (ball.stripe) {
      // Stripe balls: white top, colored band in middle
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.25, '#ffffff');
      grad.addColorStop(0.30, lightenColor(baseColor, 20));
      grad.addColorStop(0.45, baseColor);
      grad.addColorStop(0.55, baseColor);
      grad.addColorStop(0.65, darkenColor(baseColor, 15));
      grad.addColorStop(0.75, '#ffffff');
      grad.addColorStop(1, darkenColor(baseColor, 35));
    } else {
      // Solid balls - rich deep color
      grad.addColorStop(0, lightenColor(baseColor, 60));
      grad.addColorStop(0.15, lightenColor(baseColor, 30));
      grad.addColorStop(0.5, baseColor);
      grad.addColorStop(0.8, darkenColor(baseColor, 25));
      grad.addColorStop(1, darkenColor(baseColor, 50));
    }

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Number circle (for non-cue balls)
    if (id > 0) {
      const numR = r * 0.38;
      // White circle behind number
      ctx.beginPath();
      ctx.arc(x, y, numR, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Subtle inner shadow on number circle
      const numGrad = ctx.createRadialGradient(
        x - numR * 0.15, y - numR * 0.15, 0,
        x, y, numR
      );
      numGrad.addColorStop(0, 'rgba(255,255,255,0.5)');
      numGrad.addColorStop(0.7, 'rgba(255,255,255,0.1)');
      numGrad.addColorStop(1, 'rgba(0,0,0,0.1)');
      ctx.beginPath();
      ctx.arc(x, y, numR, 0, Math.PI * 2);
      ctx.fillStyle = numGrad;
      ctx.fill();

      // Number text with bold font
      ctx.fillStyle = '#111111';
      ctx.font = `bold ${r * 0.58}px 'Arial Black', 'Arial', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(id), x, y + 0.5);

      // Tiny outline on number
      ctx.strokeStyle = 'rgba(0,0,0,0.08)';
      ctx.lineWidth = 0.3;
      ctx.strokeText(String(id), x, y + 0.5);
    }

    // Main specular highlight - top left
    const hlGrad = ctx.createRadialGradient(
      x - r * 0.32, y - r * 0.32, r * 0.01,
      x - r * 0.15, y - r * 0.15, r * 0.55
    );
    hlGrad.addColorStop(0, 'rgba(255,255,255,0.95)');
    hlGrad.addColorStop(0.3, 'rgba(255,255,255,0.4)');
    hlGrad.addColorStop(0.7, 'rgba(255,255,255,0.08)');
    hlGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = hlGrad;
    ctx.fill();

    // Small bright dot highlight
    const dotGrad = ctx.createRadialGradient(
      x - r * 0.3, y - r * 0.35, 0,
      x - r * 0.3, y - r * 0.35, r * 0.15
    );
    dotGrad.addColorStop(0, 'rgba(255,255,255,1)');
    dotGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = dotGrad;
    ctx.fill();

    // Bottom edge rim light
    const rimGrad = ctx.createRadialGradient(
      x + r * 0.2, y + r * 0.3, r * 0.5,
      x, y, r
    );
    rimGrad.addColorStop(0, 'rgba(255,255,255,0)');
    rimGrad.addColorStop(0.85, 'rgba(255,255,255,0)');
    rimGrad.addColorStop(1, 'rgba(255,255,255,0.06)');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = rimGrad;
    ctx.fill();

    // Edge outline
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    ctx.restore();
  }

  // ============================================
  // Aim Guide
  // ============================================

  _drawAimGuide(ctx, cueBall) {
    const angle = this.aimAngle;
    const length = 400;

    // Faint dotted guide line
    ctx.beginPath();
    ctx.moveTo(cueBall.x, cueBall.y);
    ctx.lineTo(
      cueBall.x + Math.cos(angle) * length,
      cueBall.y + Math.sin(angle) * length
    );
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ============================================
  // Trajectory / Prediction
  // ============================================

  _drawTrajectory(ctx, cueBall, balls) {
    const angle = this.aimAngle;
    const maxLength = 500;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    let hitBall = null;
    let hitDistance = maxLength;
    let hitX, hitY;

    // Find first ball hit
    for (const ball of balls) {
      if (ball.pocketed || ball.id === 0) continue;

      const dist = this._distanceToLineSegment(
        cueBall.x, cueBall.y,
        cueBall.x + dx * maxLength, cueBall.y + dy * maxLength,
        ball.x, ball.y
      );

      if (dist < BALL_RADIUS * 2) {
        const hitDist = this._projectDistanceOnLine(
          cueBall.x, cueBall.y,
          cueBall.x + dx * maxLength, cueBall.y + dy * maxLength,
          ball.x, ball.y
        );

        if (hitDist > 0 && hitDist < hitDistance) {
          hitDistance = hitDist;
          hitBall = ball;
        }
      }
    }

    // Draw cue ball path
    ctx.beginPath();
    ctx.moveTo(cueBall.x, cueBall.y);

    if (hitBall) {
      hitX = cueBall.x + dx * (hitDistance - BALL_RADIUS);
      hitY = cueBall.y + dy * (hitDistance - BALL_RADIUS);
      ctx.lineTo(hitX, hitY);

      // Ghost ball at collision point
      ctx.save();
      const ghostGrad = ctx.createRadialGradient(hitX, hitY, 0, hitX, hitY, BALL_RADIUS);
      ghostGrad.addColorStop(0, 'rgba(255,255,255,0.15)');
      ghostGrad.addColorStop(1, 'rgba(255,255,255,0.03)');
      ctx.beginPath();
      ctx.arc(hitX, hitY, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = ghostGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Predicted target ball path
      const targetAngle = Math.atan2(hitBall.y - hitY, hitBall.x - hitX);
      ctx.beginPath();
      ctx.moveTo(hitBall.x, hitBall.y);
      ctx.lineTo(
        hitBall.x + Math.cos(targetAngle) * 80,
        hitBall.y + Math.sin(targetAngle) * 80
      );
      ctx.strokeStyle = 'rgba(255,200,80,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Target ball dot
      ctx.beginPath();
      ctx.arc(hitBall.x, hitBall.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,200,80,0.5)';
      ctx.fill();
    } else {
      ctx.lineTo(cueBall.x + dx * maxLength, cueBall.y + dy * maxLength);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  _distanceToLineSegment(x1, y1, x2, y2, px, py) {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = lenSq !== 0 ? dot / lenSq : -1;
    let xx, yy;
    if (param < 0) { xx = x1; yy = y1; }
    else if (param > 1) { xx = x2; yy = y2; }
    else { xx = x1 + param * C; yy = y1 + param * D; }
    const ddx = px - xx;
    const ddy = py - yy;
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }

  _projectDistanceOnLine(x1, y1, x2, y2, px, py) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return 0;
    const t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    return t * Math.sqrt(lenSq);
  }

  // ============================================
  // Cue Stick (Realistic)
  // ============================================

  _drawCueStick(ctx, cueBall) {
    const angle = this.aimAngle;
    const pullBack = this.aimPower * 100;
    const cx = cueBall.x;
    const cy = cueBall.y;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const perpX = -sin;
    const perpY = cos;

    const tipStart = BALL_RADIUS + 3 + pullBack;
    const cueLen = 260;

    const tipX = cx - cos * tipStart;
    const tipY = cy - sin * tipStart;

    // Section lengths
    const chalkLen = 5;
    const ferruleLen = 14;
    const shaftLen = 130;
    const wrapLen = 28;
    const buttLen = cueLen - chalkLen - ferruleLen - shaftLen - wrapLen;

    // Half-widths at each section boundary (tip → butt)
    const w = [2.5, 3.0, 4.5, 5.0, 6.0];

    // Section colors (gradient fills perpendicular to cue)
    const colors = [
      ['#1a5088', '#2870b0', '#1a5088'],         // chalk tip: blue
      ['#e8e0d0', '#f8f4e8', '#e0d8c8'],          // ferrule: ivory
      ['#c09050', '#e0c888', '#b88848'],           // shaft: maple
      ['#1a1a1a', '#333333', '#1a1a1a'],           // wrap: dark linen
      ['#1c0e06', '#3a2010', '#140a04'],           // butt: dark wood
    ];

    const lens = [chalkLen, ferruleLen, shaftLen, wrapLen, buttLen];

    // Shadow
    ctx.save();
    ctx.globalAlpha = 0.25;
    const sOff = 4;
    const sPx = perpX * sOff;
    const sPy = perpY * sOff;
    ctx.beginPath();
    let a = 0;
    ctx.moveTo(tipX - cos * a + sPx - perpX * w[0], tipY - sin * a + sPy - perpY * w[0]);
    for (let i = 0; i < 5; i++) {
      a += lens[i];
      ctx.lineTo(tipX - cos * a + sPx - perpX * w[i + 1], tipY - sin * a + sPy - perpY * w[i + 1]);
    }
    for (let i = 4; i >= 0; i--) {
      ctx.lineTo(tipX - cos * a + sPx + perpX * w[i + 1], tipY - sin * a + sPy + perpY * w[i + 1]);
      a -= lens[i];
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();
    ctx.restore();

    // Draw each section
    let offset = 0;
    for (let i = 0; i < 5; i++) {
      const sx = tipX - cos * offset;
      const sy = tipY - sin * offset;
      const len = lens[i];
      const halfW = w[i];
      const halfWN = w[i + 1];
      const c = colors[i];

      // Section body
      ctx.beginPath();
      ctx.moveTo(sx - perpX * halfW, sy - perpY * halfW);
      ctx.lineTo(sx - cos * len - perpX * halfWN, sy - sin * len - perpY * halfWN);
      ctx.lineTo(sx - cos * len + perpX * halfWN, sy - sin * len + perpY * halfWN);
      ctx.lineTo(sx + perpX * halfW, sy + perpY * halfW);
      ctx.closePath();

      const grad = ctx.createLinearGradient(
        sx + perpX * halfW, sy + perpY * halfW,
        sx - perpX * halfW, sy - perpY * halfW
      );
      grad.addColorStop(0, c[0]);
      grad.addColorStop(0.4, c[1]);
      grad.addColorStop(1, c[2]);
      ctx.fillStyle = grad;
      ctx.fill();

      // Gloss highlight on shaft and butt
      if (i === 2 || i === 4) {
        ctx.beginPath();
        ctx.moveTo(sx - perpX * halfW * 0.3, sy - perpY * halfW * 0.3);
        ctx.lineTo(sx - cos * len - perpX * halfWN * 0.3, sy - sin * len - perpY * halfWN * 0.3);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Ring accents at section boundaries
      if (i === 1 || i === 3) {
        ctx.beginPath();
        ctx.moveTo(sx - perpX * (halfW + 0.8), sy - perpY * (halfW + 0.8));
        ctx.lineTo(sx + perpX * (halfW + 0.8), sy + perpY * (halfW + 0.8));
        ctx.strokeStyle = 'rgba(180,160,120,0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      offset += len;
    }
  }

  // ============================================
  // Game Overlay
  // ============================================

  _drawGameOverlay(ctx, gameState) {
    if (gameState.foul) {
      // Foul red tint with pulsing
      ctx.save();
      ctx.fillStyle = 'rgba(220,40,40,0.08)';
      ctx.fillRect(0, 0, TABLE.WIDTH, TABLE.HEIGHT);
      ctx.restore();
    }
  }
}

// ============================================
// Color Utilities
// ============================================

function lightenColor(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + percent);
  const g = Math.min(255, ((num >> 8) & 0x00FF) + percent);
  const b = Math.min(255, (num & 0x0000FF) + percent);
  return `rgb(${r},${g},${b})`;
}

function darkenColor(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, (num >> 16) - percent);
  const g = Math.max(0, ((num >> 8) & 0x00FF) - percent);
  const b = Math.max(0, (num & 0x0000FF) - percent);
  return `rgb(${r},${g},${b})`;
}
