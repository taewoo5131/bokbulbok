import type { Effect } from '../game/types';
import { TRACK_W, type Race, type RaceBall } from '../race/race';

const TAU = Math.PI * 2;
const MARGIN = 10;
const MINIMAP_W = 10;

/** 레이스 그리기: 세로로 긴 트랙을 카메라가 따라가며 보여주고, 오른쪽에 전체 진행 미니맵 */
export class RaceRenderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private camY = 0;
  private lastSeed = -1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D를 지원하지 않는 브라우저입니다.');
    this.ctx = ctx;
  }

  private fit(): void {
    const w = Math.floor(this.canvas.clientWidth);
    const h = Math.floor(this.canvas.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
  }

  draw(race: Race): void {
    this.fit();
    const { ctx } = this;
    const scale = (this.w * this.dpr) / (TRACK_W + MARGIN * 2 + MINIMAP_W + 6);
    const viewH = (this.h * this.dpr) / scale;

    // 카메라: 1등 뽑기는 선두, 꼴등 뽑기는 꼴찌를 따라감
    const racing = race.balls.filter((b) => !b.place);
    const pool = racing.length ? racing : race.balls;
    const focusY = race.mode === 'winner' ? Math.max(...pool.map((b) => b.y)) : Math.min(...pool.map((b) => b.y));
    const target = Math.max(-40, Math.min(race.finishY + 140 - viewH, focusY - viewH * 0.45));
    if (race.seed !== this.lastSeed || race.time < 0.05) {
      this.camY = target;
      this.lastSeed = race.seed;
    }
    this.camY += (target - this.camY) * 0.08;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(scale, 0, 0, scale, MARGIN * scale, -this.camY * scale);

    const top = this.camY - 40;
    const bottom = this.camY + viewH + 40;
    this.drawTrack(race, top, bottom);
    for (const b of race.balls) if (b.y > top - 30 && b.y < bottom + 30) this.drawBall(b);
    for (const e of race.effects) if (e.kind !== 'banner') this.drawEffect(e);

    // 화면 고정 요소
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    this.drawMinimap(race, scale, viewH);
    for (const e of race.effects) if (e.kind === 'banner') this.drawBanner(e.text, e.color, e.t / e.life, viewH);
  }

  private drawTrack(race: Race, top: number, bottom: number): void {
    const { ctx } = this;
    const { track } = race;

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, Math.max(top, -60), TRACK_W, Math.min(bottom, track.finishY + 200) - Math.max(top, -60));

    // 출발선
    ctx.fillStyle = 'rgba(148,163,184,0.5)';
    ctx.fillRect(0, 20, TRACK_W, 3);

    // 구역(부스터/진흙)
    for (const z of track.zones) {
      if (z.y > bottom || z.y + z.h < top) continue;
      if (z.kind === 'boost') {
        ctx.fillStyle = 'rgba(34,197,94,0.16)';
        ctx.fillRect(z.x, z.y, z.w, z.h);
        ctx.strokeStyle = 'rgba(74,222,128,0.6)';
        ctx.lineWidth = 3;
        const off = (race.time * 120) % 40;
        for (let y = z.y + off; y < z.y + z.h - 10; y += 40) {
          ctx.beginPath();
          ctx.moveTo(z.x + z.w / 2 - 16, y);
          ctx.lineTo(z.x + z.w / 2, y + 12);
          ctx.lineTo(z.x + z.w / 2 + 16, y);
          ctx.stroke();
        }
        this.label('⚡ 부스터', z.x + z.w / 2, z.y - 10, '#4ade80');
      } else {
        ctx.fillStyle = 'rgba(120,72,32,0.45)';
        ctx.fillRect(z.x, z.y, z.w, z.h);
        ctx.fillStyle = 'rgba(80,48,20,0.8)';
        for (let i = 0; i < 18; i++) {
          const px = z.x + ((i * 53) % z.w);
          const py = z.y + ((i * 97) % z.h);
          ctx.beginPath();
          ctx.arc(px, py, 4 + (i % 3), 0, TAU);
          ctx.fill();
        }
        this.label('🟫 진흙', z.x + z.w / 2, z.y - 10, '#d6a36b');
      }
    }

    // 벽/경사로
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 7;
    for (const s of track.segments) {
      if (Math.max(s.y1, s.y2) < top || Math.min(s.y1, s.y2) > bottom) continue;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    }

    // 핀/범퍼
    for (const p of track.pegs) {
      if (p.y < top - 40 || p.y > bottom + 40) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      if (p.bounce > 1) {
        ctx.fillStyle = '#be185d';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#f9a8d4';
        ctx.stroke();
      } else {
        ctx.fillStyle = '#64748b';
        ctx.fill();
      }
    }

    // 회전 막대
    for (const sp of track.spinners) {
      if (sp.y < top - 80 || sp.y > bottom + 80) continue;
      const a = sp.phase + sp.omega * race.time;
      const dx = Math.cos(a) * sp.half;
      const dy = Math.sin(a) * sp.half;
      ctx.beginPath();
      ctx.moveTo(sp.x - dx, sp.y - dy);
      ctx.lineTo(sp.x + dx, sp.y + dy);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 6, 0, TAU);
      ctx.fillStyle = '#fde68a';
      ctx.fill();
    }

    // 좌우 벽
    ctx.fillStyle = '#475569';
    ctx.fillRect(-6, Math.max(top, -60), 6, bottom - Math.max(top, -60));
    ctx.fillRect(TRACK_W, Math.max(top, -60), 6, bottom - Math.max(top, -60));

    // 결승선 (체크무늬)
    const fy = track.finishY;
    if (fy > top - 20 && fy < bottom + 20) {
      const sq = 15;
      for (let i = 0; i * sq < TRACK_W; i++) {
        for (let j = 0; j < 2; j++) {
          ctx.fillStyle = (i + j) % 2 ? '#f8fafc' : '#0f172a';
          ctx.fillRect(i * sq, fy - sq + j * sq, sq, sq);
        }
      }
      this.label('🏁 FINISH', TRACK_W / 2, fy - sq - 14, '#f8fafc');
    }
  }

  private drawBall(b: RaceBall): void {
    const { ctx } = this;
    ctx.save();
    if (b.place) ctx.globalAlpha = 0.7;
    if (b.boosted) {
      ctx.beginPath();
      ctx.arc(b.x, b.y - b.r * 0.8, b.r * 0.9, 0, TAU);
      ctx.fillStyle = 'rgba(74,222,128,0.35)';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, TAU);
    ctx.fillStyle = b.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();

    // 이름은 원 위에 (작은 원에도 읽히게)
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(b.name, b.x, b.y - b.r - 2);
    ctx.fillStyle = '#fff';
    ctx.fillText(b.name, b.x, b.y - b.r - 2);

    if (b.place) {
      ctx.font = '800 12px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0f172a';
      ctx.fillText(String(b.place), b.x, b.y + 1);
    }
    ctx.restore();
  }

  /** 오른쪽 미니맵: 트랙 전체에서 각 원의 위치 */
  private drawMinimap(race: Race, scale: number, viewH: number): void {
    const { ctx } = this;
    const x = (this.w * this.dpr) / scale - MINIMAP_W - 4;
    const y0 = 16;
    const hh = viewH - 32;
    const total = race.finishY;
    ctx.fillStyle = 'rgba(15,23,42,0.85)';
    ctx.fillRect(x, y0, MINIMAP_W, hh);
    // 지금 보고 있는 구간
    const vy = y0 + (Math.max(0, this.camY) / total) * hh;
    const vh = Math.min(hh, (viewH / total) * hh);
    ctx.fillStyle = 'rgba(148,163,184,0.25)';
    ctx.fillRect(x, vy, MINIMAP_W, vh);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(x - 2, y0 + hh - 2, MINIMAP_W + 4, 3);
    for (const b of race.balls) {
      const p = Math.max(0, Math.min(1, b.y / total));
      ctx.beginPath();
      ctx.arc(x + MINIMAP_W / 2, y0 + p * hh, 4, 0, TAU);
      ctx.fillStyle = b.color;
      ctx.fill();
    }
  }

  private drawEffect(e: Effect): void {
    const { ctx } = this;
    const k = e.t / e.life;
    ctx.globalAlpha = 1 - k;
    if (e.kind === 'text') {
      ctx.font = '800 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(e.text, e.x, e.y - k * 30);
      ctx.fillStyle = e.color;
      ctx.fillText(e.text, e.x, e.y - k * 30);
    } else if (e.kind === 'ring') {
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius * (0.3 + 0.7 * k), 0, TAU);
      ctx.lineWidth = 3;
      ctx.strokeStyle = e.color;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawBanner(text: string, color: string, k: number, viewH: number): void {
    const { ctx } = this;
    const appear = Math.min(1, k * 8);
    ctx.save();
    ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
    ctx.translate((TRACK_W + MARGIN * 2) / 2, viewH * 0.18);
    ctx.scale(0.6 + 0.4 * appear, 0.6 + 0.4 * appear);
    ctx.font = '900 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(2, 6, 23, 0.8)';
    ctx.beginPath();
    ctx.roundRect(-w / 2 - 18, -26, w + 36, 52, 14);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 2);
    ctx.restore();
  }

  private label(text: string, x: number, y: number, color: string): void {
    const { ctx } = this;
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
}
