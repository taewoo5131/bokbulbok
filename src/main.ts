/** ⚔️ 배틀 페이지 진입점 */
import './style.css';
import { Game, MAX_HP, SUDDEN_AT } from './game/game';
import { DECOY, HEAL, WEAPONS, WEAPON_LIST } from './game/weapons';
import { Renderer } from './render/canvas';
import { runShell } from './shell';

let renderer: Renderer | null = null;

runShell<Game>({
  create: (names, mode, seed) => new Game(names, mode, seed),
  draw: (game, canvas) => {
    renderer ??= new Renderer(canvas);
    renderer.draw(game);
  },
  entrants: (game) => game.balls,
  hud: (game) => {
    const t = Math.floor(game.time);
    const sd = game.suddenDeath ? ' · <span class="sd">🔥 서든데스</span>' : ` · 서든데스까지 ${SUDDEN_AT - t}s`;
    return `⏱ ${t}s · 생존 ${game.alive.length}/${game.balls.length}${sd}`;
  },
  roster: (game) =>
    game.balls.map((b) => {
      const ratio = Math.max(0, b.hp) / MAX_HP;
      return {
        bar: ratio,
        barColor: ratio > 0.5 ? '#22c55e' : ratio > 0.25 ? '#eab308' : '#ef4444',
        icon: b.weapon ? WEAPONS[b.weapon].emoji : '',
        out: !b.alive,
      };
    }),
});

document.getElementById('weapon-list')?.replaceChildren(
  ...WEAPON_LIST.map((w) => {
    const li = document.createElement('li');
    li.innerHTML = `${w.emoji} <b>${w.name}</b> · 피해 ${w.damage} — ${w.desc}`;
    return li;
  }),
  Object.assign(document.createElement('li'), {
    innerHTML: `${HEAL.emoji} <b>${HEAL.name}</b> · +${HEAL.amount} — ${HEAL.desc}`,
  }),
  Object.assign(document.createElement('li'), {
    innerHTML: `${DECOY.emoji} <b>${DECOY.name}</b> — ${DECOY.desc}`,
  }),
);
