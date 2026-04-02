import { useCallback, useEffect, useRef, useState } from 'react';

const IDLE_MS = 30 * 60 * 1000; // 30 minutes
const COUNTDOWN_S = 60;          // 60-second warning countdown

interface UseIdleTimeoutOptions {
  onTimeout: () => void;
}

interface UseIdleTimeoutResult {
  showWarning: boolean;
  countdown: number;
  resetTimer: () => void;
}

export function useIdleTimeout({ onTimeout }: UseIdleTimeoutOptions): UseIdleTimeoutResult {
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_S);

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTimeoutRef = useRef(onTimeout);

  // Keep onTimeout ref current so stale closures don't capture old callbacks
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  const clearCountdown = useCallback(() => {
    if (countdownIntervalRef.current !== null) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const startCountdown = useCallback(() => {
    setCountdown(COUNTDOWN_S);
    clearCountdown();

    let remaining = COUNTDOWN_S;
    countdownIntervalRef.current = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) {
        clearCountdown();
        onTimeoutRef.current();
      }
    }, 1000);
  }, [clearCountdown]);

  const resetTimer = useCallback(() => {
    setShowWarning(false);
    clearCountdown();
    setCountdown(COUNTDOWN_S);

    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = setTimeout(() => {
      setShowWarning(true);
      startCountdown();
    }, IDLE_MS);
  }, [clearCountdown, startCountdown]);

  useEffect(() => {
    const events: (keyof DocumentEventMap)[] = [
      'mousemove',
      'mousedown',
      'keydown',
      'touchstart',
      'scroll',
    ];

    const handleActivity = () => {
      // Only reset when the warning is not showing — once the warning is up,
      // background activity should not dismiss it silently
      setShowWarning(current => {
        if (!current) {
          if (idleTimerRef.current !== null) {
            clearTimeout(idleTimerRef.current);
          }
          idleTimerRef.current = setTimeout(() => {
            setShowWarning(true);
            startCountdown();
          }, IDLE_MS);
        }
        return current;
      });
    };

    events.forEach(event => document.addEventListener(event, handleActivity, { passive: true }));

    // Start the initial idle timer
    idleTimerRef.current = setTimeout(() => {
      setShowWarning(true);
      startCountdown();
    }, IDLE_MS);

    return () => {
      events.forEach(event => document.removeEventListener(event, handleActivity));
      if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
      clearCountdown();
    };
  // startCountdown and clearCountdown are stable (useCallback with no changing deps)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { showWarning, countdown, resetTimer };
}
