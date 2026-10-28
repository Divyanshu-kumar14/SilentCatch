import * as THREE from "three";

/**
 * A volume reconstructed from a single key slice.
 *
 * The fixture ships one 512×512 axial slice per encounter, not a DICOM stack.
 * We stack 34 additive planes of that slice and treat the centre plane as the
 * readable key slice. It is a reconstruction, and the UI says so.
 */

export type VolumeMode = "film" | "still";

export interface VolumeSceneOptions {
  imageUrl: string;
  /** ROI in the fixture's 256-space slice coordinates. */
  roi?: { cx: number; cy: number } | null;
  mode?: VolumeMode;
}

export interface VolumeSceneHandle {
  setProgress: (p: number) => void;
  dispose: () => void;
}

const SLICE_COUNT = 34;
const SLICE_SIZE = 13.6;
const SLICE_SPACING = 0.44;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const CAMERA_KEYS: Array<{
  p: number;
  pos: [number, number, number];
  look: [number, number, number];
}> = [
  { p: 0.0, pos: [0, 1.2, 20.5], look: [0, 0, 0] },
  { p: 0.16, pos: [4.8, 2.8, 15], look: [0, 0, 0] },
  { p: 0.34, pos: [4.6, 3.0, 10.5], look: [1.8, 2.2, 0] },
  { p: 0.48, pos: [3.0, 2.8, 8.6], look: [2.2, 2.1, 0] },
  { p: 0.62, pos: [0.6, 2.2, 18], look: [0.8, 0.8, 0] },
  { p: 0.78, pos: [-1.4, 2.0, 19], look: [1.2, 1.0, 0] },
  { p: 1.0, pos: [-0.4, 1.6, 19.5], look: [0.8, 1.0, 0] },
];

function sampleCamera(p: number) {
  let i = 0;
  while (i < CAMERA_KEYS.length - 2 && p > CAMERA_KEYS[i + 1].p) i += 1;
  const a = CAMERA_KEYS[i];
  const b = CAMERA_KEYS[i + 1];
  const raw = clamp01((p - a.p) / (b.p - a.p));
  const t = raw * raw * (3 - 2 * raw);
  return {
    pos: new THREE.Vector3(
      lerp(a.pos[0], b.pos[0], t),
      lerp(a.pos[1], b.pos[1], t),
      lerp(a.pos[2], b.pos[2], t)
    ),
    look: new THREE.Vector3(
      lerp(a.look[0], b.look[0], t),
      lerp(a.look[1], b.look[1], t),
      lerp(a.look[2], b.look[2], t)
    ),
  };
}

