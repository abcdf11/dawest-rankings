import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { TypewriterText } from "./TypewriterText";

export const INTRO_STORAGE_KEY = "dawest:intro-seen:v1";
export function shouldShowIntro() {
  try {
    return sessionStorage.getItem(INTRO_STORAGE_KEY) !== "1";
  } catch {
    return true;
  }
}

export function LoadingScreen({
  ready,
  onComplete,
}: {
  ready: boolean;
  onComplete: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [progress, setProgress] = useState(0);
  const skip = useRef<HTMLButtonElement>(null);
  const done = useRef(false);
  const readyRef = useRef(ready);
  const finishRef = useRef(onComplete);
  readyRef.current = ready;
  finishRef.current = onComplete;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    skip.current?.focus({ preventScroll: true });
    done.current = false;
    const finish = () => {
      if (!done.current) {
        done.current = true;
        finishRef.current();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Space" || event.key === "Escape") {
        event.preventDefault();
        finish();
      }
      if (event.key === "Tab") {
        event.preventDefault();
        skip.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    const start = performance.now();
    const duration = reducedMotion ? 220 : 3200;
    let frame = 0;
    const tick = (now: number) => {
      const elapsed = now - start;
      setProgress(
        Math.min(readyRef.current ? 100 : 92, (elapsed / duration) * 100),
      );
      if (elapsed >= duration + (reducedMotion ? 100 : 350) && readyRef.current)
        finish();
      if (!done.current) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected && previousFocus !== document.body)
        previousFocus.focus({ preventScroll: true });
      else
        document
          .querySelector<HTMLButtonElement>(".brand-button")
          ?.focus({ preventScroll: true });
    };
  }, [reducedMotion]);

  function finish() {
    if (!done.current) {
      done.current = true;
      onComplete();
    }
  }
  return (
    <motion.section
      className="intro-screen"
      role="dialog"
      aria-modal="true"
      aria-label="DaWest loading introduction"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, filter: reducedMotion ? "none" : "blur(5px)" }}
      transition={{ duration: reducedMotion ? 0.15 : 0.6 }}
    >
      <div className="intro-topline">
        <span className="intro-wordmark">
          DW<span>®</span>
        </span>
        <span>THE COMPETITIVE FRONTIER</span>
        <span>SEASON 04 / 2026</span>
      </div>
      <div className="intro-frame">
        <i />
        <i />
        <i />
        <i />
        <div className="intro-title">
          <span className="intro-title-rule" />
          <h1 className="vhs-title" data-text="DAWEST" aria-label="DAWEST">
            <TypewriterText text="DAWEST" speed={95} delay={350} />
          </h1>
          <span className="intro-title-rule" />
        </div>
        <p className="intro-credit">The frontier remembers your name.</p>
        <div
          className="intro-progress"
          role="progressbar"
          aria-label="Intro progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.floor(progress)}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <span className="intro-percentage">{Math.floor(progress)}%</span>
        <p className="intro-status" aria-live="polite">
          {!ready
            ? "SYNCHRONIZING THE LADDER"
            : progress < 70
              ? "PREPARING THE FRONTIER"
              : "WELCOME TO THE WEST"}
        </p>
      </div>
      <div className="intro-bottomline">
        <span>EVERY MATCH LEAVES A MARK.</span>
        <div>
          <span>Press SPACE to enter</span>
          <button ref={skip} onClick={finish} aria-label="Skip intro">
            SKIP <kbd>SPACE</kbd>
          </button>
        </div>
      </div>
    </motion.section>
  );
}
