import { ARENA_R, CHARGE_TIME, ITEM_R, MAX_HP, type Game } from '../game/game';
import type { Ball, Effect, ItemKind, MeteorStrike, Projectile } from '../game/types';
import { WEAPONS, itemVisual } from '../game/weapons';

const TAU = Math.PI * 2;
const MARGIN = 14;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private size = 0;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D를 지원하지 않는 브라우저입니다.');
    this.ctx = ctx;
  }

  /** 캔버스를 표시 크기 × DPR로 맞춤 (매 프레임 호출해도 변화 없으면 무시) */
  private fit(): void {
    const size = Math.floor(this.canvas.clientWidth);
    const dpr = window.devicePixelRatio || 1;
    if (size === this.size && dpr === this.dpr) return;
    this.size = size;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.floor(size * dpr));
    this.canvas.height = Math.max(1, Math.floor(size * dpr));
  }

  draw(game: Game): void {
    this.fit();
    const { ctx } = this;
    const scale = (this.size * this.dpr) / (2 * (ARENA_R + MARGIN));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // 화면 흔들림은 연출 전용이라 Math.random 사용 (경기 결과에 영향 없음)
    const sx = (Math.random() - 0.5) * game.shake * scale;
    const sy = (Math.random() - 0.5) * game.shake * scale;
    ctx.setTransform(scale, 0, 0, scale, this.canvas.width / 2 + sx, this.canvas.height / 2 + sy);

    this.drawArena(game);
    if (game.meteors.length > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, game.arenaR, 0, TAU);
      ctx.clip();
      for (const m of game.meteors) this.drawMeteorZone(m);
      ctx.restore();
    }
    for (const it of game.items) this.drawItem(it.x, it.y, it.age, it.kind);
    for (const p of game.projectiles) this.drawProjectile(p);
    for (const b of game.balls) if (b.alive) this.drawBall(b, game);
    for (const m of game.meteors) this.drawFallingMeteor(m);
    for (const e of game.effects) if (e.kind !== 'banner') this.drawEffect(e);
    for (const e of game.effects) if (e.kind === 'banner') this.drawBanner(e.text, e.color, e.t / e.life);
  }

  /** 운석 낙하 예고: 어두운 경기장 + 빨간 점선 원 + 시간에 따라 차오르는 안쪽 */
  private drawMeteorZone(m: MeteorStrike): void {
    const { ctx } = this;
    const k = 1 - m.timer / m.total;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.radius * k, 0, TAU);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.28)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.radius, 0, TAU);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
    ctx.fill();
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -k * 60;
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(239, 68, 68, ${0.6 + 0.4 * Math.sin(k * 40)})`;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawFallingMeteor(m: MeteorStrike): void {
    const k = 1 - m.timer / m.total;
    const ease = k * k;
    const x = m.x + (1 - ease) * 40;
    const y = m.y - (1 - ease) * 90;
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = Math.min(1, k * 3);
    // 꼬리
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 20 + 25 * (1 - ease), y - 48 - 60 * (1 - ease));
    ctx.lineCap = 'round';
    ctx.lineWidth = 10 + 14 * k;
    ctx.strokeStyle = 'rgba(251, 146, 60, 0.45)';
    ctx.stroke();
    this.emoji('☄️', x, y, 22 + 34 * k);
    ctx.restore();
  }

  private drawBanner(text: string, color: string, k: number): void {
    const { ctx } = this;
    const appear = Math.min(1, k * 8);
    const alpha = k > 0.75 ? (1 - k) / 0.25 : 1;
    const y = -ARENA_R * 0.62;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(0, y);
    ctx.scale(0.6 + 0.4 * appear, 0.6 + 0.4 * appear);
    ctx.font = '900 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(2, 6, 23, 0.75)';
    ctx.beginPath();
    ctx.roundRect(-w / 2 - 18, -28, w + 36, 56, 14);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 2);
    ctx.restore();
  }

  private drawArena(game: Game): void {
    const { ctx } = this;
    this.drawArenaBase(game);
    // 운석 대기 중엔 경기장을 살짝 어둡게
    if (game.meteors.length > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, game.arenaR, 0, TAU);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fill();
    }
  }

  private drawArenaBase(game: Game): void {
    const { ctx } = this;
    if (game.suddenDeath) {
      ctx.beginPath();
      ctx.arc(0, 0, ARENA_R, 0, TAU);
      ctx.fillStyle = 'rgba(127, 29, 29, 0.35)';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, game.arenaR, 0, TAU);
    ctx.fillStyle = '#1e293b';
    ctx.fill();
    const pulse = game.suddenDeath ? 0.6 + 0.4 * Math.sin(game.time * 8) : 1;
    ctx.lineWidth = 4;
    ctx.strokeStyle = game.suddenDeath ? `rgba(239, 68, 68, ${pulse})` : '#475569';
    ctx.stroke();
  }

  private drawItem(x: number, y: number, age: number, kind: ItemKind): void {
    const { ctx } = this;
    const def = itemVisual(kind);
    const pop = Math.min(1, age * 4);
    const bob = Math.sin(age * 4) * 2;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.scale(pop, pop);
    ctx.beginPath();
    ctx.arc(0, 0, ITEM_R, 0, TAU);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = def.color;
    ctx.shadowColor = def.color;
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
    this.emoji(def.emoji, 0, 1, ITEM_R * 1.25);
    ctx.restore();
  }

  private drawProjectile(p: Projectile): void {
    const { ctx } = this;
    const color = WEAPONS[p.weapon].color;
    const s = Math.hypot(p.vx, p.vy) || 1;
    const dx = p.vx / s;
    const dy = p.vy / s;
    ctx.lineCap = 'round';
    switch (p.weapon) {
      case 'dagger':
      case 'bow': {
        const len = p.weapon === 'bow' ? 22 : 14;
        ctx.beginPath();
        ctx.moveTo(p.x - dx * len, p.y - dy * len);
        ctx.lineTo(p.x, p.y);
        ctx.lineWidth = p.weapon === 'bow' ? 3 : 4;
        ctx.strokeStyle = color;
        ctx.stroke();
        break;
      }
      case 'bomb':
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fillStyle = '#111827';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x + 5, p.y - 7, 2.5 + Math.random() * 1.5, 0, TAU);
        ctx.fillStyle = '#fde047';
        ctx.fill();
        break;
      default:
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fillStyle = color;
        ctx.fill();
    }
  }

  private drawBall(b: Ball, game: Game): void {
    const { ctx } = this;

    if (b.awakened) {
      const pulse = 0.5 + 0.5 * Math.sin(game.time * 10);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 6 + pulse * 4, 0, TAU);
      ctx.fillStyle = `rgba(251, 191, 36, ${0.18 + pulse * 0.15})`;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fbbf24';
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 18;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, TAU);
    ctx.fillStyle = b.color;
    ctx.fill();
    if (b.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${b.flash / 0.15})`;
      ctx.fill();
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();

    // 이름
    const fontSize = Math.max(9, b.r * 0.62);
    ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let label = b.name;
    const maxW = b.r * 1.8;
    while (label.length > 1 && ctx.measureText(label).width > maxW) label = label.slice(0, -1);
    if (label !== b.name) label = label.slice(0, -1) + '…';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(label, b.x, b.y + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, b.x, b.y + 1);

    // HP 바
    const w = Math.max(28, b.r * 2);
    const hx = b.x - w / 2;
    const hy = b.y + b.r + 5;
    const ratio = Math.max(0, b.hp) / MAX_HP;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(hx, hy, w, 5);
    ctx.fillStyle = ratio > 0.5 ? '#22c55e' : ratio > 0.25 ? '#eab308' : '#ef4444';
    ctx.fillRect(hx, hy, w * ratio, 5);

    // 들고 있는 무기 + 1초 충전 게이지
    if (b.weapon) {
      const def = WEAPONS[b.weapon];
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 4, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, b.charge / CHARGE_TIME));
      ctx.lineWidth = 3;
      ctx.strokeStyle = def.color;
      ctx.stroke();
      const wobble = Math.sin(game.time * 30) * (b.charge / CHARGE_TIME) * 2;
      this.emoji(def.emoji, b.x + wobble, b.y - b.r - 14, 18);
    }
  }

  private drawEffect(e: Effect): void {
    const { ctx } = this;
    const k = e.t / e.life;
    ctx.globalAlpha = 1 - k;
    switch (e.kind) {
      case 'text':
        ctx.font = '800 15px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeText(e.text, e.x, e.y - k * 26);
        ctx.fillStyle = e.color;
        ctx.fillText(e.text, e.x, e.y - k * 26);
        break;
      case 'ring':
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius * (0.3 + 0.7 * k), 0, TAU);
        ctx.fillStyle = e.color;
        ctx.globalAlpha = (1 - k) * 0.35;
        ctx.fill();
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = 3;
        ctx.strokeStyle = e.color;
        ctx.stroke();
        break;
      case 'beam':
        ctx.beginPath();
        ctx.moveTo(e.x1, e.y1);
        ctx.lineTo(e.x2, e.y2);
        ctx.lineCap = 'round';
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 10 * (1 - k);
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 16;
        ctx.stroke();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3 * (1 - k);
        ctx.stroke();
        ctx.shadowBlur = 0;
        break;
      case 'arc':
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.arc(e.x, e.y, e.radius, e.angle - e.spread, e.angle + e.spread);
        ctx.closePath();
        ctx.fillStyle = e.color;
        ctx.globalAlpha = (1 - k) * 0.45;
        ctx.fill();
        break;
    }
    ctx.globalAlpha = 1;
  }

  private emoji(text: string, x: number, y: number, size: number): void {
    const { ctx } = this;
    ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x, y);
  }
}
