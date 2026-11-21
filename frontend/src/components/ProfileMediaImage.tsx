import { useReducedMotion } from "framer-motion";
import type { ImgHTMLAttributes } from "react";

export function ProfileMediaImage({
  src,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const reducedMotion = useReducedMotion();
  const source =
    reducedMotion &&
    (src.startsWith("/api/v1/players/") ||
      src.startsWith("/api/v1/factions/")) &&
    src.includes("/media/")
      ? `${src}${src.includes("?") ? "&" : "?"}still=1`
      : src;
  return <img {...props} src={source} />;
}
