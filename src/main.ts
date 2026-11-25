import './style.css';
import { BALL_COLORS, Game, MAX_HP, SUDDEN_AT } from './game/game';
import { randomSeed } from './game/rng';
import type { Mode } from './game/types';
import { HEAL, WEAPONS, WEAPON_LIST } from './game/weapons';
import { Renderer } from './render/canvas';

const MIN_ITEMS = 2;
const MAX_ITEMS = 16;
const MAX_NAME_LEN = 12;
const STEP = 1 / 60;
const STORAGE_KEY = 'circle-battle:last';

const PRESETS: Record<string, string[]> = {
  lunch: ['돈까스', '국밥', '냉면', '짜장면', '김치찌개', '초밥'],
  dinner: ['삼겹살', '치킨', '피자', '마라탕', '족발', '회'],
  numbers: ['1', '2', '3', '4', '5', '6'],
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  screenInput: $('screen-input'),
  screenGame: $('screen-game'),
  form: $<HTMLFormElement>('add-form'),
  input: $<HTMLInputElement>('item-input'),
  chips: $('chips'),
  hint: $('hint'),
  start: $<HTMLButtonElement>('start-btn'),
  clear: $('clear-btn'),
  weaponList: $('weapon-list'),
  canvas: $<HTMLCanvasElement>('canvas'),
  hud: $('hud'),
  roster: $('roster'),
  speed: $('speed-btn'),
  back: $('back-btn'),
  result: $('result'),
  resultLabel: $('result-label'),
  resultName: $('result-name'),
  resultRanking: $('result-ranking'),
  again: $('again-btn'),
  replay: $('replay-btn'),
  share: $('share-btn'),
  edit: $('edit-btn'),
};

// ───────────────────────── 상태 ─────────────────────────

let items: string[] = [];
let mode: Mode = 'winner';
let game: Game | null = null;
let speed = 1;
let rafId = 0;
let resultShown = false;
const renderer = new Renderer(el.canvas);

// ───────────────────────── 입력 화면 ─────────────────────────

function addItems(raw: string): void {
  const names = raw
    .split(',')
    .map((s) => s.trim().slice(0, MAX_NAME_LEN))
    .filter(Boolean);
  for (const name of names) {
    if (items.length >= MAX_ITEMS) break;
    if (!items.includes(name)) items.push(name);
  }
  renderChips();
}

function renderChips(): void {
  el.chips.replaceChildren(
    ...items.map((name, i) => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = BALL_COLORS[i % BALL_COLORS.length];
      const label = document.createElement('span');
      label.textContent = name;
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '✕';
      del.setAttribute('aria-label', `${name} 삭제`);
      del.onclick = () => {
        items.splice(i, 1);
        renderChips();
      };
      li.append(dot, label, del);
      return li;
    }),
  );
  const n = items.length;
  el.start.disabled = n < MIN_ITEMS;
  el.hint.textContent =
    n < MIN_ITEMS ? `항목을 ${MIN_ITEMS}개 이상 입력하세요 (최대 ${MAX_ITEMS}개)` : `${n} / ${MAX_ITEMS}개`;
  saveLast();
}

function setMode(m: Mode): void {
  mode = m;
  document.querySelectorAll<HTMLButtonElement>('.mode button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === m);
    b.setAttribute('aria-checked', String(b.dataset.mode === m));
  });
  saveLast();
}

function saveLast(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ items, mode }));
  } catch {
    /* 저장 불가 환경은 무시 */
  }
}

function loadLast(): void {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(data?.items)) items = data.items.filter((s: unknown) => typeof s === 'string').slice(0, MAX_ITEMS);
    if (data?.mode === 'winner' || data?.mode === 'loser') mode = data.mode;
  } catch {
    /* 무시 */
  }
}

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  addItems(el.input.value);
  el.input.value = '';
  el.input.focus();
});

document.querySelectorAll<HTMLButtonElement>('.mode button').forEach((b) => {
  b.onclick = () => setMode(b.dataset.mode as Mode);
});

document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => {
  b.onclick = () => {
    items = [...PRESETS[b.dataset.preset!]];
    renderChips();
  };
});

el.clear.onclick = () => {
  items = [];
  renderChips();
};

el.start.onclick = () => startGame(randomSeed());

el.weaponList.replaceChildren(
  ...WEAPON_LIST.map((w) => {
    const li = document.createElement('li');
    li.innerHTML = `${w.emoji} <b>${w.name}</b> · 피해 ${w.damage} — ${w.desc}`;
    return li;
  }),
  Object.assign(document.createElement('li'), {
    innerHTML: `${HEAL.emoji} <b>${HEAL.name}</b> · +${HEAL.amount} — ${HEAL.desc}`,
  }),
);

// ───────────────────────── 경기 ─────────────────────────

