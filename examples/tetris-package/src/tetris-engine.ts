/**
 * Dependency-free, deterministic Tetris engine.
 *
 * Everything here is pure data in and data out: no React, no timers, no
 * randomness outside the seeded bag. The component owns the clock and the
 * document runtime; the engine owns the rules. That split keeps SSR and
 * hydration reproducible.
 */

export const TETRIS_PIECES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;
export type TetrisPiece = (typeof TETRIS_PIECES)[number];
export type TetrisCell = TetrisPiece | null;
export type TetrisStatus = 'playing' | 'paused' | 'over';

export interface TetrisOptions {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
}

export interface ActivePiece {
  readonly type: TetrisPiece;
  readonly rotation: number;
  readonly x: number;
  readonly y: number;
}

export interface TetrisState {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly board: readonly (readonly TetrisCell[])[];
  readonly active: ActivePiece | null;
  readonly queue: readonly TetrisPiece[];
  readonly rng: number;
  readonly score: number;
  readonly lines: number;
  readonly level: number;
  readonly moves: number;
  readonly status: TetrisStatus;
}

type Matrix = readonly (readonly number[])[];

const BASE_SHAPES: Record<TetrisPiece, Matrix> = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
};

const LINE_SCORES = [0, 100, 300, 500, 800] as const;
const KICKS = [0, -1, 1, -2, 2] as const;

function rotateMatrix(matrix: Matrix): Matrix {
  const size = matrix.length;
  return matrix.map((_, row) =>
    matrix.map((_, column) => matrix[size - 1 - column][row]),
  );
}

function rotationsOf(matrix: Matrix): readonly Matrix[] {
  const rotations: Matrix[] = [matrix];
  for (let index = 1; index < 4; index += 1) {
    rotations.push(rotateMatrix(rotations[index - 1]));
  }
  return rotations;
}

const ROTATIONS: Record<TetrisPiece, readonly Matrix[]> = {
  I: rotationsOf(BASE_SHAPES.I),
  O: rotationsOf(BASE_SHAPES.O),
  T: rotationsOf(BASE_SHAPES.T),
  S: rotationsOf(BASE_SHAPES.S),
  Z: rotationsOf(BASE_SHAPES.Z),
  J: rotationsOf(BASE_SHAPES.J),
  L: rotationsOf(BASE_SHAPES.L),
};

function clampInteger(value: number, minimum: number, maximum: number, fallback: number): number {
  const normalized = Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(minimum, Math.min(maximum, normalized));
}

