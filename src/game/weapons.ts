import type { Rng } from './rng';
import type { WeaponId } from './types';

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
};

export const WEAPON_LIST = Object.values(WEAPONS);

const TOTAL_WEIGHT = WEAPON_LIST.reduce((s, w) => s + w.weight, 0);

export function pickWeapon(rng: Rng): WeaponId {
  let roll = rng() * TOTAL_WEIGHT;
  for (const w of WEAPON_LIST) {
    roll -= w.weight;
    if (roll < 0) return w.id;
  }
  return WEAPON_LIST[0].id;
}
