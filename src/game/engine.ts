import * as THREE from "three";
import { sound } from "./audio";
import { ParticleSystem, TracerPool } from "./effects";
import type { GameOptions, HudState } from "./types";
import { ARENA, buildWorld, resolveCircle, segmentBlocked, type Box, type WorldRefs } from "./world";

type Kind = "drone" | "rusher" | "heavy";

interface Enemy {
  kind: Kind;
  group: THREE.Group;
  core: THREE.Mesh;
  ring: THREE.Mesh;
  hp: number;
  maxHp: number;
  radius: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  shootCd: number;
  hitFlash: number;
  alive: boolean;
  speed: number;
  dmg: number;
  phase: number;
  orbit: number;
  spawnT: number;
  burst: number;
  burstCd: number;
  scoreValue: number;
  hoverY: number;
}

interface Orb {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  dmg: number;
  active: boolean;
}

interface Pickup {
  mesh: THREE.Group;
  kind: "hp" | "ammo";
  life: number;
  t: number;
  active: boolean;
  pos: THREE.Vector3;
}

const KIND_STATS: Record<Kind, { hp: number; radius: number; speed: number; dmg: number; hover: number; color: number; score: number }> = {
  drone: { hp: 34, radius: 0.75, speed: 4.0, dmg: 8, hover: 2.0, color: 0xff3d6e, score: 100 },
  rusher: { hp: 22, radius: 0.6, speed: 7.6, dmg: 24, hover: 0.55, color: 0x6ef34f, score: 75 },
  heavy: { hp: 85, radius: 1.0, speed: 2.6, dmg: 12, hover: 2.4, color: 0xa855f7, score: 220 },
};

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private world: WorldRefs;
  private particles: ParticleSystem;
  private tracers: TracerPool;

  private gun = new THREE.Group();
  private muzzle = new THREE.Object3D();
  private muzzleLight: THREE.PointLight;
  private gunKick = 0;
  private gunSway = new THREE.Vector2();

  // بازیکن
  private pos = new THREE.Vector3(0, 0, 22);
  private vel = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private onGround = true;
  private bob = 0;
  private hp = 100;
  private maxHp = 100;
  private lastDamage = -99;
  private invuln = 0;
  alive = true;
  private deathT = 0;

  // اسلحه
  private ammo = 34;
  private magSize = 34;
  private reserve = 240;
  private fireCd = 0;
  private reloading = false;
  private reloadT = 0;
  private recoilPitch = 0;
  private shotCount = 0;
  private blastCd = 0;
  private blastMax = 14;
  private blastRing: THREE.Mesh;

  // ورودی
  private input = { x: 0, y: 0 };
  private firing = false;
  private wantJump = false;
  sensitivity = 1;
  assist = 2.0;
  autoFire = true;
  haptics = true;
  private currentLock = false;
  private lockTick = 0;
  private desktop = false;
  private keys = new Set<string>();
  private locked = false;

  // دشمن‌ها
  private enemies: Enemy[] = [];
  private orbs: Orb[] = [];
  private pickups: Pickup[] = [];
  private wave = 0;
  private score = 0;
  private kills = 0;
  private combo = 0;
  private comboTimer = 0;
  private spawnQueue: Kind[] = [];
  private spawnTimer = 0;
  private breakTimer = -1;
  private banner = "";
  private bannerT = 0;
  private shake = 0;
  private shakeT = 0;

  running = false;
  paused = false;
  private raf = 0;
  private lastT = 0;
  private stateT = 0;
  private elapsed = 0;
  private opts: GameOptions & { onAutoPause?: () => void };
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, opts: GameOptions & { onAutoPause?: () => void }) {
    this.opts = opts;
    const mobile = typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches ?? false);
    this.desktop = !mobile;
    this.assist = mobile ? 2.2 : 1.25;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !mobile,
      powerPreference: "high-performance",
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.6 : 2));
    this.renderer.setClearColor(0x05060f, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.08, 500);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);

    this.world = buildWorld(this.scene);
    this.particles = new ParticleSystem(560);
    this.scene.add(this.particles.points);
    this.tracers = new TracerPool(44);
    this.scene.add(this.tracers.lines);

    this.buildGun();

    this.muzzleLight = new THREE.PointLight(0x88e0ff, 0, 12, 2);
    this.muzzleLight.position.set(0.3, 0.1, -1.1);
    this.camera.add(this.muzzleLight);

    const ringGeo = new THREE.RingGeometry(1, 1.25, 40);
    this.blastRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.blastRing.rotation.x = -Math.PI / 2;
    this.scene.add(this.blastRing);

    // استخر گلوله دشمن
    const orbGeo = new THREE.IcosahedronGeometry(0.22, 0);
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xff6464 });
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(orbGeo, orbMat);
      m.visible = false;
      this.scene.add(m);
      this.orbs.push({ mesh: m, vel: new THREE.Vector3(), life: 0, dmg: 0, active: false });
    }

    this.resize();
    this.attachListeners(canvas);

    // پیش‌نمایش صحنه پشت منوی اصلی
    this.updateCamera(0);
    this.renderer.render(this.scene, this.camera);
  }

  // ---------- ساخت مدل اسلحه ----------
  private buildGun() {
    const metal = new THREE.MeshPhongMaterial({ color: 0x2b3448, shininess: 60, specular: 0x8899bb });
    const dark = new THREE.MeshPhongMaterial({ color: 0x151a26, shininess: 30 });
    const energy = new THREE.MeshBasicMaterial({ color: 0x22d3ee });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.17, 0.62), metal);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.5, 10), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, -0.5);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.22, 0.14), dark);
    grip.position.set(0, -0.16, 0.16);
    grip.rotation.x = -0.22;
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.24, 0.1), metal);
    mag.position.set(0, -0.19, -0.02);
    const cell = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.3), energy);
    cell.position.set(0.09, 0.02, -0.02);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.05), dark);
    sight.position.set(0, 0.13, -0.05);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.06), energy);
    tip.position.set(0, 0.03, -0.73);
    this.muzzle.position.set(0, 0.03, -0.8);

    this.gun.add(body, barrel, grip, mag, cell, sight, tip, this.muzzle);
    this.gun.position.set(0.3, -0.3, -0.55);
    this.gun.scale.setScalar(1.15);
    this.camera.add(this.gun);
  }

  // ---------- گوش‌دادن به رویدادها ----------
  private onKey = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      if (this.locked) document.exitPointerLock?.();
      this.opts.onAutoPause?.();
      return;
    }
    this.keys.add(e.code);
    if (e.code === "Space") {
      this.wantJump = true;
      e.preventDefault();
    }
    if (e.code === "KeyR") this.reload();
    if (e.code === "KeyQ" || e.code === "ShiftRight") this.blast();
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    this.applyLook(e.movementX, e.movementY);
  };
  private onMouseDown = (e: MouseEvent) => {
    if (this.desktop && e.button === 0) {
      if (!this.locked) void this.requestLock();
      this.firing = true;
    }
  };
  private onMouseUp = () => {
    this.firing = false;
  };
  private onVisibility = () => {
    if (document.visibilityState === "hidden" && this.running && !this.paused) this.opts.onAutoPause?.();
  };
  private onResize = () => this.resize();
  private onContext = (e: Event) => e.preventDefault();

  private canvas: HTMLCanvasElement | null = null;

  private attachListeners(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("orientationchange", this.onResize);
    canvas.addEventListener("contextmenu", this.onContext);
  }

  async requestLock() {
    try {
      await this.canvas?.requestPointerLock();
      this.locked = true;
    } catch {
      this.locked = false;
    }
  }

  resize() {
    const el = this.renderer.domElement;
    const parent = el.parentElement;
    const w = parent?.clientWidth || window.innerWidth;
    const h = parent?.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / Math.max(1, h);
    this.camera.aspect = aspect;
    this.baseFov = aspect < 1 ? 78 : aspect < 1.4 ? 72 : 68;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.syncParticleScale();
  }

  // ---------- چرخه بازی ----------
  start() {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.lastT = performance.now();
    sound.unlock();
    sound.startAmbient();
    this.nextWave();
    this.emitState(true);
    this.raf = requestAnimationFrame(this.tick);
  }

  pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.firing = false;
    this.input.x = 0;
    this.input.y = 0;
    if (this.locked) document.exitPointerLock?.();
    this.emitState(true);
  }

  resume() {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.lastT = performance.now();
    sound.unlock();
    this.emitState(true);
  }

  restart() {
    for (const e of this.enemies) this.removeEnemy(e, false);
    this.enemies.length = 0;
    for (const o of this.orbs) {
      o.active = false;
      o.mesh.visible = false;
    }
    for (const p of this.pickups) {
      this.scene.remove(p.mesh);
    }
    this.pickups.length = 0;
    this.pos.set(0, 0, 22);
    this.vel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.hp = this.maxHp;
    this.ammo = this.magSize;
    this.reserve = 240;
    this.alive = true;
    this.deathT = 0;
    this.reloading = false;
    this.blastCd = 0;
    this.wave = 0;
    this.score = 0;
    this.kills = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.spawnQueue = [];
    this.breakTimer = -1;
    this.running = true;
    this.paused = false;
    this.lastT = performance.now();
    this.nextWave();
    this.emitState(true);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("orientationchange", this.onResize);
    this.canvas?.removeEventListener("mousedown", this.onMouseDown);
    this.canvas?.removeEventListener("contextmenu", this.onContext);
    this.particles.dispose();
    sound.stopAmbient();
    this.renderer.dispose();
  }

  private tick = (t: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min((t - this.lastT) / 1000, 1 / 30);
    this.lastT = t;
    if (!this.paused) this.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  // ---------- ورودی‌ها ----------
  setMove(x: number, y: number) {
    this.input.x = THREE.MathUtils.clamp(x, -1, 1);
    this.input.y = THREE.MathUtils.clamp(y, -1, 1);
  }
  setFiring(v: boolean) {
    this.firing = v;
  }
  applyLook(dxPx: number, dyPx: number) {
    const s = 0.0034 * this.sensitivity;
    this.yaw -= dxPx * s;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dyPx * s, -1.45, 1.45);
  }
  jump() {
    this.wantJump = true;
  }
  reload() {
    if (this.reloading || this.ammo === this.magSize || this.reserve <= 0 || !this.alive) return;
    this.reloading = true;
    this.reloadT = 1.5;
    sound.reload();
  }
  blast() {
    if (this.blastCd > 0 || !this.alive) return;
    this.blastCd = this.blastMax;
    sound.blast();
    this.vibrate(60);
    this.shakeScreen(0.6);
    const p = this.playerCenter();
    this.particles.burst(p, 60, new THREE.Color(0x67e8f9), { speed: 16, gravity: 3, life: 0.8, size: 0.75 });
    this.particles.burst(p, 26, new THREE.Color(0xffffff), { speed: 9, gravity: 2, life: 0.6, size: 0.5 });
    // حلقه موج انفجار
    this.blastRing.position.set(p.x, 0.25, p.z);
    this.blastRing.scale.setScalar(0.6);
    (this.blastRing.material as THREE.MeshBasicMaterial).opacity = 0.85;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(p);
      if (d < 11) {
        const k = 1 - d / 11;
        this.hurtEnemy(e, 55 * (0.55 + k * 0.6), e.pos.clone().add(new THREE.Vector3(0, 1, 0)));
        e.vel.add(e.pos.clone().sub(p).setY(1.5).normalize().multiplyScalar(14 * (0.4 + k)));
      }
    }
    this.opts.onEvent({ type: "blast" });
  }

  private vibrate(ms: number | number[]) {
    if (!this.haptics) return;
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      try {
        navigator.vibrate(ms);
      } catch {
        /* ignore */
      }
    }
  }

  private shakeScreen(v: number) {
    this.shake = Math.min(1.2, this.shake + v);
    this.shakeT = 0.35;
  }

  // ---------- به‌روزرسانی ----------
  private update(dt: number) {
    this.elapsed += dt;
    for (const fn of this.world.animated) fn(this.elapsed, dt);

    if (this.desktop) this.readKeyboard();

    if (this.alive) this.updatePlayer(dt);
    else {
      this.deathT += dt;
      this.pos.y = Math.max(0, this.pos.y);
    }
    this.updateWeapon(dt);
    this.updateEnemies(dt);
    this.updateOrbs(dt);
    this.updatePickups(dt);
    this.particles.update(dt);
    this.tracers.update(dt);
    this.updateWaves(dt);

    if (this.blastCd > 0) this.blastCd = Math.max(0, this.blastCd - dt);
    const rm = this.blastRing.material as THREE.MeshBasicMaterial;
    if (rm.opacity > 0.001) {
      rm.opacity = Math.max(0, rm.opacity - dt * 1.6);
      this.blastRing.scale.addScalar(dt * 16);
    }

    if (this.shakeT > 0) {
      this.shakeT -= dt;
      this.shake *= 1 - dt * 3.4;
      if (this.shake < 0.02) this.shake = 0;
    }
    this.recoilPitch *= 1 - dt * 9;
    if (this.muzzleLight.intensity > 0.1) this.muzzleLight.intensity *= 1 - dt * 14;
    this.invuln = Math.max(0, this.invuln - dt);

    // تمایل دوربین
    if (this.desktop && !this.locked) this.input.x = this.input.y = 0;
    this.updateCamera(dt);

    // کمبوی امتیاز
    if (this.combo > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    // بازیابی جان تدریجی
    if (this.alive && this.hp < this.maxHp && this.elapsed - this.lastDamage > 6.5) {
      this.hp = Math.min(this.maxHp, this.hp + dt * 4.5);
    }

    if (this.bannerT > 0) this.bannerT -= dt;

    this.stateT += dt;
    if (this.stateT > 0.12) {
      this.stateT = 0;
      this.emitState(false);
    }
  }

  private readKeyboard() {
    const k = this.keys;
    let x = 0;
    let y = 0;
    if (k.has("KeyW") || k.has("ArrowUp")) y += 1;
    if (k.has("KeyS") || k.has("ArrowDown")) y -= 1;
    if (k.has("KeyA") || k.has("ArrowLeft")) x -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) x += 1;
    this.keySprint = k.has("ShiftLeft") || k.has("ShiftRight");
    this.input.x = x;
    this.input.y = y;
  }

  private playerCenter() {
    return this.pos.clone().add(new THREE.Vector3(0, 1.35, 0));
  }

  private updatePlayer(dt: number) {
    const mag = Math.min(1.25, Math.hypot(this.input.x, this.input.y));

    // سرعت: با کشیدن کامل جوی‌استیک (آنالوگ) خودکار می‌دود
    // دویدن فقط وقتی جوی‌استیک رو به جلو کشیده شده باشد (به عقب/کنار = دویدن ندارد)
    const sprintTarget = this.desktop
      ? this.keySprint && mag > 0.1
        ? 1
        : 0
      : THREE.MathUtils.smoothstep(this.input.y, 0.62, 0.88);
    this.sprintAmount += (sprintTarget - this.sprintAmount) * (1 - Math.exp(-9 * dt));
    if (this.sprintAmount < 0.002) this.sprintAmount = 0;
    const throttle = Math.min(1, mag * 1.5);
    const desired = THREE.MathUtils.lerp(7.8, 11.6, this.sprintAmount) * throttle;

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3()
      .addScaledVector(forward, this.input.y)
      .addScaledVector(right, this.input.x);
    if (wish.lengthSq() > 1e-6) wish.normalize();
    const target = wish.multiplyScalar(desired);
    const k = 1 - Math.exp(-(this.onGround ? 16 : 4.5) * dt);
    this.vel.x += (target.x - this.vel.x) * k;
    this.vel.z += (target.z - this.vel.z) * k;

    if (this.wantJump) {
      this.wantJump = false;
      if (this.onGround) {
        this.vel.y = 7.2;
        this.onGround = false;
      }
    }
    this.vel.y -= (this.vel.y < 0 ? 26 : 20) * dt;
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      this.vel.y = 0;
      this.onGround = true;
    }
    resolveCircle(this.pos, 0.45, this.world.obstacles, this.world.bounds);

    // ارتفاع سر و لرزش راه‌رفتن
    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    this.bob += dt * (3.6 + hspeed * 0.95);
    this.bobJitter = THREE.MathUtils.lerp(this.bobJitter, this.onGround ? Math.min(1, hspeed / 11) : 0, dt * 7);
  }

  private bobJitter = 0;
  private keySprint = false;
  private sprintAmount = 0;
  private baseFov = 70;

  private syncParticleScale() {
    const bufH = this.renderer.domElement.height || window.innerHeight;
    this.particles.setProjectionScale((0.5 * bufH) / Math.tan((this.camera.fov * Math.PI) / 360));
  }

  private updateCamera(dt: number) {
    // پرش زاویه دید (FOV) هنگام دویدن برای حس سرعت
    const targetFov = this.baseFov + this.sprintAmount * 4.5;
    if (Math.abs(this.camera.fov - targetFov) > 0.04) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 6);
      this.camera.updateProjectionMatrix();
      this.syncParticleScale();
    }
    const eye = 1.66 + Math.sin(this.bob * 2) * 0.035 * this.bobJitter;
    const shakeX = this.shake * (Math.random() - 0.5) * 0.22;
    const shakeY = this.shake * (Math.random() - 0.5) * 0.22;
    const roll = Math.sin(this.bob) * 0.012 * this.bobJitter + this.shake * (Math.random() - 0.5) * 0.09;
    const falling = this.alive ? 0 : Math.min(1, this.deathT * 1.4);
    const camY = THREE.MathUtils.lerp(this.pos.y + eye, 0.55, falling);
    this.camera.position.set(this.pos.x + shakeX, camY + shakeY, this.pos.z);
    const lean = Math.sin(this.bob) * 0.09 * this.bobJitter;
    const zAx = Math.sin(this.bob) * 0.014 * this.bobJitter;
    this.camera.rotation.set(this.pitch + this.recoilPitch + falling * -0.5, this.yaw, roll * 0.6 + zAx + lean * 0.05 + falling * 0.7);
    this.camera.updateMatrixWorld();
  }

  private updateWeapon(dt: number) {
    // نشانه‌گیری نرم اسلحه
    const swayX = (this.input.x * -0.028 + this.camera.rotation.z * 0.4);
    const swayY = (this.input.y * 0.02 - 0.02);
    this.gunSway.x += (swayX - this.gunSway.x) * Math.min(1, dt * 6);
    this.gunSway.y += (swayY - this.gunSway.y) * Math.min(1, dt * 6);
    this.gunKick = Math.max(0, this.gunKick - dt * 6.5);
    const bobX = Math.sin(this.bob) * 0.02 * this.bobJitter;
    const bobY = Math.abs(Math.cos(this.bob)) * 0.022 * this.bobJitter;
    const reloadDrop = this.reloading ? Math.sin(Math.min(1, this.reloadT / 1.5) * Math.PI) * 0.55 : 0;
    this.gun.position.set(
      0.3 + this.gunSway.x + bobX,
      -0.3 + this.gunSway.y - bobY - reloadDrop * 0.5,
      -0.55 + this.gunKick * 0.16,
    );
    this.gun.rotation.set(this.gunKick * 0.22 + reloadDrop * 1.1, this.gunSway.x * 1.6, -reloadDrop * 0.4);

    if (this.fireCd > 0) this.fireCd -= dt;
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const need = this.magSize - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take;
        this.reserve -= take;
        this.reloading = false;
      }
    }
    if (!this.alive || this.paused) return;
    this.lockTick = (this.lockTick + 1) % 2;
    if (this.autoFire && this.lockTick === 0 && this.ammo > 0 && !this.reloading) {
      this.currentLock = this.castShot(true).enemy !== null;
    }
    const shouldFire = this.firing || (this.autoFire && this.currentLock);
    if (shouldFire && !this.reloading && this.fireCd <= 0) {
      if (this.ammo > 0) this.shoot();
      else {
        sound.empty();
        this.opts.onEvent({ type: "noammo" });
        this.reload();
      }
    }
  }

  private rayBoxDistance(o: THREE.Vector3, d: THREE.Vector3, b: Box): number {
    let tmin = 0;
    let tmax = Infinity;
    const oArr = [o.x, o.y, o.z];
    const dArr = [d.x, d.y, d.z];
    const minArr = [b.minX, 0, b.minZ];
    const maxArr = [b.maxX, b.top, b.maxZ];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(dArr[i]) < 1e-6) {
        if (oArr[i] < minArr[i] || oArr[i] > maxArr[i]) return Infinity;
      } else {
        const inv = 1 / dArr[i];
        let t1 = (minArr[i] - oArr[i]) * inv;
        let t2 = (maxArr[i] - oArr[i]) * inv;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return Infinity;
      }
    }
    return tmin;
  }

  /** محاسبه برخورد تیر: نزدیک‌ترین دشمن روی خط دید و فاصله تا دیوار */
  private castShot(exact = false) {
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    if (!exact) {
      const spread = 0.006 + this.bobJitter * 0.014 + this.gunKick * 0.004;
      dir.x += (Math.random() - 0.5) * spread;
      dir.y += (Math.random() - 0.5) * spread;
      dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();
    }
    let best: Enemy | null = null;
    let bestT = Infinity;
    for (const e of this.enemies) {
      if (!e.alive || e.spawnT > 0) continue;
      const c = e.pos.clone().add(new THREE.Vector3(0, e.kind === "rusher" ? 0.45 : 0.15, 0));
      const rel = c.clone().sub(origin);
      const t = rel.dot(dir);
      if (t < 0.5 || t > 70) continue;
      const perp = rel.clone().addScaledVector(dir, -t).length();
      const hitR = e.kind === "rusher" ? e.radius * Math.min(this.assist, 1.7) : e.radius * this.assist;
      if (perp < hitR && t < bestT) {
        bestT = t;
        best = e;
      }
    }
    let wallT = 80;
    for (const b of this.world.obstacles) {
      const t = this.rayBoxDistance(origin, dir, b);
      if (t < wallT) wallT = t;
    }
    const groundT = dir.y < -1e-4 ? (0 - origin.y) / dir.y : Infinity;
    wallT = Math.min(wallT, groundT);
    return { enemy: best && bestT < wallT ? best : null, enemyT: bestT, wallT, origin, dir };
  }

  private shoot() {
    this.ammo--;
    this.fireCd = 0.105;
    this.shotCount++;
    sound.shoot();
    this.vibrate(10);
    this.gunKick = 1;
    this.recoilPitch += 0.0075;
    this.muzzleLight.intensity = 9;
    this.shakeScreen(0.06);

    const { enemy, enemyT, wallT, origin, dir } = this.castShot();
    const muzzlePos = new THREE.Vector3();
    this.muzzle.getWorldPosition(muzzlePos);

    if (enemy) {
      const hitPoint = origin.clone().addScaledVector(dir, enemyT);
      this.tracers.add(muzzlePos, hitPoint);
      this.hurtEnemy(enemy, 12, hitPoint);
      this.particles.burst(hitPoint, 7, new THREE.Color(0xffd166), { speed: 6, gravity: 6, life: 0.35, size: 0.3 });
      this.opts.onEvent({ type: "hit" });
      this.score += 10;
    } else {
      const end = origin.clone().addScaledVector(dir, Math.min(wallT, 80));
      this.tracers.add(muzzlePos, end);
      if (wallT < 80) {
        this.particles.burst(end, 5, new THREE.Color(0x9ad8ff), { speed: 4, gravity: 7, life: 0.3, size: 0.26 });
      }
    }
  }

  private hurtEnemy(e: Enemy, dmg: number, hitPoint: THREE.Vector3 | null) {
    if (!e.alive) return;
    e.hp -= dmg;
    e.hitFlash = 1;
    if (hitPoint) {
      const kb = hitPoint.clone().sub(e.pos).setY(0);
      if (kb.lengthSq() > 1e-5) e.vel.addScaledVector(kb.normalize(), 1.2);
    }
    if (e.hp <= 0) this.killEnemy(e);
    else sound.hit();
  }

  private killEnemy(e: Enemy) {
    e.alive = false;
    this.kills++;
    this.combo++;
    this.comboTimer = 4;
    const mult = Math.min(3, 1 + (this.combo - 1) * 0.15);
    const gain = Math.round(e.scoreValue * mult);
    this.score += gain;
    const col = new THREE.Color(KIND_STATS[e.kind].color);
    this.particles.burst(e.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 26, col, { speed: 9, gravity: 8, life: 0.8, size: 0.55 });
    this.particles.burst(e.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 10, new THREE.Color(0xffffff), { speed: 6, gravity: 5, life: 0.5, size: 0.4 });
    sound.kill();
    this.vibrate([18, 30, 30]);
    this.opts.onEvent({ type: "kill", combo: this.combo, text: `+${gain}`, amount: gain });
    this.removeEnemy(e, true);
    // شانس افت آیتم
    if (Math.random() < (this.hp < 55 ? 0.36 : 0.2)) this.spawnPickup(e.pos.clone(), this.hp < 55 && Math.random() < 0.6 ? "hp" : "ammo");
  }

  private removeEnemy(e: Enemy, animate: boolean) {
    void animate;
    this.scene.remove(e.group);
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
  }

  private spawnEnemy(kind: Kind, at: THREE.Vector3) {
    const st = KIND_STATS[kind];
    const group = new THREE.Group();
    const scale = 1 + Math.min(1.1, (this.wave - 1) * 0.07);
    const mat = new THREE.MeshPhongMaterial({
      color: st.color,
      emissive: st.color,
      emissiveIntensity: 0.35,
      shininess: 70,
      specular: 0xffffff,
    });
    let core: THREE.Mesh;
    if (kind === "drone") core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), mat);
    else if (kind === "rusher") core = new THREE.Mesh(new THREE.TetrahedronGeometry(0.55), mat);
    else core = new THREE.Mesh(new THREE.OctahedronGeometry(0.72), mat);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(st.radius * 0.95, 0.055, 5, 18),
      new THREE.MeshBasicMaterial({ color: kind === "heavy" ? 0xf0abfc : kind === "rusher" ? 0xd9f99d : 0x67e8f9 }),
    );
    ring.rotation.x = Math.PI / 2.4;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    eye.position.set(0, 0.1, -0.42);
    group.add(core, ring, eye);
    group.position.copy(at);
    group.scale.setScalar(0.15);
    this.scene.add(group);

    const hp = st.hp * (1 + (this.wave - 1) * 0.13);
    this.enemies.push({
      kind,
      group,
      core,
      ring,
      hp,
      maxHp: hp,
      radius: st.radius,
      pos: at.clone(),
      vel: new THREE.Vector3(),
      shootCd: 1.2 + Math.random() * 1.4,
      hitFlash: 0,
      alive: true,
      speed: st.speed * (1 + (this.wave - 1) * 0.045) * (0.9 + Math.random() * 0.2),
      dmg: st.dmg + (this.wave - 1) * 0.8,
      phase: Math.random() * 6.28,
      orbit: Math.random() < 0.5 ? -1 : 1,
      spawnT: 0.6,
      burst: 0,
      burstCd: 0,
      scoreValue: st.score,
      hoverY: st.hover * scale * 0.5 + st.hover * 0.5,
    });
    this.particles.burst(at.clone().add(new THREE.Vector3(0, 1, 0)), 16, new THREE.Color(st.color), { speed: 5, gravity: -1, life: 0.6, size: 0.5 });
  }

  private updateEnemies(dt: number) {
    const playerChest = this.pos.clone().add(new THREE.Vector3(0, 1.3, 0));
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.alive) continue;
      if (e.spawnT > 0) {
        e.spawnT -= dt;
        const k = 1 - Math.max(0, e.spawnT) / 0.6;
        e.group.scale.setScalar(0.15 + k * 0.85 * (e.kind === "heavy" ? 1.15 : 1));
        if (e.spawnT > 0) continue;
      }
      const toPlayer = playerChest.clone().sub(e.pos);
      const dist = Math.max(0.001, toPlayer.length());
      const dirTo = toPlayer.clone().divideScalar(dist);
      const desired = new THREE.Vector3();

      if (e.kind === "drone") {
        if (dist > 13) desired.copy(dirTo);
        else if (dist < 8) desired.copy(dirTo).negate();
        else desired.set(-dirTo.z, 0, dirTo.x).multiplyScalar(e.orbit);
        e.shootCd -= dt;
        if (e.shootCd <= 0 && dist < 30 && segmentBlocked(playerChest, e.pos, this.world.obstacles, 7) === false) {
          e.shootCd = (1.9 + Math.random() * 0.9) / (1 + this.wave * 0.05);
          this.fireOrb(e, dirTo, 13.5);
        }
      } else if (e.kind === "heavy") {
        desired.copy(dirTo).multiplyScalar(dist > 9 ? 1 : -0.15);
        desired.addScaledVector(new THREE.Vector3(-dirTo.z, 0, dirTo.x), e.orbit * 0.5);
        e.shootCd -= dt;
        if (e.shootCd <= 0 && dist < 32 && !segmentBlocked(playerChest, e.pos, this.world.obstacles, 7)) {
          e.burst = 3;
          e.shootCd = (3.6 + Math.random()) / (1 + this.wave * 0.04);
        }
        if (e.burst > 0) {
          e.burstCd -= dt;
          if (e.burstCd <= 0) {
            e.burstCd = 0.22;
            e.burst--;
            this.fireOrb(e, dirTo, 11.5);
          }
        }
      } else {
        desired.copy(dirTo);
        e.phase += dt * 3;
        if (dist < 1.6 && this.alive) {
          // انفجار تماسی
          this.particles.burst(e.pos.clone().add(new THREE.Vector3(0, 0.5, 0)), 24, new THREE.Color(0x86efac), { speed: 8, gravity: 6, life: 0.6, size: 0.5 });
          this.damagePlayer(e.dmg);
          this.shakeScreen(0.4);
          e.hp = 0;
          this.killEnemy(e);
          continue;
        }
      }

      if (!this.alive) desired.multiplyScalar(0.15);

      // جداسازی دشمن‌ها
      for (const o of this.enemies) {
        if (o === e || !o.alive) continue;
        const d = e.pos.distanceTo(o.pos);
        const minD = e.radius + o.radius + 0.5;
        if (d < minD && d > 0.001) {
          desired.addScaledVector(e.pos.clone().sub(o.pos).normalize(), (1 - d / minD) * 1.6);
        }
      }

      if (desired.lengthSq() > 0) desired.normalize();
      const target = desired.multiplyScalar(e.speed);
      const k = 1 - Math.exp(-4.5 * dt);
      e.vel.x += (target.x - e.vel.x) * k;
      e.vel.z += (target.z - e.vel.z) * k;
      e.pos.x += e.vel.x * dt;
      e.pos.z += e.vel.z * dt;
      resolveCircle(e.pos, e.radius + 0.15, this.world.obstacles, this.world.bounds);

      // ارتفاع
      const hover = e.hoverY + Math.sin(this.elapsed * 2 + e.phase) * 0.18 + (e.kind === "rusher" ? 0 : 0);
      e.pos.y = hover;
      e.group.position.copy(e.pos);
      e.ring.rotation.z += dt * (e.kind === "rusher" ? 4 : 1.6);
      e.core.rotation.y += dt * 0.9;
      if (e.kind === "rusher") e.core.rotation.x += dt * 2.2;
      // روی بازیکن نگاه کن
      e.group.rotation.y = Math.atan2(-dirTo.x, -dirTo.z);
      if (e.hitFlash > 0) {
        e.hitFlash = Math.max(0, e.hitFlash - dt * 4);
        const m = e.core.material as THREE.MeshPhongMaterial;
        m.emissiveIntensity = 0.35 + e.hitFlash * 2.4;
        e.group.scale.setScalar(1 + e.hitFlash * 0.12);
      }
    }
  }

  private fireOrb(e: Enemy, aimDir: THREE.Vector3, speed: number) {
    const orb = this.orbs.find((o) => !o.active);
    if (!orb) return;
    orb.active = true;
    orb.life = 5;
    orb.dmg = e.dmg;
    orb.vel.copy(aimDir).setY(aimDir.y * 0.35).normalize().multiplyScalar(speed);
    orb.mesh.visible = true;
    orb.mesh.position.copy(e.pos).addScaledVector(aimDir, 0.9);
    (orb.mesh.material as THREE.MeshBasicMaterial).color.set(e.kind === "heavy" ? 0xd8b4fe : 0xff7a7a);
  }

  private updateOrbs(dt: number) {
    const chest = this.pos.clone().add(new THREE.Vector3(0, 1.35, 0));
    for (const o of this.orbs) {
      if (!o.active) continue;
      o.life -= dt;
      o.vel.y -= 1.2 * dt;
      o.mesh.position.addScaledVector(o.vel, dt);
      o.mesh.rotation.x += dt * 6;
      const p = o.mesh.position;
      if (Math.random() < 0.4) {
        this.particles.burst(p, 1, new THREE.Color(0xff9db1), { speed: 0.6, gravity: 0, life: 0.22, size: 0.28, dir: o.vel.clone().normalize().negate() });
      }
      let hit = false;
      if (p.y < 0.12) hit = true;
      for (const b of this.world.obstacles) {
        if (p.y <= b.top && p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ) {
          hit = true;
          break;
        }
      }
      if (!hit && p.distanceTo(chest) < 0.85) {
        this.damagePlayer(o.dmg);
        hit = true;
      }
      if (hit || o.life <= 0) {
        o.active = false;
        o.mesh.visible = false;
        this.particles.burst(p.clone(), 8, new THREE.Color(0xffc2c2), { speed: 4, gravity: 4, life: 0.35, size: 0.34 });
      }
    }
  }

  private damagePlayer(amount: number) {
    if (!this.alive || this.invuln > 0) return;
    this.hp -= amount;
    this.invuln = 0.3;
    this.lastDamage = this.elapsed;
    this.shakeScreen(0.42);
    sound.damage();
    this.vibrate(45);
    this.opts.onEvent({ type: "damage", amount });
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deathT = 0;
      this.firing = false;
      this.combo = 0;
      sound.hurtPlayer();
      const best = Number(localStorage.getItem("cyber_best") || 0);
      if (this.score > best) localStorage.setItem("cyber_best", String(Math.round(this.score)));
      this.opts.onEvent({ type: "death" });
      this.emitState(true);
    }
  }

  // ---------- آیتم‌ها ----------
  private spawnPickup(at: THREE.Vector3, kind: "hp" | "ammo") {
    at = at.clone().setY(0);
    resolveCircle(at, 0.9, this.world.obstacles, this.world.bounds);
    const group = new THREE.Group();
    const color = kind === "hp" ? 0x34d399 : 0x38bdf8;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.9, shininess: 80 }),
    );
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.035, 5, 18),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }),
    );
    halo.rotation.x = Math.PI / 2;
    group.add(box, halo);
    group.position.set(at.x, 0.75, at.z);
    this.scene.add(group);
    this.pickups.push({ mesh: group, kind, life: 30, t: Math.random() * 3, active: true, pos: group.position.clone() });
  }

  private updatePickups(dt: number) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      p.life -= dt;
      p.mesh.rotation.y += dt * 1.6;
      p.mesh.position.y = 0.75 + Math.sin(p.t * 2) * 0.14;
      const d = this.pos.distanceTo(p.mesh.position);
      if (d < 3.5 && this.alive) {
        // جذب مغناطیسی
        const dir = this.pos.clone().add(new THREE.Vector3(0, 1, 0)).sub(p.mesh.position).normalize();
        p.mesh.position.addScaledVector(dir, dt * (2.5 + (3.5 - d) * 2.4));
      }
      p.mesh.visible = p.life > 5 || Math.sin(p.life * 12) > -0.2;
      if (d < 1.1 && this.alive) {
        if (p.kind === "hp") {
          this.hp = Math.min(this.maxHp, this.hp + 32);
          this.opts.onEvent({ type: "pickup", text: "+۳۲ جان" });
        } else {
          this.reserve = Math.min(420, this.reserve + 110);
          this.opts.onEvent({ type: "pickup", text: "+۱۱۰ تیر" });
        }
        sound.pickup();
        this.particles.burst(p.mesh.position.clone(), 14, new THREE.Color(p.kind === "hp" ? 0x34d399 : 0x38bdf8), { speed: 5, gravity: 2, life: 0.5, size: 0.4 });
        this.scene.remove(p.mesh);
        this.pickups.splice(i, 1);
        continue;
      }
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.pickups.splice(i, 1);
      }
    }
  }

  // ---------- موج‌ها ----------
  private nextWave() {
    this.wave++;
    this.spawnQueue = [];
    const w = this.wave;
    const total = 3 + Math.round(w * 1.7);
    for (let i = 0; i < total; i++) {
      const r = Math.random();
      if (w >= 3 && r < Math.min(0.28, 0.09 + w * 0.02)) this.spawnQueue.push("heavy");
      else if (r < Math.min(0.62, 0.32 + w * 0.04)) this.spawnQueue.push("rusher");
      else this.spawnQueue.push("drone");
    }
    this.spawnTimer = 0.8;
    this.breakTimer = -1;
    this.banner = `موج ${w}`;
    this.bannerT = 2.4;
    sound.wave();
    this.opts.onEvent({ type: "wave", wave: w });
    // جایزه شروع موج
    if (w > 1) {
      this.ammo = this.magSize;
      this.reserve = Math.min(420, this.reserve + 90);
      const near = this.pos.clone().add(new THREE.Vector3(Math.cos(this.yaw) * 6, 0, -Math.sin(this.yaw) * 6));
      this.spawnPickup(near, "hp");
      const near2 = this.pos.clone().add(new THREE.Vector3(-Math.cos(this.yaw) * 6, 0, Math.sin(this.yaw) * 6));
      this.spawnPickup(near2, this.hp < 70 ? "hp" : "ammo");
    }
  }

  private updateWaves(dt: number) {
    if (!this.alive) return;
    if (this.breakTimer > 0) {
      this.breakTimer -= dt;
      if (this.breakTimer <= 0) this.nextWave();
      return;
    }
    if (this.spawnQueue.length > 0) {
      this.spawnTimer -= dt;
      const maxAlive = Math.min(4 + Math.floor(this.wave * 0.8), 9);
      if (this.spawnTimer <= 0 && this.enemies.length < maxAlive) {
        this.spawnTimer = Math.max(0.5, 1.5 - this.wave * 0.06);
        const kind = this.spawnQueue.shift()!;
        const candidates = this.world.spawnPoints
          .slice()
          .sort((a, b) => b.distanceTo(this.pos) - a.distanceTo(this.pos))
          .slice(0, 6);
        const at = candidates[Math.floor(Math.random() * candidates.length)].clone();
        at.x += (Math.random() - 0.5) * 3;
        at.z += (Math.random() - 0.5) * 3;
        this.spawnEnemy(kind, at);
      }
    } else if (this.enemies.length === 0) {
      this.breakTimer = 4.5;
      this.banner = `موج ${this.wave} پاک‌سازی شد`;
      this.bannerT = 2.4;
      this.score += 150;
      this.opts.onEvent({ type: "wave", wave: this.wave, text: "cleared" });
      sound.wave();
    }
  }

  // ---------- خروجی وضعیت ----------
  get info() {
    return {
      yaw: this.yaw,
      px: this.pos.x,
      pz: this.pos.z,
      wave: this.wave,
      enemies: this.enemies.map((e) => ({ x: e.pos.x, z: e.pos.z, kind: e.kind })),
      pickups: this.pickups.map((p) => ({ x: p.mesh.position.x, z: p.mesh.position.z, kind: p.kind })),
      orbs: this.orbs.filter((o) => o.active).map((o) => ({ x: o.mesh.position.x, z: o.mesh.position.z })),
      locked: this.currentLock,
      arena: ARENA,
    };
  }

  private snapshot(): HudState {
    return {
      hp: Math.round(this.hp),
      maxHp: this.maxHp,
      ammo: this.ammo,
      magSize: this.magSize,
      reserve: this.reserve,
      score: Math.round(this.score),
      wave: this.wave,
      kills: this.kills,
      enemiesLeft: this.enemies.length + this.spawnQueue.length,
      combo: this.combo,
      reloading: this.reloading,
      blastReady: 1 - this.blastCd / this.blastMax,
      sprinting: this.sprintAmount > 0.45,
      alive: this.alive,
      running: this.running,
    };
  }

  private emitState(force: boolean) {
    void force;
    const s = this.snapshot();
    this.opts.onState({ ...s, combo: this.combo });
  }

  getBanner() {
    return this.bannerT > 0 ? this.banner : null;
  }

  /** 0 = آماده، 1 = در حال شارژ مجدد */
  get blastCdRatio() {
    return this.blastCd / this.blastMax;
  }
}

// برای استفاده در جاهایی که نیاز به تایپ است
export type { GameEventName } from "./types";
export type { GameEvent } from "./types";
