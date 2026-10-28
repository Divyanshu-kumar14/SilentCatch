"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { API_BASE } from "@/lib/api";
import type { Encounter } from "@/lib/types";

interface ThreeDProps {
  encounter: Encounter;
  roi?: { cx: number; cy: number; ring: number };
}

const SLICE_COUNT = 34;
const SLICE_SIZE = 13.6;
const SLICE_SPACING = 0.44;
const KEY_INDEX = Math.floor(SLICE_COUNT / 2);

/**
 * An interactive reconstruction, not a DICOM volume: the fixture ships one
 * axial slice, so the stack is 34 additive planes of that slice with the key
 * plane readable. The slice control moves the emphasised plane and the beacon.
 */
export default function ThreeDVolumeViewer({ encounter, roi }: ThreeDProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [slice, setSlice] = useState(KEY_INDEX);
  const [autoRotate, setAutoRotate] = useState(true);

  const materialsRef = useRef<THREE.MeshBasicMaterial[]>([]);
  const beaconRef = useRef<THREE.Group | null>(null);
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;

  const emphasize = useCallback((index: number) => {
    materialsRef.current.forEach((mat, i) => {
      const dist = Math.abs(i - index);
      const isActive = i === index;
      mat.opacity = isActive
        ? 0.9
        : Math.max(0.02, 0.26 * Math.exp(-(dist * dist) / 20));
      mat.blending = isActive ? THREE.NormalBlending : THREE.AdditiveBlending;
      mat.color.set(isActive ? 0xffffff : 0xcfc9bc);
      mat.needsUpdate = true;
    });
    if (beaconRef.current) {
      beaconRef.current.position.z = (index - KEY_INDEX) * SLICE_SPACING;
    }
  }, []);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 320;
    const height = container.clientHeight || 248;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x08090a);
    scene.fog = new THREE.FogExp2(0x08090a, 0.018);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 200);
    // Off-axis start so the plane stack reads as a volume, not a flat image.
    camera.position.set(7.4, 5.2, 14.6);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.rotateSpeed = 0.7;
    controls.zoomSpeed = 0.7;
    controls.enablePan = false;
    controls.minDistance = 8;
    controls.maxDistance = 32;
    controls.minPolarAngle = 0.25;
    controls.maxPolarAngle = Math.PI - 0.25;
    controls.autoRotateSpeed = 0.55;
    controls.target.set(0, 0, 0);

    const volume = new THREE.Group();
    volume.rotation.x = -0.14;
    volume.rotation.y = -0.52;
    scene.add(volume);

    // ── planes ──────────────────────────────────────────────────────
    const geometry = new THREE.PlaneGeometry(SLICE_SIZE, SLICE_SIZE);
    const materials: THREE.MeshBasicMaterial[] = [];

    for (let i = 0; i < SLICE_COUNT; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.05,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: new THREE.Color(0xcfc9bc),
      });
      materials.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.z = (i - KEY_INDEX) * SLICE_SPACING;
      volume.add(mesh);
    }
    materialsRef.current = materials;
    emphasize(KEY_INDEX);

    // ── volume bounds ───────────────────────────────────────────────
    const cage = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(SLICE_SIZE, SLICE_SIZE, SLICE_COUNT * SLICE_SPACING)),
      new THREE.LineBasicMaterial({
        color: 0x8f8b80,
        transparent: true,
        opacity: 0.22,
      })
    );
    volume.add(cage);

    // ── beacon on the ROI, riding the emphasised plane ──────────────
    const beacon = new THREE.Group();
    const roiX = roi ? (roi.cx / 256 - 0.5) * SLICE_SIZE : 1.9;
    const roiY = roi ? -(roi.cy / 256 - 0.5) * SLICE_SIZE : 2.4;
    beacon.position.set(roiX, roiY, 0);
    beaconRef.current = beacon;

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xd8323a, transparent: true, opacity: 0.95 })
    );
    beacon.add(sphere);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.26, 0.32, 48),
      new THREE.MeshBasicMaterial({
        color: 0xd8323a,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    beacon.add(ring);

    // faint radial glow
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = 128;
    glowCanvas.height = 128;
    const gtx = glowCanvas.getContext("2d");
    if (gtx) {
      const grad = gtx.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, "rgba(255,120,120,0.9)");
      grad.addColorStop(0.4, "rgba(176,35,42,0.28)");
      grad.addColorStop(1, "rgba(176,35,42,0)");
      gtx.fillStyle = grad;
      gtx.fillRect(0, 0, 128, 128);
    }
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    glowTex.colorSpace = THREE.SRGBColorSpace;
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.8,
      })
    );
    glow.scale.set(2.1, 2.1, 1);
    beacon.add(glow);

    // leader line from the beacon to the upper right
    const leader = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1.5, 1, 0),
        new THREE.Vector3(2.9, 1, 0),
      ]),
      new THREE.LineBasicMaterial({ color: 0xb0232a, transparent: true, opacity: 0.5 })
    );
    beacon.add(leader);
    volume.add(beacon);

    // ── dust for depth cues ─────────────────────────────────────────
    const dustGeom = new THREE.BufferGeometry();
    const dustCount = 260;
    const positions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 34;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 24;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 22;
    }
    dustGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const dustMat = new THREE.PointsMaterial({
      color: 0x8f8b80,
      size: 0.03,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    const dust = new THREE.Points(dustGeom, dustMat);
    scene.add(dust);

    // ── texture ─────────────────────────────────────────────────────
    let disposed = false;
    let texture: THREE.Texture | null = null;
    const imageUrl = `${API_BASE}${encounter.radiology_study.slice_image_url}`;
    new THREE.TextureLoader().load(
      imageUrl,
      (tex) => {
        if (disposed) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        texture = tex;
        materials.forEach((m) => {
          m.map = tex;
          m.needsUpdate = true;
        });
      },
      undefined,
      () => {
        /* A missing fixture leaves the chamber empty; the DOM carries the label. */
      }
    );

    // ── loop ────────────────────────────────────────────────────────
    const clock = new THREE.Clock();
    let raf = 0;
    let running = true;

    const animate = () => {
      if (!running) return;
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      controls.autoRotate = autoRotateRef.current;
      controls.update();
      dust.rotation.y = t * 0.01;
      const pulse = 1 + Math.sin(t * 2.6) * 0.16;
      ring.scale.set(pulse, pulse, 1);
      glow.material.opacity = 0.62 + Math.sin(t * 2.6) * 0.14;
      renderer.render(scene, camera);
    };
    animate();

    // ── resize + visibility ─────────────────────────────────────────
    const resize = () => {
      const w = container.clientWidth || width;
      const h = container.clientHeight || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const visibility = new IntersectionObserver(
      ([entry]) => {
        running = entry.isIntersecting;
        if (running) {
          clock.getDelta();
          animate();
        } else {
          cancelAnimationFrame(raf);
        }
      },
      { threshold: 0 }
    );
    visibility.observe(container);

    return () => {
      disposed = true;
      running = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      visibility.disconnect();
      controls.dispose();
      geometry.dispose();
      materials.forEach((m) => m.dispose());
      texture?.dispose();
      cage.geometry.dispose();
      (cage.material as THREE.Material).dispose();
      dustGeom.dispose();
      dustMat.dispose();
      sphere.geometry.dispose();
      (sphere.material as THREE.Material).dispose();
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
      glow.material.map?.dispose();
      glow.material.dispose();
      (leader.geometry as THREE.BufferGeometry).dispose();
      (leader.material as THREE.Material).dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
    // The scene is rebuilt only when the encounter or ROI changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounter.encounter_id, encounter.radiology_study.slice_image_url, roi?.cx, roi?.cy]);

  // auto-rotate is toggled without rebuilding the scene
  useEffect(() => {
    emphasize(slice);
  }, [slice, emphasize]);

  return (
    <div className="chamber relative flex h-[248px] w-full flex-col overflow-hidden">
      <div
        ref={mountRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        role="img"
        aria-label={`Interactive 3D reconstruction of ${encounter.encounter_id}, built from the single key slice`}
      />

      {/* top HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 bg-gradient-to-b from-black/75 via-black/30 to-transparent px-2.5 pb-8 pt-2.5">
        <span className="mono text-[10.5px] leading-[1.45] text-night-ink/60">
          3D reconstruction
          <br />
          <span className="text-night-ink/35">34 planes · not raw DICOM</span>
          <br />
          <span className="text-night-ink/25">drag to orbit · scroll to zoom</span>
        </span>
        <button
          onClick={() => setAutoRotate((v) => !v)}
          aria-pressed={autoRotate}
          className="pointer-events-auto border border-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-night-ink/70 transition-colors hover:border-white/40 hover:text-night-ink"
        >
          {autoRotate ? "pause" : "orbit"}
        </button>
      </div>

      {/* bottom slice control */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2.5 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-2.5 pb-2.5 pt-7">
        <span className="mono shrink-0 text-[10.5px] text-night-ink/55">
          plane <span className="text-night-ink/85">{String(slice + 1).padStart(2, "0")}</span>/
          {SLICE_COUNT}
        </span>
        <input
          type="range"
          min={0}
          max={SLICE_COUNT - 1}
          value={slice}
          onChange={(e) => setSlice(Number(e.target.value))}
          aria-label="Reconstruction plane"
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/20 accent-[#d8323a]"
        />
      </div>
    </div>
  );
}
