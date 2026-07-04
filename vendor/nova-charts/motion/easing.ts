export type EasingFn = (t: number) => number;

export const linear: EasingFn = (t) => t;
export const easeInQuad: EasingFn = (t) => t * t;
export const easeOutQuad: EasingFn = (t) => t * (2 - t);
export const easeInOutQuad: EasingFn = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
export const easeOutCubic: EasingFn = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic: EasingFn = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutQuart: EasingFn = (t) => 1 - Math.pow(1 - t, 4);
export const easeOutExpo: EasingFn = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeOutBack: EasingFn = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export const easings = {
  linear,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeOutCubic,
  easeInOutCubic,
  easeOutQuart,
  easeOutExpo,
  easeOutBack,
} as const;

export type EasingName = keyof typeof easings;

export function resolveEasing(easing: EasingName | EasingFn | undefined, fallback: EasingFn): EasingFn {
  if (easing === undefined) return fallback;
  return typeof easing === 'function' ? easing : easings[easing];
}
