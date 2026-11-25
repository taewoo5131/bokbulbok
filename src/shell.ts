/**
 * 게임 공통 화면: 입력 → 경기 → 결과/공유.
 * 각 게임(배틀, 레이스 …)은 GameDef만 구현하면 이 화면을 그대로 씁니다.
 * 입력값은 localStorage를 공유하므로 게임을 바꿔도 그대로 유지됩니다.
 */
import { colorFor } from './game/colors';
import { MAX_ENTRANTS, SIZE_INFO, sizeFor } from './game/size';
import { randomSeed } from './game/rng';
import type { Mode } from './game/types';


export interface Entrant {
  id: number;
  name: string;
  color: string;
}

export interface Result {
  mode: Mode;
  picked: Entrant;
  /** 1등 → 꼴등 순서 */
  ranking: Entrant[];
}

export interface PlayableGame {
  readonly seed: number;
  readonly finished: boolean;
  readonly result: Result | null;
  step(dt: number): void;
}

export interface RosterRow {
  /** 0~1 막대 길이 (배틀: 체력, 레이스: 진행도) */
  bar: number;
  barColor: string;
  /** 오른쪽 작은 표시 (무기 이모지, 순위 등) */
  icon: string;
  /** 탈락/도착 등으로 흐리게 표시 */
  out: boolean;
}

export interface GameDef<G extends PlayableGame> {
  create(names: string[], mode: Mode, seed: number): G;
  draw(game: G, canvas: HTMLCanvasElement): void;
  entrants(game: G): Entrant[];
  /** 상단 상태 표시 (HTML) */
  hud(game: G): string;
  roster(game: G): RosterRow[];
}

const MIN_ITEMS = 2;
const MAX_ITEMS = MAX_ENTRANTS;
const MAX_NAME_LEN = 12;
const STEP = 1 / 60;
const STORAGE_KEY = 'bokbulbok:last';
/** 프로젝트 이름을 바꾸기 전에 쓰던 키 (기존 방문자 입력값을 옮겨 오기 위해) */
const OLD_STORAGE_KEY = 'circle-battle:last';

const PRESETS: Record<string, string[]> = {
  lunch: ['돈까스', '국밥', '냉면', '짜장면', '김치찌개', '초밥'],
  dinner: ['삼겹살', '치킨', '피자', '마라탕', '족발', '회'],
  numbers: ['1', '2', '3', '4', '5', '6'],
};

/** "이름*3" → 같은 이름 3개. 곱하기 기호는 * 또는 × (영문 x는 "box2" 같은 이름과 헷갈려서 제외) */
const REPEAT_RE = /^(.+?)\s*[*×]\s*(\d+)$/;

export function runShell<G extends PlayableGame>(def: GameDef<G>): void {
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

  let items: string[] = [];
  let mode: Mode = 'winner';
  let game: G | null = null;
  let speed = 1;
  let rafId = 0;
  let resultShown = false;

  // ───────────────────────── 입력 화면 ─────────────────────────

  function addItems(raw: string): void {
    for (const token of raw.split(',')) {
      const t = token.trim();
      if (!t) continue;
      const m = t.match(REPEAT_RE);
      const name = (m ? m[1] : t).trim().slice(0, MAX_NAME_LEN);
      const count = m ? Number(m[2]) : 1;
      if (!name) continue;
      // 같은 이름도 여러 개 허용 (색으로 구분)
      for (let i = 0; i < count && items.length < MAX_ITEMS; i++) items.push(name);
    }
    renderChips();
  }

  function renderChips(): void {
    el.chips.replaceChildren(
      ...items.map((name, i) => {
        const li = document.createElement('li');
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = colorFor(i);
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
    const size = sizeFor(n);
    el.hint.textContent =
      n < MIN_ITEMS
        ? `항목을 ${MIN_ITEMS}개 이상 입력하세요 (최대 ${MAX_ITEMS}개)`
        : `${n} / ${MAX_ITEMS}개 · 맵 ${SIZE_INFO[size].label} (${SIZE_INFO[size].max}명까지)`;
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
      let raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) {
        raw = localStorage.getItem(OLD_STORAGE_KEY);
        if (raw !== null) {
          localStorage.setItem(STORAGE_KEY, raw);
          localStorage.removeItem(OLD_STORAGE_KEY);
        }
      }
      const data = JSON.parse(raw ?? 'null');
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

  // ───────────────────────── 경기 ─────────────────────────

  function startGame(seed: number): void {
    if (items.length < MIN_ITEMS) return;
    game = def.create([...items], mode, seed);
    resultShown = false;
    el.result.classList.add('hidden');
    el.screenInput.classList.add('hidden');
    el.screenGame.classList.remove('hidden');
    document.body.classList.add('playing');
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
      def.draw(game, el.canvas);
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
    document.body.classList.remove('playing');
    el.screenInput.classList.remove('hidden');
    history.replaceState(null, '', location.pathname);
  }

  let rosterRows: { li: HTMLLIElement; bar: HTMLElement; icon: HTMLElement }[] = [];

  function buildRoster(): void {
    if (!game) return;
    rosterRows = def.entrants(game).map((b) => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = b.color;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = b.name;
      const icon = document.createElement('span');
      icon.className = 'weapon';
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('i');
      bar.append(fill);
      li.append(dot, name, icon, bar);
      return { li, bar: fill, icon };
    });
    el.roster.replaceChildren(...rosterRows.map((r) => r.li));
  }

  let lastHud = '';

  function updateHud(): void {
    if (!game) return;
    const hud = def.hud(game);
    if (hud !== lastHud) {
      el.hud.innerHTML = hud;
      lastHud = hud;
    }
    def.roster(game).forEach((r, i) => {
      const row = rosterRows[i];
      row.bar.style.width = `${Math.max(0, Math.min(1, r.bar)) * 100}%`;
      row.bar.style.background = r.barColor;
      row.li.classList.toggle('dead', r.out);
      if (row.icon.textContent !== r.icon) row.icon.textContent = r.icon;
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
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = b.color;
        li.append(dot, b.name);
        if (b.id === picked.id) li.className = 'picked';
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
}
