/**
 * BilliardsRulesEngine Tests
 * 
 * Run: npm test
 */

import { BilliardsRulesEngine, GAME_STATE, BALL_GROUP, FOUL, SHOT_RESULT, getBallGroup } from '../src/engine/rules/BilliardsRulesEngine.js';

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

function expect(val) {
  return {
    toBe(exp) { if (val !== exp) throw new Error(`Expected ${exp}, got ${val}`); },
    toBeTruthy() { if (!val) throw new Error(`Expected truthy, got ${val}`); },
    toBeNull() { if (val !== null) throw new Error(`Expected null, got ${val}`); },
    toContain(exp) { if (!val.includes(exp)) throw new Error(`Expected to contain ${exp}`); },
  };
}

function createBalls(pocketed = []) {
  return Array.from({ length: 16 }, (_, i) => ({ id: i, pocketed: pocketed.includes(i) }));
}

console.log('\nBilliardsRulesEngine Tests\n');

// ============================================
// Ball Group Tests
// ============================================
console.log('Ball Groups:');

test('getBallGroup returns CUE for 0', () => {
  expect(getBallGroup(0)).toBe(BALL_GROUP.CUE);
});

test('getBallGroup returns EIGHT for 8', () => {
  expect(getBallGroup(8)).toBe(BALL_GROUP.EIGHT);
});

test('getBallGroup returns SOLIDS for 1-7', () => {
  for (let i = 1; i <= 7; i++) expect(getBallGroup(i)).toBe(BALL_GROUP.SOLIDS);
});

test('getBallGroup returns STRIPES for 9-15', () => {
  for (let i = 9; i <= 15; i++) expect(getBallGroup(i)).toBe(BALL_GROUP.STRIPES);
});

// ============================================
// Break Shot Tests
// ============================================
console.log('\nBreak Shot:');

test('starts in BREAK state', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  expect(e.gameState).toBe(GAME_STATE.BREAK);
});

test('win on 8-ball pocketed during break', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.beginShot(createBalls());
  e.recordFirstContact(8);
  e.recordBallPocketed(8);
  e.recordCushionHit();
  // 8-ball pocketed on break is a win
  const r = e.endShot(createBalls([8]));
  expect(r.shotResult).toBe(SHOT_RESULT.WIN);
  expect(r.winner).toBe(1);
});

test('scratch on break gives opponent ball in hand', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.beginShot(createBalls());
  e.recordFirstContact(1);
  e.recordBallPocketed(0);
  e.recordCushionHit();
  const r = e.endShot(createBalls([0]));
  expect(r.foul).toBe(FOUL.SCRATCH);
  expect(e.turn).toBe(2);
  expect(e.gameState).toBe(GAME_STATE.BALL_IN_HAND);
});

test('pocketing solid on break assigns solids to player 1', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.beginShot(createBalls());
  e.recordFirstContact(3);
  e.recordBallPocketed(3);
  e.recordCushionHit();
  e.endShot(createBalls([3]));
  expect(e.player1Group).toBe(BALL_GROUP.SOLIDS);
  expect(e.player2Group).toBe(BALL_GROUP.STRIPES);
});

test('pocketing stripe on break assigns stripes to player 1', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.beginShot(createBalls());
  e.recordFirstContact(11);
  e.recordBallPocketed(11);
  e.recordCushionHit();
  e.endShot(createBalls([11]));
  expect(e.player1Group).toBe(BALL_GROUP.STRIPES);
  expect(e.player2Group).toBe(BALL_GROUP.SOLIDS);
});

test('no pocket on break switches to player 2', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.beginShot(createBalls());
  e.recordFirstContact(1);
  e.recordCushionHit();
  const r = e.endShot(createBalls());
  expect(e.turn).toBe(2);
  expect(r.switchTurn).toBe(true);
});

// ============================================
// Open Table Tests
// ============================================
console.log('\nOpen Table:');

test('table stays open until ball pocketed', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.beginShot(createBalls());
  e.recordFirstContact(1);
  e.recordCushionHit();
  e.endShot(createBalls());
  expect(e.tableOpen).toBe(true);
});

test('any ball can be hit first when open', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.beginShot(createBalls());
  e.recordFirstContact(1);
  e.recordCushionHit();
  e.endShot(createBalls());

  // Player 2's turn, table open - can hit stripe first
  e.beginShot(createBalls());
  e.recordFirstContact(11);
  e.recordBallPocketed(11);
  e.recordCushionHit();
  e.endShot(createBalls([11]));
  expect(e.player2Group).toBe(BALL_GROUP.STRIPES);
});

// ============================================
// Legal Shot Tests
// ============================================
console.log('\nLegal Shots:');

