import { TABLE, MAX_POWER, BALL_RADIUS } from './constants.js';

/**
 * InputHandler - Simple pool controls
 *
 * Desktop: move mouse to aim, click+hold to charge power, release to shoot.
 * Mobile: touch+drag to aim, power slider to set power, tap Shoot button.
 */

export class InputHandler {
  constructor(canvas, renderer) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.enabled = false;
    this.onShoot = null;
    this.onBallInHand = null;
    this.ballInHandMode = false;

    this.isMouseDown = false;
    this.chargeStart = 0;
    this.chargeInterval = null;

    this.isTouching = false;
    this.isMobile = false;

    this.externalPower = null;

    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onContextMenu = this._onContextMenu.bind(this);
    this._onTouchStart = this._onTouchStart.bind(this);
    this._onTouchMove = this._onTouchMove.bind(this);
    this._onTouchEnd = this._onTouchEnd.bind(this);

    canvas.addEventListener('mousedown', this._onMouseDown);
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('contextmenu', this._onContextMenu);
    canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this._onTouchEnd, { passive: false });

    this._detectMobile();
    window.addEventListener('resize', () => this._detectMobile());
  }

  _detectMobile() {
    this.isMobile = window.innerWidth <= 768;
    this.canvas.style.touchAction = 'none';
  }

  enable() { this.enabled = true; }

  disable() {
    this.enabled = false;
    this.renderer.isAiming = false;
    this.isMouseDown = false;
    this.isTouching = false;
    this.renderer.aimPower = 0;
    this._stopCharge();
  }

  setBallInHandMode(callback) {
    this.ballInHandMode = true;
    this.onBallInHand = callback;
  }

  disableBallInHandMode() {
    this.ballInHandMode = false;
    this.onBallInHand = null;
  }

  setExternalPower(power) {
    this.externalPower = power;
    this.renderer.aimPower = power;
  }

  getPower() {
    if (this.externalPower !== null) return this.externalPower;
    if (!this.isMouseDown || !this.chargeStart) return 0;
    const elapsed = Date.now() - this.chargeStart;
    return Math.min(1, elapsed / 2000);
  }

  _getCanvasPos(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = TABLE.WIDTH / rect.width;
    const scaleY = TABLE.HEIGHT / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  _startCharge() {
    this.chargeStart = Date.now();
    this._stopCharge();
    this.chargeInterval = setInterval(() => {
      if (!this.isMouseDown) { this._stopCharge(); return; }
      const power = this.getPower();
      this.renderer.aimPower = this.externalPower !== null ? this.externalPower : power;
    }, 16);
  }

  _stopCharge() {
    if (this.chargeInterval) {
      clearInterval(this.chargeInterval);
      this.chargeInterval = null;
    }
  }

  // ============================================
  // Mouse
  // ============================================

  _onMouseDown(e) {
    if (!this.enabled || this.isMobile) return;

    if (this.ballInHandMode) {
      const pos = this._getCanvasPos(e.clientX, e.clientY);
      if (this.onBallInHand) this.onBallInHand(pos.x, pos.y);
      return;
    }

    if (e.button === 0) {
      this.isMouseDown = true;
      this.renderer.isAiming = true;
      this.renderer.aimPower = 0;
      this.externalPower = null;
      this._startCharge();
    }
  }

  _onMouseMove(e) {
    if (!this.enabled || this.isMobile) return;
    const pos = this._getCanvasPos(e.clientX, e.clientY);
    this.renderer.mouseX = pos.x;
    this.renderer.mouseY = pos.y;
  }

  _onMouseUp(e) {
    if (!this.enabled || this.isMobile || !this.isMouseDown) return;

    const power = this.getPower();
    this._stopCharge();

    if (power > 0.05 && this.onShoot) {
      this.onShoot(this.renderer.aimAngle, power * MAX_POWER);
    }

    this.isMouseDown = false;
    this.renderer.isAiming = false;
    this.renderer.aimPower = 0;
    this.externalPower = null;
  }

  _onContextMenu(e) {
    e.preventDefault();
    if (!this.enabled) return;
    this._stopCharge();
    this.isMouseDown = false;
    this.renderer.isAiming = false;
    this.renderer.aimPower = 0;
  }

  // ============================================
  // Touch
  // ============================================

  _onTouchStart(e) {
    if (!this.enabled) return;
    e.preventDefault();

    const touch = e.touches[0];
    const pos = this._getCanvasPos(touch.clientX, touch.clientY);

    if (this.ballInHandMode) {
      if (this.onBallInHand) this.onBallInHand(pos.x, pos.y);
      return;
    }

    this.isTouching = true;
    this.renderer.mouseX = pos.x;
    this.renderer.mouseY = pos.y;
    this.renderer.isAiming = true;
    this.renderer.aimPower = 0;
    this.externalPower = null;
  }

  _onTouchMove(e) {
    if (!this.enabled || !this.isTouching) return;
    e.preventDefault();

    const touch = e.touches[0];
    const pos = this._getCanvasPos(touch.clientX, touch.clientY);
    this.renderer.mouseX = pos.x;
    this.renderer.mouseY = pos.y;
  }

  _onTouchEnd(e) {
    if (!this.enabled || !this.isTouching) return;
    e.preventDefault();

    if (this.ballInHandMode) {
      this.isTouching = false;
      return;
    }

    this.isTouching = false;
    if (!this.externalPower) {
      this.renderer.isAiming = false;
      this.renderer.aimPower = 0;
    }
  }

  // ============================================
  // Public API
  // ============================================

  triggerShoot() {
    if (!this.enabled || !this.renderer.isAiming) return;

    const power = this.getPower();
    if (power > 0.05 && this.onShoot) {
      this.onShoot(this.renderer.aimAngle, power * MAX_POWER);
    }

    this.renderer.isAiming = false;
    this.renderer.aimPower = 0;
    this.externalPower = null;
  }

  cancelAim() {
    this._stopCharge();
    this.isTouching = false;
    this.isMouseDown = false;
    this.renderer.isAiming = false;
    this.renderer.aimPower = 0;
    this.externalPower = null;
  }

  destroy() {
    this._stopCharge();
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    this.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mouseup', this._onMouseUp);
    this.canvas.removeEventListener('contextmenu', this._onContextMenu);
    this.canvas.removeEventListener('touchstart', this._onTouchStart);
    this.canvas.removeEventListener('touchmove', this._onTouchMove);
    this.canvas.removeEventListener('touchend', this._onTouchEnd);
  }
}
