import * as THREE from "three";
import { glowTexture } from "./world";

/** سیستم ذرات (انفجار، برخورد، جرقه) در یک draw call با شیدر اختصاصی */
export class ParticleSystem {
  points: THREE.Points;
  private count: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private size0: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private cursor = 0;
  private material: THREE.ShaderMaterial;

  constructor(count = 520) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.size0 = new Float32Array(count);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.grav = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("size", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: glowTexture },
        uProj: { value: 480 },
      },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute vec3 aColor;
        varying vec3 vColor;
        uniform float uProj;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(1.0, size * uProj / max(0.4, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor * tex.a, tex.a);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -999;
  }

  /** مقیاس اندازه ذرات بر اساس ارتفاع بافر رندر و زاویه دید دوربین */
  setProjectionScale(v: number) {
    this.material.uniforms.uProj.value = v;
  }

  burst(
    origin: THREE.Vector3,
    n: number,
    color: THREE.Color,
    opts: { speed?: number; spread?: number; gravity?: number; life?: number; size?: number; dir?: THREE.Vector3 } = {},
  ) {
    const speed = opts.speed ?? 6;
    const gravity = opts.gravity ?? 9;
    const life = opts.life ?? 0.6;
    const size = opts.size ?? 0.5;
    const dir = opts.dir;
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      const j = i * 3;
      this.pos[j] = origin.x;
      this.pos[j + 1] = origin.y;
      this.pos[j + 2] = origin.z;
      const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (v.lengthSq() < 1e-4) v.set(0, 1, 0);
      v.normalize().multiplyScalar(speed * (0.45 + Math.random() * 0.85));
      if (dir) v.lerp(dir.clone().multiplyScalar(speed), 0.55);
      this.vel[j] = v.x;
      this.vel[j + 1] = v.y;
      this.vel[j + 2] = v.z;
      const shade = 0.65 + Math.random() * 0.5;
      this.col[j] = color.r * shade;
      this.col[j + 1] = color.g * shade;
      this.col[j + 2] = color.b * shade;
      this.size0[i] = size * (0.6 + Math.random() * 0.9);
      this.size[i] = this.size0[i];
      this.life[i] = life * (0.7 + Math.random() * 0.6);
      this.maxLife[i] = this.life[i];
      this.grav[i] = gravity;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aColor.needsUpdate = true;
    this.points.geometry.attributes.size.needsUpdate = true;
  }

  update(dt: number) {
    let active = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      active = true;
      this.life[i] -= dt;
      const j = i * 3;
      if (this.life[i] <= 0) {
        this.pos[j + 1] = -999;
        this.size[i] = 0;
        continue;
      }
      this.vel[j + 1] -= this.grav[i] * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < 0.05) {
        this.pos[j + 1] = 0.05;
        this.vel[j + 1] *= -0.35;
        this.vel[j] *= 0.8;
        this.vel[j + 2] *= 0.8;
      }
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.size[i] = Math.max(0.001, this.size0[i] * (0.3 + 0.7 * k));
      this.col[j] *= 1 - dt * 1.4;
      this.col[j + 1] *= 1 - dt * 1.4;
      this.col[j + 2] *= 1 - dt * 1.4;
    }
    if (active) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.aColor.needsUpdate = true;
      this.points.geometry.attributes.size.needsUpdate = true;
    }
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

/** رگه گلوله‌ها با یک draw call (LineSegments) */
export class TracerPool {
  lines: THREE.LineSegments;
  private capacity: number;
  private positions: Float32Array;
  private colors: Float32Array;
  private life: Float32Array;
  private cursor = 0;
  private base = new THREE.Color(0.6, 1, 1);

  constructor(capacity = 40) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 6);
    this.colors = new Float32Array(capacity * 6);
    this.life = new Float32Array(capacity);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.frustumCulled = false;
  }

  add(from: THREE.Vector3, to: THREE.Vector3, color = this.base) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const j = i * 6;
    this.positions[j] = from.x;
    this.positions[j + 1] = from.y;
    this.positions[j + 2] = from.z;
    this.positions[j + 3] = to.x;
    this.positions[j + 4] = to.y;
    this.positions[j + 5] = to.z;
    this.setColor(i, color, 1);
    this.life[i] = 0.09;
    this.lines.geometry.attributes.position.needsUpdate = true;
  }

  private setColor(i: number, c: THREE.Color, k: number) {
    const j = i * 6;
    this.colors[j] = c.r * k;
    this.colors[j + 1] = c.g * k;
    this.colors[j + 2] = c.b * k;
    this.colors[j + 3] = c.r * k;
    this.colors[j + 4] = c.g * k;
    this.colors[j + 5] = c.b * k;
    this.lines.geometry.attributes.color.needsUpdate = true;
  }

  update(dt: number) {
    const c = this.base;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / 0.09);
      this.setColor(i, c, k);
      if (this.life[i] <= 0) {
        const j = i * 6;
        this.positions[j + 1] = -999;
        this.positions[j + 4] = -999;
        this.lines.geometry.attributes.position.needsUpdate = true;
      }
    }
  }
}
