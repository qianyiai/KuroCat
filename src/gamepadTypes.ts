export interface GamepadInputState {
  active?: boolean;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  lt: number;
  rt: number;
  buttons: number;
}

export const GAMEPAD_BTN = {
  A: 1 << 0,
  B: 1 << 1,
  X: 1 << 2,
  Y: 1 << 3,
  LB: 1 << 4,
  RB: 1 << 5,
  UP: 1 << 6,
  DOWN: 1 << 7,
  LEFT: 1 << 8,
  RIGHT: 1 << 9,
  START: 1 << 10,
  BACK: 1 << 11,
} as const;
