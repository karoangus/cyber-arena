import * as THREE from "three";
import { sound } from "./audio";
import { ParticleSystem, TracerPool } from "./effects";
import { PerfScaler } from "./perf";
import { saveBest } from "./settings";
import type { GameOptions, HudState, SlotKind } from "./types";
import { ViewModel } from "./viewmodel";
import { ARENA, buildWorld, glowTexture, resolveCircle, segmentBlocked, type Box, type WorldRefs } from "./world";

type Kind = "drone" | "rusher" | "heavy" | "boss";

interface BossAI {
  volley: number;
  radial: number;
  summon: number;
  charge: number;
  slam: number;
  /** >0 یعنی در حال خیز برداشتن برای حمله‌ی شارژ */
  telegraph: number;
  /** >0 یعنی در حال یورش (شارژ) است */
  charging: number;
  enraged: boolean;
  /** جهت یورش */
  chargeDir?: THREE.Vector3;
}

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
  baseScale: number;
  /** فقط باس: تایمرهای حمله‌ها و فاز خشم */
  boss?: BossAI;
  /** اجزای اضافه‌ی مدل باس برای انیمیشن */
  bossParts?: { rings: THREE.Mesh[]; spikes: THREE.Group; aura: THREE.Mesh; light: THREE.PointLight };
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

/** ارتفاع مرکز بدن بازیکن (برای برخورد/نشان‌گیری) */
const Y_CENTER = new THREE.Vector3(0, 1.35, 0);
/** آفست نقطه‌ی آسیب از انفجار موج */
const BLAST_Y = new THREE.Vector3(0, 1, 0);
/** رنگ رد ذرات گلوله‌ی دشمن (یک‌بار ساخته می‌شود، نه هر فریم) */
const ORB_TRAIL_COLOR = new THREE.Color(0xff9db1);

/* ------------------------------ تنظیمات بازی ------------------------------ */
/** هر چند موج یک نبرد باس داریم */
export const BOSS_EVERY = 10;
/** جان پایه‌ی باس (با هر باس قوی‌تر می‌شود) */
export const BOSS_BASE_HP = 1200;
/** وقفه‌ی بعد از شکست باس: فرصت خرید از شاپ */
export const SHOP_BREAK = 100;
/** وقفه‌ی معمول بین موج‌ها */
export const REGULAR_BREAK = 4.5;
/** سقف مهمات ذخیره */
export const RESERVE_CAP = 480;

const KIND_STATS: Record<Kind, { hp: number; radius: number; speed: number; dmg: number; hover: number; color: number; score: number }> = {
  drone: { hp: 34, radius: 0.75, speed: 4.0, dmg: 8, hover: 2.0, color: 0xff3d6e, score: 100 },
  rusher: { hp: 22, radius: 0.6, speed: 7.6, dmg: 24, hover: 0.55, color: 0x6ef34f, score: 75 },
  heavy: { hp: 85, radius: 1.0, speed: 2.6, dmg: 12, hover: 2.4, color: 0xa855f7, score: 220 },
  boss: { hp: BOSS_BASE_HP, radius: 2.05, speed: 3.5, dmg: 26, hover: 1.6, color: 0xff2e63, score: 2500 },
};

/** پول: هر کیل ۱ دلار، باس ۱۰ دلار */
export const CASH_PER_KILL = 1;
export const CASH_PER_BOSS = 10;

/** اسلحه */
export const GUN_BASE_DAMAGE = 12;
export const GUN_DAMAGE_PER_LEVEL = 0.3; // هر سطح +۳۰٪
export const MAG_SIZE = 34;
export const RELOAD_TIME = 1.5;

/** ضربه‌ی نزدیک: پرخطر چون باید به دشمن بچسبی */
export const MELEE: Record<"fists" | "knife", { dmg: number; range: number; cd: number; anim: number }> = {
  fists: { dmg: 20, range: 2.6, cd: 0.58, anim: 0.34 },
  knife: { dmg: 26, range: 2.9, cd: 0.44, anim: 0.38 },
};

/** قیمت‌های شاپ */
export const SHOP = {
  damageBase: 5,
  damageStep: 5,
  damageMaxLevel: 3,
  ammoCost: 2,
  ammoAmount: 50,
  knifeCost: 20,
};

export type ShopItemKind = "damage" | "ammo" | "knife";

/** نام فارسی اسلات‌ها برای HUD و پیام‌ها */
export const SLOT_LABEL: Record<SlotKind, string> = {
  fists: "دست خالی",
  gun: "اسلحه",
  knife: "چاقو",
};