/** Mulberry32: tiny seeded PRNG; the state is one 32-bit integer. */
function nextRandom(state: number): { value: number; state: number } {
  const next = (state + 0x6d2b79f5) >>> 0;
  let mixed = Math.imul(next ^ (next >>> 15), next | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return {
    value: ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296,
    state: next,
  };
}

function shuffledBag(state: number): { pieces: TetrisPiece[]; state: number } {
  const pieces: TetrisPiece[] = [...TETRIS_PIECES];
  let current = state;
  for (let index = pieces.length - 1; index > 0; index -= 1) {
    const random = nextRandom(current);
    current = random.state;
    const target = Math.floor(random.value * (index + 1));
    const swap = pieces[index];
    pieces[index] = pieces[target];
    pieces[target] = swap;
  }
  return { pieces, state: current };
}

function emptyBoard(width: number, height: number): TetrisCell[][] {
  return Array.from({ length: height }, () => Array<TetrisCell>(width).fill(null));
}

function matrixFor(piece: ActivePiece): Matrix {
  return ROTATIONS[piece.type][piece.rotation % 4];
}

function collides(
  board: readonly (readonly TetrisCell[])[],
  width: number,
  height: number,
  piece: ActivePiece,
): boolean {
  const matrix = matrixFor(piece);
  for (let row = 0; row < matrix.length; row += 1) {
    for (let column = 0; column < matrix[row].length; column += 1) {
      if (matrix[row][column] === 0) continue;
      const x = piece.x + column;
      const y = piece.y + row;
      if (x < 0 || x >= width || y >= height) return true;
      if (y >= 0 && board[y][x] !== null) return true;
    }
  }
  return false;
}

function spawn(state: TetrisState): TetrisState {
  let queue = [...state.queue];
  let rng = state.rng;
  while (queue.length < 5) {
    const bag = shuffledBag(rng);
    queue = [...queue, ...bag.pieces];
    rng = bag.state;
  }
  const [type, ...rest] = queue;
  const matrix = ROTATIONS[type][0];
  const active: ActivePiece = {
    type,
    rotation: 0,
    x: Math.floor((state.width - matrix.length) / 2),
    y: 0,
  };
  const next: TetrisState = { ...state, active, queue: rest, rng };
  if (collides(state.board, state.width, state.height, active)) {
    return { ...next, active: null, status: 'over' };
  }
  return next;
}

function clearLines(board: TetrisCell[][]): { board: TetrisCell[][]; lines: number } {
  const remaining = board.filter((row) => row.some((cell) => cell === null));
  const lines = board.length - remaining.length;
  if (lines === 0) return { board, lines };
  const empty = Array.from({ length: lines }, () => Array<TetrisCell>(board[0].length).fill(null));
  return { board: [...empty, ...remaining], lines };
}

function lock(state: TetrisState): TetrisState {
  if (!state.active) return state;
  const board = state.board.map((row) => [...row]);
  const matrix = matrixFor(state.active);
  for (let row = 0; row < matrix.length; row += 1) {
    for (let column = 0; column < matrix[row].length; column += 1) {
      if (matrix[row][column] === 0) continue;
      const y = state.active.y + row;
      const x = state.active.x + column;
      if (y >= 0 && y < state.height) board[y][x] = state.active.type;
    }
  }
  const cleared = clearLines(board);
  const lines = state.lines + cleared.lines;
  const level = 1 + Math.floor(lines / 10);
  const score = state.score + (LINE_SCORES[cleared.lines] ?? 0) * state.level;
  return spawn({ ...state, board: cleared.board, active: null, lines, level, score });
}

export function createTetrisState(options: TetrisOptions): TetrisState {
  const width = clampInteger(options.width, 6, 14, 10);
  const height = clampInteger(options.height, 12, 24, 20);
  const seed = clampInteger(options.seed, 0, 99999, 7);
  const bag = shuffledBag(seed);
  return spawn({
    width,
    height,
    seed,
    board: emptyBoard(width, height),
    active: null,
    queue: bag.pieces,
    rng: bag.state,
    score: 0,
    lines: 0,
    level: 1,
    moves: 0,
    status: 'playing',
  });
}

/** One gravity step: move down, or lock the piece and spawn the next one. */
export function tick(state: TetrisState): TetrisState {
  if (state.status !== 'playing' || !state.active) return state;
  const moved: ActivePiece = { ...state.active, y: state.active.y + 1 };
  if (!collides(state.board, state.width, state.height, moved)) {
    return { ...state, active: moved };
  }
  return lock(state);
}

export function softDrop(state: TetrisState): TetrisState {
  if (state.status !== 'playing' || !state.active) return state;
  const moved: ActivePiece = { ...state.active, y: state.active.y + 1 };
  if (!collides(state.board, state.width, state.height, moved)) {
    return { ...state, active: moved, moves: state.moves + 1, score: state.score + 1 };
  }
  return { ...lock(state), moves: state.moves + 1 };
}

export function shift(state: TetrisState, direction: -1 | 1): TetrisState {
  if (state.status !== 'playing' || !state.active) return state;
  const moved: ActivePiece = { ...state.active, x: state.active.x + direction };
  if (collides(state.board, state.width, state.height, moved)) return state;
  return { ...state, active: moved, moves: state.moves + 1 };
}

export function rotate(state: TetrisState): TetrisState {
  if (state.status !== 'playing' || !state.active) return state;
  const rotation = (state.active.rotation + 1) % 4;
  for (const offset of KICKS) {
    const candidate: ActivePiece = { ...state.active, rotation, x: state.active.x + offset };
    if (!collides(state.board, state.width, state.height, candidate)) {
      return { ...state, active: candidate, moves: state.moves + 1 };
    }
  }
  return state;
}

export function hardDrop(state: TetrisState): TetrisState {
  if (state.status !== 'playing' || !state.active) return state;
  let active = state.active;
  let distance = 0;
  while (!collides(state.board, state.width, state.height, { ...active, y: active.y + 1 })) {
    active = { ...active, y: active.y + 1 };
    distance += 1;
  }
  const dropped: TetrisState = {
    ...state,
    active,
    moves: state.moves + 1,
    score: state.score + distance * 2,
  };
  return lock(dropped);
}

export function togglePause(state: TetrisState): TetrisState {
  if (state.status === 'over') return state;
  return { ...state, status: state.status === 'playing' ? 'paused' : 'playing' };
}

export function restart(state: TetrisState): TetrisState {
  return createTetrisState({ width: state.width, height: state.height, seed: state.seed });
}

/** Board plus the active piece, ready for rendering and for tests. */
export function renderBoard(state: TetrisState): readonly (readonly TetrisCell[])[] {
  const board = state.board.map((row) => [...row]);
  if (state.active) {
    const matrix = matrixFor(state.active);
    for (let row = 0; row < matrix.length; row += 1) {
      for (let column = 0; column < matrix[row].length; column += 1) {
        if (matrix[row][column] === 0) continue;
        const y = state.active.y + row;
        const x = state.active.x + column;
        if (y >= 0 && y < state.height && x >= 0 && x < state.width) {
          board[y][x] = state.active.type;
        }
      }
    }
  }
  return board;
}

/** Shape cells of the next pieces, for the preview panel. */
export function previewCells(piece: TetrisPiece): readonly (readonly boolean[])[] {
  return ROTATIONS[piece][0].map((row) => row.map((cell) => cell === 1));
}
