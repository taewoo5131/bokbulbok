import type { Rng } from './rng';
import type { ItemKind, WeaponId } from './types';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  emoji: string;
  damage: number;
  color: string;
  desc: string;
  /** 스폰 가중치 (클수록 자주 등장) */
  weight: number;
}

/** 무기 밸런스는 여기서만 조정하면 됩니다. */
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  dagger: { id: 'dagger', name: '단검', emoji: '🗡️', damage: 3, color: '#cbd5e1', desc: '빠른 투사체 1발', weight: 3 },
  bow: { id: 'bow', name: '활', emoji: '🏹', damage: 4, color: '#facc15', desc: '아주 빠른 화살 1발', weight: 3 },
  bomb: { id: 'bomb', name: '폭탄', emoji: '💣', damage: 5, color: '#f97316', desc: '굴러가다 폭발, 범위 피해', weight: 2 },
  laser: { id: 'laser', name: '레이저', emoji: '⚡', damage: 3, color: '#22d3ee', desc: '직선상의 모든 원 관통', weight: 2 },
  hammer: { id: 'hammer', name: '망치', emoji: '🔨', damage: 6, color: '#a78bfa', desc: '근접 강타 + 넉백', weight: 2 },
  shotgun: { id: 'shotgun', name: '산탄', emoji: '🌀', damage: 2, color: '#4ade80', desc: '부채꼴로 5발', weight: 2 },
  meteor: { id: 'meteor', name: '운석', emoji: '☄️', damage: 8, color: '#ef4444', desc: '(희귀) 상대 위치에 1.5초 뒤 낙하, 범위 안 모두 피해 — 본인 포함!', weight: 0.5 },
};

/** 운석 관련 수치 */
export const METEOR = {
  radius: 95,
  /** 경고 표시 후 낙하까지 시간 */
  delay: 1.5,
  /** 한 경기에 등장할 수 있는 최대 횟수 */
  maxPerGame: 2,
};

export const WEAPON_LIST = Object.values(WEAPONS);

/** 체력 회복 아이템: 닿는 즉시 회복 (무기를 들고 있어도 습득, 체력이 가득 찬 원은 지나침) */
export const HEAL = {
  name: '회복',
  emoji: '❤️',
  color: '#f43f5e',
  amount: 3,
  /** 무기 대신 회복 아이템이 나올 확률 */
  chance: 0.15,
  /** 경기장에 동시에 존재할 수 있는 최대 개수 */
  maxOnField: 1,
  desc: '닿으면 즉시 체력 3 회복 (최대 10)',
};

/** 환각 아이템: 닿는 즉시 본체와 똑같은 분신 생성. 상대가 분신을 노리면 헛방 */
export const DECOY = {
  name: '환각',
  emoji: '👥',
  color: '#c084fc',
  /** 회복이 아닐 때 환각이 나올 확률 */
  chance: 0.1,
  maxOnField: 1,
  /** 한 번에 생기는 분신 수 */
  count: 2,
  /** 분신 지속 시간(초) */
  duration: 5,
  desc: '닿으면 가짜 분신 2개가 5초간 생김. 상대가 분신을 노리면 헛방',
};

export function itemVisual(kind: ItemKind): { emoji: string; color: string; name: string } {
  if (kind === 'heal') return HEAL;
  if (kind === 'decoy') return DECOY;
  return WEAPONS[kind];
}

export function pickWeapon(rng: Rng, exclude: WeaponId[] = []): WeaponId {
  const pool = WEAPON_LIST.filter((w) => !exclude.includes(w.id));
  const total = pool.reduce((s, w) => s + w.weight, 0);
  let roll = rng() * total;
  for (const w of pool) {
    roll -= w.weight;
    if (roll < 0) return w.id;
  }
  return pool[0].id;
}
