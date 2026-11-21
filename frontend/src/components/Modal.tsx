import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { motion } from "framer-motion";
export function Modal({
  children,
  title,
  onClose,
  drawer = false,
  dismissible = true,
}: {
  children: ReactNode;
  title: string;
  onClose: () => void;
  drawer?: boolean;
  dismissible?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) onClose();
      if (e.key === "Tab") {
        const focusable = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input, select, [tabindex="0"]',
          ) ?? [],
        ).filter(
          (element) =>
            !element.matches(":disabled") &&
            element.tabIndex >= 0 &&
            element.getClientRects().length > 0,
        );
        if (!focusable.length) {
          e.preventDefault();
          panel.current?.focus();
          return;
        }
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === panel.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", listener);
    return () => {
      document.body.style.overflow = oldOverflow;
      window.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, [onClose, dismissible]);
  return (
    <motion.div
      className={`modal-backdrop ${drawer ? "drawer-backdrop" : ""}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={dismissible ? onClose : undefined}
    >
      <motion.div
        ref={panel}
        className={`modal-panel ${drawer ? "drawer-panel" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        initial={drawer ? { x: 80 } : { y: 20, scale: 0.98 }}
        animate={drawer ? { x: 0 } : { y: 0, scale: 1 }}
      >
        <div className="modal-heading">
          <span className="eyebrow">DAWEST / {title}</span>
          <button
            className="icon-button"
            aria-label="Close dialog"
            disabled={!dismissible}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}
