"use client";

import { useEffect, useRef } from "react";
import { createVolumeScene } from "@/lib/volume-scene";

/** The hero's imaging band: one live reconstruction, slowly turning. */
export default function VolumeStill({
  imageUrl,
  roi,
}: {
  imageUrl: string;
  roi?: { cx: number; cy: number };
}) {
  const mount = useRef<HTMLDivElement>(null);
  const cx = roi?.cx;
  const cy = roi?.cy;

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    const scene = createVolumeScene(el, {
      imageUrl,
      roi: cx === undefined || cy === undefined ? undefined : { cx, cy },
      mode: "still",
    });
    return () => scene.dispose();
  }, [imageUrl, cx, cy]);

  return <div ref={mount} className="absolute inset-0" aria-hidden />;
}
