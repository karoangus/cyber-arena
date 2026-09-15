import * as THREE from "three";

export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
}

export interface WorldRefs {
  obstacles: Box[];
  bounds: number;
  animated: ((t: number, dt: number) => void)[];
  spawnPoints: THREE.Vector3[];
}

export const ARENA = 74; // ضلع میدان (متر)
export const WALL_H = 7;

/** بافت شبکه‌ای کف میدان به صورت برنامه‌ای ساخته می‌شود */
function gridTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0a0f1e";
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = "#1d4d63";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, s - 2, s - 2);
  ctx.strokeStyle = "#2f8fa8";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, s);
  ctx.lineTo(0, 0);
  ctx.lineTo(s, 0);
  ctx.stroke();
  ctx.fillStyle = "rgba(34,211,238,0.10)";
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(ARENA / 3, ARENA / 3);
  t.anisotropy = 2;
  return t;
}

function radialSprite(color: string, soft = 0.35): THREE.Texture {
  const s = 64;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, color);
  g.addColorStop(soft, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

export const glowTexture = radialSprite("rgba(255,255,255,1)", 0.25);

export function buildWorld(scene: THREE.Scene): WorldRefs {
  const obstacles: Box[] = [];
  const animated: ((t: number, dt: number) => void)[] = [];
  const half = ARENA / 2;

  scene.background = new THREE.Color(0x05060f);
  scene.fog = new THREE.FogExp2(0x060a18, 0.021);

  // ---------- نورپردازی ----------
  const hemi = new THREE.HemisphereLight(0x3b6ea5, 0x0a1020, 0.85);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0x9fb4ff, 0.85);
  dir.position.set(40, 70, 20);
  scene.add(dir);
  const p1 = new THREE.PointLight(0x22d3ee, 60, 60, 2);
  p1.position.set(0, 7, 0);
  scene.add(p1);
  const p2 = new THREE.PointLight(0xf472b6, 45, 55, 2);
  p2.position.set(-22, 6, 18);
  scene.add(p2);
  const p3 = new THREE.PointLight(0x7c3aed, 30, 40, 2);
  p3.position.set(24, 6, -20);
  scene.add(p3);
  animated.push((t) => {
    p3.intensity = 24 + Math.sin(t * 1.1 + 2) * 8;
  });
  animated.push((t) => {
    p1.intensity = 55 + Math.sin(t * 1.4) * 12;
    p2.intensity = 40 + Math.sin(t * 0.9 + 1) * 10;
  });

  // ---------- کف ----------
  const floorMat = new THREE.MeshPhongMaterial({
    map: gridTexture(),
    color: 0xffffff,
    emissive: 0x0d3550,
    emissiveIntensity: 0.55,
    shininess: 30,
    specular: 0x14323f,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA, ARENA), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // ---------- دیوارهای بیرونی ----------
  const wallMat = new THREE.MeshPhongMaterial({ color: 0x121a2e, shininess: 12, emissive: 0x061424 });
  const stripMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
  const mkWall = (x: number, z: number, w: number, d: number, h: number, strip = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, h / 2, z);
    scene.add(m);
    if (strip) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(w * 0.98, 0.16, d * 0.98), stripMat);
      e.position.set(x, h + 0.05, z);
      scene.add(e);
    }
    obstacles.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: h });
  };

  const T = 1.4;
  mkWall(0, -half, ARENA, T, WALL_H, false);
  mkWall(0, half, ARENA, T, WALL_H, false);
  mkWall(-half, 0, T, ARENA, WALL_H, false);
  mkWall(half, 0, T, ARENA, WALL_H, false);

  // نوارهای نورانی دیوارها
  const wallStrip = (w: number, h: number, x: number, z: number, ry: number) => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x1a6f8a }));
    s.position.set(x, WALL_H * 0.55, z);
    s.rotation.y = ry;
    scene.add(s);
  };
  wallStrip(ARENA * 0.94, 0.4, 0, -half + 0.75, 0);
  wallStrip(ARENA * 0.94, 0.4, 0, half - 0.75, Math.PI);
  wallStrip(ARENA * 0.94, 0.4, -half + 0.75, 0, Math.PI / 2);
  wallStrip(ARENA * 0.94, 0.4, half - 0.75, 0, -Math.PI / 2);

  // ---------- موانع داخل میدان (تقارن برای بازی عادلانه) ----------
  const layout: [number, number, number, number, number][] = [
    [0, 0, 9, 9, 2.6],
    [0, -15, 7, 2.6, 3.4],
    [0, 15, 7, 2.6, 3.4],
    [-15, 0, 2.6, 7, 3.4],
    [15, 0, 2.6, 7, 3.4],
    [-14, -14, 6, 6, 5.2],
    [14, -14, 6, 6, 5.2],
    [-14, 14, 6, 6, 5.2],
    [14, 14, 6, 6, 5.2],
    [-26, -26, 4.5, 4.5, 6.2],
    [26, -26, 4.5, 4.5, 6.2],
    [-26, 26, 4.5, 4.5, 6.2],
    [26, 26, 4.5, 4.5, 6.2],
    [-6.5, -9.5, 2.6, 2.6, 2.2],
    [6.5, 9.5, 2.6, 2.6, 2.2],
    [-9.5, 6.5, 2.6, 2.6, 2.2],
    [9.5, -6.5, 2.6, 2.6, 2.2],
    [-30, -8, 3, 3, 4.6],
    [30, 8, 3, 3, 4.6],
    [-8, 30, 3, 3, 4.6],
    [8, -30, 3, 3, 4.6],
  ];
  for (const [x, z, w, d, h] of layout) mkWall(x, z, w, d, h);

  // ---------- حلقه‌های نئونی شناور + هسته مرکزی ----------
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xf472b6 });
  for (let i = 0; i < 5; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(3.2 + i, 0.14, 6, 30), ringMat.clone());
    (r.material as THREE.MeshBasicMaterial).color.setHSL(0.5 + i * 0.09, 0.9, 0.6);
    r.position.set(Math.cos(i * 1.3) * 22, 9 + i * 1.5, Math.sin(i * 1.3) * 22);
    r.rotation.x = Math.PI / 2.6;
    scene.add(r);
    const speed = 0.25 + i * 0.07;
    animated.push((t) => {
      r.rotation.z = t * speed;
      r.position.y = 9 + i * 1.5 + Math.sin(t * 0.7 + i) * 0.8;
    });
  }
  const coreMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, wireframe: true });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 1), coreMat);
  core.position.set(0, 9, 0);
  scene.add(core);
  animated.push((t) => {
    core.rotation.y = t * 0.4;
    core.rotation.x = t * 0.22;
    const k = 1 + Math.sin(t * 2) * 0.04;
    core.scale.setScalar(k);
  });

  // ---------- آسمان & افق شهر ----------
  const skyGeo = new THREE.SphereGeometry(400, 20, 14);
  const cols = new Float32Array(skyGeo.attributes.position.count * 3);
  const pos = skyGeo.attributes.position;
  const bottom = new THREE.Color(0x05060f);
  const top = new THREE.Color(0x0a2140);
  const horizon = new THREE.Color(0x143a54);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 400;
    if (y < 0) tmp.copy(horizon).lerp(bottom, Math.min(1, -y * 1.6));
    else tmp.copy(horizon).lerp(top, Math.min(1, y * 1.3));
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  skyGeo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  scene.add(sky);

  // ستاره‌ها
  const starCount = 260;
  const sp = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const v = new THREE.Vector3().setFromSphericalCoords(370, Math.acos(Math.random() * 0.75), Math.random() * Math.PI * 2);
    sp.set([v.x, Math.abs(v.y) * 0.95 + 20, v.z], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  scene.add(
    new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9fd8ff, size: 3.2, sizeAttenuation: false, transparent: true, opacity: 0.8, fog: false })),
  );

  // خط افق شهر
  const towerMat = new THREE.MeshBasicMaterial({ color: 0x0b1526, fog: true });
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0x256075 });
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2 + 0.1;
    const rad = 60 + Math.random() * 55;
    const h = 10 + Math.random() * 34;
    const w = 5 + Math.random() * 12;
    const tw = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), towerMat);
    tw.position.set(Math.cos(a) * rad, h / 2 - 3, Math.sin(a) * rad);
    scene.add(tw);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, 0.5, w * 1.02), edgeMat);
    cap.position.set(tw.position.x, h - 3, tw.position.z);
    scene.add(cap);
  }

  // ---------- نقاط تولد دشمن ----------
  const spawnPoints: THREE.Vector3[] = [];
  const R = half - 5;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    spawnPoints.push(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R));
  }

  return { obstacles, bounds: half - 2.2, animated, spawnPoints };
}

