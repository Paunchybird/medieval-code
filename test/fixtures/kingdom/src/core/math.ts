export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function sum(xs: number[]): number {
  let total = 0;
  for (const x of xs) total += x;
  return total;
}
