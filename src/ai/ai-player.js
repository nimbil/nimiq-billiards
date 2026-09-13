import { TABLE, BALL_RADIUS, CUE_BALL_ID, EIGHT_BALL_ID, MAX_POWER } from '../engine/constants.js';

const DIFFICULTY = {
  easy: {
    accuracy: 0.35,
    aimJitter: 0.35,
    powerVariance: 0.45,
    thinkTime: 500,
    positioningWeight: 0.0,
    riskAversion: 0.1,
    safetyBias: 0.0,
    canBreakClusters: false,
    considersNextShot: false,
    scratchesOnPurpose: 0.05,
    maxSearchDepth: 1,
  },
  medium: {
    accuracy: 0.65,
    aimJitter: 0.18,
    powerVariance: 0.2,
    thinkTime: 900,
    positioningWeight: 0.25,
    riskAversion: 0.35,
    safetyBias: 0.15,
    canBreakClusters: false,
    considersNextShot: true,
    scratchesOnPurpose: 0.0,
    maxSearchDepth: 1,
  },
  hard: {
    accuracy: 0.88,
    aimJitter: 0.07,
    powerVariance: 0.1,
    thinkTime: 1300,
    positioningWeight: 0.45,
    riskAversion: 0.6,
    safetyBias: 0.3,
    canBreakClusters: true,
    considersNextShot: true,
    scratchesOnPurpose: 0.0,
    maxSearchDepth: 2,
  },
  expert: {
    accuracy: 0.97,
    aimJitter: 0.02,
    powerVariance: 0.05,
    thinkTime: 1800,
    positioningWeight: 0.6,
    riskAversion: 0.8,
    safetyBias: 0.4,
    canBreakClusters: true,
    considersNextShot: true,
    scratchesOnPurpose: 0.0,
    maxSearchDepth: 3,
  },
};

export class AIPlayer {
  constructor(difficulty = 'medium') {
    this.difficulty = difficulty;
    this.config = DIFFICULTY[difficulty] || DIFFICULTY.medium;
    this.evaluator = new ShotEvaluator();
  }

  async getShot(balls, playerType, gameState) {
    await new Promise(r => setTimeout(r, this.config.thinkTime));

    const cueBall = balls.find(b => b.id === CUE_BALL_ID && !b.pocketed);
    if (!cueBall) return null;

    const targets = this._getTargetBalls(balls, playerType);
    const isBreaking = balls.every(b => b.id === CUE_BALL_ID || (!b.pocketed && this._isInRack(b)));
    const isEndgame = this._isEndgame(balls, playerType);

    if (isBreaking) {
      return this._getBreakShot(cueBall, balls);
    }

    if (targets.length === 0) {
      return this._getSafetyShot(cueBall, balls, playerType);
    }

    const candidates = this._generateAllCandidates(cueBall, targets, balls, playerType);

    if (candidates.length === 0) {
      return this._getSafetyShot(cueBall, balls, playerType);
    }

    const evaluated = candidates.map(c => ({
      ...c,
      score: this._evaluateCandidate(c, cueBall, balls, playerType, isEndgame),
    }));

    evaluated.sort((a, b) => b.score - a.score);

    const best = this._selectWithDifficulty(evaluated);
    return this._addJitter(best);
  }

  _isInRack(ball) {
    const rackX = TABLE.WIDTH * 0.72;
    const rackY = TABLE.HEIGHT / 2;
    return Math.abs(ball.x - rackX) < 60 && Math.abs(ball.y - rackY) < 80;
  }

  _isEndgame(balls, playerType) {
    if (playerType === 'solids' || playerType === 'stripes') {
      const range = playerType === 'solids' ? [1, 7] : [9, 15];
      const remaining = balls.filter(b => b.id >= range[0] && b.id <= range[1] && !b.pocketed);
      return remaining.length <= 2;
    }
    return false;
  }

  _getTargetBalls(balls, playerType) {
    const active = balls.filter(b => !b.pocketed && b.id !== CUE_BALL_ID && b.id !== EIGHT_BALL_ID);
    if (playerType === 'solids') {
      const solids = active.filter(b => b.id >= 1 && b.id <= 7);
      return solids.length > 0 ? solids : [];
    }
    if (playerType === 'stripes') {
      const stripes = active.filter(b => b.id >= 9 && b.id <= 15);
      return stripes.length > 0 ? stripes : [];
    }
    return active;
  }