test('continues turn when pocketing own ball', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.beginShot(createBalls());
  e.recordFirstContact(1);
  e.recordBallPocketed(1);
  e.recordCushionHit();
  e.endShot(createBalls([1]));

  e.beginShot(createBalls([1]));
  e.recordFirstContact(2);
  e.recordBallPocketed(2);
  e.recordCushionHit();
  const r = e.endShot(createBalls([1, 2]));
  expect(r.continueTurn).toBe(true);
  expect(e.turn).toBe(1);
});

test('switches turn when missing own ball', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.beginShot(createBalls());
  e.recordFirstContact(1);
  e.recordBallPocketed(1);
  e.recordCushionHit();
  e.endShot(createBalls([1]));

  e.beginShot(createBalls([1]));
  e.recordFirstContact(2);
  e.recordCushionHit();
  const r = e.endShot(createBalls([1]));
  expect(r.switchTurn).toBe(true);
  expect(e.turn).toBe(2);
});

// ============================================
// Foul Tests
// ============================================
console.log('\nFouls:');

test('scratch - cue ball pocketed', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.beginShot(createBalls());
  e.recordFirstContact(1);
  e.recordBallPocketed(0);
  e.recordCushionHit();
  const r = e.endShot(createBalls([0]));
  expect(r.foul).toBe(FOUL.SCRATCH);
});

test('no ball hit - cue misses all', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.beginShot(createBalls());
  e.recordFirstContact(1);
  e.recordBallPocketed(1);
  e.recordCushionHit();
  e.endShot(createBalls([1]));

  e.beginShot(createBalls([1]));
  e.recordCushionHit();
  const r = e.endShot(createBalls([1]));
  expect(r.foul).toBe(FOUL.NO_BALL_HIT);
});

test('wrong ball first - hitting opponent ball', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.beginShot(createBalls());
  e.recordFirstContact(1);
  e.recordBallPocketed(1);
  e.recordCushionHit();
  e.endShot(createBalls([1]));

  e.beginShot(createBalls([1]));
  e.recordFirstContact(11); // Stripe - wrong!
  e.recordCushionHit();
  const r = e.endShot(createBalls([1]));
  expect(r.foul).toBe(FOUL.WRONG_BALL_FIRST);
});

test('no rail after hit - ball contacted but no rail/pocket', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.beginShot(createBalls());
  e.recordFirstContact(1);
  e.recordBallPocketed(1);
  e.recordCushionHit();
  e.endShot(createBalls([1]));

  e.beginShot(createBalls([1]));
  e.recordFirstContact(2);
  const r = e.endShot(createBalls([1]));
  expect(r.foul).toBe(FOUL.NO_RAIL_AFTER_HIT);
});

test('no foul when pocketing ball counts as rail', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.beginShot(createBalls());
  e.recordFirstContact(1);
  e.recordBallPocketed(1);
  e.recordCushionHit();
  e.endShot(createBalls([1]));

  e.beginShot(createBalls([1]));
  e.recordFirstContact(2);
  e.recordBallPocketed(2);
  const r = e.endShot(createBalls([1, 2]));
  expect(r.foul).toBe(FOUL.NONE);
});

// ============================================
// 8-Ball Tests
// ============================================
console.log('\n8-Ball Rules:');

test('win - legal 8-ball pocket after clearing solids', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.player1Group = BALL_GROUP.SOLIDS;
  e.player2Group = BALL_GROUP.STRIPES;
  e.tableOpen = false;
  e.turn = 1;

  const balls = createBalls([1, 2, 3, 4, 5, 6, 7]);
  e.beginShot(balls);
  e.recordFirstContact(8);
  e.recordBallPocketed(8);
  e.recordCushionHit();
  const r = e.endShot(createBalls([1, 2, 3, 4, 5, 6, 7, 8]));
  expect(r.shotResult).toBe(SHOT_RESULT.WIN);
  expect(r.winner).toBe(1);
});

test('lose - 8-ball pocketed before clearing solids', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  // Simulate game in progress (not break)
  e.player1Group = BALL_GROUP.SOLIDS;
  e.player2Group = BALL_GROUP.STRIPES;
  e.tableOpen = false;
  e.turn = 1;
  e.gameState = GAME_STATE.solids; // Set to solids state, not break

  const balls = createBalls([1, 2]); // Still has solids on table
  e.beginShot(balls);
  e.recordFirstContact(8);
  e.recordBallPocketed(8);
  e.recordCushionHit();
  const r = e.endShot(createBalls([1, 2, 8]));
  expect(r.shotResult).toBe(SHOT_RESULT.LOSE);
  expect(r.loser).toBe(1);
  expect(r.winner).toBe(2);
});

