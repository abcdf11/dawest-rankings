import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

export function TypewriterText({
  text,
  active = true,
  speed = 50,
  delay = 0,
}: {
  text: string;
  active?: boolean;
  speed?: number;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  const [length, setLength] = useState(reduced ? text.length : 0);
  useEffect(() => {
    if (!active) {
      setLength(0);
      return;
    }
    if (reduced) {
      setLength(text.length);
      return;
    }
    setLength(0);
    let count = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      count += 1;
      setLength(count);
      if (count < text.length) timer = setTimeout(tick, speed);
    };
    timer = setTimeout(tick, delay);
    return () => clearTimeout(timer);
  }, [text, active, speed, delay, reduced]);
  return (
    <span
      className={`typewriter ${length === text.length ? "typewriter-complete" : ""}`}
    >
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.slice(0, length)}
        <span className="typewriter-cursor" />
      </span>
    </span>
  );
}