export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private world: WorldRefs;
  private particles: ParticleSystem;
  private tracers: TracerPool;

  /**
   * بردارهای کاری (scratch) برای حلقه‌های داغ:
   * هر شلیک/هر فریم ده‌ها Vector3 موقت create می‌شد که فشار GC می‌زد و روی
   * دستگاه‌های ضعیف میکرو-لگ ایجاد می‌کرد. حالا همه‌جا همین چند بردار
   * مشترک استفاده می‌شود (کال‌ها ترتیبی‌اند، پس تداخلی ندارند).
   */
  private readonly _t1 = new THREE.Vector3();
  private readonly _t2 = new THREE.Vector3();
  private readonly _t3 = new THREE.Vector3();
  private readonly _t4 = new THREE.Vector3();
  private readonly _t5 = new THREE.Vector3();
  /** زاویه‌ی چرخش دوربین در منوی اصلی (پس‌زمینه‌ی زنده) */
  private menuAngle = 0;

  /** مدل اول‌شخص: بازوها/دست‌ها/اسلحه/چاقو/مشت + همه‌ی انیمیشن‌ها */
  private vm: ViewModel;
  private muzzleLight: THREE.PointLight;
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
  /** گام‌ها: شماره‌ی قدم (برای صدای پا و تکان دوربین) */
  private stepPhase = 0;
  private stepDip = 0;
  private landDip = 0;
  private wasAirborne = false;
  /** خم شدن دوربین به چپ/راست هنگام جابه‌جایی عرضی */
  private lean = 0;
  /** ضربه‌ی دوربین هنگام مشت/برش */
  private meleePitch = 0;

  // اسلحه و اسلات‌ها
  private ammo = MAG_SIZE;
  private magSize = MAG_SIZE;
  private reserve = 240;
  private fireCd = 0;
  /** کول‌داون صدای/پیام خشاب خالی: نگه‌داشتن شلیک با مهمات صفر نباید هر فریم ریپ کند */
  private emptyCd = 0;
  private reloading = false;
  private reloadT = 0;
  private recoilPitch = 0;
  private shotCount = 0;
  private blastCd = 0;
  private blastMax = 14;
  private blastRing: THREE.Mesh;
  /** اسلات فعال: دست خالی / اسلحه / چاقو */
  private slot: SlotKind = "gun";
  private hasKnife = false;
  private meleeCd = 0;
  private meleeT = 0;
  private meleeHand = 0;
  private meleeHitDone = true;

  // اقتصاد بازی
  private money = 0;
  private weaponLevel = 0;

  // نشانه‌گیری (ADS)
  private aiming = false;
  private aimAmount = 0;
  private aimInput = { mouse: false, key: false, touch: false };

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
  /** باس زنده‌ی میدان (برای نوار جان و هوش مصنوعی) */
  private bossRef: Enemy | null = null;
  /** شاپ فقط بعد از شکست باس و تا شروع موج بعد باز است */
  private shopAvailable = false;
  /** اسلوموشن سینمایی (مرگ باس) */
  private timeScale = 1;
  /** حلقه‌ی ضربه‌ی باس روی زمین */
  private shockRings: THREE.Mesh[] = [];

  /** مقیاس‌دهنده‌ی کیفیت خودکار (رزولوشن داینامیک برای روانی روی گوشی‌های ضعیف) */
  readonly perf = new PerfScaler();
  /** رزولوشن پایه‌ی دستگاه (pixel ratio قبل از کاهش خودکار کیفیت) */
  private basePixelRatio = 1;

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
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, mobile ? 1.6 : 2);
    this.renderer.setPixelRatio(this.basePixelRatio);
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

    // مدل اول‌شخص (دست‌ها + اسلحه + چاقو + مشت) به دوربین چسبانده می‌شود
    this.vm = new ViewModel();
    this.camera.add(this.vm.root);

    // چراغ شلیک روی دهانه‌ی اسلحه سوار است تا با لگد و ریلود جابه‌جا شود
    this.muzzleLight = new THREE.PointLight(0x88e0ff, 0, 12, 2);
    this.vm.muzzle.add(this.muzzleLight);

    const ringGeo = new THREE.RingGeometry(1, 1.25, 40);
    this.blastRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.blastRing.rotation.x = -Math.PI / 2;
    this.scene.add(this.blastRing);

    // حلقه‌های ضربه‌ی باس (استخر ثابت تا چیزی به صحنه اضافه/کم نشود)
    const shockGeo = new THREE.RingGeometry(1, 1.3, 44);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        shockGeo,
        new THREE.MeshBasicMaterial({ color: 0xff5c8a, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      this.scene.add(ring);
      this.shockRings.push(ring);
    }

    // استخر گلوله دشمن (با رگبارهای باس بزرگ‌تر شد)
    const orbGeo = new THREE.IcosahedronGeometry(0.22, 0);
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xff6464 });
    for (let i = 0; i < 42; i++) {
      const m = new THREE.Mesh(orbGeo, orbMat);
      m.visible = false;
      this.scene.add(m);
      this.orbs.push({ mesh: m, vel: new THREE.Vector3(), life: 0, dmg: 0, active: false });
    }

    this.resize();
    this.attachListeners(canvas);

    // پیش‌نمایش زنده‌ی صحنه پشت منوی اصلی: حلقه‌ی سبک menuUpdate (دوربین
    // آرام دور میدان می‌چرخد و دنیای نئونی زنده می‌ماند — بدون بازیکن/مدل اول‌شخص)
    this.vm.root.visible = false;
    this.lastT = performance.now();
    this.menuUpdate(0);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.tick);
  }

  // ---------- گوش‌دادن به رویدادها ----------
  private onKey = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      if (this.locked) document.exitPointerLock?.();
      this.opts.onAutoPause?.();
      return;
    }
    // وقتی کاربر با یک کنترل فرم (مثلاً اسلایدر حساسیت) کار می‌کند، کلیدها مال بازی نیستند
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    this.keys.add(e.code);
    if (e.code === "Space") {
      this.wantJump = true;
      e.preventDefault();
    }
    if (e.code === "KeyR") this.reload();
    if (e.code === "KeyQ" || e.code === "ShiftRight") this.blast();
    // اسلات‌ها: ۱ دست خالی، ۲ اسلحه، ۳ چاقو
    if (e.code === "Digit1" || e.code === "Numpad1") this.setSlot("fists");
    if (e.code === "Digit2" || e.code === "Numpad2") this.setSlot("gun");
    if (e.code === "Digit3" || e.code === "Numpad3") this.setSlot("knife");
    // تعویض سریع اسلات‌ها (با نگه‌داشتن کلید تکرار نشود)
    if ((e.code === "KeyF" || e.code === "KeyE") && !e.repeat) this.cycleSlot(1);
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    this.applyLook(e.movementX, e.movementY);
  };
  private onMouseDown = (e: MouseEvent) => {
    if (!this.desktop) return;
    // کلیک راست = نشانه‌گیری (ADS)
    if (e.button === 2) {
      e.preventDefault();
      this.aimInput.mouse = true;
      return;
    }
    if (e.button === 0) {
      if (!this.locked) void this.requestLock();
      this.firing = true;
    }
  };
  private onMouseUp = (e: MouseEvent) => {
    // دکمه‌ی راست = رهاسازی نشانه‌گیری؛ بقیه (یا رویداد بدون button) = قطع شلیک
    if (e.button === 2) {
      this.aimInput.mouse = false;
      return;
    }
    this.firing = false;
  };
  /** چرخ ماوس = تعویض اسلات */
  private onWheel = (e: WheelEvent) => {
    if (!this.desktop || !this.running || this.paused) return;
    e.preventDefault();
    if (Math.abs(e.deltaY) < 4) return;
    this.cycleSlot(e.deltaY > 0 ? 1 : -1);
  };
  private onVisibility = () => {
    if (document.visibilityState === "hidden" && this.running && !this.paused) this.opts.onAutoPause?.();
  };
  private hadRealLock = false;
  private onLockChange = () => {
    // همگام‌سازی با قفل واقعی مرورگر (Esc باعث خروج خودکار از قفل می‌شود)
    if (document.pointerLockElement === this.canvas) {
      this.locked = true;
      this.hadRealLock = true;
    } else if (this.hadRealLock && document.pointerLockElement == null) {
      this.locked = false;
      this.hadRealLock = false;
      this.firing = false;
      this.aimInput.mouse = false;
    }
    // اگر مرورگر اصلاً قفل نداد (آی‌فریم بدون مجوز)، حالت خوش‌بینانه حفظ می‌شود تا بازی با movementX کار کند
  };
  private onLockError = () => {
    // خطای قفل نباید بازی را متوقف کند؛ ورودی ماوس بدون قفل هم ادامه می‌یابد
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
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("pointerlockerror", this.onLockError);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("orientationchange", this.onResize);
    canvas.addEventListener("contextmenu", this.onContext);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
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
    this.vm.root.visible = true;
    sound.unlock();
    sound.startAmbient();
    this.nextWave();
    this.emitState(true);
    // حلقه‌ی RAF از کنستراکتور فعال است (حالت منو)؛ اینجا فقط وضعیت عوض می‌شود
  }

  pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.firing = false;
    this.aimInput.mouse = false;
    this.aimInput.key = false;
    this.aimInput.touch = false;
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
    // تخلیه با حلقه‌ی while: removeEnemy داخل آرایه splice می‌کند و for..of باعث جاماندن دشمن می‌شد
    while (this.enemies.length > 0) this.removeEnemy(this.enemies[0], false);
    this.enemies.length = 0;
    for (const o of this.orbs) {
      o.active = false;
      o.mesh.visible = false;
    }
    for (const p of this.pickups) {
      this.scene.remove(p.mesh);
    }
    this.pickups.length = 0;
    for (const r of this.shockRings) {
      r.visible = false;
      (r.material as THREE.MeshBasicMaterial).opacity = 0;
    }
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
    // اقتصاد و اسلات‌ها از نو
    this.money = 0;
    this.weaponLevel = 0;
    this.hasKnife = false;
    this.slot = "gun";
    this.vm.setSlot("gun");
    this.aiming = false;
    this.aimAmount = 0;
    this.aimInput.mouse = this.aimInput.key = this.aimInput.touch = false;
    this.meleeCd = 0;
    this.meleeT = 0;
    this.meleeHand = 0;
    this.meleeHitDone = true;
    this.bossRef = null;
    this.shopAvailable = false;
    this.timeScale = 1;
    this.firing = false;
    this.currentLock = false;
    this.invuln = 0;
    this.lastDamage = -99;
    // بحران‌های دوربین/انیمیشن که قبلاً بعد از restart باقی می‌ماندند
    this.recoilPitch = 0;
    this.meleePitch = 0;
    this.gunSway.set(0, 0);
    this.bob = 0;
    this.bobJitter = 0;
    this.sprintAmount = 0;
    this.lean = 0;
    this.stepPhase = 0;
    this.stepDip = 0;
    this.landDip = 0;
    this.wasAirborne = false;
    this.onGround = true;
    this.fireCd = 0;
    this.emptyCd = 0;
    this.shake = 0;
    this.shakeT = 0;
    this.banner = "";
    this.bannerT = 0;
    this.vm.root.visible = true;
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
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("pointerlockerror", this.onLockError);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("orientationchange", this.onResize);
    this.canvas?.removeEventListener("mousedown", this.onMouseDown);
    this.canvas?.removeEventListener("contextmenu", this.onContext);
    this.canvas?.removeEventListener("wheel", this.onWheel);
    this.vm.dispose();
    this.particles.dispose();
    // همه‌ی جئامتری/متریال/بافت‌های دنیای ساخت‌شده‌ی پروسیجرال (کف، دیوارها،
    // آسمان، ستاره‌ها، برج‌ها، حلقه‌ها) هم آزاد شوند تا بین‌بار retry چیزی نشت نکند.
    // glowTexture بافتِ مشترکِ ماژول است (ذرات + فلش دهانه) و نباید dispose شود.
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const m of mats as THREE.Material[]) {
        const mm = m as unknown as { map?: THREE.Texture };
        if (mm.map && mm.map !== glowTexture) mm.map.dispose();
        m.dispose();
      }
    });
    sound.stopAmbient();
    this.renderer.dispose();
  }

  private tick = (t: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const rawMs = t - this.lastT;
    this.lastT = t;
    const raw = Math.min(rawMs / 1000, 1 / 30);

    // کیفیت خودکار: فقط حین بازی واقعی نمونه‌برداری می‌شود (منو و توقف = مصرف صفر)
    if (this.running && !this.paused) {
      this.perf.sample(rawMs, t);
      if (this.perf.update(t)) this.applyQuality();
    }

    if (this.running && !this.paused) {
      // اسلوموشن کوتاه هنگام انفجار باس (سینمایی)
      this.update(raw * this.timeScale);
    } else if (!this.running) {
      this.menuUpdate(raw);
    }
    // در توقف فریم آخر روی کانواس می‌ماند؛ رندر کردن صحنه‌ی ثابت فقط GPU می‌سوزاند
    if (!this.paused) this.renderer.render(this.scene, this.camera);
  };

  /** چرخه‌ی سبک پس‌زمینه‌ی منوی اصلی: دوربین آرام دور میدان می‌چرخد */
  private menuUpdate(dt: number) {
    this.elapsed += dt;
    for (const fn of this.world.animated) fn(this.elapsed, dt);
    this.menuAngle += dt * 0.06;
    const r = 30;
    this.camera.position.set(
      Math.sin(this.menuAngle) * r,
      10.5 + Math.sin(this.elapsed * 0.13) * 1.2,
      Math.cos(this.menuAngle) * r,
    );
    this.camera.lookAt(0, 2.2, 0);
    this.particles.update(dt);
    this.tracers.update(dt);
  }

  /** اعمال نسبت کیفیت جدید روی رندرر (رزولوشن داینامیک) */
  private applyQuality() {
    this.renderer.setPixelRatio(this.basePixelRatio * this.perf.ratio);
    this.resize(); // با رزولوشن جدید بافر رندر می‌سازد + مقیاس ذرات همگام می‌شود
  }

  // ---------- ورودی‌ها ----------
  setMove(x: number, y: number) {
    this.input.x = THREE.MathUtils.clamp(x, -1, 1);
    this.input.y = THREE.MathUtils.clamp(y, -1, 1);
  }
  setFiring(v: boolean) {
    this.firing = v;
  }
  applyLook(dxPx: number, dyPx: number) {
    // هنگام نشانه‌گیری حساسیت کم می‌شود تا هدف‌گیری دقیق باشد
    const s = 0.0034 * this.sensitivity * (1 - this.aimAmount * 0.55);
    this.yaw -= dxPx * s;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dyPx * s, -1.45, 1.45);
  }
  jump() {
    this.wantJump = true;
  }
  reload() {
    if (this.reloading || this.ammo === this.magSize || this.reserve <= 0 || !this.alive) return;
    this.reloading = true;
    this.reloadT = RELOAD_TIME;
    sound.reload();
  }
  /** نشانه‌گیری (ADS): با ماوس/کیبورد/دکمه‌ی لمسی */
  setAiming(v: boolean, source: "mouse" | "key" | "touch" = "touch") {
    this.aimInput[source] = v;
  }
  /** اسلات فعلی */
  get currentSlot(): SlotKind {
    return this.slot;
  }
  /** اسلات‌های باز (چاقو فقط بعد از خرید) */
  private slotList(): SlotKind[] {
    return this.hasKnife ? ["fists", "gun", "knife"] : ["fists", "gun"];
  }
  setSlot(slot: SlotKind) {
    if (slot === this.slot || !this.alive) return;
    if (slot === "knife" && !this.hasKnife) {
      this.deny("چاقو نداری — از شاپ بخر");
      return;
    }
    this.slot = slot;
    this.vm.setSlot(slot);
    this.meleeCd = Math.max(this.meleeCd, 0.22);
    this.meleeT = 0;
    // تعویض سلاح، پرکردن خشاب را لغو می‌کند
    if (slot !== "gun" && this.reloading) {
      this.reloading = false;
      this.reloadT = 0;
    }
    sound.swap();
    this.vibrate(12);
    this.opts.onEvent({ type: "slot", slot, text: SLOT_LABEL[slot] });
    this.emitState(true);
  }
  cycleSlot(dir = 1) {
    const list = this.slotList();
    const i = list.indexOf(this.slot);
    this.setSlot(list[(i + dir + list.length) % list.length]);
  }
  /** خرید از شاپ (فقط در وقفه‌ی بعد از باس) */
  buy(item: ShopItemKind): boolean {
    if (!this.shopAvailable) {
      this.deny("شاپ بسته است — بعد از باس باز می‌شود");
      return false;
    }
    if (item === "damage") {
      const cost = this.damageUpgradeCost();
      if (this.weaponLevel >= SHOP.damageMaxLevel) {
        this.deny("آسیب اسلحه به حداکثر رسیده");
        return false;
      }
      if (!this.pay(cost)) return false;
      this.weaponLevel++;
      sound.buy();
      this.opts.onEvent({ type: "shop", text: `آسیب اسلحه → سطح ${this.weaponLevel} (${this.weaponDamage().toFixed(1)})` });
      this.emitState(true);
      return true;
    }
    if (item === "ammo") {
      if (this.reserve >= RESERVE_CAP) {
        this.deny("جای مهمات نداری!");
        return false;
      }
      if (!this.pay(SHOP.ammoCost)) return false;
      this.reserve = Math.min(RESERVE_CAP, this.reserve + SHOP.ammoAmount);
      sound.buy();
      this.opts.onEvent({ type: "shop", text: `+${SHOP.ammoAmount} تیر خریدی` });
      this.emitState(true);
      return true;
    }
    // چاقو
    if (this.hasKnife) {
      this.deny("چاقو را داری");
      return false;
    }
    if (!this.pay(SHOP.knifeCost)) return false;
    this.hasKnife = true;
    sound.buy();
    this.setSlot("knife");
    this.opts.onEvent({ type: "shop", text: "چاقو خریدی! اسلات ۳ باز شد" });
    this.emitState(true);
    return true;
  }
  /** قیمت ارتقای آسیب در سطح فعلی */
  damageUpgradeCost() {
    return SHOP.damageBase + SHOP.damageStep * this.weaponLevel;
  }
  /** آسیب هر گلوله با احتساب ارتقاها */
  weaponDamage() {
    return GUN_BASE_DAMAGE * (1 + GUN_DAMAGE_PER_LEVEL * this.weaponLevel);
  }
  private pay(cost: number): boolean {
    if (this.money < cost) {
      this.deny(`پول کافی نداری ($${cost} لازم داری)`);
      return false;
    }
    this.money -= cost;
    return true;
  }
  private deny(text: string) {
    sound.deny();
    this.opts.onEvent({ type: "deny", text });
  }
  blast() {
    if (this.blastCd > 0 || !this.alive) return;
    this.blastCd = this.blastMax;
    sound.blast();
    this.vibrate(60);
    this.shakeScreen(0.6);
    const p = this.playerCenter(this._t1);
    this.particles.burst(p, 60, new THREE.Color(0x67e8f9), { speed: 16, gravity: 3, life: 0.8, size: 0.75 });
    this.particles.burst(p, 26, new THREE.Color(0xffffff), { speed: 9, gravity: 2, life: 0.6, size: 0.5 });
    // حلقه موج انفجار
    this.blastRing.position.set(p.x, 0.25, p.z);
    this.blastRing.scale.setScalar(0.6);
    (this.blastRing.material as THREE.MeshBasicMaterial).opacity = 0.85;
    // روی کپی حلقه می‌زنیم چون hurtEnemy ممکن است دشمن را kill و از آرایه حذف (splice) کند
    for (const e of [...this.enemies]) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(p);
      if (d < 11) {
        const k = 1 - d / 11;
        this.hurtEnemy(e, 55 * (0.55 + k * 0.6), this._t2.copy(e.pos).add(BLAST_Y));
        e.vel.add(this._t3.copy(e.pos).sub(p).setY(1.5).normalize().multiplyScalar(14 * (0.4 + k)));
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
    this.updateAim(dt);

    if (this.alive) this.updatePlayer(dt);
    else {
      this.deathT += dt;
      this.pos.y = Math.max(0, this.pos.y);
      this.landDip = 0;
      this.stepDip = 0;
    }
    this.updateWeapon(dt);
    this.updateEnemies(dt);
    this.updateOrbs(dt);
    this.updatePickups(dt);
    this.particles.update(dt);
    this.tracers.update(dt);
    this.updateWaves(dt);
    this.updateShockRings(dt);

    if (this.blastCd > 0) this.blastCd = Math.max(0, this.blastCd - dt);
    if (this.meleeCd > 0) this.meleeCd = Math.max(0, this.meleeCd - dt);
    if (this.meleeT > 0) this.meleeT = Math.max(0, this.meleeT - dt);
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
    this.meleePitch *= 1 - dt * 8;
    this.stepDip = Math.max(0, this.stepDip - dt * 6);
    this.landDip = Math.max(0, this.landDip - dt * 3.6);
    if (this.muzzleLight.intensity > 0.1) this.muzzleLight.intensity *= 1 - dt * 14;
    this.invuln = Math.max(0, this.invuln - dt);
    // بازگشت از اسلوموشن
    if (this.timeScale < 1) this.timeScale = Math.min(1, this.timeScale + dt * 0.9);

    // تمایل دوربین
    if (this.desktop && !this.locked) this.input.x = this.input.y = 0;
    this.updateViewModel(dt);
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
    // نگه‌داشتن F هم نشانه‌گیری است (برای لپ‌تاپ/کیبورد بدون ماوس)
    this.aimInput.key = k.has("KeyG");
    this.input.x = x;
    this.input.y = y;
  }

  /** همگرایی نرم نشانه‌گیری (ADS) از روی همه‌ی ورودی‌ها */
  private updateAim(dt: number) {
    const want = this.alive && !this.paused && (this.aimInput.mouse || this.aimInput.key || this.aimInput.touch);
    if (want !== this.aiming) {
      this.aiming = want;
      if (this.running) sound.aim(want);
    }
    this.aimAmount += ((want ? 1 : 0) - this.aimAmount) * (1 - Math.exp(-14 * dt));
    if (this.aimAmount < 0.002) this.aimAmount = 0;
  }

  private playerCenter(out: THREE.Vector3) {
    return out.copy(this.pos).add(Y_CENTER);
  }

  private updatePlayer(dt: number) {
    const mag = Math.min(1.25, Math.hypot(this.input.x, this.input.y));

    // سرعت: با کشیدن کامل جوی‌استیک (آنالوگ) خودکار می‌دود
    // دویدن فقط وقتی جوی‌استیک رو به جلو کشیده شده باشد (به عقب/کنار = دویدن ندارد)
    // هنگام نشانه‌گیری دویدن قطع می‌شود و حرکت سنگین‌تر است (دقت در برابر سرعت)
    const canSprint = 1 - this.aimAmount;
    const sprintTarget = (this.desktop
      ? this.keySprint && mag > 0.1
        ? 1
        : 0
      : THREE.MathUtils.smoothstep(this.input.y, 0.62, 0.88)) * canSprint;
    this.sprintAmount += (sprintTarget - this.sprintAmount) * (1 - Math.exp(-9 * dt));
    if (this.sprintAmount < 0.002) this.sprintAmount = 0;
    const throttle = Math.min(1, mag * 1.5);
    const desired = THREE.MathUtils.lerp(7.8, 11.6, this.sprintAmount) * throttle * (1 - this.aimAmount * 0.45);

    const forward = this._t1.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = this._t2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = this._t3.copy(forward).multiplyScalar(this.input.y).addScaledVector(right, this.input.x);
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
        this.wasAirborne = true;
      }
    }
    this.vel.y -= (this.vel.y < 0 ? 26 : 20) * dt;
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y <= 0) {
      // فرود: ضربه‌ی دوربین، صدا و گرد و خاک (هرچه سقوط تندتر، سنگین‌تر)
      if (this.wasAirborne && this.vel.y < -4) {
        const power = THREE.MathUtils.clamp(-this.vel.y / 18, 0.15, 1);
        this.landDip = Math.max(this.landDip, power);
        this.shakeScreen(0.16 * power);
        sound.land();
        this.vibrate(Math.round(22 * power));
        this.particles.burst(this.pos.clone().setY(0.1), Math.round(6 + 10 * power), new THREE.Color(0x8fd8ff), {
          speed: 2.4 + 3 * power,
          gravity: 6,
          life: 0.4,
          size: 0.3,
        });
      }
      this.pos.y = 0;
      this.vel.y = 0;
      this.onGround = true;
      this.wasAirborne = false;
    } else {
      this.wasAirborne = true;
    }
    resolveCircle(this.pos, 0.45, this.world.obstacles, this.world.bounds);

    // ارتفاع سر و لرزش راه‌رفتن
    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    this.bob += dt * (3.6 + hspeed * 0.95);
    this.bobJitter = THREE.MathUtils.lerp(this.bobJitter, this.onGround ? Math.min(1, hspeed / 11) : 0, dt * 7);

    // گام‌ها: هر نیم‌چرخه‌ی bob یک قدم است → صدای پا + تکان دوربین + گرد و خاک
    if (this.onGround && hspeed > 1.4) {
      const prev = this.stepPhase;
      this.stepPhase += dt * (1.6 + hspeed * 0.42);
      if (Math.floor(this.stepPhase) !== Math.floor(prev)) {
        const power = THREE.MathUtils.clamp(hspeed / 11, 0.2, 1);
        this.stepDip = Math.max(this.stepDip, 0.35 + power * 0.65);
        sound.step(power);
        if (power > 0.55 && Math.random() < 0.6) {
          this.particles.burst(this.pos.clone().setY(0.08), 3, new THREE.Color(0x6fb6d8), {
            speed: 1.4,
            gravity: 5,
            life: 0.35,
            size: 0.2,
          });
        }
      }
    } else {
      this.stepPhase = 0;
    }

    // خم شدن بدن به چپ/راست هنگام جابه‌جایی عرضی (حس حرکت واقعی)
    const lateral = this.vel.x * right.x + this.vel.z * right.z;
    const leanTarget = THREE.MathUtils.clamp(-lateral / 12, -1, 1) * (1 - this.aimAmount * 0.6);
    this.lean += (leanTarget - this.lean) * (1 - Math.exp(-8 * dt));
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
    // پرش زاویه دید (FOV): دویدن = بازتر، نشانه‌گیری = بسته‌تر (زوم)
    const adsFov = this.slot === "gun" ? 44 : 56;
    const targetFov = (this.baseFov + this.sprintAmount * 4.5) * (1 - this.aimAmount) + adsFov * this.aimAmount;
    if (Math.abs(this.camera.fov - targetFov) > 0.04) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
      this.syncParticleScale();
    }
    // گام‌ها: هر قدم کمی دوربین را پایین می‌آورد؛ فرود ضربه‌ی محکم‌تری دارد
    const stepDrop = this.stepDip * 0.05 * (1 - this.aimAmount * 0.6);
    const eye = 1.66 + Math.sin(this.bob * 2) * 0.035 * this.bobJitter - stepDrop - this.landDip * 0.3;
    const shakeX = this.shake * (Math.random() - 0.5) * 0.22;
    const shakeY = this.shake * (Math.random() - 0.5) * 0.22;
    const roll = Math.sin(this.bob) * 0.012 * this.bobJitter + this.shake * (Math.random() - 0.5) * 0.09;
    const falling = this.alive ? 0 : Math.min(1, this.deathT * 1.4);
    const camY = THREE.MathUtils.lerp(this.pos.y + eye, 0.55, falling);
    this.camera.position.set(this.pos.x + shakeX, camY + shakeY, this.pos.z);
    const lean = Math.sin(this.bob) * 0.09 * this.bobJitter;
    const zAx = Math.sin(this.bob) * 0.014 * this.bobJitter;
    // نشانه‌گیری: تکان‌های راه‌رفتن کم می‌شود تا دید ثابت بماند
    const steady = 1 - this.aimAmount * 0.7;
    this.camera.rotation.set(
      this.pitch + (this.recoilPitch + this.meleePitch) * steady + falling * -0.5,
      this.yaw,
      (roll * 0.6 + zAx + lean * 0.05) * steady + this.lean * 0.035 + falling * 0.7,
    );
    this.camera.updateMatrixWorld();
  }

  /** فریم انیمیشن مدل اول‌شخص را می‌سازد و به ViewModel می‌دهد */
  private updateViewModel(dt: number) {
    void dt;
    const meleeAnim = this.slot === "knife" ? MELEE.knife.anim : MELEE.fists.anim;
    this.vm.update({
      dt: this.paused ? 0 : Math.min(0.05, dt),
      elapsed: this.elapsed,
      bob: this.bob,
      speed01: this.bobJitter,
      sprint01: this.sprintAmount,
      aim01: this.aimAmount,
      reloading: this.reloading && this.slot === "gun",
      reloadProgress: this.reloading ? 1 - Math.max(0, this.reloadT) / RELOAD_TIME : 0,
      slot: this.slot,
      meleeProgress: this.meleeT > 0 ? 1 - this.meleeT / meleeAnim : 0,
      meleeHand: this.meleeHand,
      swayX: this.gunSway.x,
      swayY: this.gunSway.y,
      alive: this.alive,
      vy: this.vel.y,
      landDip: this.landDip,
    });
  }

  private updateWeapon(dt: number) {
    // تکان نرم اسلحه از ورودی حرکت (به ViewModel داده می‌شود)
    const swayX = this.input.x * -0.028 + this.camera.rotation.z * 0.4;
    const swayY = this.input.y * 0.02 - 0.02;
    const swayK = Math.min(1, dt * 6);
    this.gunSway.x += (swayX - this.gunSway.x) * swayK;
    this.gunSway.y += (swayY - this.gunSway.y) * swayK;

    if (this.fireCd > 0) this.fireCd -= dt;
    if (this.emptyCd > 0) this.emptyCd -= dt;
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const need = this.magSize - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take;
        this.reserve -= take;
        this.reloading = false;
        this.opts.onEvent({ type: "reload" });
      }
    }
    if (!this.alive || this.paused) return;

    // ---------- اسلات نزدیک (دست خالی / چاقو) ----------
    if (this.slot !== "gun") {
      this.currentLock = false;
      const cfg = this.slot === "knife" ? MELEE.knife : MELEE.fists;
      // ضربه در میانه‌ی انیمیشن فرود می‌آید (نه در لحظه‌ی فشردن دکمه)
      if (this.meleeT > 0) {
        const progress = 1 - this.meleeT / cfg.anim;
        if (!this.meleeHitDone && progress >= 0.22 && progress <= 0.55) {
          this.meleeHitDone = true;
          this.meleeStrike();
        }
      }
      // ضربه‌ی نزدیک فقط دستی است: نگه‌داشتن دکمه = تکرار ضربه با ریتم کول‌داون
      if (this.firing && this.meleeCd <= 0 && this.meleeT <= 0) {
        this.startMelee();
      }
      return;
    }

    // ---------- اسلحه ----------
    this.lockTick = (this.lockTick + 1) % 2;
    if (this.autoFire && this.ammo > 0 && !this.reloading) {
      if (this.lockTick === 0) this.currentLock = this.castShot(true).enemy !== null;
    } else {
      // قفل کهنه نماند: با خشاب خالی/ریلود، شلیک خودکار ادامه پیدا نکند
      this.currentLock = false;
    }
    const shouldFire = this.firing || (this.autoFire && this.currentLock);
    if (shouldFire && !this.reloading && this.fireCd <= 0) {
      if (this.ammo > 0) this.shoot();
      else if (this.emptyCd <= 0) {
        // بدون کول‌داون، نگه‌داشتن شلیک با مهمات صفر هر فریم (۶۰/ث) صدای
        // خشاب‌خالی و توست «خشاب خالی» ریپ می‌کرد
        this.emptyCd = 0.4;
        sound.empty();
        this.opts.onEvent({ type: "noammo" });
        this.reload();
      }
    }
  }

  /** شروع انیمیشن ضربه‌ی نزدیک */
  private startMelee() {
    const cfg = this.slot === "knife" ? MELEE.knife : MELEE.fists;
    this.meleeCd = cfg.cd;
    this.meleeT = cfg.anim;
    this.meleeHitDone = false;
    // مشت‌ها یکی‌درمیان (چاقو همیشه دست راست)
    this.meleeHand = this.slot === "knife" ? 0 : this.meleeHand === 0 ? 1 : 0;
    if (this.slot === "knife") sound.slash();
    else sound.punch();
    this.vibrate(8);
  }

  /** فرود ضربه‌ی نزدیک: هر دشمن (یا گلوله‌ی دشمن) داخل برد و روبه‌رو */
  private meleeStrike() {
    const cfg = this.slot === "knife" ? MELEE.knife : MELEE.fists;
    const chest = this.playerCenter(this._t1);
    const dir = this._t2;
    this.camera.getWorldDirection(dir);
    const reach = cfg.range;

    // گرداندن گلوله‌های دشمن با ضربه‌ی نزدیک (ریسکِ نزدیک شدن را کمی کم می‌کند)
    for (const o of this.orbs) {
      if (!o.active) continue;
      const rel = this._t3.copy(o.mesh.position).sub(chest);
      if (rel.length() < reach && rel.normalize().dot(dir) > 0.45) {
        o.active = false;
        o.mesh.visible = false;
        this.particles.burst(o.mesh.position.clone(), 8, new THREE.Color(0xffd6a5), { speed: 5, gravity: 5, life: 0.3, size: 0.3 });
        sound.hit();
        this.score += 5;
      }
    }

    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of this.enemies) {
      if (!e.alive || e.spawnT > 0) continue;
      const c = this._t4.copy(e.pos);
      c.y += e.kind === "rusher" ? 0.45 : 0.2;
      const rel = this._t5.copy(c).sub(chest);
      const d = rel.length();
      if (d > reach + e.radius * 0.8) continue;
      if (rel.normalize().dot(dir) < 0.42) continue;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }

    // افکت هُل دادن هوا حتی اگر به چیزی نخورد
    const fxPoint = this._t3.copy(chest).addScaledVector(dir, Math.min(bestD, reach));
    this.meleePitch += 0.006;
    this.shakeScreen(0.09);
    if (!best) {
      this.particles.burst(fxPoint, 4, new THREE.Color(this.slot === "knife" ? 0xb7fbff : 0xffe6a8), {
        speed: 3,
        gravity: 2,
        life: 0.24,
        size: 0.24,
        dir: dir,
      });
      return;
    }

    const hitPoint = this._t4.copy(best.pos);
    hitPoint.y += 0.5;
    this.hurtEnemy(best, cfg.dmg, hitPoint);
    // ضربه‌ی نزدیک دشمن را محکم‌تر پرت می‌کند
    const kb = this._t5.copy(best.pos).sub(this.pos);
    kb.y = 0;
    if (kb.lengthSq() > 1e-5) best.vel.addScaledVector(kb.normalize(), best.kind === "boss" ? 0.6 : 4.5);
    this.particles.burst(hitPoint, 12, new THREE.Color(this.slot === "knife" ? 0xb7fbff : 0xffd166), {
      speed: 7,
      gravity: 7,
      life: 0.4,
      size: 0.36,
      dir,
    });
    sound.meleeHit();
    this.vibrate(26);
    this.shakeScreen(0.16);
    this.meleePitch -= 0.012;
    this.score += 15;
    this.opts.onEvent({ type: "melee" });
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

  /**
   * محاسبه برخورد تیر: نزدیک‌ترین دشمن روی خط دید و فاصله تا دیوار
   * (تمام بردارها scratch هستند؛ origin/dir تا اولین castShot بعدی معتبر می‌مانند)
   */
  private castShot(exact = false) {
    const origin = this._t1;
    this.camera.getWorldPosition(origin);
    const dir = this._t2;
    this.camera.getWorldDirection(dir);
    if (!exact) {
      // نشانه‌گیری پراکندگی را تقریباً صفر می‌کند؛ حرکت و لگد آن را بیشتر
      const spread = (0.006 + this.bobJitter * 0.014) * (1 - this.aimAmount * 0.85);
      dir.x += (Math.random() - 0.5) * spread;
      dir.y += (Math.random() - 0.5) * spread;
      dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();
    }
    let best: Enemy | null = null;
    let bestT = Infinity;
    for (const e of this.enemies) {
      if (!e.alive || e.spawnT > 0) continue;
      const c = this._t3.copy(e.pos);
      c.y += e.kind === "rusher" ? 0.45 : 0.15;
      const rel = this._t4.copy(c).sub(origin);
      const t = rel.dot(dir);
      if (t < 0.5 || t > 70) continue;
      const perp = this._t5.copy(rel).addScaledVector(dir, -t).length();
      const assist = this.assist * (1 + this.aimAmount * 0.18);
      const hitR = e.kind === "rusher" ? e.radius * Math.min(assist, 1.9) : e.radius * assist;
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
    // لگد: هنگام نشانه‌گیری کمتر است (دقت بالاتر)
    this.vm.recoil(1 - this.aimAmount * 0.35);
    this.recoilPitch += 0.0075 * (1 - this.aimAmount * 0.45);
    this.muzzleLight.intensity = 9;
    this.shakeScreen(0.06);

    const { enemy, enemyT, wallT, origin, dir } = this.castShot();
    const muzzlePos = this._t3;
    this.vm.muzzle.getWorldPosition(muzzlePos);

    if (enemy) {
      const hitPoint = this._t4.copy(origin).addScaledVector(dir, enemyT);
      this.tracers.add(muzzlePos, hitPoint);
      this.hurtEnemy(enemy, this.weaponDamage(), hitPoint);
      this.particles.burst(hitPoint, 7, new THREE.Color(0xffd166), { speed: 6, gravity: 6, life: 0.35, size: 0.3 });
      this.opts.onEvent({ type: "hit" });
      this.score += 10;
    } else {
      const end = this._t4.copy(origin).addScaledVector(dir, Math.min(wallT, 80));
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
      // پس‌زنی باید دشمن را از بازیکن دور کند (قبلاً به‌سمت بازیکن کشیده می‌شد)
      const kb = this._t5.copy(e.pos).sub(this.pos);
      kb.y = 0;
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
    // هیت‌استاپ خیلی کوتاه: لحظه‌ی کیل یک‌کم آهسته می‌شود تا ضربه «بهدل» بنشیند
    // (باس خودش اسلوموشن قوی‌تر دارد و min() اجازه‌ی کوتاه‌ترشدن نمی‌دهد)
    if (e.kind !== "boss") this.timeScale = Math.min(this.timeScale, 0.78);
    const mult = Math.min(3, 1 + (this.combo - 1) * 0.15);
    const gain = Math.round(e.scoreValue * mult);
    this.score += gain;
    // پول: هر کیل ۱ دلار، باس ۱۰ دلار
    const cash = e.kind === "boss" ? CASH_PER_BOSS : CASH_PER_KILL;
    this.money += cash;
    sound.coin();
    this.opts.onEvent({ type: "cash", amount: cash, money: this.money, text: `$${cash}` });

    const col = new THREE.Color(KIND_STATS[e.kind].color);
    this.particles.burst(e.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 26, col, { speed: 9, gravity: 8, life: 0.8, size: 0.55 });
    this.particles.burst(e.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 10, new THREE.Color(0xffffff), { speed: 6, gravity: 5, life: 0.5, size: 0.4 });
    sound.kill();
    this.vibrate([18, 30, 30]);
    this.opts.onEvent({ type: "kill", combo: this.combo, text: `+${gain}`, amount: gain });
    if (e.kind === "boss") this.onBossDefeated(e);
    this.removeEnemy(e, true);
    // شانس افت آیتم
    if (e.kind !== "boss" && Math.random() < (this.hp < 55 ? 0.36 : 0.2)) {
      this.spawnPickup(e.pos.clone(), this.hp < 55 && Math.random() < 0.6 ? "hp" : "ammo");
    }
  }

  /** انفجار سینمایی باس + باز شدن شاپ با وقفه‌ی ۱۰۰ ثانیه‌ای */
  private onBossDefeated(e: Enemy) {
    this.bossRef = null;
    const p = e.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    sound.bossDie();
    this.vibrate([70, 40, 90]);
    this.shakeScreen(1.2);
    this.timeScale = 0.35; // اسلوموشن کوتاه
    this.particles.burst(p, 90, new THREE.Color(0xff2e63), { speed: 20, gravity: 5, life: 1.4, size: 0.9 });
    this.particles.burst(p, 50, new THREE.Color(0xffd166), { speed: 13, gravity: 4, life: 1.1, size: 0.7 });
    this.particles.burst(p, 30, new THREE.Color(0xffffff), { speed: 8, gravity: 2, life: 0.9, size: 0.6 });
    // حلقه‌ی انفجار روی زمین
    this.spawnShockRing(e.pos, 0xffb347, 34);
    // غنیمت: چند آیتم اطراف محل انفجار
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.random();
      const at = e.pos.clone().add(new THREE.Vector3(Math.cos(a) * 3.4, 0, Math.sin(a) * 3.4));
      this.spawnPickup(at, i === 0 ? "hp" : "ammo");
    }
    this.opts.onEvent({ type: "boss", text: "defeated", wave: this.wave });
  }

  /** حلقه‌ی موج انفجار روی زمین (از استخر ثابت) */
  private spawnShockRing(at: THREE.Vector3, color: number, maxSize: number) {
    const ring = this.shockRings.find((r) => !(r.material as THREE.MeshBasicMaterial).opacity) ?? this.shockRings[0];
    if (!ring) return;
    const m = ring.material as THREE.MeshBasicMaterial;
    m.color.set(color);
    m.opacity = 0.9;
    ring.visible = true;
    ring.position.set(at.x, 0.28, at.z);
    ring.scale.setScalar(1);
    ring.userData.max = maxSize;
  }

  private updateShockRings(dt: number) {
    for (const ring of this.shockRings) {
      const m = ring.material as THREE.MeshBasicMaterial;
      if (m.opacity <= 0.001) {
        ring.visible = false;
        continue;
      }
      const max = (ring.userData.max as number) || 16;
      m.opacity = Math.max(0, m.opacity - dt * 1.15);
      ring.scale.addScalar(dt * max * 0.5);
    }
  }

  private removeEnemy(e: Enemy, animate: boolean) {
    void animate;
    this.scene.remove(e.group);
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
    if (this.bossRef === e) this.bossRef = null;
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
    else if (kind === "heavy") core = new THREE.Mesh(new THREE.OctahedronGeometry(0.72), mat);
    else core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 1), mat);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(st.radius * 0.95, 0.055, 5, 18),
      new THREE.MeshBasicMaterial({ color: kind === "boss" ? 0xffd166 : kind === "heavy" ? 0xf0abfc : kind === "rusher" ? 0xd9f99d : 0x67e8f9 }),
    );
    ring.rotation.x = Math.PI / 2.4;
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(kind === "boss" ? 0.3 : 0.14, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    eye.position.set(0, 0.1, kind === "boss" ? -1.05 : -0.42);
    group.add(core, ring, eye);

    let bossParts: Enemy["bossParts"];
    if (kind === "boss") {
      // باس: هسته‌ی بزرگ + دو حلقه‌ی چرخان + زره خاردار + هاله‌ی نورانی + چراغ
      const rings: THREE.Mesh[] = [];
      for (let i = 0; i < 2; i++) {
        const r = new THREE.Mesh(
          new THREE.TorusGeometry(1.9 + i * 0.6, 0.09, 6, 26),
          new THREE.MeshBasicMaterial({ color: i === 0 ? 0xff2e63 : 0xffd166 }),
        );
        r.rotation.set(Math.PI / 2 + i * 0.5, i * 0.8, 0);
        group.add(r);
        rings.push(r);
      }
      const spikeGroup = new THREE.Group();
      const spikeMat = new THREE.MeshPhongMaterial({ color: 0x2b0d1a, emissive: 0xff2e63, emissiveIntensity: 0.5, shininess: 60 });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const s = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.1, 5), spikeMat);
        s.position.set(Math.cos(a) * 1.55, Math.sin(a * 2) * 0.35, Math.sin(a) * 1.55);
        s.lookAt(s.position.clone().multiplyScalar(2));
        spikeGroup.add(s);
      }
      group.add(spikeGroup);
      const aura = new THREE.Mesh(
        new THREE.SphereGeometry(2.5, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xff2e63, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }),
      );
      group.add(aura);
      const light = new THREE.PointLight(0xff2e63, 40, 26, 2);
      group.add(light);
      bossParts = { rings, spikes: spikeGroup, aura, light };
    }

    group.position.copy(at);
    group.scale.setScalar(0.15);
    this.scene.add(group);

    // جان: دشمن‌های معمولی با موج قوی‌تر می‌شوند؛ باس با شماره‌ی نبرد باس
    const bossIndex = Math.max(1, Math.round(this.wave / BOSS_EVERY));
    const hp = kind === "boss" ? BOSS_BASE_HP * (1 + 0.5 * (bossIndex - 1)) : st.hp * (1 + (this.wave - 1) * 0.13);
    const enemy: Enemy = {
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
      speed: kind === "boss" ? st.speed : st.speed * (1 + (this.wave - 1) * 0.045) * (0.9 + Math.random() * 0.2),
      dmg: kind === "boss" ? st.dmg + bossIndex * 2 : st.dmg + (this.wave - 1) * 0.8,
      phase: Math.random() * 6.28,
      orbit: Math.random() < 0.5 ? -1 : 1,
      spawnT: kind === "boss" ? 2.2 : 0.6,
      burst: 0,
      burstCd: 0,
      scoreValue: st.score,
      hoverY: st.hover * scale * 0.5 + st.hover * 0.5,
      baseScale: kind === "boss" ? 1.35 : kind === "heavy" ? 1.15 : 1,
    };
    if (kind === "boss") {
      enemy.boss = { volley: 2.4, radial: 7, summon: 9, charge: 5, slam: 4, telegraph: 0, charging: 0, enraged: false };
      enemy.bossParts = bossParts;
      this.bossRef = enemy;
    }
    this.enemies.push(enemy);
    this.particles.burst(at.clone().add(new THREE.Vector3(0, 1, 0)), 16, new THREE.Color(st.color), { speed: 5, gravity: -1, life: 0.6, size: 0.5 });
    if (kind === "boss") {
      sound.bossRoar();
      this.shakeScreen(0.8);
      this.vibrate([80, 40, 80]);
      this.spawnShockRing(at, 0xff2e63, 26);
      this.particles.burst(at.clone().add(new THREE.Vector3(0, 2, 0)), 60, new THREE.Color(0xff2e63), { speed: 12, gravity: -2, life: 1.2, size: 0.9 });
    }
  }

  private updateEnemies(dt: number) {
    // همه‌ی بردارهای این حلقه scratch هستند (چند بردار موقت × دشمن × فریم = فشار GC)
    const playerChest = this._t1.copy(this.pos);
    playerChest.y += 1.3;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.alive) continue;
      if (e.spawnT > 0) {
        e.spawnT -= dt;
        const dur = e.kind === "boss" ? 2.2 : 0.6;
        const k = 1 - Math.max(0, e.spawnT) / dur;
        e.group.scale.setScalar(0.15 + k * (e.baseScale - 0.15));
        if (e.spawnT > 0) {
          if (e.kind === "boss") this.animateBoss(e, dt, k);
          continue;
        }
      }
      const toPlayer = this._t2.copy(playerChest).sub(e.pos);
      const dist = Math.max(0.001, toPlayer.length());
      const dirTo = this._t3.copy(toPlayer).divideScalar(dist);
      const desired = this._t4;
      desired.set(0, 0, 0);
      let speedMul = 1;

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
        desired.addScaledVector(this._t5.set(-dirTo.z, 0, dirTo.x), e.orbit * 0.5);
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
      } else if (e.kind === "boss") {
        speedMul = this.updateBoss(e, dt, playerChest, dirTo, dist, desired);
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
          desired.addScaledVector(this._t5.copy(e.pos).sub(o.pos).normalize(), (1 - d / minD) * 1.6);
        }
      }

      if (desired.lengthSq() > 0) desired.normalize();
      const target = desired.multiplyScalar(e.speed * speedMul);
      const k = 1 - Math.exp(-4.5 * dt);
      e.vel.x += (target.x - e.vel.x) * k;
      e.vel.z += (target.z - e.vel.z) * k;
      e.pos.x += e.vel.x * dt;
      e.pos.z += e.vel.z * dt;
      resolveCircle(e.pos, e.radius + 0.15, this.world.obstacles, this.world.bounds);

      // ارتفاع
      const hover =
        e.hoverY + Math.sin(this.elapsed * (e.kind === "boss" ? 1.2 : 2) + e.phase) * (e.kind === "boss" ? 0.5 : 0.18);
      e.pos.y = hover;
      e.group.position.copy(e.pos);
      e.ring.rotation.z += dt * (e.kind === "rusher" ? 4 : 1.6);
      e.core.rotation.y += dt * 0.9;
      if (e.kind === "rusher") e.core.rotation.x += dt * 2.2;
      // روی بازیکن نگاه کن
      e.group.rotation.y = Math.atan2(-dirTo.x, -dirTo.z);
      if (e.kind === "boss") this.animateBoss(e, dt, 1);
      if (e.hitFlash > 0) {
        e.hitFlash = Math.max(0, e.hitFlash - dt * 4);
        const m = e.core.material as THREE.MeshPhongMaterial;
        m.emissiveIntensity = 0.35 + e.hitFlash * 2.4;
        e.group.scale.setScalar(e.baseScale * (1 + e.hitFlash * (e.kind === "boss" ? 0.04 : 0.12)));
      } else if (e.kind === "boss") {
        e.group.scale.setScalar(e.baseScale);
      }
    }
  }

  /** انیمیشن ظاهری باس: حلقه‌ها، خارها، هاله و نور */
  private animateBoss(e: Enemy, dt: number, k: number) {
    const parts = e.bossParts;
    if (!parts) return;
    const enraged = e.boss?.enraged ? 1 : 0;
    parts.rings[0].rotation.z += dt * (1.1 + enraged * 1.6);
    parts.rings[0].rotation.x += dt * 0.35;
    parts.rings[1].rotation.y += dt * (0.9 + enraged * 1.3);
    parts.spikes.rotation.y -= dt * (0.6 + enraged * 0.8);
    const pulse = 0.1 + Math.sin(this.elapsed * (3 + enraged * 4)) * 0.04 + enraged * 0.1;
    (parts.aura.material as THREE.MeshBasicMaterial).opacity = Math.max(0, pulse) * (0.4 + k * 0.6);
    (parts.aura.material as THREE.MeshBasicMaterial).color.set(enraged ? 0xffd166 : 0xff2e63);
    parts.light.intensity = 30 + Math.sin(this.elapsed * 5) * 10 + enraged * 30 + e.hitFlash * 60;
    parts.light.color.set(enraged ? 0xffb347 : 0xff2e63);
    // خیز برداشتن برای یورش: قرمزِ چشمک‌زن
    if (e.boss && e.boss.telegraph > 0) {
      const blink = Math.sin(this.elapsed * 26) > 0 ? 1.9 : 0.5;
      (e.core.material as THREE.MeshPhongMaterial).emissiveIntensity = blink;
      (parts.aura.material as THREE.MeshBasicMaterial).opacity = 0.45;
    }
    if (e.boss && e.boss.charging > 0) {
      this.particles.burst(e.pos.clone(), 2, new THREE.Color(0xffb347), { speed: 3, gravity: 1, life: 0.4, size: 0.5 });
    }
  }

  /**
   * هوش مصنوعی باس: فاصله‌گیری، رگبار، انفجار حلقه‌ای، یورش (با خیز قابل‌دیدن)،
   * ضربه‌ی زمینی و احضار نیروی کمکی. زیر ۵۰٪ جان «خشمگین» می‌شود.
   * خروجی: ضریب سرعت این فریم.
   */
  private updateBoss(e: Enemy, dt: number, playerChest: THREE.Vector3, dirTo: THREE.Vector3, dist: number, desired: THREE.Vector3): number {
    const ai = e.boss;
    if (!ai) return 1;
    const clear = !segmentBlocked(playerChest, e.pos, this.world.obstacles, 7);

    // خشم: زیر نصف جان
    if (!ai.enraged && e.hp < e.maxHp * 0.5) {
      ai.enraged = true;
      sound.bossRoar();
      this.shakeScreen(0.8);
      this.vibrate(70);
      this.spawnShockRing(e.pos, 0xffd166, 30);
      this.particles.burst(e.pos.clone(), 50, new THREE.Color(0xffd166), { speed: 14, gravity: -1, life: 1, size: 0.8 });
      this.banner = "باس خشمگین شد!";
      this.bannerT = 2;
      this.opts.onEvent({ type: "boss", text: "enraged" });
    }
    const haste = ai.enraged ? 1.35 : 1;
    ai.volley -= dt * haste;
    ai.radial -= dt * haste;
    ai.summon -= dt;
    ai.charge -= dt * haste;
    ai.slam -= dt * haste;

    // ۱) خیز برداشتن برای یورش (قابل فرار چون علامت دارد)
    if (ai.telegraph > 0) {
      ai.telegraph -= dt;
      desired.set(0, 0, 0);
      if (ai.telegraph <= 0) {
        ai.charging = 1.15;
        ai.chargeDir = dirTo.clone().setY(0).normalize();
        sound.blast();
        this.shakeScreen(0.4);
      }
      return 0.15;
    }
    // ۲) یورش: سرعت زیاد، برخورد = آسیب سنگین + پرتاب بازیکن
    if (ai.charging > 0) {
      ai.charging -= dt;
      desired.copy(ai.chargeDir ?? dirTo);
      if (dist < e.radius + 1.3 && this.alive) {
        this.damagePlayer(e.dmg * 1.5);
        this.shakeScreen(0.75);
        this.vel.addScaledVector(ai.chargeDir ?? dirTo, 9);
        this.vel.y = Math.max(this.vel.y, 4.5);
        this.particles.burst(playerChest.clone(), 26, new THREE.Color(0xffb347), { speed: 10, gravity: 6, life: 0.6, size: 0.5 });
        ai.charging = 0;
      }
      return ai.charging > 0 ? 3.4 : 1;
    }
    // ۳) نگه‌داشتن فاصله و چرخش به دور بازیکن
    if (dist > 17) desired.copy(dirTo);
    else if (dist < 9.5) desired.copy(dirTo).negate();
    else desired.set(-dirTo.z, 0, dirTo.x).multiplyScalar(e.orbit);

    if (clear && this.alive) {
      // رگبار ۵ تایی
      if (ai.volley <= 0 && dist < 36) {
        ai.volley = ai.enraged ? 2.6 : 3.6;
        const base = dirTo.clone();
        for (let i = -2; i <= 2; i++) {
          const d = base.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.16);
          this.fireOrb(e, d, 15);
        }
        sound.bossShot();
      }
      // انفجار حلقه‌ای ۱۲ تایی
      if (ai.radial <= 0 && (ai.enraged || dist < 22)) {
        ai.radial = ai.enraged ? 6 : 9;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          this.fireOrb(e, new THREE.Vector3(Math.cos(a), 0.12, Math.sin(a)), 12.5);
        }
        this.shakeScreen(0.35);
        sound.bossShot();
      }
      // یورش با علامت هشدار
      if (ai.charge <= 0 && dist > 7 && dist < 28) {
        ai.charge = ai.enraged ? 6.5 : 9;
        ai.telegraph = 0.8;
        sound.empty();
      }
      // ضربه‌ی زمینی وقتی بازیکن چسبیده است
      if (ai.slam <= 0 && dist < 8.5) {
        ai.slam = 6.5;
        this.spawnShockRing(e.pos, 0xff5c8a, 22);
        this.shakeScreen(0.6);
        sound.blast();
        this.particles.burst(e.pos.clone().setY(0.4), 40, new THREE.Color(0xff5c8a), { speed: 12, gravity: 8, life: 0.7, size: 0.6 });
        if (dist < 8) {
          this.damagePlayer(e.dmg * 0.85);
          const away = this.pos.clone().sub(e.pos).setY(0);
          if (away.lengthSq() > 1e-5) this.vel.addScaledVector(away.normalize(), 8);
        }
      }
    }
    // احضار نیروی کمکی
    if (ai.summon <= 0 && this.enemies.length < 7) {
      ai.summon = ai.enraged ? 10 : 14;
      const n = ai.enraged ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const at = e.pos.clone().add(new THREE.Vector3(Math.cos(a) * 5, 0, Math.sin(a) * 5));
        resolveCircle(at, 0.8, this.world.obstacles, this.world.bounds);
        this.spawnEnemy(i % 2 === 0 ? "rusher" : "drone", at.setY(0));
      }
      sound.wave();
      this.opts.onEvent({ type: "boss", text: "summon" });
    }
    return 1;
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
    const chest = this.playerCenter(this._t1);
    for (const o of this.orbs) {
      if (!o.active) continue;
      o.life -= dt;
      o.vel.y -= 1.2 * dt;
      o.mesh.position.addScaledVector(o.vel, dt);
      o.mesh.rotation.x += dt * 6;
      const p = o.mesh.position;
      if (Math.random() < 0.25) {
        this.particles.burst(p, 1, ORB_TRAIL_COLOR, {
          speed: 0.6,
          gravity: 0,
          life: 0.22,
          size: 0.28,
          dir: this._t2.copy(o.vel).normalize().negate(),
        });
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
      saveBest(this.score);
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
        const dir = this._t2.copy(this.pos).add(BLAST_Y).sub(p.mesh.position).normalize();
        p.mesh.position.addScaledVector(dir, dt * (2.5 + (3.5 - d) * 2.4));
      }
      p.mesh.visible = p.life > 5 || Math.sin(p.life * 12) > -0.2;
      if (d < 1.1 && this.alive) {
        if (p.kind === "hp") {
          this.hp = Math.min(this.maxHp, this.hp + 32);
          this.opts.onEvent({ type: "pickup", text: "+۳۲ جان" });
        } else {
          this.reserve = Math.min(RESERVE_CAP, this.reserve + 80);
          this.opts.onEvent({ type: "pickup", text: "+۸۰ تیر" });
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
  /** آیا این موج نبرد باس است؟ (هر ۱۰ موج) */
  static isBossWave(wave: number) {
    return wave > 0 && wave % BOSS_EVERY === 0;
  }

  private nextWave() {
    this.wave++;
    this.spawnQueue = [];
    const w = this.wave;
    const bossWave = Game.isBossWave(w);
    if (bossWave) {
      // نبرد باس: یک باس + اسکورت سبک (هرچه باس چندم باشد، اسکورت بیشتر)
      const bossIndex = Math.max(1, Math.round(w / BOSS_EVERY));
      this.spawnQueue.push("boss");
      const escort = Math.min(6, 2 + bossIndex);
      for (let i = 0; i < escort; i++) this.spawnQueue.push(i % 2 === 0 ? "rusher" : "drone");
      this.banner = `⚠ موج ${w} — نبرد باس ⚠`;
      this.bannerT = 3.2;
      sound.bossRoar();
      this.shakeScreen(0.7);
      this.vibrate([60, 30, 60]);
    } else {
      const total = 3 + Math.round(w * 1.7);
      for (let i = 0; i < total; i++) {
        const r = Math.random();
        if (w >= 3 && r < Math.min(0.28, 0.09 + w * 0.02)) this.spawnQueue.push("heavy");
        else if (r < Math.min(0.62, 0.32 + w * 0.04)) this.spawnQueue.push("rusher");
        else this.spawnQueue.push("drone");
      }
      this.banner = `موج ${w}`;
      this.bannerT = 2.4;
      sound.wave();
    }
    this.spawnTimer = bossWave ? 1.6 : 0.8;
    this.breakTimer = -1;
    // شاپ با شروع موج بعدی بسته می‌شود
    this.shopAvailable = false;
    this.opts.onEvent({ type: "wave", wave: w, text: bossWave ? "boss" : undefined });
    // جایزه‌ی شروع موج: فقط آیتم روی زمین می‌افتد.
    // خشاب دیگر خودکار پر نمی‌شود — بازیکن باید خودش R/دکمه‌ی خشاب را بزند.
    if (w > 1) {
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
      const bossCleared = Game.isBossWave(this.wave);
      // بعد از نبرد باس: ۱۰۰ ثانیه وقفه با شاپ باز و تایمر شروع موج‌ها
      this.breakTimer = bossCleared ? SHOP_BREAK : REGULAR_BREAK;
      this.score += bossCleared ? 1000 : 150;
      if (bossCleared) {
        this.shopAvailable = true;
        this.banner = "باس نابود شد! شاپ باز شد 🛒";
        this.bannerT = 3.4;
        sound.shopOpen();
        this.opts.onEvent({ type: "wave", wave: this.wave, text: "cleared" });
        this.opts.onEvent({ type: "shop", text: `شاپ ${SHOP_BREAK} ثانیه باز است` });
      } else {
        this.banner = `موج ${this.wave} پاک‌سازی شد`;
        this.bannerT = 2.4;
        this.opts.onEvent({ type: "wave", wave: this.wave, text: "cleared" });
        sound.wave();
      }
      this.emitState(true);
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

  /** آیا قفل اتوشلیک این لحظه روی دشمن نشسته است؟ (حالت سبک برای HUD) */
  get onTarget() {
    return this.currentLock;
  }

  /** نسبت کیفیت فعلی (۱ = کامل، کمتر = رزولوشن پایین‌تر برای روانی) */
  get perfRatio() {
    return this.perf.ratio;
  }

  private snapshot(): HudState {
    const meleeCfg = this.slot === "knife" ? MELEE.knife : MELEE.fists;
    const boss = this.bossRef && this.bossRef.alive ? this.bossRef : null;
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
      money: Math.round(this.money),
      weaponLevel: this.weaponLevel,
      weaponDamage: Math.round(this.weaponDamage() * 10) / 10,
      hasKnife: this.hasKnife,
      slot: this.slot,
      aiming: this.aimAmount > 0.5,
      meleeReady: 1 - this.meleeCd / meleeCfg.cd,
      meleeDamage: meleeCfg.dmg,
      meleeRange: meleeCfg.range,
      boss: boss ? { hp: Math.max(0, boss.hp), maxHp: boss.maxHp, enraged: !!boss.boss?.enraged } : null,
      nextBossWave: Math.max(1, Math.ceil(this.wave / BOSS_EVERY)) * BOSS_EVERY,
      breakTime: this.breakTimer > 0 ? this.breakTimer : 0,
      shopAvailable: this.shopAvailable,
      shop: {
        damageCost: this.damageUpgradeCost(),
        damageLevel: this.weaponLevel,
        damageMax: SHOP.damageMaxLevel,
        ammoCost: SHOP.ammoCost,
        ammoAmount: SHOP.ammoAmount,
        knifeCost: SHOP.knifeCost,
        hasKnife: this.hasKnife,
        reserve: this.reserve,
        reserveCap: RESERVE_CAP,
      },
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

  /** پول فعلی (برای HUD/شاپ) */
  get cash() {
    return Math.round(this.money);
  }

  /** آیا شاپ باز است؟ */
  get shopOpen() {
    return this.shopAvailable;
  }

  /** ثانیه‌های باقی‌مانده تا شروع موج بعد */
  get breakTimeLeft() {
    return this.breakTimer > 0 ? this.breakTimer : 0;
  }
}

// برای استفاده در جاهایی که نیاز به تایپ است
export type { GameEventName } from "./types";
export type { GameEvent } from "./types";
