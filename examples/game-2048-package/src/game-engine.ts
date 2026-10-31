/**
 * Dependency-free, deterministic 2048 engine.
 *
 * Everything here is pure data in and out: no React, no timers and no
 * randomness outside the seeded generator. The component owns the document
 * runtime and local UI state; the engine owns the rules. That split keeps
 * SSR, static rendering and hydration reproducible.
 */

export type Direction2048 = 'left' | 'right' | 'up' | 'down';
export type Game2048Status = 'playing' | 'won' | 'over';

export interface Cell2048 {
  readonly row: number;
  readonly column: number;
}

export interface Game2048Options {
  readonly size: number;
  readonly seed: number;
  readonly target: number;
}

export interface Game2048State {
  readonly size: number;
  readonly seed: number;
  readonly target: number;
  /** Row-major values; `0` means an empty cell. */
  readonly board: readonly (readonly number[])[];
  readonly score: number;
  readonly moves: number;
  readonly status: Game2048Status;
  readonly rng: number;
  /** Cells that received a new tile during the last action. */
  readonly spawned: readonly Cell2048[];
  /** Cells where two tiles merged during the last action. */
  readonly merged: readonly Cell2048[];
}

const TWO_PROBABILITY = 0.9;
const DIRECTIONS: readonly Direction2048[] = ['left', 'right', 'up', 'down'];

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

function emptyBoard(size: number): number[][] {
  return Array.from({ length: size }, () => Array<number>(size).fill(0));
}

function cloneBoard(board: readonly (readonly number[])[]): number[][] {
  return board.map((row) => [...row]);
}

function sameBoard(a: readonly (readonly number[])[], b: readonly (readonly number[])[]): boolean {
  return a.every((row, y) => row.every((cell, x) => cell === b[y][x]));
}

/** Coordinates of one line in traversal order: far edge first. */
function lineCoordinates(size: number, direction: Direction2048, index: number): Cell2048[] {
  const coordinates: Cell2048[] = [];
  for (let offset = 0; offset < size; offset += 1) {
    if (direction === 'left') coordinates.push({ row: index, column: offset });
    else if (direction === 'right') coordinates.push({ row: index, column: size - 1 - offset });
    else if (direction === 'up') coordinates.push({ row: offset, column: index });
    else coordinates.push({ row: size - 1 - offset, column: index });
  }
  return coordinates;
}

interface CollapsedLine {
  readonly values: number[];
  readonly score: number;
  readonly mergedAt: number[];
}

/** Collapse one line toward its far edge, merging each tile at most once. */
function collapseLine(values: readonly number[]): CollapsedLine {
  const tiles = values
    .filter((value) => value !== 0)
    .map((value) => ({ value, merged: false }));
  const collapsed: { value: number; merged: boolean }[] = [];
  const mergedAt: number[] = [];
  let score = 0;
  for (const tile of tiles) {
    const previous = collapsed[collapsed.length - 1];
    if (previous && previous.value === tile.value && !previous.merged) {
      previous.value *= 2;
      previous.merged = true;
      score += previous.value;
      mergedAt.push(collapsed.length - 1);
    } else {
      collapsed.push({ value: tile.value, merged: false });
    }
  }
  const result = collapsed.map((tile) => tile.value);
  while (result.length < values.length) result.push(0);
  return { values: result, score, mergedAt };
}

/** True when at least one direction would change the board. */
export function canMove(board: readonly (readonly number[])[]): boolean {
  const size = board.length;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (board[y][x] === 0) return true;
      if (x + 1 < size && board[y][x] === board[y][x + 1]) return true;
      if (y + 1 < size && board[y][x] === board[y + 1][x]) return true;
    }
  }
  return false;
}

function addRandomTile(
  board: number[][],
  size: number,
  rng: number,
): { board: number[][]; rng: number; cell: Cell2048 | null } {
  const empties: Cell2048[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (board[y][x] === 0) empties.push({ row: y, column: x });
    }
  }
  if (empties.length === 0) return { board, rng, cell: null };
  const index = nextRandom(rng);
  const pick = empties[Math.floor(index.value * empties.length)];
  const value = nextRandom(index.state);
  board[pick.row][pick.column] = value.value < TWO_PROBABILITY ? 2 : 4;
  return { board, rng: value.state, cell: pick };
}

function highestTile(board: readonly (readonly number[])[]): number {
  let highest = 0;
  for (const row of board) for (const cell of row) highest = Math.max(highest, cell);
  return highest;
}

/** Create a fresh game with two starting tiles. */
export function createGameState(options: Game2048Options): Game2048State {
  const size = clampInteger(options.size, 3, 6, 4);
  const target = clampInteger(options.target, 8, 131072, 2048);
  const seed = clampInteger(options.seed, 0, 99999, 7);
  const board = emptyBoard(size);
  const first = addRandomTile(board, size, seed);
  const second = addRandomTile(first.board, size, first.rng);
  const spawned = [first.cell, second.cell].filter((cell): cell is Cell2048 => cell !== null);
  const status: Game2048Status = highestTile(board) >= target ? 'won' : canMove(board) ? 'playing' : 'over';
  return {
    size,
    seed,
    target,
    board,
    score: 0,
    moves: 0,
    status,
    rng: second.rng,
    spawned,
    merged: [],
  };
}

/**
 * Apply one move. An unchanged move returns the same state object, which
 * makes it cheap for components and tests to detect invalid input.
 */
export function move(state: Game2048State, direction: Direction2048): Game2048State {
  if (state.status === 'over' || !DIRECTIONS.includes(direction)) return state;
  const { size } = state;
  const board = cloneBoard(state.board);
  const merged: Cell2048[] = [];
  let score = 0;

  for (let index = 0; index < size; index += 1) {
    const coordinates = lineCoordinates(size, direction, index);
    const values = coordinates.map(({ row, column }) => state.board[row][column]);
    const collapsed = collapseLine(values);
    score += collapsed.score;
    for (const position of collapsed.mergedAt) {
      merged.push(coordinates[position]);
    }
    coordinates.forEach(({ row, column }, position) => {
      board[row][column] = collapsed.values[position];
    });
  }

  if (sameBoard(state.board, board)) return state;

  const spawnedTile = addRandomTile(board, size, state.rng);
  const reachedTarget = highestTile(board) >= state.target;
  let status: Game2048Status;
  if (!canMove(board)) status = 'over';
  else if (reachedTarget || state.status === 'won') status = 'won';
  else status = 'playing';

  return {
    ...state,
    board,
    score: state.score + score,
    moves: state.moves + 1,
    status,
    rng: spawnedTile.rng,
    spawned: spawnedTile.cell ? [spawnedTile.cell] : [],
    merged,
  };
}

/** Restart with the same size, target and seed. */
export function restart(state: Game2048State): Game2048State {
  return createGameState({ size: state.size, seed: state.seed, target: state.target });
}

/** Data attribute friendly label for a tile value. */
export function tileTier(value: number): string {
  return value === 0 ? 'empty' : value > 2048 ? 'super' : String(value);
}
