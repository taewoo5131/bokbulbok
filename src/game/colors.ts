/** 참가자 색상 팔레트 (처음 16명은 구분이 잘 되는 고정 색) */
export const BALL_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#ec4899', '#14b8a6', '#f97316',
  '#6366f1', '#84cc16', '#06b6d4', '#f43f5e', '#8b5cf6', '#10b981', '#d946ef', '#0ea5e9',
];

/** i번째 참가자 색. 16명을 넘으면 황금각으로 색상환을 돌며 겹치지 않게 생성 */
export function colorFor(i: number): string {
  if (i < BALL_COLORS.length) return BALL_COLORS[i];
  const hue = Math.round((i * 137.508) % 360);
  const light = 50 + (i % 3) * 8;
  return `hsl(${hue} 72% ${light}%)`;
}
