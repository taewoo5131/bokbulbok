/** 맵 크기: 참가 인원으로 자동 결정 (두 게임 공통) */
export type MapSize = 'S' | 'M' | 'L';

export const SIZE_INFO: Record<MapSize, { label: string; max: number }> = {
  S: { label: 'Small', max: 16 },
  M: { label: 'Medium', max: 50 },
  L: { label: 'Large', max: 100 },
};

export const MAX_ENTRANTS = SIZE_INFO.L.max;

export function sizeFor(n: number): MapSize {
  if (n <= SIZE_INFO.S.max) return 'S';
  if (n <= SIZE_INFO.M.max) return 'M';
  return 'L';
}
