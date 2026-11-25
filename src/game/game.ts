import { collideArena, collideBalls, rayToCircleEdge } from './physics';
import { mulberry32, type Rng } from './rng';
import type { Ball, Effect, GameResult, Item, Mode, Projectile, WeaponId } from './types';
import { WEAPONS, pickWeapon } from './weapons';

export const ARENA_R = 300;
export const MAX_HP = 10;
export const CHARGE_TIME = 1;
export const ITEM_R = 13;
export const SUDDEN_AT = 30;
const SHRINK_DURATION = 25;
const MIN_ARENA_RATIO = 0.38;
const TIME_LIMIT = 120;
const BASE_SPEED = 110;
const TAU = Math.PI * 2;

export const BALL_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#ec4899', '#14b8a6', '#f97316',
  '#6366f1', '#84cc16', '#06b6d4', '#f43f5e', '#8b5cf6', '#10b981', '#d946ef', '#0ea5e9',
];

/**
 * 게임 로직 전체. 렌더링과 분리되어 있어 화면 없이도 시뮬레이션 가능.
 * 모든 랜덤은 시드 RNG로만 → 같은 (이름, 모드, 시드)면 같은 경기.
 */
export class Game {
  balls: Ball[] = [];
  items: Item[] = [];
  projectiles: Projectile[] = [];
  effects: Effect[] = [];
  time = 0;
  arenaR = ARENA_R;
  result: GameResult | null = null;

  private rng: Rng;
  private spawnTimer = 0.8;
  private itemSeq = 0;
  private eliminated: Ball[] = [];

  constructor(
    readonly names: string[],
    readonly mode: Mode,
    readonly seed: number,
  ) {
    this.rng = mulberry32(seed);
    const n = names.length;
    // 경기장이 최소로 줄어도 원들이 다 들어가도록 반지름 결정
    const minArena = ARENA_R * MIN_ARENA_RATIO;
    const r = Math.max(12, Math.min(30, minArena * Math.sqrt(0.5 / n)));

    names.forEach((name, id) => {
      let x = 0;
      let y = 0;
      for (let attempt = 0; attempt < 200; attempt++) {
        const ang = this.rng() * TAU;
        const d = Math.sqrt(this.rng()) * (ARENA_R * 0.8 - r);
        x = Math.cos(ang) * d;
        y = Math.sin(ang) * d;
        if (this.balls.every((b) => Math.hypot(b.x - x, b.y - y) > b.r + r + 6)) break;
      }
      const va = this.rng() * TAU;
      this.balls.push({
        id, name, color: BALL_COLORS[id % BALL_COLORS.length], x, y,
        vx: Math.cos(va) * BASE_SPEED, vy: Math.sin(va) * BASE_SPEED,
        r, hp: MAX_HP, alive: true, weapon: null, charge: 0, flash: 0, wallCd: 0,
      });
    });
  }

  get finished(): boolean {
    return this.result !== null;
  }

  get suddenDeath(): boolean {
    return this.time >= SUDDEN_AT;
  }

  get alive(): Ball[] {
    return this.balls.filter((b) => b.alive);
  }

  /** 고정 타임스텝 한 번 */
  step(dt: number): void {
    this.updateEffects(dt);
    if (this.finished) return;

    this.time += dt;
    if (this.suddenDeath) {
      const k = Math.min(1, (this.time - SUDDEN_AT) / SHRINK_DURATION);
      this.arenaR = ARENA_R * (1 - (1 - MIN_ARENA_RATIO) * k);
    }

    this.updateSpawns(dt);
    this.updateBalls(dt);
    this.updateProjectiles(dt);
    this.processDeaths();
    this.checkEnd();
  }

  // ───────────────────────── 아이템 ─────────────────────────

  private updateSpawns(dt: number): void {
    for (const it of this.items) it.age += dt;
    this.items = this.items.filter((it) => Math.hypot(it.x, it.y) < this.arenaR - ITEM_R);

    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = (this.suddenDeath ? 0.4 : 0.6) + this.rng() * 0.8;

    const maxItems = Math.min(6, 2 + Math.ceil(this.alive.length / 3));
    if (this.items.length >= maxItems) return;

    const ang = this.rng() * TAU;
    const d = Math.sqrt(this.rng()) * (this.arenaR - ITEM_R - 12);
    this.items.push({
      id: this.itemSeq++,
      x: Math.cos(ang) * d,
      y: Math.sin(ang) * d,
      weapon: pickWeapon(this.rng),
      age: 0,
    });
  }

