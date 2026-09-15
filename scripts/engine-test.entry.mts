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

// pause/resume
mustNotThrow("engine: pause/resume", () => {
  game.pause();
  const el = (game as unknown as { elapsed: number }).elapsed;
  pump(10);
  if ((game as unknown as { elapsed: number }).elapsed !== el) throw new Error("در توقف آپدیت شد");
  game.resume();
});
check("engine: بعد از resume اجرا ادامه دارد", g.paused === false);

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
