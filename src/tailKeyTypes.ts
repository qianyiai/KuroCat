export type KeyboardOrientation = 'cat' | 'viewer';
export type TailKeyMode = 'smart' | 'custom' | 'edge' | 'off';

export const DEFAULT_TAIL_KEY_IDS: readonly string[] = ['enter', 'space', 'bs', 'esc'];

export const TAIL_KEY_PRESETS = {
  office: {
    label: '回车空格',
    ids: ['enter', 'space', 'bs', 'esc'] as readonly string[],
  },
  rightFn: {
    label: '方向/小键盘',
    ids: [
      'up', 'down', 'left', 'right', 'enter', 'bs', 'rshift',
      'ins', 'home', 'pgup', 'del', 'end', 'pgdn',
      'numlk', 'np_div', 'np_mul', 'np_sub', 'np_add', 'np_ent', 'np_dot',
      'np_0', 'np_1', 'np_2', 'np_3', 'np_4', 'np_5', 'np_6', 'np_7', 'np_8', 'np_9',
    ] as readonly string[],
  },
  edgeMods: {
    label: '外侧功能键',
    ids: ['esc', 'tab', 'caps', 'lshift', 'lctrl', 'rshift', 'enter', 'bs'] as readonly string[],
  },
} as const;
