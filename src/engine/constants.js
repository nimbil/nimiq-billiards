export const TABLE = {
  WIDTH: 900,
  HEIGHT: 450,
  FELT_COLOR: '#1a8a52',
  RAIL_COLOR: '#4a2c0a',
  RAIL_WIDTH: 30,
  POCKET_RADIUS: 30,
  POCKETS: [],
};

const PW = TABLE.POCKET_RADIUS;
const RW = TABLE.RAIL_WIDTH;

TABLE.POCKETS = [
  { x: RW - 4, y: RW - 4 },
  { x: TABLE.WIDTH / 2, y: RW - 6 },
  { x: TABLE.WIDTH - RW + 4, y: RW - 4 },
  { x: RW - 4, y: TABLE.HEIGHT - RW + 4 },
  { x: TABLE.WIDTH / 2, y: TABLE.HEIGHT - RW + 6 },
  { x: TABLE.WIDTH - RW + 4, y: TABLE.HEIGHT - RW + 4 },
];

export const BALL_RADIUS = 13;
export const CUE_BALL_ID = 0;
export const EIGHT_BALL_ID = 8;
export const FRICTION = 0.985;
export const MIN_VELOCITY = 0.15;
export const MAX_POWER = 22;

export const BALL_COLORS = [
  '#f5f5f0',
  '#f5d033', // 1 solid yellow
  '#1a5fb4', // 2 solid blue
  '#d32f2f', // 3 solid red
  '#6a1b9a', // 4 solid purple
  '#e65100', // 5 solid orange
  '#1b5e20', // 6 solid green
  '#5d4037', // 7 solid maroon
  '#212121', // 8 black
  '#ffeb3b', // 9 stripe bright yellow
  '#42a5f5', // 10 stripe sky blue
  '#ef5350', // 11 stripe coral red
  '#ab47bc', // 12 stripe orchid
  '#ffa726', // 13 stripe light orange
  '#66bb6a', // 14 stripe lime green
  '#8d6e63', // 15 stripe rose brown
];

export const BALL_NUMBERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

export function createRack() {
  const startX = TABLE.WIDTH * 0.72;
  const startY = TABLE.HEIGHT / 2;
  const d = BALL_RADIUS * 2 + 1;
  const h = d * Math.sin(Math.PI / 3);

  const rackOrder = [1, 9, 2, 10, 8, 11, 3, 13, 6, 14, 12, 4, 7, 15, 5];
  const balls = [];
  let idx = 0;

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      const x = startX + row * h;
      const y = startY + (col - row / 2) * d;
      const num = rackOrder[idx++];
      balls.push({
        id: num,
        x,
        y,
        vx: 0,
        vy: 0,
        spinX: 0,
        spinY: 0,
        spinZ: 0,
        pocketed: false,
        stationary: true,
        stripe: num >= 9,
        solid: num >= 1 && num <= 7,
        isEight: num === 8,
      });
    }
  }

  balls.unshift({
    id: 0,
    x: TABLE.WIDTH * 0.25,
    y: TABLE.HEIGHT / 2,
    vx: 0,
    vy: 0,
    spinX: 0,
    spinY: 0,
    spinZ: 0,
    pocketed: false,
    stationary: true,
    stripe: false,
    solid: false,
    isEight: false,
  });

  return balls;
}
