"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { API_BASE } from "@/lib/api";
import type { Encounter } from "@/lib/types";

interface ThreeDProps {
  encounter: Encounter;
  roi?: { cx: number; cy: number; ring: number };
}

export default function ThreeDVolumeViewer({ encounter, roi }: ThreeDProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [sliceLevel, setSliceLevel] = useState<number>(42); // default slice 42 for ED-104
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const controlsRef = useRef<OrbitControls | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 320;
    const height = container.clientHeight || 280;

    // 1. Scene & Camera
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06090e);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, -18, 22);

    // 2. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // 3. OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.8;
    controls.maxDistance = 45;
    controls.minDistance = 8;
    controlsRef.current = controls;

    // 4. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x38bdf8, 1.5);
    dirLight1.position.set(10, 15, 20);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x0284c7, 0.8);
    dirLight2.position.set(-10, -15, -10);
    scene.add(dirLight2);

    // 5. Volume Stack (Multiple Axial CT Slices)
    const stackGroup = new THREE.Group();
    scene.add(stackGroup);

    // Load actual slice image as primary texture
    const textureLoader = new THREE.TextureLoader();
    const imageUrl = `${API_BASE}${encounter.radiology_study.slice_image_url}`;

    textureLoader.load(imageUrl, (texture) => {
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;

      const numSlices = 14;
      const sliceSpacing = 0.8;
      const planeGeo = new THREE.PlaneGeometry(16, 16);

      for (let i = 0; i < numSlices; i++) {
        const zPos = (i - numSlices / 2) * sliceSpacing;
        const isTarget = i === Math.floor(numSlices / 2);

        let mat: THREE.Material;
        if (isTarget) {
          // Key slice with actual radiology texture
          mat = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: 0.95,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
        } else {
          // Surrounding context slices with fading opacity
          const distFromTarget = Math.abs(i - numSlices / 2);
          const opacity = Math.max(0.08, 0.35 - distFromTarget * 0.05);
          mat = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: opacity,
            side: THREE.DoubleSide,
            depthWrite: false,
            color: new THREE.Color(0x38bdf8),
          });
        }

        const sliceMesh = new THREE.Mesh(planeGeo, mat);
        sliceMesh.position.z = zPos;
        stackGroup.add(sliceMesh);
      }
    });

    // 6. Anatomical Bounding Cage with glowing cyan corners
    const boxGeo = new THREE.BoxGeometry(16.5, 16.5, 12);
    const boxMat = new THREE.MeshBasicMaterial({
      color: 0x0284c7,
      wireframe: true,
      transparent: true,
      opacity: 0.25,
    });
    const boxMesh = new THREE.Mesh(boxGeo, boxMat);
    scene.add(boxMesh);

    // 7. 3D Nodule Caliper Beacon (if ROI coordinates exist)
    let beaconGroup: THREE.Group | null = null;
    if (roi) {
      beaconGroup = new THREE.Group();

      // Normalize 256x256 ROI coordinates to Three.js [-8, +8] coordinates
      const normX = ((roi.cx - 128) / 128) * 8.0;
      const normY = -((roi.cy - 128) / 128) * 8.0; // Inverted Y in canvas
      const normZ = 0.0;

      // Inner glowing sphere
      const sphereGeo = new THREE.SphereGeometry(0.45, 16, 16);
      const sphereMat = new THREE.MeshBasicMaterial({
        color: 0xf43f5e,
        transparent: true,
        opacity: 0.9,
      });
      const sphere = new THREE.Mesh(sphereGeo, sphereMat);
      beaconGroup.add(sphere);

      // Outer pulsing ring
      const ringGeo = new THREE.RingGeometry(0.7, 0.85, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      beaconGroup.add(ring);

      beaconGroup.position.set(normX, normY, normZ);
      scene.add(beaconGroup);
    }

    // 8. Animation Loop
    let animId = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);

      if (autoRotate && controls) {
        stackGroup.rotation.z += 0.003;
        boxMesh.rotation.z += 0.003;
        if (beaconGroup) {
          beaconGroup.rotation.z += 0.003;
        }
      }

      // Pulse beacon ring
      if (beaconGroup) {
        const time = clock.getElapsedTime();
        const scale = 1.0 + Math.sin(time * 3.5) * 0.15;
        beaconGroup.children[1].scale.set(scale, scale, 1);
      }

      controls.update();
      renderer.render(scene, camera);
    };

    animate();

    // 9. Resize Observer
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 320;
      const h = container.clientHeight || 280;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [encounter, roi, autoRotate]);

  return (
    <div className="relative flex h-[280px] w-full flex-col overflow-hidden rounded-lg border border-border bg-[#06090e]">
      {/* 3D WebGL Canvas */}
      <div ref={mountRef} className="h-full w-full cursor-grab active:cursor-grabbing" />

      {/* Floating HUD Controls */}
      <div className="pointer-events-none absolute inset-x-2 top-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-slate-900/80 px-2.5 py-0.5 text-[10px] font-mono font-medium text-sky-400 backdrop-blur-md">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
          <span>3D VOLUMETRIC CT · {encounter.radiology_study.modality}</span>
        </div>

        <button
          onClick={() => setAutoRotate(!autoRotate)}
          className="pointer-events-auto rounded border border-border bg-slate-900/80 px-2 py-0.5 text-[10px] font-mono text-slate-300 hover:text-white transition-colors"
        >
          {autoRotate ? "Pause Spin" : "Auto Spin"}
        </button>
      </div>

      {/* Slice Level Slider & 3D Indicator */}
      <div className="pointer-events-auto absolute inset-x-3 bottom-2 flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-slate-950/80 px-3 py-1.5 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-slate-400">Slice:</span>
          <span className="font-mono text-[11px] font-bold text-sky-400">#{sliceLevel}</span>
        </div>
        <input
          type="range"
          min={10}
          max={80}
          value={sliceLevel}
          onChange={(e) => setSliceLevel(Number(e.target.value))}
          className="h-1 w-36 cursor-pointer appearance-none rounded-lg bg-slate-800 accent-sky-400"
        />
        <div className="font-mono text-[9px] text-slate-400">
          Orbit: Click & Drag · Zoom: Scroll
        </div>
      </div>
    </div>
  );
}