  _getBreakShot(cueBall, balls) {
    const rackCenterX = TABLE.WIDTH * 0.72;
    const rackCenterY = TABLE.HEIGHT / 2;
    const angle = Math.atan2(rackCenterY - cueBall.y, rackCenterX - cueBall.x);
    const dist = Math.sqrt(
      (rackCenterX - cueBall.x) ** 2 + (rackCenterY - cueBall.y) ** 2
    );
    return {
      angle: angle + (Math.random() - 0.5) * 0.06,
      power: Math.min(MAX_POWER, dist * 0.09 + 8),
    };
  }

  _generateAllCandidates(cueBall, targets, balls, playerType) {
    const candidates = [];

    for (const target of targets) {
      for (const pocket of TABLE.POCKETS) {
        const candidate = this._buildCandidate(cueBall, target, pocket, balls, playerType);
        if (candidate) candidates.push(candidate);
      }
    }

    const eightBall = balls.find(b => b.id === EIGHT_BALL_ID && !b.pocketed);
    if (eightBall && this._allOwnPocketed(balls, playerType)) {
      for (const pocket of TABLE.POCKETS) {
        const candidate = this._buildCandidate(cueBall, eightBall, pocket, balls, playerType, true);
        if (candidate) {
          candidate.isEightBallShot = true;
          candidates.push(candidate);
        }
      }
    }

    return candidates;
  }

  _allOwnPocketed(balls, playerType) {
    if (playerType === 'solids') {
      return balls.filter(b => b.id >= 1 && b.id <= 7).every(b => b.pocketed);
    }
    if (playerType === 'stripes') {
      return balls.filter(b => b.id >= 9 && b.id <= 15).every(b => b.pocketed);
    }
    return false;
  }

  _buildCandidate(cueBall, target, pocket, balls, playerType, isEight = false) {
    const dx = pocket.x - target.x;
    const dy = pocket.y - target.y;
    const distToPocket = Math.sqrt(dx * dx + dy * dy);
    const angleToPocket = Math.atan2(dy, dx);

    const ghostX = target.x - Math.cos(angleToPocket) * BALL_RADIUS * 2;
    const ghostY = target.y - Math.sin(angleToPocket) * BALL_RADIUS * 2;

    const gdx = ghostX - cueBall.x;
    const gdy = ghostY - cueBall.y;
    const angleToGhost = Math.atan2(gdy, gdx);
    const distToGhost = Math.sqrt(gdx * gdx + gdy * gdy);

    const cutAngle = Math.abs(this._normalizeAngle(angleToPocket - angleToGhost));
    if (cutAngle > Math.PI * 0.42) return null;

    if (this._isPathBlocked(cueBall.x, cueBall.y, ghostX, ghostY, target, balls)) {
      return null;
    }

    const predictedCueEnd = this._predictCueBallEnd(
      cueBall, angleToGhost, distToGhost, target, balls
    );

    const nextShotScore = this._evaluateNextShot(
      predictedCueEnd, balls, playerType
    );

    const scratchRisk = this._evaluateScratchRisk(predictedCueEnd);
    const foulRisk = this._evaluateFoulRisk(predictedCueEnd, target, balls, playerType);

    return {
      target,
      pocket,
      angle: angleToGhost,
      power: Math.min(MAX_POWER, distToGhost * 0.08 + 5),
      distToGhost,
      distToPocket,
      cutAngle,
      ghostX,
      ghostY,
      predictedCueEnd,
      nextShotScore,
      scratchRisk,
      foulRisk,
      isEightBallShot: isEight,
    };
  }

  _predictCueBallEnd(cueBall, angle, dist, targetBall, balls) {
    const hitX = cueBall.x + Math.cos(angle) * dist;
    const hitY = cueBall.y + Math.sin(angle) * dist;

    const dx = targetBall.x - hitX;
    const dy = targetBall.y - hitY;
    const hitAngle = Math.atan2(dy, dx);

    const deflectAngle = angle + Math.PI + (hitAngle - (angle + Math.PI)) * 0.5;
    const deflectionPower = dist * 0.15;

    const endX = hitX + Math.cos(deflectAngle) * deflectionPower;
    const endY = hitY + Math.sin(deflectAngle) * deflectionPower;

    return {
      x: Math.max(TABLE.RAIL_WIDTH + BALL_RADIUS, Math.min(TABLE.WIDTH - TABLE.RAIL_WIDTH - BALL_RADIUS, endX)),
      y: Math.max(TABLE.RAIL_WIDTH + BALL_RADIUS, Math.min(TABLE.HEIGHT - TABLE.RAIL_WIDTH - BALL_RADIUS, endY)),
    };
  }

