// تست headless موتور واقعی بازی (src/game/engine.ts) در Node.
// WebGLRenderer با استاب جایگزین شده (alias در run-tests.mjs) ولی تمام منطق
// موتور — حلقه‌ی update، موج‌ها، هوش دشمن، شلیک، برخورد، آیتم‌ها — واقعی اجراست.
import type * as THREE_NS from "three";

/* ------------------------------ شیمِ مرورگر ------------------------------ */
function make2D() {
  const gradient = { addColorStop: (_o: number, _c: string) => {} };
  return {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    createRadialGradient: () => gradient,
  };
}

type Listener = (e: never) => void;
const winListeners = new Map<string, Set<Listener>>();
const docListeners = new Map<string, Set<Listener>>();

function addTo(map: Map<string, Set<Listener>>, type: string, fn: Listener) {
  let s = map.get(type);
  if (!s) {
    s = new Set();
    map.set(type, s);
  }
  s.add(fn);
}
function delFrom(map: Map<string, Set<Listener>>, type: string, fn: Listener) {
  map.get(type)?.delete(fn);
}
function fire(map: Map<string, Set<Listener>>, type: string, e: unknown) {
  map.get(type)?.forEach((fn) => (fn as (ev: unknown) => void)(e));
}

let coarsePointer = false;
const fakeCanvas = {
  style: {} as Record<string, string>,
  width: 0,
  height: 0,
  parentElement: { clientWidth: 800, clientHeight: 600 },
  listeners: new Map<string, Set<Listener>>(),
  addEventListener(type: string, fn: Listener) {
    addTo(this.listeners, type, fn);
  },
  removeEventListener(type: string, fn: Listener) {
    delFrom(this.listeners, type, fn);
  },
  requestPointerLock() {
    (globalThis as Record<string, unknown>).__lockRequested = true;
  },
};

const store = new Map<string, string>();
let storageThrows = false;
const localStorageStub = {
  getItem: (k: string) => {
    if (storageThrows) throw new Error("SecurityError: storage blocked");
    return store.has(k) ? store.get(k)! : null;
  },
  setItem: (k: string, v: string) => {
    if (storageThrows) throw new Error("SecurityError: storage blocked");
    store.set(k, String(v));
  },
  removeItem: (k: string) => void store.delete(k),
};

const G = globalThis as Record<string, unknown>;
G.window = {
  matchMedia: (_q: string) => ({ matches: coarsePointer }),
  devicePixelRatio: 1,
  innerWidth: 800,
  innerHeight: 600,
  addEventListener: (t: string, fn: Listener) => addTo(winListeners, t, fn),
  removeEventListener: (t: string, fn: Listener) => delFrom(winListeners, t, fn),
  setTimeout: (...a: [unknown, number]) => setTimeout(a[0] as () => void, a[1]),
  clearTimeout: (id: unknown) => clearTimeout(id as NodeJS.Timeout),
};
G.document = {
  createElement: (tag: string) => {
    if (tag === "canvas") return { width: 0, height: 0, getContext: () => make2D() };
    return {};
  },
  addEventListener: (t: string, fn: Listener) => addTo(docListeners, t, fn),
  removeEventListener: (t: string, fn: Listener) => delFrom(docListeners, t, fn),
  visibilityState: "visible",
  exitPointerLock: () => {},
  pointerLockElement: null,
};
G.localStorage = localStorageStub;
G.requestAnimationFrame = (_cb: (t: number) => void) => 1;
G.cancelAnimationFrame = (_id: number) => {};
if (typeof G.navigator === "undefined") G.navigator = {};

