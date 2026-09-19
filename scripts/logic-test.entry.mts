// تست منطقیِ لایه‌های بدون‌نیاز به GPU: برخورد جهان، دید مستقیم و ذخیره‌ی تنظیمات.
// این فایل کد واقعی shipped را اجرا می‌کند (نه نسخه‌ی بازنویسی‌شده).
import * as THREE from "three";

/* ---------- شیمِ حداقلی DOM قبل از import دینامیک world ---------- */
function makeCtx() {
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
(globalThis as Record<string, unknown>).document = {
  createElement: (tag: string) => {
    if (tag === "canvas") return { width: 0, height: 0, getContext: () => makeCtx() };
    return {};
  },
};
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) console.log(`PASS  ${name}`);
  else {
    failures++;
    console.log(`FAIL  ${name} ${extra}`);
  }
}

const { buildWorld, resolveCircle, segmentBlocked, ARENA } = await import("../src/game/world");
const { loadSettings, saveSettings, bestScore, defaultSettings } = await import("../src/game/settings");

/* ------------------------------- جهان ------------------------------- */
const scene = new THREE.Scene();
const world = buildWorld(scene);
check("buildWorld: موانع ساخته شدند", world.obstacles.length > 4, `count=${world.obstacles.length}`);
check("buildWorld: نقاط شروع موجودند", world.spawnPoints.length >= 4, `count=${world.spawnPoints.length}`);
check("buildWorld: انیمیشن‌ها ثبت شدند", world.animated.length > 0);
let animOk = true;
try {
  for (const fn of world.animated) fn(1.23, 0.016);
} catch {
  animOk = false;
}
check("buildWorld: تابع‌های انیمیشن بدون خطا اجرا می‌شوند", animOk);
for (const sp of world.spawnPoints) {
  check(
    `spawnPoint(${sp.x.toFixed(0)},${sp.z.toFixed(0)}) داخل میدان است`,
    Math.abs(sp.x) <= ARENA / 2 && Math.abs(sp.z) <= ARENA / 2
  );
}

/* --------------------------- برخورد دایره --------------------------- */
// محدود به مرز playable میدان — همان قراردادی که موتور استفاده می‌کند (bounds = half - 2.2)
const p = new THREE.Vector3(500, 0, -500);
resolveCircle(p, 0.45, world.obstacles, world.bounds);
check(
  "resolveCircle: به مرز playable میدان محدود می‌شود",
  Math.abs(p.x) <= world.bounds + 1e-6 && Math.abs(p.z) <= world.bounds + 1e-6,
  `pos=(${p.x.toFixed(2)},${p.z.toFixed(2)}) bounds=${world.bounds}`
);
check("resolveCircle: بازیکن داخل هیچ مانعی نمی‌ماند", !world.obstacles.some((b) => p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ));

// بیرون راندن از مانع
const box = world.obstacles[0];
const cx = (box.minX + box.maxX) / 2;
const cz = (box.minZ + box.maxZ) / 2;
const inside = new THREE.Vector3(cx, 0, cz);
resolveCircle(inside, 0.7, [box], ARENA / 2);
const inX = inside.x > box.minX - 1e-3 && inside.x < box.maxX + 1e-3;
const inZ = inside.z > box.minZ - 1e-3 && inside.z < box.maxZ + 1e-3;
check("resolveCircle: دایره‌ی داخل جعبه بیرون رانده می‌شود", !(inX && inZ), `pos=(${inside.x.toFixed(2)},${inside.z.toFixed(2)})`);

// نزدیک‌شدن از بیرون، توقف در شعاع
const approaching = new THREE.Vector3(cx + 0.2, 0, box.maxZ + 0.4);
resolveCircle(approaching, 0.7, [box], ARENA / 2);
const distFromBox = Math.hypot(
  Math.max(box.minX - approaching.x, 0, approaching.x - box.maxX),
  Math.max(box.minZ - approaching.z, 0, approaching.z - box.maxZ)
);
check("resolveCircle: دایره در فاصله‌ی شعاع نگه داشته می‌شود", distFromBox >= 0.7 - 1e-3, `d=${distFromBox.toFixed(3)}`);

/* ---------------------------- دید مستقیم ---------------------------- */
// پاره‌خطی که از داخل همان مانع رد می‌شود باید مسدود باشد
const aY = new THREE.Vector3(cx - 10, 1, cz);
const bY = new THREE.Vector3(cx + 10, 1, cz);
check("segmentBlocked: عبور از مانع = مسدود", segmentBlocked(aY, bY, [box], 24) === true);
// پاره‌خطی بالای مانع (بالاتر از top) باید باز باشد
const aUp = new THREE.Vector3(cx - 10, box.top + 5, cz);
const bUp = new THREE.Vector3(cx + 10, box.top + 5, cz);
check("segmentBlocked: بالای مانع = باز", segmentBlocked(aUp, bUp, [box], 24) === false);

/* ----------------------------- تنظیمات ----------------------------- */
saveSettings({ ...defaultSettings, sensitivity: 1.9, sound: false });
const back = loadSettings();
check("settings: ذخیره/بازیابی حساسیت", back.sensitivity === 1.9);
check("settings: ذخیره/بازیابی صدا", back.sound === false);
store.set("cyber_best", "1250");
check("settings: رکورد خوانده می‌شود", bestScore() === 1250, `got=${bestScore()}`);

/* --------------------------- کیفیت خودکار (PerfScaler) --------------------------- */
const { PerfScaler } = await import("../src/game/perf");
{
  const s = new PerfScaler();
  let now = 0;
  const feed = (ms: number, frames: number) => {
    for (let i = 0; i < frames; i++) {
      now += ms;
      s.sample(ms, now);
      s.update(now);
    }
  };

  feed(16.7, 60); // ~۱ ثانیه: هنوز در دوره‌ی گرم‌شدن است
  check("کیفیت: در ۶۰ فریم/ث ثانیه‌ی اول کیفیت کامل می‌ماند", s.ratio === 1, `ratio=${s.ratio}`);

  feed(33, 100); // ۳۰ فریم/ث = دستگاه ضعیف → باید کیفیت را کم کند
  check("کیفیت: افت فریم → کاهش نسبت کیفیت", s.ratio < 0.99, `ratio=${s.ratio}`);
  const afterSlow = s.ratio;

  feed(8, 600); // دستگاه جا دارد → کیفیت پله‌پله تا سقف برمی‌گردد
  check("کیفیت: با فریم سریع، کیفیت تا سقف برمی‌گردد", s.ratio === s.maxRatio, `${afterSlow} -> ${s.ratio}`);

  feed(33, 600); // ضعف طولانی → باید به کف برسد و پایین‌تر نرود
  check("کیفیت: به کف minRatio محدود می‌شود", s.ratio === s.minRatio, `ratio=${s.ratio}`);

  s.reset();
  check("کیفیت: reset کیفیت کامل برمی‌گرداند", s.ratio === 1);

  // فریم‌های بسیار طولانی (تب پس‌زمینه/کاشی) نباید کیفیت را کم کنند
  const s2 = new PerfScaler();
  let now2 = 0;
  for (let i = 0; i < 300; i++) {
    now2 += 400;
    s2.sample(400, now2);
    s2.update(now2);
  }
  check("کیفیت: فریم‌های غیرواقعی (>۲۵۰ms) نادیده گرفته می‌شوند", s2.ratio === 1, `ratio=${s2.ratio}`);
}

console.log(failures === 0 ? "\nALL LOGIC TESTS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