  _evaluateNextShot(cueEnd, balls, playerType) {
    if (!this.config.considersNextShot) return 0.5;

    const targets = this._getTargetBalls(balls, playerType).filter(
      b => b.id !== undefined
    );
    if (targets.length === 0) return 1.0;

    let bestAngle = Infinity;

    for (const target of targets) {
      for (const pocket of TABLE.POCKETS) {
        const dx = pocket.x - target.x;
        const dy = pocket.y - target.y;
        const angleToPocket = Math.atan2(dy, dx);

        const ghostX = target.x - Math.cos(angleToPocket) * BALL_RADIUS * 2;
        const ghostY = target.y - Math.sin(angleToPocket) * BALL_RADIUS * 2;

        const gdx = ghostX - cueEnd.x;
        const gdy = ghostY - cueEnd.y;
        const dist = Math.sqrt(gdx * gdx + gdy * gdy);

        if (dist < 500) {
          const angle = Math.abs(Math.atan2(gdy, gdx));
          if (angle < bestAngle) bestAngle = angle;
        }

        if (dist < 250 && !this._isPathBlocked(cueEnd.x, cueEnd.y, ghostX, ghostY, target, balls)) {
          return 1.0;
        }
      }
    }

    if (bestAngle === Infinity) return 0.1;
    return Math.max(0.1, 1.0 - bestAngle / Math.PI);
  }

  _evaluateScratchRisk(cueEnd) {
    const dangerZone = TABLE.RAIL_WIDTH + BALL_RADIUS * 3;
    let risk = 0;

    for (const pocket of TABLE.POCKETS) {
      const dx = cueEnd.x - pocket.x;
      const dy = cueEnd.y - pocket.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < TABLE.POCKET_RADIUS * 2) {
        risk = Math.max(risk, 1.0 - dist / (TABLE.POCKET_RADIUS * 2));
      }
    }

    if (cueEnd.x < dangerZone || cueEnd.x > TABLE.WIDTH - dangerZone) risk += 0.2;
    if (cueEnd.y < dangerZone || cueEnd.y > TABLE.HEIGHT - dangerZone) risk += 0.2;