function startGame(seed: number): void {
  if (items.length < MIN_ITEMS) return;
  game = new Game([...items], mode, seed);
  resultShown = false;
  el.result.classList.add('hidden');
  el.screenInput.classList.add('hidden');
  el.screenGame.classList.remove('hidden');
  buildRoster();
  cancelAnimationFrame(rafId);
  let last = performance.now();
  let acc = 0;

  const frame = (now: number) => {
    if (!game) return;
    // 탭 전환 등으로 오래 멈췄을 때 한 번에 몰아서 계산하지 않도록 제한
    acc += Math.min(0.1, (now - last) / 1000) * speed;
    last = now;
    while (acc >= STEP) {
      game.step(STEP);
      acc -= STEP;
    }
    renderer.draw(game);
    updateHud();
    if (game.finished && !resultShown) {
      resultShown = true;
      setTimeout(showResult, 1200);
    }
    rafId = requestAnimationFrame(frame);
  };
  rafId = requestAnimationFrame(frame);
}

function stopGame(): void {
  cancelAnimationFrame(rafId);
  game = null;
  el.result.classList.add('hidden');
  el.screenGame.classList.add('hidden');
  el.screenInput.classList.remove('hidden');
  history.replaceState(null, '', location.pathname);
}

let rosterRows: { li: HTMLLIElement; bar: HTMLElement; weapon: HTMLElement }[] = [];

function buildRoster(): void {
  if (!game) return;
  rosterRows = game.balls.map((b) => {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = b.color;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = b.name;
    const weapon = document.createElement('span');
    weapon.className = 'weapon';
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('i');
    bar.append(fill);
    li.append(dot, name, weapon, bar);
    return { li, bar: fill, weapon };
  });
  el.roster.replaceChildren(...rosterRows.map((r) => r.li));
}

let lastHud = '';

function updateHud(): void {
  if (!game) return;
  const alive = game.alive.length;
  const t = Math.floor(game.time);
  const sd = game.suddenDeath ? ' · <span class="sd">🔥 서든데스</span>' : ` · 서든데스까지 ${SUDDEN_AT - t}s`;
  const hud = `⏱ ${t}s · 생존 ${alive}/${game.balls.length}${sd}`;
  if (hud !== lastHud) {
    el.hud.innerHTML = hud;
    lastHud = hud;
  }
  game.balls.forEach((b, i) => {
    const row = rosterRows[i];
    const ratio = Math.max(0, b.hp) / MAX_HP;
    row.bar.style.width = `${ratio * 100}%`;
    row.bar.style.background = ratio > 0.5 ? '#22c55e' : ratio > 0.25 ? '#eab308' : '#ef4444';
    row.li.classList.toggle('dead', !b.alive);
    const w = b.weapon ? WEAPONS[b.weapon].emoji : '';
    if (row.weapon.textContent !== w) row.weapon.textContent = w;
  });
}

function showResult(): void {
  if (!game?.result) return;
  const { picked, ranking, mode: m } = game.result;
  el.resultLabel.textContent = m === 'winner' ? '🏆 1등은!' : '💀 꼴등은…';
  el.resultName.textContent = picked.name;
  el.resultName.style.color = picked.color;
  el.resultRanking.replaceChildren(
    ...ranking.map((b) => {
      const li = document.createElement('li');
      li.textContent = b.name;
      if (b === picked) li.className = 'picked';
      return li;
    }),
  );
  el.result.classList.remove('hidden');
  history.replaceState(null, '', shareUrl());
}

function shareUrl(): string {
  const params = new URLSearchParams();
  params.set('items', items.join(','));
  params.set('mode', mode);
  if (game) params.set('seed', String(game.seed));
  return `${location.origin}${location.pathname}?${params}`;
}

el.speed.onclick = () => {
  speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
  el.speed.textContent = `${speed}x`;
};
el.back.onclick = stopGame;
el.edit.onclick = stopGame;
el.again.onclick = () => startGame(randomSeed());
el.replay.onclick = () => game && startGame(game.seed);
el.share.onclick = async () => {
  const url = shareUrl();
  try {
    await navigator.clipboard.writeText(url);
    el.share.textContent = '✅ 복사됨!';
  } catch {
    prompt('아래 링크를 복사하세요', url);
  }
  setTimeout(() => (el.share.textContent = '🔗 결과 링크 복사'), 1500);
};

// ───────────────────────── 초기화 ─────────────────────────
// ?items=a,b,c&mode=loser&seed=123 → 공유받은 경기를 그대로 재생

loadLast();
const params = new URLSearchParams(location.search);
const sharedItems = params.get('items');
if (sharedItems) {
  items = [];
  addItems(sharedItems);
}
const sharedMode = params.get('mode');
if (sharedMode === 'winner' || sharedMode === 'loser') mode = sharedMode;
setMode(mode);
renderChips();

const sharedSeed = Number(params.get('seed'));
if (sharedItems && params.has('seed') && Number.isInteger(sharedSeed)) startGame(sharedSeed);
