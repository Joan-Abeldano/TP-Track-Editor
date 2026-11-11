import { RecipeSegment } from '../recipe/recipe.types';

export interface Vec2 {
  x: number;
  y: number;
}

export interface LoopClosure {
  turnsDeg: number[];
  error: number;
  maxCorrectionDeg: number;
}

export interface PolylineOptions {
  stepM?: number;
  maxAngleDeg?: number;
}

export function integrate(
  segments: readonly Pick<RecipeSegment, 'length'>[],
  turnsDeg: readonly number[],
): { x: number; y: number; heading: number } {
  let x = 0;
  let y = 0;
  let heading = 0;
  const count = Math.min(segments.length, turnsDeg.length);

  for (let i = 0; i < count; i++) {
    const length = segments[i].length;
    const turn = (turnsDeg[i] * Math.PI) / 180;

    if (Math.abs(turn) < 1e-9) {
      x += length * Math.cos(heading);
      y += length * Math.sin(heading);
      continue;
    }

    const radius = length / Math.abs(turn);
    const sign = Math.sign(turn);
    const centerX = x - sign * radius * Math.sin(heading);
    const centerY = y + sign * radius * Math.cos(heading);
    const nextHeading = heading + turn;

    x = centerX + sign * radius * Math.sin(nextHeading);
    y = centerY - sign * radius * Math.cos(nextHeading);
    heading = nextHeading;
  }

  return { x, y, heading };
}

export function closeLoop(
  segments: readonly RecipeSegment[],
  initialTurnsDeg: readonly number[],
  options: { maxIterations?: number; tolerance?: number } = {},
): LoopClosure {
  const maxIterations = options.maxIterations ?? 30;
  const tolerance = options.tolerance ?? 0.20;

  const turns = initialTurnsDeg.slice();
  const count = turns.length;
  const targetTurn = turns.reduce((sum, value) => sum + value, 0);
  if (count === 0) return { turnsDeg: turns, error: 0, maxCorrectionDeg: 0 };

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const position = integrate(segments, turns);
    if (Math.hypot(position.x, position.y) < tolerance) break;

    const epsilon = 0.01;
    const jacobianX: number[] = [];
    const jacobianY: number[] = [];
    for (let i = 0; i < count; i++) {
      const probe = turns.slice();
      probe[i] += epsilon;
      const moved = integrate(segments, probe);
      jacobianX.push((moved.x - position.x) / epsilon);
      jacobianY.push((moved.y - position.y) / epsilon);
    }

    const rows = [jacobianX, jacobianY, new Array<number>(count).fill(1)];
    const deltas = minNormSolve(rows, [-position.x, -position.y, 0], 1e-6);

    for (let i = 0; i < count; i++) {
      const delta = Math.max(-6, Math.min(6, deltas[i]));
      turns[i] += delta * 0.85;
    }

    const currentTurn = turns.reduce((sum, value) => sum + value, 0);
    const correction = (targetTurn - currentTurn) / count;
    for (let i = 0; i < count; i++) turns[i] += correction;
  }

  const final = integrate(segments, turns);
  let maxCorrectionDeg = 0;
  for (let i = 0; i < count; i++) {
    maxCorrectionDeg = Math.max(maxCorrectionDeg, Math.abs(turns[i] - initialTurnsDeg[i]));
  }

  return {
    turnsDeg: turns,
    error: Math.hypot(final.x, final.y),
    maxCorrectionDeg,
  };
}

export function buildPolyline(
  segments: readonly RecipeSegment[],
  turnsDeg: readonly number[],
  options: PolylineOptions = {},
): Vec2[] {
  const stepM = options.stepM ?? 20;
  const maxAngleDeg = options.maxAngleDeg ?? 9;
  const points: Vec2[] = [];

  const push = (x: number, y: number) => {
    const last = points[points.length - 1];
    if (!last || Math.hypot(last.x - x, last.y - y) > 1e-6) points.push({ x, y });
  };

  let x = 0;
  let y = 0;
  let heading = 0;
  push(x, y);

  for (let i = 0; i < segments.length; i++) {
    const length = segments[i].length;
    const turn = (turnsDeg[i] * Math.PI) / 180;
    const startX = x;
    const startY = y;

    if (Math.abs(turn) < 1e-9) {
      const steps = Math.max(1, Math.ceil(length / stepM));
      for (let k = 1; k <= steps; k++) {
        push(startX + (length * k * Math.cos(heading)) / steps, startY + (length * k * Math.sin(heading)) / steps);
      }
      x = startX + length * Math.cos(heading);
      y = startY + length * Math.sin(heading);
      continue;
    }

    const radius = length / Math.abs(turn);
    const sign = Math.sign(turn);
    const centerX = startX - sign * radius * Math.sin(heading);
    const centerY = startY + sign * radius * Math.cos(heading);
    const steps = Math.max(
      2,
      Math.ceil(length / stepM),
      Math.ceil((Math.abs(turnsDeg[i]) / maxAngleDeg)),
    );

    for (let k = 1; k <= steps; k++) {
      const angle = heading + (turn * k) / steps;
      push(centerX + sign * radius * Math.sin(angle), centerY - sign * radius * Math.cos(angle));
    }

    const endHeading = heading + turn;
    x = centerX + sign * radius * Math.sin(endHeading);
    y = centerY - sign * radius * Math.cos(endHeading);
    heading = endHeading;
  }

  return points;
}

function minNormSolve(rows: number[][], rhs: number[], lambda: number): number[] {
  const count = rows[0]?.length ?? 0;
  if (count === 0) return [];

  const gram: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < count; k++) sum += rows[i][k] * rows[j][k];
      gram[i][j] = sum + (i === j ? lambda : 0);
    }
  }

  const y = solve3(gram, rhs);
  const deltas = new Array<number>(count).fill(0);
  for (let k = 0; k < count; k++) {
    deltas[k] = rows[0][k] * y[0] + rows[1][k] * y[1] + rows[2][k] * y[2];
  }
  return deltas;
}

function solve3(matrix: number[][], rhs: number[]): number[] {
  const m = matrix.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return [0, 0, 0];
    [m[col], m[pivot]] = [m[pivot], m[col]];

    for (let row = col + 1; row < 3; row++) {
      const factor = m[row][col] / m[col][col];
      for (let c = col; c < 4; c++) m[row][c] -= factor * m[col][c];
    }
  }

  const out = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let sum = m[i][3];
    for (let j = i + 1; j < 3; j++) sum -= m[i][j] * out[j];
    out[i] = sum / m[i][i];
  }
  return out;
}
