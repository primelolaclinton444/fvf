/**
 * Byte-identical Deno port of lib/connect4/engine.ts. Keep in sync with the
 * client copy. See note in _shared/prng.ts.
 */

export const CONNECT4_COLS = 7;
export const CONNECT4_ROWS = 6;
export const CONNECT4_CELLS = CONNECT4_COLS * CONNECT4_ROWS;

export type Connect4Cell = 0 | 1 | 2;
export type Connect4Board = Connect4Cell[];
export type Connect4Player = 1 | 2;
export type MoveValidationError = "OUT_OF_RANGE" | "INVALID_BOARD" | "COLUMN_FULL";

export function createEmptyBoard(): Connect4Board {
  return Array.from({ length: CONNECT4_CELLS }, () => 0 as Connect4Cell);
}

function index(col: number, row: number): number {
  return row * CONNECT4_COLS + col;
}

function assertBoard(board: Connect4Board) {
  if (
    !Array.isArray(board) ||
    board.length !== CONNECT4_CELLS ||
    board.some((c) => c !== 0 && c !== 1 && c !== 2)
  ) {
    throw new Error("INVALID_BOARD");
  }
}

export function validateMove(board: Connect4Board, col: number): MoveValidationError | null {
  if (col < 0 || col >= CONNECT4_COLS || !Number.isInteger(col)) return "OUT_OF_RANGE";
  assertBoard(board);
  const top = board[index(col, CONNECT4_ROWS - 1)];
  if (top !== 0) return "COLUMN_FULL";
  return null;
}

export function applyMove(board: Connect4Board, col: number, player: Connect4Player): { board: Connect4Board; row: number } {
  const err = validateMove(board, col);
  if (err) throw new Error(err);
  const next = board.slice() as Connect4Board;
  for (let row = 0; row < CONNECT4_ROWS; row++) {
    const i = index(col, row);
    if (next[i] === 0) {
      next[i] = player;
      return { board: next, row };
    }
  }
  throw new Error("COLUMN_FULL");
}

export function isDraw(board: Connect4Board): boolean {
  assertBoard(board);
  return board.every((c) => c !== 0);
}

export function detectWinner(board: Connect4Board): Connect4Player | null {
  assertBoard(board);
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let c = 0; c < CONNECT4_COLS; c++) {
    for (let r = 0; r < CONNECT4_ROWS; r++) {
      const p = board[index(c, r)];
      if (p === 0) continue;
      for (const [dc, dr] of dirs) {
        let ok = true;
        for (let k = 1; k < 4; k++) {
          const cc = c + dc * k;
          const rr = r + dr * k;
          if (cc < 0 || cc >= CONNECT4_COLS || rr < 0 || rr >= CONNECT4_ROWS || board[index(cc, rr)] !== p) {
            ok = false; break;
          }
        }
        if (ok) return p as Connect4Player;
      }
    }
  }
  return null;
}
