import type { KeyboardLayoutDef, KeySpec } from './keyboardLayout';

// Match the Rust input boundary. Outside the standard VK range, like numpad Enter.
export const VK_MAC_FN = 0x13f;

type Cap = [id: string, legend: string, vk: number | number[], width?: number];
const letters = (row: string): Cap[] =>
  [...row].map((letter) => [letter.toLowerCase(), letter, letter.charCodeAt(0)]);

const modifierBubbles: Record<string, string> = {
  command: '⌘',
  option: '⌥',
  control: '⌃',
  'caps lock': '⇪',
};

function row(index: number, caps: Cap[]): KeySpec[] {
  let start = 0;
  return caps.map(([id, label, vk, uWidth = 1]) => {
    const key: KeySpec = {
      id,
      label,
      bubble: modifierBubbles[label] ?? (label || 'Space'),
      row: index,
      uStart: start,
      uWidth,
      vkCodes: Array.isArray(vk) ? vk : [vk],
    };
    start += uWidth;
    return key;
  });
}

const functionKeys: Cap[] = Array.from({ length: 12 }, (_, index) => {
  // Consumer media VKs are aliases only when the input source actually delivers one.
  const media = [0xb1, 0xb3, 0xb0, 0xad, 0xae, 0xaf];
  const codes = [0x70 + index];
  codes.push(index < 6 ? 0x140 + index : media[index - 6]);
  return [`f${index + 1}`, `F${index + 1}`, codes, 13.5 / 13];
});

export const MACBOOK_LAYOUT: KeyboardLayoutDef = {
  id: 'macbook',
  totalUnits: 15,
  totalRows: 6,
  keys: [
    ...row(0, [['esc', 'esc', 0x1b, 1.5], ...functionKeys, ['touchid', 'Touch ID', [], 13.5 / 13]]),
    ...row(1, [
      ['grave', '`', 0xc0],
      ...letters('1234567890'),
      ['minus', '-', 0xbd],
      ['equal', '=', 0xbb],
      ['bs', '⌫', 8, 2],
    ]),
    ...row(2, [
      ['tab', 'tab', 9, 1.5],
      ...letters('QWERTYUIOP'),
      ['lb', '[', 0xdb],
      ['rb', ']', 0xdd],
      ['bslash', '\\', 0xdc, 1.5],
    ]),
    ...row(3, [
      ['caps', 'caps lock', 0x14, 1.75],
      ...letters('ASDFGHJKL'),
      ['semi', ';', 0xba],
      ['quote', "'", 0xde],
      ['enter', '↩︎', [0x0d, 0x10d], 2.25],
    ]),
    ...row(4, [
      ['lshift', '⇧', [0xa0, 0x10], 2.25],
      ...letters('ZXCVBNM'),
      ['comma', ',', 0xbc],
      ['dot', '.', 0xbe],
      ['slash', '/', 0xbf],
      ['rshift', '⇧', 0xa1, 2.75],
    ]),
    ...row(5, [
      ['fn', 'fn', VK_MAC_FN],
      ['lctrl', 'control', [0xa2, 0x11, 0xa3]],
      ['loption', 'option', [0xa4, 0x12]],
      ['lcommand', 'command', 0x5b, 1.25],
      ['space', '', 0x20, 5.5],
      ['rcommand', 'command', 0x5c, 1.25],
      ['roption', 'option', 0xa5],
      ['left', '←', 0x25],
    ]),
    { id: 'up', label: '↑', bubble: '↑', row: 5, rowSpan: 0.5, uStart: 13, uWidth: 1, vkCodes: [0x26] },
    { id: 'down', label: '↓', bubble: '↓', row: 5, rowY: 5.5, rowSpan: 0.5, uStart: 13, uWidth: 1, vkCodes: [0x28] },
    { id: 'right', label: '→', bubble: '→', row: 5, uStart: 14, uWidth: 1, vkCodes: [0x27] },
  ],
};
