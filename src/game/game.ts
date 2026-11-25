import { collideArena, collideBalls, rayToCircleEdge } from './physics';
import { BALL_COLORS } from './colors';
import { mulberry32, type Rng } from './rng';
import type { Ball, Decoy, Effect, GameResult, Item, ItemKind, MeteorStrike, Mode, Projectile, WeaponId } from './types';
import { DECOY, HEAL, METEOR, WEAPONS, pickWeapon } from './weapons';

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


/**
 * 게임 로직 전체. 렌더링과 분리되어 있어 화면 없이도 시뮬레이션 가능.
 * 모든 랜덤은 시드 RNG로만 → 같은 (이름, 모드, 시드)면 같은 경기.
 */
export class Game {
  balls: Ball[] = [];
  items: Item[] = [];
  projectiles: Projectile[] = [];
  effects: Effect[] = [];
  meteors: MeteorStrike[] = [];
  decoys: Decoy[] = [];
  /** 화면 흔들림 세기 (렌더 전용, 시간이 지나면 0으로) */
  shake = 0;
  time = 0;
  arenaR = ARENA_R;
  result: GameResult | null = null;

  private rng: Rng;
  private spawnTimer = 0.8;
  private itemSeq = 0;
  private eliminated: Ball[] = [];
  private meteorsSpawned = 0;
  private decoySeq = 0;

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
    this.shake = Math.max(0, this.shake - dt * 30);
    if (this.finished) return;

    this.time += dt;
    if (this.suddenDeath) {
      const k = Math.min(1, (this.time - SUDDEN_AT) / SHRINK_DURATION);
      this.arenaR = ARENA_R * (1 - (1 - MIN_ARENA_RATIO) * k);
    }

    this.updateSpawns(dt);
    this.updateBalls(dt);
    this.updateDecoys(dt);
    this.updateProjectiles(dt);
    this.updateMeteors(dt);
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
    const onField = (k: ItemKind) => this.items.filter((it) => it.kind === k).length;
    const roll = this.rng();
    let kind: ItemKind;
    if (roll < HEAL.chance && onField('heal') < HEAL.maxOnField) {
      kind = 'heal';
    } else if (roll >= HEAL.chance && roll < HEAL.chance + DECOY.chance && onField('decoy') < DECOY.maxOnField) {
      kind = 'decoy';
    } else {
      kind = pickWeapon(this.rng, this.meteorsSpawned >= METEOR.maxPerGame ? ['meteor'] : []);
      if (kind === 'meteor') this.meteorsSpawned++;
    }
    this.items.push({
      id: this.itemSeq++,
      x: Math.cos(ang) * d,
      y: Math.sin(ang) * d,
      kind,
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

    const touching = (b: Ball, it: Item) => Math.hypot(it.x - b.x, it.y - b.y) < b.r + ITEM_R;

    for (const b of alive) {
      // 회복: 무기 소지 여부와 상관없이 즉시 적용, 체력이 가득 차 있으면 줍지 않음
      if (b.hp < MAX_HP) {
        const hi = this.items.findIndex((it) => it.kind === 'heal' && touching(b, it));
        if (hi >= 0) {
          this.items.splice(hi, 1);
          const gained = Math.min(HEAL.amount, MAX_HP - b.hp);
          b.hp += gained;
          this.addText(b.x, b.y - b.r - 18, `+${gained}`, '#4ade80');
          this.effects.push({ kind: 'ring', x: b.x, y: b.y, radius: b.r * 1.8, color: '#4ade80', t: 0, life: 0.4 });
        }
      }

      // 환각: 즉시 분신 생성 (이미 분신이 있으면 줍지 않음)
      if (!this.decoys.some((d) => d.owner === b.id)) {
        const di = this.items.findIndex((it) => it.kind === 'decoy' && touching(b, it));
        if (di >= 0) {
          this.items.splice(di, 1);
          this.spawnDecoys(b);
        }
      }

      if (b.weapon) {
        b.charge += dt;
        if (b.charge >= CHARGE_TIME) {
          this.fire(b, b.weapon);
          b.weapon = null;
          b.charge = 0;
        }
        continue;
      }
      const wi = this.items.findIndex((it) => it.kind !== 'heal' && it.kind !== 'decoy' && touching(b, it));
      if (wi >= 0) {
        const [it] = this.items.splice(wi, 1);
        if (it.kind === 'heal' || it.kind === 'decoy') continue;
        b.weapon = it.kind;
        b.charge = 0;
        this.addText(b.x, b.y - b.r - 18, WEAPONS[it.kind].name, WEAPONS[it.kind].color);
        if (it.kind === 'meteor') this.banner(`☄️ ${b.name} 운석 소환!`, WEAPONS.meteor.color);
      }
    }
  }

  // ───────────────────────── 무기 발사 ─────────────────────────

  /**
   * 발사 순간 살아있는 상대 중 한 명을 무작위로 골라 그 좌표를 향한 각도.
   * 유도가 아니라 이 순간의 위치로 쏘기 때문에 상대가 움직이면 빗나갈 수 있음.
   */
  /** 발사 대상: 살아있는 상대 + 다른 원의 분신 중 무작위 1개 (분신을 고르면 헛방) */
  private pickTarget(b: Ball): { x: number; y: number } | null {
    const targets: { x: number; y: number }[] = [
      ...this.alive.filter((o) => o.id !== b.id),
      ...this.decoys.filter((d) => d.owner !== b.id && d.life > 0),
    ];
    if (targets.length === 0) return null;
    return targets[Math.floor(this.rng() * targets.length)];
  }

  // ───────────────────────── 환각(분신) ─────────────────────────

  private spawnDecoys(b: Ball): void {
    const base = Math.atan2(b.vy, b.vx);
    for (let i = 0; i < DECOY.count; i++) {
      const a = base + ((i + 1) * TAU) / (DECOY.count + 1);
      this.decoys.push({
        id: this.decoySeq++, owner: b.id,
        x: b.x + Math.cos(a) * b.r * 0.5, y: b.y + Math.sin(a) * b.r * 0.5,
        vx: Math.cos(a) * BASE_SPEED, vy: Math.sin(a) * BASE_SPEED,
        r: b.r, life: DECOY.duration,
      });
    }
    this.banner(`👥 ${b.name} 분신술!`, DECOY.color);
    this.effects.push({ kind: 'ring', x: b.x, y: b.y, radius: b.r * 2.4, color: DECOY.color, t: 0, life: 0.5 });
  }

  private updateDecoys(dt: number): void {
    for (const d of this.decoys) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      collideArena(d, this.arenaR);
      d.life -= dt;
    }
    this.decoys = this.decoys.filter((d) => {
      if (d.life > 0 && this.balls[d.owner].alive) return true;
      if (d.life > -1) this.effects.push({ kind: 'ring', x: d.x, y: d.y, radius: d.r * 1.4, color: DECOY.color, t: 0, life: 0.3 });
      return false;
    });
  }

