export type WeaponId = 'dagger' | 'bow' | 'bomb' | 'laser' | 'hammer' | 'shotgun';
export type Mode = 'winner' | 'loser';

export interface Ball {
  id: number;
  name: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  alive: boolean;
  /** 들고 있는 무기 (습득 후 CHARGE_TIME 뒤 발사) */
  weapon: WeaponId | null;
  charge: number;
  /** 피격 시 하얗게 번쩍이는 남은 시간 */
  flash: number;
  /** 서든데스 벽 피해 쿨다운 */
  wallCd: number;
}

export type ItemKind = WeaponId | 'heal';

export interface Item {
  id: number;
  x: number;
  y: number;
  kind: ItemKind;
  age: number;
}

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  owner: number;
  weapon: WeaponId;
  damage: number;
  life: number;
  hit: Set<number>;
}

interface EffectBase {
  t: number;
  life: number;
  color: string;
}

export type Effect =
  | (EffectBase & { kind: 'text'; x: number; y: number; text: string })
  | (EffectBase & { kind: 'ring'; x: number; y: number; radius: number })
  | (EffectBase & { kind: 'beam'; x1: number; y1: number; x2: number; y2: number })
  | (EffectBase & { kind: 'arc'; x: number; y: number; angle: number; radius: number; spread: number });

export interface GameResult {
  mode: Mode;
  picked: Ball;
  /** 1등 → 꼴등 순서 */
  ranking: Ball[];
}