/** حل برخورد دایره (بازیکن/دشمن) با جعبه‌های مانع */
export function resolveCircle(pos: THREE.Vector3, radius: number, boxes: Box[], bounds: number) {
  pos.x = THREE.MathUtils.clamp(pos.x, -bounds, bounds);
  pos.z = THREE.MathUtils.clamp(pos.z, -bounds, bounds);
  for (const b of boxes) {
    if (pos.y >= b.top) continue;
    const cx = THREE.MathUtils.clamp(pos.x, b.minX, b.maxX);
    const cz = THREE.MathUtils.clamp(pos.z, b.minZ, b.maxZ);
    let dx = pos.x - cx;
    let dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 > radius * radius) continue;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      pos.x = cx + (dx / d) * radius;
      pos.z = cz + (dz / d) * radius;
    } else {
      // داخل جعبه: به نزدیک‌ترین ضلع رانده می‌شو
      const left = pos.x - b.minX;
      const right = b.maxX - pos.x;
      const front = pos.z - b.minZ;
      const back = b.maxZ - pos.z;
      const m = Math.min(left, right, front, back);
      if (m === left) pos.x = b.minX - radius;
      else if (m === right) pos.x = b.maxX + radius;
      else if (m === front) pos.z = b.minZ - radius;
      else pos.z = b.maxZ + radius;
    }
  }
}

/** آیا پاره‌خط بین دو نقطه توسط موانع مسدود شده است؟ */
export function segmentBlocked(a: THREE.Vector3, b: THREE.Vector3, boxes: Box[], steps = 12): boolean {
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const z = a.z + (b.z - a.z) * t;
    for (const box of boxes) {
      if (y <= box.top && x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ) return true;
    }
  }
  return false;
}