  /** 공격에 맞은 분신 제거 (같은 프레임의 다른 공격은 무시하도록 life를 -1로) */
  private popDecoy(d: Decoy): void {
    if (d.life <= 0) return;
    d.life = -1;
    this.addText(d.x, d.y - d.r, '💨 가짜!', DECOY.color);
    this.effects.push({ kind: 'ring', x: d.x, y: d.y, radius: d.r * 1.8, color: DECOY.color, t: 0, life: 0.4 });
  }

  private liveDecoysExcept(owner: number): Decoy[] {
    return this.decoys.filter((d) => d.life > 0 && d.owner !== owner);
  }

  private fire(b: Ball, weapon: WeaponId): void {
    const def = WEAPONS[weapon];
    const dmg = def.damage;
    const target = this.pickTarget(b);
    const angle = target ? Math.atan2(target.y - b.y, target.x - b.x) : this.rng() * TAU;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const spawn = (ang: number, speed: number, r: number, life: number) => {
      this.projectiles.push({
        x: b.x + Math.cos(ang) * (b.r + r),
        y: b.y + Math.sin(ang) * (b.r + r),
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        r, owner: b.id, weapon, damage: dmg, life, hit: new Set(),
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
          if (perp < o.r + 4) this.damage(o, dmg, def.color);
        }
        for (const d of this.liveDecoysExcept(b.id)) {
          const ox = d.x - b.x;
          const oy = d.y - b.y;
          const along = ox * dx + oy * dy;
          if (along >= 0 && along <= len + d.r && Math.abs(ox * dy - oy * dx) < d.r + 4) this.popDecoy(d);
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
          this.damage(o, dmg, def.color);
          o.vx += (ox / d) * 340;
          o.vy += (oy / d) * 340;
        }
        for (const d of this.liveDecoysExcept(b.id)) {
          const ox = d.x - b.x;
          const oy = d.y - b.y;
          if (Math.hypot(ox, oy) - d.r > range) continue;
          let diff = Math.atan2(oy, ox) - angle;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          if (Math.abs(diff) <= spread) this.popDecoy(d);
        }
        this.effects.push({ kind: 'arc', x: b.x, y: b.y, angle, radius: range, spread, color: def.color, t: 0, life: 0.3 });
        break;
      }
      case 'meteor': {
        // 발사 순간 상대의 좌표에 낙하 예고. 상대가 피하면 빗나감
        const tx = target ? target.x : b.x;
        const ty = target ? target.y : b.y;
        this.meteors.push({ x: tx, y: ty, radius: METEOR.radius, timer: METEOR.delay, total: METEOR.delay, owner: b.id, damage: dmg });
        break;
      }
    }
  }

  private updateMeteors(dt: number): void {
    this.meteors = this.meteors.filter((m) => {
      m.timer -= dt;
      if (m.timer > 0) return true;
      // 시전자 포함 범위 안 모든 원에 피해
      for (const b of this.alive) {
        if (Math.hypot(b.x - m.x, b.y - m.y) - b.r < m.radius) this.damage(b, m.damage, WEAPONS.meteor.color);
      }
      for (const d of this.liveDecoysExcept(-1)) {
        if (Math.hypot(d.x - m.x, d.y - m.y) - d.r < m.radius) this.popDecoy(d);
      }
      this.effects.push({ kind: 'ring', x: m.x, y: m.y, radius: m.radius * 1.3, color: WEAPONS.meteor.color, t: 0, life: 0.7 });
      this.effects.push({ kind: 'ring', x: m.x, y: m.y, radius: m.radius * 0.7, color: '#fde047', t: 0, life: 0.5 });
      this.shake = 14;
      return false;
    });
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

      for (const d of this.liveDecoysExcept(p.owner)) {
        if (Math.hypot(d.x - p.x, d.y - p.y) >= d.r + p.r) continue;
        if (p.weapon === 'bomb') this.explode(p);
        else this.popDecoy(d);
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
    for (const d of this.liveDecoysExcept(p.owner)) {
      if (Math.hypot(d.x - p.x, d.y - p.y) - d.r < radius) this.popDecoy(d);
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

  private banner(text: string, color: string): void {
    this.effects.push({ kind: 'banner', text, color, t: 0, life: 1.8 });
  }

  private addText(x: number, y: number, text: string, color: string, life = 0.8): void {
    this.effects.push({ kind: 'text', x, y, text, color, t: 0, life });
  }

  private updateEffects(dt: number): void {
    for (const e of this.effects) e.t += dt;
    this.effects = this.effects.filter((e) => e.t < e.life);
  }
}