  // ───────────────────────── 원 이동/충돌/습득 ─────────────────────────

  private updateBalls(dt: number): void {
    const alive = this.alive;

    for (const b of alive) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.flash = Math.max(0, b.flash - dt);
      b.wallCd = Math.max(0, b.wallCd - dt);

      // 넉백 등으로 바뀐 속도를 기본 속도로 서서히 복귀
      const s = Math.hypot(b.vx, b.vy);
      if (s < 1) {
        const a = this.rng() * TAU;
        b.vx = Math.cos(a) * BASE_SPEED;
        b.vy = Math.sin(a) * BASE_SPEED;
      } else {
        const ns = s + (BASE_SPEED - s) * Math.min(1, dt * 2);
        b.vx *= ns / s;
        b.vy *= ns / s;
      }
    }

    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) collideBalls(alive[i], alive[j]);
    }

    for (const b of alive) {
      const hitWall = collideArena(b, this.arenaR);
      if (hitWall && this.suddenDeath && b.wallCd <= 0) {
        this.damage(b, 1, '#ef4444');
        b.wallCd = 0.6;
      }
    }

    for (const b of alive) {
      if (b.weapon) {
        b.charge += dt;
        if (b.charge >= CHARGE_TIME) {
          this.fire(b, b.weapon);
          b.weapon = null;
          b.charge = 0;
        }
        continue;
      }
      const idx = this.items.findIndex((it) => Math.hypot(it.x - b.x, it.y - b.y) < b.r + ITEM_R);
      if (idx >= 0) {
        const [it] = this.items.splice(idx, 1);
        b.weapon = it.weapon;
        b.charge = 0;
        this.addText(b.x, b.y - b.r - 18, WEAPONS[it.weapon].name, WEAPONS[it.weapon].color);
      }
    }
  }

  // ───────────────────────── 무기 발사 ─────────────────────────

  /**
   * 발사 순간 살아있는 상대 중 한 명을 무작위로 골라 그 좌표를 향한 각도.
   * 유도가 아니라 이 순간의 위치로 쏘기 때문에 상대가 움직이면 빗나갈 수 있음.
   */
  private aimAngle(b: Ball): number {
    const targets = this.alive.filter((o) => o.id !== b.id);
    if (targets.length === 0) return this.rng() * TAU;
    const t = targets[Math.floor(this.rng() * targets.length)];
    return Math.atan2(t.y - b.y, t.x - b.x);
  }

  private fire(b: Ball, weapon: WeaponId): void {
    const def = WEAPONS[weapon];
    const angle = this.aimAngle(b);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const spawn = (ang: number, speed: number, r: number, life: number) => {
      this.projectiles.push({
        x: b.x + Math.cos(ang) * (b.r + r),
        y: b.y + Math.sin(ang) * (b.r + r),
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        r, owner: b.id, weapon, damage: def.damage, life, hit: new Set(),
      });
    };

    switch (weapon) {
      case 'dagger':
        spawn(angle, 520, 5, 2);
        break;
      case 'bow':
        spawn(angle, 720, 4, 2);
        break;
      case 'bomb':
        spawn(angle, 190, 9, 1.6);
        break;
      case 'shotgun':
        for (let k = -2; k <= 2; k++) spawn(angle + k * 0.18, 480, 4, 0.75);
        break;
      case 'laser': {
        const len = rayToCircleEdge(b.x, b.y, dx, dy, this.arenaR);
        for (const o of this.alive) {
          if (o.id === b.id) continue;
          const ox = o.x - b.x;
          const oy = o.y - b.y;
          const along = ox * dx + oy * dy;
          if (along < 0 || along > len + o.r) continue;
          const perp = Math.abs(ox * dy - oy * dx);
          if (perp < o.r + 4) this.damage(o, def.damage, def.color);
        }
        this.effects.push({ kind: 'beam', x1: b.x, y1: b.y, x2: b.x + dx * len, y2: b.y + dy * len, color: def.color, t: 0, life: 0.35 });
        break;
      }
      case 'hammer': {
        const range = b.r + 75;
        const spread = 1.1;
        for (const o of this.alive) {
          if (o.id === b.id) continue;
          const ox = o.x - b.x;
          const oy = o.y - b.y;
          const d = Math.hypot(ox, oy);
          if (d - o.r > range) continue;
          let diff = Math.atan2(oy, ox) - angle;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          if (Math.abs(diff) > spread) continue;
          this.damage(o, def.damage, def.color);
          o.vx += (ox / d) * 340;
          o.vy += (oy / d) * 340;
        }
        this.effects.push({ kind: 'arc', x: b.x, y: b.y, angle, radius: range, spread, color: def.color, t: 0, life: 0.3 });
        break;
      }
    }
  }

  private updateProjectiles(dt: number): void {
    const alive = this.alive;
    this.projectiles = this.projectiles.filter((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;

      for (const b of alive) {
        if (b.id === p.owner || p.hit.has(b.id) || !b.alive) continue;
        if (Math.hypot(b.x - p.x, b.y - p.y) >= b.r + p.r) continue;
        if (p.weapon === 'bomb') {
          this.explode(p);
          return false;
        }
        p.hit.add(b.id);
        this.damage(b, p.damage, WEAPONS[p.weapon].color);
        return false;
      }

      if (Math.hypot(p.x, p.y) > this.arenaR - p.r || p.life <= 0) {
        if (p.weapon === 'bomb') this.explode(p);
        return false;
      }
      return true;
    });
  }

  private explode(p: Projectile): void {
    const radius = 85;
    for (const b of this.alive) {
      if (b.id === p.owner) continue;
      if (Math.hypot(b.x - p.x, b.y - p.y) - b.r < radius) this.damage(b, p.damage, WEAPONS.bomb.color);
    }
    this.effects.push({ kind: 'ring', x: p.x, y: p.y, radius, color: WEAPONS.bomb.color, t: 0, life: 0.45 });
  }

  // ───────────────────────── 피해/탈락/종료 ─────────────────────────

  private damage(b: Ball, amount: number, color: string): void {
    b.hp -= amount;
    b.flash = 0.15;
    this.addText(b.x + (this.rng() - 0.5) * 16, b.y - b.r, `-${amount}`, color);
  }

  private processDeaths(): void {
    const dying = this.balls
      .filter((b) => b.alive && b.hp <= 0)
      .map((b) => ({ b, tie: this.rng() }))
      // 같은 프레임에 죽으면 더 크게 오버킬 당한 쪽이 먼저 탈락
      .sort((x, y) => x.b.hp - y.b.hp || x.tie - y.tie);

    for (const { b } of dying) {
      b.alive = false;
      b.weapon = null;
      this.eliminated.push(b);
      this.effects.push({ kind: 'ring', x: b.x, y: b.y, radius: b.r * 2.2, color: b.color, t: 0, life: 0.6 });
      this.addText(b.x, b.y, `💀 ${b.name}`, '#f8fafc', 1.4);
    }
  }

  private checkEnd(): void {
    const aliveCount = this.alive.length;
    const done =
      this.time >= TIME_LIMIT ||
      (this.mode === 'winner' && aliveCount <= 1) ||
      (this.mode === 'loser' && this.eliminated.length > 0);
    if (!done) return;

    const ranking = [
      ...this.alive.sort((a, b) => b.hp - a.hp || a.id - b.id),
      ...[...this.eliminated].reverse(),
    ];
    const picked = this.mode === 'winner' ? ranking[0] : ranking[ranking.length - 1];
    this.result = { mode: this.mode, picked, ranking };
  }

  private addText(x: number, y: number, text: string, color: string, life = 0.8): void {
    this.effects.push({ kind: 'text', x, y, text, color, t: 0, life });
  }

  private updateEffects(dt: number): void {
    for (const e of this.effects) e.t += dt;
    this.effects = this.effects.filter((e) => e.t < e.life);
  }
}
