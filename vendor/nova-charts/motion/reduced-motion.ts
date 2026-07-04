let reduced = false;
let forced: boolean | null = null;
const listeners = new Set<(reduced: boolean) => void>();

if (typeof matchMedia === 'function') {
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  reduced = mq.matches;
  const onChange = (e: MediaQueryListEvent): void => {
    reduced = e.matches;
    for (const fn of listeners) fn(prefersReducedMotion());
  };
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
}

export function prefersReducedMotion(): boolean {
  return forced ?? reduced;
}

/** Test/override hook: force reduced motion on/off, or null to follow the OS. */
export function forceReducedMotion(value: boolean | null): void {
  forced = value;
  for (const fn of listeners) fn(prefersReducedMotion());
}

export function onReducedMotionChange(fn: (reduced: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