test('lose - scratch while pocketing 8-ball', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  // Simulate game in progress (not break)
  e.player1Group = BALL_GROUP.SOLIDS;
  e.player2Group = BALL_GROUP.STRIPES;
  e.tableOpen = false;
  e.turn = 1;
  e.gameState = GAME_STATE.solids; // Set to solids state, not break

  const balls = createBalls([1, 2, 3, 4, 5, 6, 7]);
  e.beginShot(balls);
  e.recordFirstContact(8);
  e.recordBallPocketed(0); // Scratch!
  e.recordBallPocketed(8);
  e.recordCushionHit();
  const r = e.endShot(createBalls([0, 1, 2, 3, 4, 5, 6, 7, 8]));
  expect(r.shotResult).toBe(SHOT_RESULT.LOSE);
  expect(r.foul).toBe(FOUL.EIGHT_BALL_SCRATCH);
});

test('must hit 8-ball first when shooting for 8', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  // Simulate game in progress (not break)
  e.player1Group = BALL_GROUP.SOLIDS;
  e.player2Group = BALL_GROUP.STRIPES;
  e.tableOpen = false;
  e.turn = 1;
  e.gameState = GAME_STATE.solids; // Set to solids state, not break

  const balls = createBalls([1, 2, 3, 4, 5, 6, 7]); // All solids cleared
  e.beginShot(balls);
  e.recordFirstContact(9); // Wrong - hit stripe first
  e.recordCushionHit();
  const r = e.endShot(createBalls([1, 2, 3, 4, 5, 6, 7]));
  expect(r.foul).toBe(FOUL.WRONG_BALL_FIRST);
});

// ============================================
// Turn Switching Tests
// ============================================
console.log('\nTurn Switching:');

test('foul switches turn', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.beginShot(createBalls());
  e.recordFirstContact(1);
  e.recordBallPocketed(1);
  e.recordCushionHit();
  e.endShot(createBalls([1]));

  e.beginShot(createBalls([1]));
  e.recordFirstContact(2);
  e.recordBallPocketed(0);
  e.recordCushionHit();
  e.endShot(createBalls([0, 1]));
  expect(e.turn).toBe(2);
});

test('pocketing own ball continues turn', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.beginShot(createBalls());
  e.recordFirstContact(1);
  e.recordBallPocketed(1);
  e.recordCushionHit();
  e.endShot(createBalls([1]));

  e.beginShot(createBalls([1]));
  e.recordFirstContact(2);
  e.recordBallPocketed(2);
  e.recordCushionHit();
  e.endShot(createBalls([1, 2]));
  expect(e.turn).toBe(1);
});

// ============================================
// Edge Cases
// ============================================
console.log('\nEdge Cases:');

test('multiple balls pocketed in one shot', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.beginShot(createBalls());
  e.recordFirstContact(1);
  e.recordBallPocketed(1);
  e.recordBallPocketed(2);
  e.recordBallPocketed(3);
  e.recordCushionHit();
  const r = e.endShot(createBalls([1, 2, 3]));
  expect(e.player1Group).toBe(BALL_GROUP.SOLIDS);
  expect(r.continueTurn).toBe(true);
});

test('scratch on break keeps table open', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.beginShot(createBalls());
  e.recordFirstContact(1);
  e.recordBallPocketed(1);
  e.recordBallPocketed(0);
  e.recordCushionHit();
  e.endShot(createBalls([0, 1]));
  // Standard rules: table stays open on scratch break
  expect(e.tableOpen).toBe(true);
  expect(e.player1Group).toBeNull();
});

test('shot count increments', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.beginShot(createBalls());
  e.recordFirstContact(1);
  e.recordCushionHit();
  e.endShot(createBalls());
  expect(e.shotCount).toBe(1);
});

test('turn history is recorded', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.beginShot(createBalls());
  e.recordFirstContact(1);
  e.recordBallPocketed(1);
  e.recordCushionHit();
  e.endShot(createBalls([1]));
  expect(e.getHistory().length).toBe(1);
});

test('state serialization works', () => {
  const e = new BilliardsRulesEngine();
  e.startBreak();
  e.player1Group = BALL_GROUP.SOLIDS;
  e.tableOpen = false;
  const state = e.getState();
  const e2 = new BilliardsRulesEngine();
  e2.loadState(state);
  expect(e2.player1Group).toBe(BALL_GROUP.SOLIDS);
  expect(e2.tableOpen).toBe(false);
});

// ============================================
// Results
// ============================================
console.log('\n========================================');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('========================================\n');

if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
  process.exit(1);
}
