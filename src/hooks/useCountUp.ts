import { useEffect, useRef, useState } from 'react';

/**
 * Spring-flavored count-up for KPI values: retargets mid-flight when the
 * value changes, honors prefers-reduced-motion.
 */
export function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }
    const from = fromRef.current;
    const t0 = performance.now();
    cancelAnimationFrame(rafRef.current);
    const frame = (now: number) => {
      const t = Math.min((now - t0) / duration, 1);
      // easeOutQuint with a whisper of overshoot at the end of large moves
      const eased = 1 - Math.pow(1 - t, 5);
      const current = from + (target - from) * eased;
      fromRef.current = current;
      setValue(current);
      if (t < 1) rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}
