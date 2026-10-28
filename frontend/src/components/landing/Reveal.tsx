"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * Reveals content on entry, but never hides it by default: if scripting fails,
 * or the element is already on screen, it stays visible.
 */
export default function Reveal({
  children,
  className = "",
  delay = 0,
  y = 18,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.92) return;

    el.style.opacity = "0";
    el.style.transform = `translateY(${y}px)`;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        el.style.transition = `opacity .7s cubic-bezier(.16,1,.3,1) ${delay}s, transform .7s cubic-bezier(.16,1,.3,1) ${delay}s`;
        el.style.opacity = "1";
        el.style.transform = "translateY(0)";
        io.disconnect();
      },
      { rootMargin: "-8%" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delay, y]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
