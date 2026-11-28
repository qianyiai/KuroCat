export type TreatFlavor = 'tuna' | 'chicken' | 'salmon' | 'bonito';

export type TreatPhase =
  | 'idle'
  | 'tracking'
  | 'approach'
  | 'licking'
  | 'impatient'
  | 'afterglow';

export interface TreatFlavorSpec {
  id: TreatFlavor;
  name: string;
  shortName: string;
  labelEn: string;
  icon: string;
  /** Warm matte ivory/cream upper-pouch tone */
  pouchBase: string;
  /** Natural muted gourmet packaging primary tone */
  tubePrimary: string;
  tubeDark: string;
  tubeLight: string;
  /** Refined brushed champagne-gold / accent trim */
  stripeColor: string;
  /** Natural appetizing meat-puree paste tones */
  pureeColor: string;
  pureeSpeck: string;
  pureeHighlight: string;
}

export interface TreatStatusSnapshot {
  active: boolean;
  phase: TreatPhase;
  /** Remaining puree amount from 1.0 (full) to 0.0 (empty). */
  amount: number;
  flavor: TreatFlavor;
  fedCount: number;
  autoDemo: boolean;
}

export const TREAT_FLAVORS: Record<TreatFlavor, TreatFlavorSpec> = {
  tuna: {
    id: 'tuna',
    name: '金枪鱼猫条',
    shortName: '金枪鱼',
    labelEn: 'MAGURO',
    icon: '🐟',
    pouchBase: '#f5efe4',
    tubePrimary: '#bf4c54',
    tubeDark: '#872f37',
    tubeLight: '#e39ca0',
    stripeColor: '#d4b072',
    pureeColor: '#dbb592',
    pureeSpeck: '#be916c',
    pureeHighlight: '#f4dfc9',
  },
  chicken: {
    id: 'chicken',
    name: '鲜鸡肉猫条',
    shortName: '鲜鸡肉',
    labelEn: 'SASAMI',
    icon: '🍗',
    pouchBase: '#f7f2e7',
    tubePrimary: '#cc853b',
    tubeDark: '#91571e',
    tubeLight: '#e9c08e',
    stripeColor: '#d8b97c',
    pureeColor: '#e6cca6',
    pureeSpeck: '#c8aa7f',
    pureeHighlight: '#faf0db',
  },
  salmon: {
    id: 'salmon',
    name: '三文鱼猫条',
    shortName: '三文鱼',
    labelEn: 'SALMON',
    icon: '🍣',
    pouchBase: '#f6efe9',
    tubePrimary: '#cf776e',
    tubeDark: '#974a42',
    tubeLight: '#ebbcb6',
    stripeColor: '#dbb884',
    pureeColor: '#e4b79a',
    pureeSpeck: '#c79374',
    pureeHighlight: '#f9e4d4',
  },
  bonito: {
    id: 'bonito',
    name: '海盐鲣鱼猫条',
    shortName: '海盐鲣鱼',
    labelEn: 'KATSUO',
    icon: '🌊',
    pouchBase: '#f1f2ee',
    tubePrimary: '#4d7c9e',
    tubeDark: '#2f5370',
    tubeLight: '#97bad4',
    stripeColor: '#c9b385',
    pureeColor: '#d8bc9a',
    pureeSpeck: '#b89874',
    pureeHighlight: '#f2e4d1',
  },
};

export const TREAT_FLAVOR_LIST: readonly TreatFlavorSpec[] = [
  TREAT_FLAVORS.tuna,
  TREAT_FLAVORS.chicken,
  TREAT_FLAVORS.salmon,
  TREAT_FLAVORS.bonito,
];