function glowTexture(color: string): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, color);
    g.addColorStop(0.35, "rgba(176,35,42,0.35)");
    g.addColorStop(1, "rgba(176,35,42,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createVolumeScene(
  container: HTMLElement,
  { imageUrl, roi, mode = "film" }: VolumeSceneOptions
): VolumeSceneHandle {
  const width = container.clientWidth || 800;
  const height = container.clientHeight || 500;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x08090a);
  scene.fog = new THREE.FogExp2(0x08090a, 0.012);

  const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 200);
  camera.position.set(0, 1.2, 20.5);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const volume = new THREE.Group();
  scene.add(volume);

  // ------------------------------------------------------------------ //
  // Slices
  // ------------------------------------------------------------------ //
  const geometry = new THREE.PlaneGeometry(SLICE_SIZE, SLICE_SIZE);
  const materials: THREE.MeshBasicMaterial[] = [];
  const slices: THREE.Mesh[] = [];
  const keyIndex = Math.floor(SLICE_COUNT / 2);

  for (let i = 0; i < SLICE_COUNT; i += 1) {
    const isKey = i === keyIndex;
    const dist = Math.abs(i - keyIndex);
    const baseOpacity = isKey ? 0.96 : Math.max(0.012, 0.085 * Math.exp(-(dist * dist) / 52));
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: baseOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: isKey ? THREE.NormalBlending : THREE.AdditiveBlending,
      color: new THREE.Color(isKey ? 0xffffff : 0xb8b3a8),
    });
    material.userData.baseOpacity = baseOpacity;
    materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = (i - keyIndex) * SLICE_SPACING;
    mesh.userData.baseZ = mesh.position.z;
    mesh.userData.isKey = isKey;
    slices.push(mesh);
    volume.add(mesh);
  }

  // ------------------------------------------------------------------ //
  // Nodule beacon
  // ------------------------------------------------------------------ //
  const beacon = new THREE.Group();
  const roiX = roi ? ((roi.cx / 256) - 0.5) * SLICE_SIZE : 1.9;
  const roiY = roi ? -((roi.cy / 256) - 0.5) * SLICE_SIZE : 2.4;
  beacon.position.set(roiX, roiY, 0);

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xd8323a, transparent: true, opacity: 0.95 })
  );
  beacon.add(sphere);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.36, 48),
    new THREE.MeshBasicMaterial({
      color: 0xd8323a,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  beacon.add(ring);

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture("rgba(255,120,120,0.95)"),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.85,
    })
  );
  glow.scale.set(2.4, 2.4, 1);
  beacon.add(glow);

  const leaderGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1.7, 1.1, 0),
    new THREE.Vector3(3.1, 1.1, 0),
  ]);
  const leader = new THREE.Line(
    leaderGeom,
    new THREE.LineBasicMaterial({ color: 0xb0232a, transparent: true, opacity: 0.55 })
  );
  beacon.add(leader);
  volume.add(beacon);

  // ------------------------------------------------------------------ //
  // Dust
  // ------------------------------------------------------------------ //
  const dustGeom = new THREE.BufferGeometry();
  const dustCount = 420;
  const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i += 1) {
    dustPositions[i * 3] = (Math.random() - 0.5) * 46;
    dustPositions[i * 3 + 1] = (Math.random() - 0.5) * 30;
    dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 26;
  }
  dustGeom.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0x8f8b80,
    size: 0.035,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const dust = new THREE.Points(dustGeom, dustMat);
  scene.add(dust);

  // ------------------------------------------------------------------ //
  // Texture
  // ------------------------------------------------------------------ //
  const loader = new THREE.TextureLoader();
  let disposed = false;
  let texture: THREE.Texture | null = null;
  loader.load(
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
      /* A missing fixture image leaves the chamber empty; the DOM still carries the story. */
    }
  );

  // ------------------------------------------------------------------ //
  // Loop
  // ------------------------------------------------------------------ //
  const clock = new THREE.Clock();
  let progress = mode === "still" ? 0.16 : 0;
  let raf = 0;
  let running = true;

  const apply = (p: number) => {
    const t = clock.getElapsedTime();

    if (mode === "still") {
      const orbit = t * 0.075;
      camera.position.set(Math.sin(orbit) * 8.2 + 2.2, 3.1, Math.cos(orbit) * 13 + 4);
      camera.lookAt(0, 0.2, 0);
      volume.rotation.y = 0;
      volume.rotation.x = -0.02;
      beacon.visible = true;
      slices.forEach((mesh) => {
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = mat.userData.baseOpacity;
      });
      const pulse = 1 + Math.sin(t * 2.4) * 0.14;
      ring.scale.set(pulse, pulse, 1);
      glow.material.opacity = 0.6 + Math.sin(t * 2.4) * 0.15;
      dust.rotation.y = t * 0.01;
      return;
    }

    const { pos, look } = sampleCamera(p);
    camera.position.copy(pos);
    camera.lookAt(look);

    const explode = smoothstep(0.3, 0.5, p) * (1 - 0.55 * smoothstep(0.6, 0.72, p));
    const camPos = camera.position;
    const world = new THREE.Vector3();
    slices.forEach((mesh) => {
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mesh.position.z = mesh.userData.baseZ * (1 + explode * 1.2);
      const fade = 1 - 0.72 * smoothstep(0.66, 0.8, p);
      mesh.getWorldPosition(world);
      const near = smoothstep(5, 12, world.distanceTo(camPos));
      mat.opacity = mat.userData.baseOpacity * fade * (mesh.userData.isKey ? 1 : near);
      mat.needsUpdate = false;
    });

    volume.rotation.y = -0.32 + p * 0.55;
    volume.rotation.x = -0.03 + Math.sin(t * 0.25) * 0.008;

    beacon.visible = p > 0.18;
    const beaconFade = smoothstep(0.2, 0.34, p) * (1 - 0.65 * smoothstep(0.7, 0.85, p));
    (sphere.material as THREE.MeshBasicMaterial).opacity = beaconFade;
    (ring.material as THREE.MeshBasicMaterial).opacity = beaconFade * 0.85;
    (leader.material as THREE.LineBasicMaterial).opacity = beaconFade * 0.5;
    glow.material.opacity = beaconFade * 0.75;
    const pulse = 1 + Math.sin(t * 3) * 0.12;
    ring.scale.set(pulse, pulse, 1);

    dust.rotation.y = t * 0.008 + p * 0.2;
  };

  const animate = () => {
    if (!running) return;
    raf = requestAnimationFrame(animate);
    apply(progress);
    renderer.render(scene, camera);
  };
  animate();

  // ------------------------------------------------------------------ //
  // Resize + visibility
  // ------------------------------------------------------------------ //
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

  return {
    setProgress: (p: number) => {
      progress = clamp01(p);
    },
    dispose: () => {
      disposed = true;
      running = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      visibility.disconnect();
      geometry.dispose();
      materials.forEach((m) => m.dispose());
      texture?.dispose();
      dustGeom.dispose();
      dustMat.dispose();
      leaderGeom.dispose();
      (leader.material as THREE.Material).dispose();
      glow.material.map?.dispose();
      glow.material.dispose();
      sphere.geometry.dispose();
      (sphere.material as THREE.Material).dispose();
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}