/* ------------------------------- چارچوب تست ------------------------------ */
let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) console.log(`PASS  ${name}`);
  else {
    failures++;
    console.log(`FAIL  ${name} ${extra}`);
  }
}
function mustNotThrow(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name} threw: ${(err as Error).message}`);
  }
}

const THREE = (await import("three")) as typeof THREE_NS;
const { Game } = await import("../src/game/engine");
const { bestScore } = await import("../src/game/settings");

type GameAny = {
  tick: (t: number) => void;
  lastT: number;
  [k: string]: never;
};

/* ------------------------------- سناریو: دسکتاپ --------------------------- */
coarsePointer = false;
const events: { type: string; wave?: number }[] = [];
let states = 0;
const game = new Game(fakeCanvas as unknown as HTMLCanvasElement, {
  onState: () => {
    states++;
  },
  onEvent: (e) => void events.push(e as { type: string; wave?: number }),
});
const g = game as unknown as GameAny & {
  start: () => void;
  restart: () => void;
  pause: () => void;
  resume: () => void;
  dispose: () => void;
  resize: () => void;
  setMove: (x: number, y: number) => void;
  setFiring: (v: boolean) => void;
  applyLook: (dx: number, dy: number) => void;
  jump: () => void;
  reload: () => void;
  blast: () => void;
  requestLock: () => Promise<void>;
  running: boolean;
  paused: boolean;
  alive: boolean;
};

check("engine: ساخت بازی بدون خطا", true);
check("engine: شروع نشده running=false", g.running === false);

let t = 0;
const pump = (n: number, stepMs = 16.7) => {
  for (let i = 0; i < n; i++) {
    t += stepMs;
    g.tick(t);
  }
};

mustNotThrow("engine: start() بدون خطا", () => game.start());
t = g.lastT as number;
check("engine: بعد از start موج ۱ است", (g as unknown as { wave: number }).wave === 1);
check(
  "engine: صف اسپاون پر شده",
  ((g as unknown as { spawnQueue: unknown[] }).spawnQueue.length as number) > 0
);

// حرکت با کیبورد (مسیر دسکتاپ) + شلیک
fire(winListeners, "keydown", { code: "KeyW", preventDefault: () => {} });
game.setFiring(true);
const z0 = (game as unknown as { pos: THREE_NS.Vector3 }).pos.z;
mustNotThrow("engine: پمپ ۱۵۰ تیک با حرکت/شلیک", () => pump(150));
const pos1 = (game as unknown as { pos: THREE_NS.Vector3 }).pos;
check("engine: بازیکن با KeyW حرکت کرد", pos1.z < z0, `z ${z0} -> ${pos1.z}`);
check("engine: مختصات معتبر (نه NaN)", Number.isFinite(pos1.x) && Number.isFinite(pos1.y) && Number.isFinite(pos1.z));
check(
  "engine: دشمن اسپاون شد",
  ((game as unknown as { enemies: unknown[] }).enemies.length as number) > 0
);

// دشمن مستقیم جلوی دوربین → شلیک خودکار باید اصابت کند
// (اول حرکت را قطع و بازیکن را به نقطه‌ی باز و معلوم برمی‌گردانیم تا تست قطعی باشد)
{
  const gg = game as unknown as {
    pos: THREE_NS.Vector3;
    vel: THREE_NS.Vector3;
    yaw: number;
    pitch: number;
    enemies: { pos: THREE_NS.Vector3 }[];
    spawnEnemy: (k: "heavy" | "drone" | "rusher", at: THREE_NS.Vector3) => void;
  };
  fire(winListeners, "keyup", { code: "KeyW" });
  gg.pos.set(0, 0, 22);
  gg.vel.set(0, 0, 0);
  gg.yaw = 0;
  gg.pitch = 0;
  const fwd = new THREE.Vector3(-Math.sin(gg.yaw), 0, -Math.cos(gg.yaw));
  gg.spawnEnemy("heavy", gg.pos.clone().addScaledVector(fwd, 6).setY(0));
}
const score0 = (game as unknown as { score: number }).score;
mustNotThrow("engine: پمپ ۸۰ تیک نبرد", () => pump(80));
const score1 = (game as unknown as { score: number }).score;
const kills1 = (game as unknown as { kills: number }).kills;
check("engine: شلیک/نبرد امتیاز یا کشته ثبت کرد", score1 > score0 || kills1 > 0, `score ${score0}->${score1} kills=${kills1}`);
const ammoAfter = (game as unknown as { ammo: number }).ammo;
check("engine: تیر مصرف شد", ammoAfter < 34, `ammo=${ammoAfter}`);

// پاک‌سازی میدان برای تست‌های قطعی بعدی (بدون دشمن سرگردان و بدون شلیک)
{
  const gg = game as unknown as {
    enemies: { hp: number }[];
    spawnQueue: unknown[];
    hurtEnemy: (e: unknown, dmg: number, p: null) => void;
  };
  gg.spawnQueue.length = 0;
  for (const e of [...gg.enemies]) gg.hurtEnemy(e, 99999, null);
  game.setFiring(false);
}
pump(5);

// پرش/خشاب/انفجار
mustNotThrow("engine: jump/reload/blast بدون خطا", () => {
  game.jump();
  pump(5);
  game.reload();
  const reloading = (game as unknown as { reloading: boolean }).reloading;
  if (!reloading) throw new Error("reloading نشد");
  pump(120); // ~۲ ثانیه: پر شدن خشاب
  game.blast();
});
check("engine: انفجار موج کول‌داون گرفت", (game as unknown as { blastCd: number }).blastCd > 0);
check("engine: بعد از ریلود خشاب پر است", (game as unknown as { ammo: number }).ammo === 34);
mustNotThrow("engine: پمپ تا موج دوم", () => pump(320));
check("engine: موج دوم شروع شد", (game as unknown as { wave: number }).wave === 2);
check("engine: رویداد wave ثبت شد", events.some((e) => e.type === "wave"));

// ورودی‌های کیبورد/ماوس
(game as unknown as { ammo: number }).ammo = 10;
fire(winListeners, "keydown", { code: "KeyR", preventDefault: () => {} });
check("engine: کلید R خشاب را پر می‌کند", (game as unknown as { reloading: boolean }).reloading === true);
pump(120);
fire(winListeners, "keydown", { code: "Space", preventDefault: () => {} });
pump(2);
check("engine: Space باعث پرش شد", (game as unknown as { pos: THREE_NS.Vector3 }).pos.y > 0.01);
pump(90);
const yaw0 = (game as unknown as { yaw: number }).yaw;
fire(fakeCanvas.listeners, "mousedown", { button: 0 });
await game.requestLock(); // قفل شدن pointer lock (در مرورگر ناهمگام است)
fire(winListeners, "mousemove", { movementX: 60, movementY: -20 });
check("engine: حرکت ماوس زاویه دید را چرخاند", (game as unknown as { yaw: number }).yaw !== yaw0);
fire(winListeners, "mouseup", {});
let autoPaused = false;
const g2check = game as unknown as { firing: boolean };
check("engine: mouseup شلیک را قطع کرد", g2check.firing === false);
// Escape → onAutoPause (از طریق callback دوم: مستقیم متد را صدا می‌زنیم چون callback در کانستراکتور بسته شده)
{
  const game3 = new Game(fakeCanvas as unknown as HTMLCanvasElement, {
    onState: () => {},
    onEvent: () => {},
    onAutoPause: () => {
      autoPaused = true;
    },
  });
  void game3;
  fire(winListeners, "keydown", { code: "Escape", preventDefault: () => {} });
  check("engine: Escape باعث auto-pause شد", autoPaused === true);
  game3.dispose();
}

// خطای pointer lock نباید بازی را بترکاند
{
  const c = fakeCanvas as unknown as { requestPointerLock: () => void };
  const prev = c.requestPointerLock;
  c.requestPointerLock = () => {
    throw new Error("denied");
  };
  let threw = false;
  try {
    await game.requestLock();
  } catch {
    threw = true;
  }
  check("engine: خطای pointer-lock مهار می‌شود", threw === false);
  c.requestPointerLock = prev;
}

// همگام‌سازی با قفل واقعی مرورگر (pointerlockchange)
{
  const doc = G.document as { pointerLockElement: unknown };
  const gg = game as unknown as { locked: boolean };
  doc.pointerLockElement = fakeCanvas;
  fire(docListeners, "pointerlockchange", {});
  check("engine: pointerlockchange قفل واقعی را ثبت می‌کند", gg.locked === true);
  doc.pointerLockElement = null;
  fire(docListeners, "pointerlockchange", {});
  check("engine: خروج از قفل واقعی locked را false می‌کند", gg.locked === false);
}

// resize
{
  fakeCanvas.parentElement.clientWidth = 1280;
  fakeCanvas.parentElement.clientHeight = 720;
  mustNotThrow("engine: resize بدون خطا", () => game.resize());
  const cam = (game as unknown as { camera: THREE_NS.PerspectiveCamera }).camera;
  check("engine: aspect دوربین به‌روز شد", Math.abs(cam.aspect - 1280 / 720) < 1e-6);
}

// pause/resume (با رندرر تقلبی که renderCalls را می‌شمارد)
{
  const renderer = (game as unknown as { renderer: { renderCalls: number } }).renderer;
  mustNotThrow("engine: pause/resume", () => {
    game.pause();
    const el = (game as unknown as { elapsed: number }).elapsed;
    pump(10);
    if ((game as unknown as { elapsed: number }).elapsed !== el) throw new Error("در توقف آپدیت شد");
    game.resume();
  });
  check("engine: بعد از resume اجرا ادامه دارد", g.paused === false);
  const rc0 = renderer.renderCalls;
  game.pause();
  pump(10);
  check("engine: در توقف موقت رندر نمی‌شود (صرفه‌جویی GPU)", renderer.renderCalls === rc0, `+${renderer.renderCalls - rc0}`);
  game.resume();
  pump(10);
  check("engine: بعد از resume رندر ادامه پیدا می‌کند", renderer.renderCalls > rc0);
}

// مرگ بازیکن
{
  const gg = game as unknown as { damagePlayer: (n: number) => void; invuln: number };
  gg.invuln = 0;
  gg.damagePlayer(99999);
}
check("engine: بازیکن مرد", g.alive === false);
check("engine: رویداد death ثبت شد", events.some((e) => e.type === "death"));
check("engine: رکورد در localStorage ذخیره شد", store.has("cyber_best"));

// شروع دوباره (باید همه‌ی دشمن‌ها/آیتم‌ها را از صحنه پاک کند — رگرشن نشت مش‌ها)
{
  const gg = game as unknown as {
    spawnEnemy: (k: "drone" | "heavy" | "rusher", at: THREE_NS.Vector3) => void;
    pos: THREE_NS.Vector3;
  };
  for (let i = 0; i < 6; i++) {
    gg.spawnEnemy("drone", gg.pos.clone().add(new THREE.Vector3(4 + i, 0, -8)));
  }
}
let sceneBefore = 0;
let enemyCount = 0;
let pickupCount = 0;
mustNotThrow("engine: restart بدون خطا", () => {
  const gg = game as unknown as {
    scene: THREE_NS.Scene;
    enemies: unknown[];
    pickups: unknown[];
  };
  sceneBefore = gg.scene.children.length;
  enemyCount = gg.enemies.length;
  pickupCount = gg.pickups.length;
  game.restart();
});
{
  const after = (game as unknown as { scene: THREE_NS.Scene }).scene.children.length;
  check(
    "engine: بعد از restart هیچ دشمن/آیتمی در صحنه نماند",
    after === sceneBefore - enemyCount - pickupCount,
    `children ${sceneBefore}->${after} enemies=${enemyCount} pickups=${pickupCount}`
  );
}
check(
  "engine: بعد از restart زنده و موج ۱",
  g.alive === true && (game as unknown as { wave: number }).wave === 1
);
mustNotThrow("engine: پمپ ۱۰۰ تیک بعد از restart", () => pump(100));
check("engine: onState صدا زده شد", states > 0);

// کشتن دسته‌ای دشمن (جهش splice در حلقه‌ها نباید بپرد)
mustNotThrow("engine: کشتن ۲۵ دشمن پشت سر هم", () => {
  const gg = game as unknown as {
    enemies: unknown[];
    spawnEnemy: (k: "drone", at: THREE_NS.Vector3) => void;
    hurtEnemy: (e: unknown, dmg: number, p: null) => void;
    pos: THREE_NS.Vector3;
  };
  for (let i = 0; i < 25; i++) gg.spawnEnemy("drone", gg.pos.clone().add(new THREE.Vector3(3 + i * 0.2, 0, -6)));
  for (const e of [...gg.enemies]) gg.hurtEnemy(e, 99999, null);
  pump(30);
});

mustNotThrow("engine: dispose بدون خطا", () => game.dispose());
check(
  "engine: لیسنرها بعد از dispose پاک شدند",
  (winListeners.get("keydown")?.size ?? 0) === 0 && (docListeners.get("visibilitychange")?.size ?? 0) === 0
);

/* ------------------------------- سناریو: موبایل --------------------------- */
coarsePointer = true;
winListeners.clear();
docListeners.clear();
const gameM = new Game(fakeCanvas as unknown as HTMLCanvasElement, {
  onState: () => {},
  onEvent: () => {},
});
const gm = gameM as unknown as GameAny & {
  start: () => void;
  dispose: () => void;
  setMove: (x: number, y: number) => void;
};
gameM.start();
t = (gameM as unknown as { lastT: number }).lastT;
gm.setMove(0, 1); // کامل رو به جلو → دویدن
for (let i = 0; i < 120; i++) {
  t += 16.7;
  (gameM as unknown as { tick: (x: number) => void }).tick(t);
}
check(
  "engine(mobile): کشیدن کامل جوی‌استیک = دویدن",
  ((gameM as unknown as { sprintAmount: number }).sprintAmount as number) > 0.5
);
check(
  "engine(mobile): بازیکن حرکت کرد",
  (gameM as unknown as { pos: THREE_NS.Vector3 }).pos.z < 22
);
// setMove باید ورودی را clamp کند
gm.setMove(5, -7);
{
  const inp = (gameM as unknown as { input: { x: number; y: number } }).input;
  check("engine: setMove ورودی را clamp می‌کند", inp.x === 1 && inp.y === -1);
}
gameM.dispose();

/* --------------- سناریو: اقتصاد، باس، شاپ، اسلات، نزدیک و نشانه‌گیری --------------- */
coarsePointer = false;
winListeners.clear();
docListeners.clear();
const eventsE: { type: string; amount?: number; text?: string }[] = [];
const gameE = new Game(fakeCanvas as unknown as HTMLCanvasElement, {
  onState: () => {},
  onEvent: (e) => void eventsE.push(e as { type: string; amount?: number; text?: string }),
});
type GameE = typeof gameE & Record<string, never>;
const ge = gameE as unknown as GameE & {
  start: () => void;
  restart: () => void;
  dispose: () => void;
  nextWave: () => void;
  removeEnemy: (e: unknown, a: boolean) => void;
  spawnEnemy: (k: "drone" | "rusher" | "heavy" | "boss", at: THREE_NS.Vector3) => void;
  spawnQueue: unknown[];
  enemies: { hp: number; maxHp: number; alive: boolean; spawnT: number; kind: string; pos: THREE_NS.Vector3; boss?: unknown }[];
  hurtEnemy: (e: unknown, dmg: number, p: null) => void;
  buy: (item: "damage" | "ammo" | "knife") => boolean;
  setSlot: (s: "fists" | "gun" | "knife") => void;
  cycleSlot: (d?: number) => void;
  setAiming: (v: boolean, src?: "mouse" | "key" | "touch") => void;
  setFiring: (v: boolean) => void;
  startMelee: () => void;
  reload: () => void;
  weaponDamage: () => number;
  money: number;
  weaponLevel: number;
  hasKnife: boolean;
  slot: string;
  aimAmount: number;
  aiming: boolean;
  shopAvailable: boolean;
  breakTimer: number;
  wave: number;
  ammo: number;
  reserve: number;
  hp: number;
  maxHp: number;
  pos: THREE_NS.Vector3;
  vel: THREE_NS.Vector3;
  yaw: number;
  pitch: number;
  bossRef: unknown;
  timeScale: number;
  camera: { fov: number };
  baseFov: number;
  lastT: number;
  tick: (t: number) => void;
  autoFire: boolean;
  emptyCd: number;
  banner: string;
  bannerT: number;
  shake: number;
  shakeT: number;
  invuln: number;
  sprintAmount: number;
  recoilPitch: number;
  perfRatio: number;
};
gameE.autoFire = false; // تست‌های قطعی: شلیک خودکار خاموش
gameE.start();
let te = ge.lastT;
const pumpE = (n: number, stepMs = 16.7) => {
  for (let i = 0; i < n; i++) {
    te += stepMs;
    ge.tick(te);
  }
};
const clearField = () => {
  ge.spawnQueue.length = 0;
  for (const e of [...ge.enemies]) ge.removeEnemy(e, false);
};
const resetPlayer = () => {
  clearField();
  ge.pos.set(0, 0, 22);
  ge.vel.set(0, 0, 0);
  ge.yaw = 0;
  ge.pitch = 0;
  ge.hp = ge.maxHp = 100;
  ge.setFiring(false);
};

/* ------------------------------- پول ------------------------------- */
resetPlayer();
{
  const m0 = ge.money;
  ge.spawnEnemy("drone", ge.pos.clone().add(new THREE.Vector3(4, 0, -6)));
  const e = ge.enemies[ge.enemies.length - 1];
  ge.hurtEnemy(e, 99999, null);
  check("پول: هر کیل ۱ دلار", ge.money === m0 + 1, `money=${ge.money}`);
  check("پول: رویداد cash منتشر شد", eventsE.some((x) => x.type === "cash"));
}

/* --------------------------- موج/دشمن باس --------------------------- */
check("باس: هر ۱۰ موج نبرد باس است (۱۰)", Game.isBossWave(10) === true && Game.isBossWave(20) === true);
check("باس: موج‌های دیگر باس ندارند", Game.isBossWave(9) === false && Game.isBossWave(11) === false);
resetPlayer();
{
  ge.wave = 9;
  ge.nextWave();
  check("باس: موج ۱۰ باس در صف دارد", (ge.spawnQueue as string[]).includes("boss"), `q=${ge.spawnQueue.join(",")}`);
  check("باس: شماره موج ۱۰ شد", ge.wave === 10);
}
resetPlayer();
{
  const m0 = ge.money;
  ge.wave = 10;
  ge.spawnEnemy("boss", ge.pos.clone().add(new THREE.Vector3(8, 0, -12)));
  const boss = ge.enemies[ge.enemies.length - 1];
  check("باس: جان زیاد دارد", boss.maxHp >= 1200, `hp=${boss.maxHp}`);
  check("باس: هوش مصنوعی دارد", !!boss.boss);
  check("باس: bossRef تنظیم شد", ge.bossRef === boss);
  ge.hurtEnemy(boss, 99999, null);
  check("پول: باس ۱۰ دلار", ge.money === m0 + 10, `money=${ge.money}`);
  check("باس: مرگ اسلوموشن سینمایی می‌دهد", ge.timeScale < 1, `timeScale=${ge.timeScale}`);
  check("باس: رویداد boss منتشر شد", eventsE.some((x) => x.type === "boss"));
}

/* -------- هوش مصنوعی باس باید چند ثانیه بدون خطا اجرا شود -------- */
resetPlayer();
mustNotThrow("باس: ۳۰۰ تیک هوش مصنوعی (رگبار/یورش/احضار) بدون خطا", () => {
  ge.timeScale = 1;
  ge.hp = 99999;
  ge.wave = 10;
  ge.spawnEnemy("boss", ge.pos.clone().add(new THREE.Vector3(6, 0, -10)));
  pumpE(300);
});
{
  const boss = ge.enemies.find((e) => e.kind === "boss");
  check("باس: بعد از ۵ ثانیه هنوز زنده است", !!boss && boss.alive === true);
  ge.hp = ge.maxHp = 100;
}

/* --------------------- شاپ: باز شدن بعد از باس --------------------- */
resetPlayer();
{
  ge.wave = 9;
  ge.nextWave(); // → موج ۱۰ یعنی نبرد باس
  check("شاپ: موج باس شروع شد", ge.wave === 10);
  clearField(); // باس و اسکورت را پاک کن تا موج «پاک‌سازی» شود
  pumpE(6);
  check("شاپ: بعد از شکست باس فعال شد", ge.shopAvailable === true);
  check("شاپ: تایمر ۱۰۰ ثانیه تا موج بعد", Math.abs(ge.breakTimer - 100) < 2, `break=${ge.breakTimer}`);
}

/* ----------------------------- خریدها ----------------------------- */
{
  ge.money = 0;
  check("شاپ: بدون پول خرید رد می‌شود", ge.buy("ammo") === false);
  check("شاپ: رد شدن خرید رویداد deny دارد", eventsE.some((x) => x.type === "deny"));
  ge.money = 100;
  ge.reserve = 100;
  check("شاپ: خشاب ۵۰ تیری = ۲ دلار", ge.buy("ammo") === true && ge.reserve === 150 && ge.money === 98);
  check("شاپ: ارتقای آسیب اول ۵ دلار", ge.buy("damage") === true && ge.weaponLevel === 1 && ge.money === 93);
  check("شاپ: ارتقای آسیب دوم ۱۰ دلار", ge.buy("damage") === true && ge.weaponLevel === 2 && ge.money === 83);
  check("شاپ: ارتقای آسیب سوم ۱۵ دلار", ge.buy("damage") === true && ge.weaponLevel === 3 && ge.money === 68);
  check("شاپ: حداکثر ۳ ارتقای آسیب", ge.buy("damage") === false && ge.weaponLevel === 3);
  check("شاپ: آسیب اسلحه با ۳ ارتقا ۱۲→۲۲.۸", Math.abs(ge.weaponDamage() - 22.8) < 1e-6, `dmg=${ge.weaponDamage()}`);
  check("شاپ: چاقو ۲۰ دلار", ge.buy("knife") === true && ge.hasKnife === true && ge.money === 48);
  check("شاپ: بعد از خرید چاقو اسلات چاقو فعال شد", ge.slot === "knife");
  check("شاپ: چاقو دوباره خریدنی نیست", ge.buy("knife") === false);
}

/* ------------------------------ اسلات‌ها ------------------------------ */
resetPlayer();
{
  ge.setSlot("gun");
  check("اسلات: تعویض به اسلحه", ge.slot === "gun");
  ge.setSlot("fists");
  check("اسلات: تعویض به دست خالی", ge.slot === "fists");
  const ammo0 = ge.ammo;
  ge.setFiring(true);
  pumpE(50);
  ge.setFiring(false);
  check("اسلات: با دست خالی مهمات مصرف نمی‌شود", ge.ammo === ammo0, `ammo=${ge.ammo}`);
  ge.cycleSlot(1);
  check("اسلات: چرخش به اسلحه", ge.slot === "gun");
  ge.cycleSlot(1);
  check("اسلات: چرخش به چاقو (خریداری‌شده)", ge.slot === "knife");
}
resetPlayer();
{
  // ضربه‌ی نزدیک باید به دشمنِ روبه‌رو و چسبیده آسیب بزند
  ge.setSlot("fists");
  ge.wave = 1;
  ge.spawnEnemy("heavy", ge.pos.clone().add(new THREE.Vector3(0, 0, -1.7)));
  const target = ge.enemies[ge.enemies.length - 1];
  target.spawnT = 0;
  const hp0 = target.hp;
  ge.startMelee();
  pumpE(24);
  check("نزدیک: ضربه‌ی دست به دشمن آسیب زد", target.hp < hp0 || target.alive === false, `hp ${hp0}->${target.hp}`);
  check("نزدیک: رویداد melee منتشر شد", eventsE.some((x) => x.type === "melee"));
}
resetPlayer();
{
  // چاقو کمی قوی‌تر از دست خالی است
  const dmgFist = 20;
  ge.setSlot("knife");
  ge.spawnEnemy("heavy", ge.pos.clone().add(new THREE.Vector3(0, 0, -1.7)));
  const t = ge.enemies[ge.enemies.length - 1];
  t.spawnT = 0;
  const hp0 = t.hp;
  ge.startMelee();
  pumpE(24);
  const dealt = hp0 - t.hp;
  check("نزدیک: چاقو از مشت قوی‌تر است", dealt > dmgFist, `dealt=${dealt}`);
}

/* ---------------------------- نشانه‌گیری ---------------------------- */
resetPlayer();
{
  ge.setSlot("gun");
  ge.setAiming(true, "touch");
  pumpE(28);
  check("نشانه‌گیری: aimAmount بالا رفت", ge.aimAmount > 0.8, `aim=${ge.aimAmount}`);
  check("نشانه‌گیری: دوربین زوم شد", ge.camera.fov < ge.baseFov - 6, `fov=${ge.camera.fov}`);
  ge.setAiming(false, "touch");
  pumpE(40);
  check("نشانه‌گیری: با رهاسازی برگشت", ge.aimAmount < 0.15, `aim=${ge.aimAmount}`);
  check("نشانه‌گیری: FOV به حالت عادی برگشت", ge.camera.fov > ge.baseFov - 3, `fov=${ge.camera.fov}`);
}

/* ------------- موج بعد: خشاب خودکار پر نمی‌شود (خواست کاربر) ------------- */
resetPlayer();
{
  ge.wave = 3;
  ge.ammo = 7;
  ge.reserve = 200;
  const res0 = ge.reserve;
  ge.nextWave();
  check("موج بعد: خشاب خودکار پر نمی‌شود", ge.ammo === 7, `ammo=${ge.ammo}`);
  check("موج بعد: مهمات ذخیره رایگان اضافه نمی‌شود", ge.reserve === res0, `reserve=${ge.reserve}`);
  check("موج بعد: شاپ بسته می‌شود", ge.shopAvailable === false);
  // پرکردن دستی هنوز کار می‌کند
  ge.reload();
  pumpE(140);
  check("پرکردن دستی خشاب (R) کار می‌کند", ge.ammo === 34, `ammo=${ge.ammo}`);
  check("پرکردن دستی از مهمات ذخیره کم کرد", ge.reserve < res0, `reserve=${ge.reserve}`);
}

/* --------------------------- شروع دوباره --------------------------- */
{
  ge.money = 55;
  ge.weaponLevel = 3;
  ge.hasKnife = true;
  ge.setSlot("knife");
  ge.setAiming(true, "touch");
  gameE.restart();
  check(
    "restart: پول/ارتقا/چاقو/اسلات/نشانه صفر شد",
    ge.money === 0 && ge.weaponLevel === 0 && ge.hasKnife === false && ge.slot === "gun" && ge.aimAmount === 0,
    `money=${ge.money} lvl=${ge.weaponLevel} knife=${ge.hasKnife} slot=${ge.slot}`
  );
  check("restart: شاپ و باس پاک شد", ge.shopAvailable === false && ge.bossRef === null);
}

/* ------------ خشاب خالی: نگه‌داشتن شلیک نباید هر فریم ریپ کند (رگرشن) ------------ */
resetPlayer();
{
  ge.setSlot("gun");
  ge.timeScale = 1;
  ge.ammo = 0;
  ge.reserve = 0;
  ge.reloading = false;
  ge.reloadT = 0;
  ge.emptyCd = 0;
  ge.autoFire = false;
  const before = eventsE.filter((x) => x.type === "noammo").length;
  ge.setFiring(true);
  pumpE(60); // ~۱ ثانیه نگه‌داشتن شلیک بدون هیچ مهماتی
  ge.setFiring(false);
  const n = eventsE.filter((x) => x.type === "noammo").length - before;
  check("خشاب‌خالی: رویداد noammo ریپ نمی‌شود (قبلاً ۶۰ در ثانیه)", n >= 1 && n <= 3, `events=${n}`);
}

/* ------------------------- هیت‌استاپ کیل (جوز جدید) ------------------------- */
resetPlayer();
{
  ge.timeScale = 1;
  ge.wave = 1;
  ge.spawnEnemy("drone", ge.pos.clone().add(new THREE.Vector3(3, 0, -5)));
  const e = ge.enemies[ge.enemies.length - 1];
  ge.hurtEnemy(e, 99999, null);
  check("هیت‌استاپ: کیل دشمن معمولی اسلوموشن کوتاه می‌دهد", ge.timeScale < 1, `ts=${ge.timeScale}`);
  pumpE(80);
  check("هیت‌استاپ: به سرعت عادی برمی‌گردد", ge.timeScale >= 0.995, `ts=${ge.timeScale}`);
}

/* ---------------- restart: پاک‌شدن وضعیت‌های گذرای دوربین ---------------- */
{
  ge.shake = 0.9;
  ge.shakeT = 0.3;
  ge.banner = "بنرِ آزمایشی";
  ge.bannerT = 2;
  ge.invuln = 0.3;
  ge.sprintAmount = 1;
  ge.recoilPitch = 0.02;
  ge.emptyCd = 0.4;
  gameE.restart();
  check(
    "restart: لرزش/محصنی/دویدن/لگد/خشاب‌خالی صفر شد",
    ge.shake === 0 && ge.shakeT === 0 && ge.invuln === 0 && ge.sprintAmount === 0 && ge.recoilPitch === 0 && ge.emptyCd === 0,
    `shake=${ge.shake} invuln=${ge.invuln} sprint=${ge.sprintAmount}`
  );
  // بنرِ کهنه‌ی بازی قبل باید جای خود را به بنرِ موج جدید بدهد
  check("restart: بنرِ کهنه با بنرِ موج جدید جایگزین شد", ge.banner === "موج 1" && ge.bannerT > 0, `b=${ge.banner}`);
}

/* -------------------- کیفیت خودکار: یکپارچگی با حلقه‌ی بازی -------------------- */
{
  // فریم‌های پمپ ۱۶.۷ms (۶۰fps) هستند → کیفیت نباید دست‌خورد
  check("کیفیت: در ۶۰fps نسبت کیفیت می‌ماند", ge.perfRatio === 1, `ratio=${ge.perfRatio}`);
}

mustNotThrow("سناریوی جدید: dispose بدون خطا", () => gameE.dispose());

/* --------------------- مدل اول‌شخص: سلامت انیمیشن‌ها --------------------- */
// چون در sandbox امکان دیدن رندر نیست، صحت ریاضی انیمیشن‌ها بررسی می‌شود:
// ۴۰۰ فریم در همه‌ی حالت‌ها (راه‌رفتن/دویدن/نشانه/ریلود/ضربه/تعویض اسلات/مرگ)
// و اطمینان از اینکه هیچ تبدیل یا کوآترنیونی NaN نمی‌شود.
{
  const { ViewModel } = await import("../src/game/viewmodel");
  const vm = new ViewModel();
  const cam = new THREE.PerspectiveCamera(70, 1, 0.08, 500);
  cam.add(vm.root);
  cam.updateMatrixWorld(true);
  const slots = ["gun", "fists", "knife"] as const;
  let bad = "";
  let t = 0;
  for (let i = 0; i < 400; i++) {
    t += 0.016;
    const slot = slots[Math.floor(i / 100) % 3];
    if (i % 100 === 0) vm.setSlot(slot);
    if (i % 37 === 0) vm.recoil(1);
    vm.update({
      dt: 0.016,
      elapsed: t,
      bob: t * 7,
      speed01: 0.4 + 0.6 * Math.abs(Math.sin(t)),
      sprint01: i % 200 < 100 ? 1 : 0,
      aim01: i % 120 < 60 ? 1 : 0,
      reloading: i % 80 < 40,
      reloadProgress: (i % 40) / 40,
      slot,
      meleeProgress: (i % 30) / 30,
      meleeHand: i % 2,
      swayX: Math.sin(t) * 0.03,
      swayY: Math.cos(t) * 0.02,
      alive: i % 350 !== 0,
      vy: Math.sin(t) * 6,
      landDip: Math.abs(Math.cos(t)),
    });
    vm.root.updateMatrixWorld(true);
    vm.root.traverse((o) => {
      const p = o.position;
      const q = o.quaternion;
      if (!Number.isFinite(p.x + p.y + p.z)) bad ||= `position در فریم ${i} (${o.name || o.type})`;
      if (!Number.isFinite(q.x + q.y + q.z + q.w)) bad ||= `quaternion در فریم ${i} (${o.name || o.type})`;
      const sc = o.scale;
      if (!Number.isFinite(sc.x + sc.y + sc.z) || sc.y === 0) bad ||= `scale در فریم ${i}`;
    });
  }
  check("viewmodel: ۴۰۰ فریم انیمیشن بدون NaN/صفر", bad === "", bad);
  check("viewmodel: اسلات فعال بعد از تعویض‌ها درست است", vm.activeSlot === "gun", `slot=${vm.activeSlot}`);
  const mp = new THREE.Vector3();
  vm.muzzle.getWorldPosition(mp);
  check("viewmodel: نقطه‌ی دهانه‌ی اسلحه معتبر است", Number.isFinite(mp.x + mp.y + mp.z));
  const lightPos = vm.muzzleLightPos(new THREE.Vector3(), "fists");
  check("viewmodel: محل نور برای اسلات غیراسلحه معتبر است", Number.isFinite(lightPos.x + lightPos.y + lightPos.z));
  mustNotThrow("viewmodel: dispose بدون خطا", () => vm.dispose());
}

/* ------------------------- سناریو: حافظه‌ی بلاک‌شده ------------------------ */
storageThrows = true;
let bestThrew = false;
let bestVal = -1;
try {
  bestVal = bestScore();
} catch {
  bestThrew = true;
}
check("settings: bestScore با localStorage بلاک‌شده نمی‌ترکد", bestThrew === false && bestVal === 0);
{
  winListeners.clear();
  docListeners.clear();
  const gameB = new Game(fakeCanvas as unknown as HTMLCanvasElement, {
    onState: () => {},
    onEvent: () => {},
  });
  let threw = false;
  try {
    gameB.start();
    const gb = gameB as unknown as { damagePlayer: (n: number) => void; invuln: number };
    gb.invuln = 0;
    gb.damagePlayer(99999); // مرگ → تلاش برای ذخیره رکورد
    gameB.restart();
  } catch {
    threw = true;
  }
  check("engine: مرگ/restart با localStorage بلاک‌شده نمی‌ترکد", threw === false);
  gameB.dispose();
}
storageThrows = false;

console.log(failures === 0 ? "\nALL ENGINE TESTS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