    return Math.min(1.0, risk);
  }

  _evaluateFoulRisk(cueEnd, target, balls, playerType) {
    const activeBalls = balls.filter(b => !b.pocketed && b.id !== CUE_BALL_ID);

    let risk = 0;
    for (const ball of activeBalls) {
      const dx = cueEnd.x - ball.x;
      const dy = cueEnd.y - ball.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < BALL_RADIUS * 3) {
        risk += 0.3;
      }
    }

    return Math.min(1.0, risk);
  }

  _evaluateCandidate(candidate, cueBall, balls, playerType, isEndgame) {
    let score = 0;

    const pocketScore = this._scorePocketAngle(candidate.cutAngle, candidate.distToPocket);
    const distanceScore = this._scoreDistance(candidate.distToGhost);
    const positionScore = this._scorePosition(candidate.predictedCueEnd, balls, playerType);
    const nextShotBonus = candidate.nextShotScore * this.config.positioningWeight;
    const scratchPenalty = candidate.scratchRisk * this.config.riskAversion * 2.0;
    const foulPenalty = candidate.foulRisk * this.config.riskAversion;

    score += pocketScore * 0.30;
    score += distanceScore * 0.20;
    score += positionScore * 0.20;
    score += nextShotBonus * 0.15;
    score -= scratchPenalty * 0.10;
    score -= foulPenalty * 0.05;

    if (candidate.isEightBallShot) {
      if (this._allOwnPocketed(balls, playerType)) {
        score *= 2.0;
      } else {
        score *= 0.01;
      }
    }

    if (isEndgame && candidate.target.id >= 1 && candidate.target.id <= 15) {
      const isOwn = this._isOwnBall(candidate.target.id, playerType);
      if (isOwn) score *= 1.5;
    }

    if (candidate.distToGhost < 80) {
      score *= 1.1;
    } else if (candidate.distToGhost > 400) {
      score *= 0.8;
    }

    if (candidate.cutAngle < 0.15) {
      score *= 1.15;
    } else if (candidate.cutAngle > 0.6) {
      score *= 0.75;
    }

    return score;
  }

  _scorePocketAngle(cutAngle, distToPocket) {
    const angleScore = Math.cos(cutAngle);
    const pocketSizeBonus = Math.max(0, 1.0 - distToPocket / 600);
    return (angleScore * 0.7 + pocketSizeBonus * 0.3);
  }

  _scoreDistance(dist) {
    if (dist < 60) return 1.0;
    if (dist < 150) return 0.9;
    if (dist < 300) return 0.7;
    if (dist < 500) return 0.5;
    return 0.3;
  }

  _scorePosition(cueEnd, balls, playerType) {
    const centerX = TABLE.WIDTH / 2;
    const centerY = TABLE.HEIGHT / 2;
    const distFromCenter = Math.sqrt(
      (cueEnd.x - centerX) ** 2 + (cueEnd.y - centerY) ** 2
    );
    const maxDist = Math.sqrt(centerX ** 2 + centerY ** 2);
    const centerScore = 1.0 - (distFromCenter / maxDist) * 0.5;

    const nearPocket = this._evaluateScratchRisk(cueEnd);
    const safetyScore = 1.0 - nearPocket * 0.5;

    return centerScore * 0.5 + safetyScore * 0.5;
  }

  _isOwnBall(ballId, playerType) {
    if (playerType === 'solids') return ballId >= 1 && ballId <= 7;
    if (playerType === 'stripes') return ballId >= 9 && ballId <= 15;
    return false;
  }

  _isPathBlocked(x1, y1, x2, y2, target, balls) {
    const steps = 25;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = x1 + (x2 - x1) * t;
      const py = y1 + (y2 - y1) * t;

      for (const b of balls) {
        if (b.pocketed || b.id === target.id || b.id === CUE_BALL_ID) continue;
        const bdx = px - b.x;
        const bdy = py - b.y;
        const dist = Math.sqrt(bdx * bdx + bdy * bdy);
        if (dist < BALL_RADIUS * 2.1) return true;
      }
    }
    return false;
  }

  _getSafetyShot(cueBall, balls, playerType) {
    const safeZones = [
      { x: TABLE.RAIL_WIDTH + 40, y: TABLE.HEIGHT / 2 },
      { x: TABLE.WIDTH / 2, y: TABLE.RAIL_WIDTH + 40 },
      { x: TABLE.WIDTH / 2, y: TABLE.HEIGHT - TABLE.RAIL_WIDTH - 40 },
      { x: TABLE.WIDTH - TABLE.RAIL_WIDTH - 40, y: TABLE.HEIGHT / 2 },
    ];

    let bestZone = safeZones[0];
    let bestDist = Infinity;

    for (const zone of safeZones) {
      const dist = Math.sqrt((zone.x - cueBall.x) ** 2 + (zone.y - cueBall.y) ** 2);
      if (dist < bestDist) {
        bestDist = dist;
        bestZone = zone;
      }
    }

    const angle = Math.atan2(bestZone.y - cueBall.y, bestZone.x - cueBall.x);
    const power = Math.min(MAX_POWER, bestDist * 0.06 + 3);

    return {
      angle: angle + (Math.random() - 0.5) * 0.3,
      power,
    };
  }

  _selectWithDifficulty(evaluated) {
    if (evaluated.length === 0) return null;

    const topN = Math.min(evaluated.length, Math.ceil(evaluated.length * 0.3 + 1));
    const top = evaluated.slice(0, topN);

    if (this.config.riskAversion > 0.5) {
      return top[0];
    }

    const jitter = this.config.powerVariance * 0.5;
    const weights = top.map((_, i) => Math.max(0.01, 1.0 - i * jitter));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalWeight;

    for (let i = 0; i < top.length; i++) {
      r -= weights[i];
      if (r <= 0) return top[i];
    }

    return top[0];
  }

  _addJitter(shot) {
    if (!shot) return null;

    const angleJitter = (Math.random() - 0.5) * this.config.aimJitter;
    const powerMult = 1 + (Math.random() - 0.5) * this.config.powerVariance;

    return {
      angle: shot.angle + angleJitter,
      power: Math.max(2, Math.min(MAX_POWER, shot.power * powerMult)),
    };
  }

  _normalizeAngle(angle) {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }
}

class ShotEvaluator {
  constructor() {
    this.weights = {
      pocketAngle: 0.30,
      distance: 0.20,
      position: 0.20,
      nextShot: 0.15,
      scratchPenalty: 0.10,
      foulPenalty: 0.05,
    };
  }
}
