import { useCallback, useEffect, useRef, useState } from "react";
import Hud from "./components/Hud";
import TouchControls from "./components/TouchControls";
import { FullscreenButton, GameOverOverlay, OrientationHint, PauseOverlay, ShopOverlay, StartScreen } from "./components/Overlays";
import { sound } from "./game/audio";
import { Game } from "./game/engine";
import { bestScore, loadSettings, saveSettings, type Settings } from "./game/settings";
import type { GameEvent, HudState } from "./game/types";

type Phase = "menu" | "playing" | "paused" | "dead" | "shop";

const emptyHud: HudState = {
  hp: 100,
  maxHp: 100,
  ammo: 34,
  magSize: 34,
  reserve: 240,
  score: 0,
  wave: 1,
  kills: 0,
  enemiesLeft: 0,
  combo: 0,
  reloading: false,
  blastReady: 1,
  sprinting: false,
  alive: true,
  running: false,
  money: 0,
  weaponLevel: 0,
  weaponDamage: 12,
  hasKnife: false,
  slot: "gun",
  aiming: false,
  meleeReady: 1,
  meleeDamage: 20,
  meleeRange: 2.6,
  boss: null,
  nextBossWave: 10,
  breakTime: 0,
  shopAvailable: false,
  shop: {
    damageCost: 5,
    damageLevel: 0,
    damageMax: 3,
    ammoCost: 2,
    ammoAmount: 50,
    knifeCost: 20,
    hasKnife: false,
    reserve: 240,
    reserveCap: 480,
  },
};

export default function App() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [phase, setPhase] = useState<Phase>("menu");
  const phaseRef = useRef<Phase>("menu");
  const [hud, setHud] = useState<HudState>(emptyHud);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const settingsRef = useRef(settings);
  const [best, setBest] = useState(() => bestScore());
  const [hitId, setHitId] = useState(0);
  const [dmgId, setDmgId] = useState(0);
  const [floats, setFloats] = useState<{ id: number; text: string; tone?: "score" | "cash" }[]>([]);
  const [banner, setBanner] = useState<{ id: number; text: string } | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [hint, setHint] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  // علامت زنده‌بودن ری‌اکت برای اسکریپت بوت index.html (تشخیص لودنشدن ماژول‌ها)
  useEffect(() => {
    (window as unknown as { __CYBER_MOUNTED__?: boolean }).__CYBER_MOUNTED__ = true;
  }, []);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Escape هنگام باز بودن شاپ = بستن شاپ و ادامه‌ی بازی
  useEffect(() => {
    if (phase !== "shop") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        gameRef.current?.resume();
        setPhase("playing");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  useEffect(() => {
    settingsRef.current = settings;
    saveSettings(settings);
    const g = gameRef.current;
    if (g) {
      g.sensitivity = settings.sensitivity;
      g.autoFire = settings.autoFire;
      g.haptics = settings.haptics;
    }
    sound.setEnabled(settings.sound);
  }, [settings]);

  const handleEvent = useCallback((e: GameEvent) => {
    switch (e.type) {
      case "hit":
        setHitId((v) => v + 1);
        break;
      case "kill": {
        const id = performance.now() + Math.random();
        setFloats((f) => [...f.slice(-4), { id, text: e.text ?? "+", tone: "score" }]);
        window.setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 950);
        break;
      }
      case "cash": {
        // پول شناور سبز: هر کیل ۱ دلار، باس ۱۰ دلار
        const id = performance.now() + Math.random();
        setFloats((f) => [...f.slice(-5), { id, text: `$+${e.amount ?? 1}`, tone: "cash" }]);
        window.setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1100);
        break;
      }
      case "melee":
        setHitId((v) => v + 1);
        break;
      case "slot": {
        const id = performance.now();
        setToast({ id, text: `اسلات: ${e.text ?? ""}` });
        window.setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), 900);
        break;
      }
      case "boss": {
        const text =
          e.text === "enraged" ? "🔥 باس خشمگین شد!" : e.text === "summon" ? "باس نیرو احضار کرد!" : "💥 باس نابود شد!";
        setBanner({ id: performance.now() + Math.random(), text });
        break;
      }
      case "shop":
      case "deny": {
        const id = performance.now();
        setToast({ id, text: e.text ?? "" });
        window.setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), 1400);
        break;
      }
      case "damage":
        setDmgId((v) => v + 1);
        break;
      case "pickup": {
        const id = performance.now();
        setToast({ id, text: e.text ?? "" });
        window.setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), 1100);
        break;
      }
      case "noammo": {
        const id = performance.now();
        setToast({ id, text: "خشاب خالی — در حال پر کردن" });
        window.setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), 1100);
        break;
      }
      case "wave": {
        const text =
          e.text === "cleared"
            ? `موج ${e.wave} پاک شد!`
            : e.text === "boss"
              ? `⚠ موج ${e.wave} — نبرد باس ⚠`
              : `موج ${e.wave} شروع شد`;
        setBanner({ id: performance.now(), text });
        break;
      }
      case "death":
        window.setTimeout(() => {
          setPhase("dead");
          setBest(bestScore());
        }, 1200);
        break;
      default:
        break;
    }
  }, []);

  const eventRef = useRef(handleEvent);
  useEffect(() => {
    eventRef.current = handleEvent;
  }, [handleEvent]);

  // ساخت بازی (با مهار خطای WebGL تا به‌جای صفحه‌ی سیاه، پیام فارسی ببینیم)
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.touchAction = "none";
    host.appendChild(canvas);

    let g: Game | null = null;
    try {
      g = new Game(canvas, {
        onState: (s) => setHud(s),
        onEvent: (e) => eventRef.current(e),
        onAutoPause: () => {
          if (phaseRef.current === "playing") {
            setPhase("paused");
            gameRef.current?.pause();
          }
        },
      });
    } catch (err) {
      console.error("[cyber-arena] ساخت موتور بازی شکست خورد:", err);
      canvas.remove();
      setInitError(
        err instanceof Error && /webgl|context/i.test(err.message)
          ? "مرورگر نتوانست WebGL را راه‌اندازی کند. شتاب سخت‌افزاری (Hardware Acceleration) را در تنظیمات مرورگر فعال کن یا از Chrome/Safari به‌روز استفاده کن."
          : "راه‌اندازی گرافیک سه‌بعدی شکست خورد. لطفاً صفحه را رفرش کن یا مرورگر دیگری امتحان کن."
      );
      return;
    }
    const game = g;
    game.sensitivity = settingsRef.current.sensitivity;
    game.autoFire = settingsRef.current.autoFire;
    game.haptics = settingsRef.current.haptics;
    gameRef.current = game;
    setGame(game);

    const onOrient = () => game.resize();
    window.addEventListener("orientationchange", onOrient);

    return () => {
      window.removeEventListener("orientationchange", onOrient);
      game.dispose();
      canvas.remove();
      gameRef.current = null;
      setGame(null);
    };
  }, [retryKey]);

  const startGame = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    sound.unlock();
    if (g.running) g.restart();
    else g.start();
    setPhase("playing");
    setHint(true);
    window.setTimeout(() => setHint(false), 6500);
  }, []);

  const pauseGame = useCallback(() => {
    gameRef.current?.pause();
    setPhase("paused");
  }, []);

  const resumeGame = useCallback(() => {
    gameRef.current?.resume();
    setPhase("playing");
  }, []);

  // شاپ: فقط بعد از شکست باس و تا شروع موج بعد باز است. هنگام خرید بازی متوقف
  // می‌شود تا تایمر ۱۰۰ ثانیه‌ای هم متوقف بماند (با خیال راحت خرید کن).
  const openShop = useCallback(() => {
    const g = gameRef.current;
    if (!g || !g.shopOpen) return;
    g.pause();
    setPhase("shop");
  }, []);

  const closeShop = useCallback(() => {
    gameRef.current?.resume();
    setPhase("playing");
  }, []);

  const restartGame = useCallback(() => {
    sound.unlock();
    gameRef.current?.restart();
    setPhase("playing");
  }, []);

  const toMenu = useCallback(() => {
    gameRef.current?.pause();
    setPhase("menu");
    setBest(bestScore());
  }, []);

  const getGame = useCallback(() => gameRef.current, []);

  const playing = phase === "playing";

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-[#05060f]">
      <div ref={hostRef} className="absolute inset-0" />

      {/* تیرگی لبه‌ها برای حس سینمایی */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)" }}
      />

      {(playing || phase === "paused" || phase === "dead" || phase === "shop") && (
        <Hud
          hud={hud}
          game={playing ? game : null}
          hitId={hitId}
          dmgId={dmgId}
          floats={floats}
          banner={banner}
          toast={toast}
          onPause={pauseGame}
          onShop={openShop}
        />
      )}

      {playing && (
        <TouchControls getGame={getGame} visible />
      )}

      {/* دکمه تمام‌صفحه (در منو داخل خود منو هست) */}
      {phase !== "menu" && (
        <div className="absolute right-3 top-[5.6rem] z-40">
          <FullscreenButton />
        </div>
      )}

      {playing && hint && (
        <div className="pointer-events-none absolute bottom-[8.5rem] left-1/2 z-40 w-[min(92vw,32rem)] -translate-x-1/2">
          <div className="glass rounded-2xl px-3 py-2 text-center text-[11px] leading-relaxed text-cyan-100/90">
            جوی‌استیک را کامل <b className="text-amber-300">رو به جلو</b> بکش تا بدوی ⚡ • دکمه شلیک را نگه دار و بکش تا دید هم بچرخد •
            انگشت را روی شلیک <b className="text-cyan-300">به بالا بکش تا بپری</b> • <b className="text-sky-300">«نشانه 🎯» را نگه دار</b> تا
            زوم و دقیق شوی • با <b className="text-orange-300">«تعویض»</b> بین دست/اسلحه/چاقو جابه‌جا شو • خشاب خودکار پر نمی‌شود؛
            <b className="text-amber-300"> «خشاب R»</b> را بزن
          </div>
        </div>
      )}

      {playing && <OrientationHint />}

      {phase === "menu" && (
        <StartScreen onStart={startGame} settings={settings} setSettings={setSettings} best={best} />
      )}
      {phase === "paused" && (
        <PauseOverlay
          onResume={resumeGame}
          onRestart={restartGame}
          onMenu={toMenu}
          settings={settings}
          setSettings={setSettings}
        />
      )}
      {phase === "shop" && game && <ShopOverlay hud={hud} game={game} onClose={closeShop} />}
      {phase === "dead" && <GameOverOverlay hud={hud} best={best} onRestart={restartGame} onMenu={toMenu} />}

      {initError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#05060f]/95 px-4">
          <div className="glass w-full max-w-sm rounded-3xl p-6 text-center">
            <div className="text-4xl">🎮⚠️</div>
            <div className="mt-2 text-xl font-extrabold text-rose-200">گرافیک بازی لود نشد</div>
            <p className="mt-2 text-xs leading-relaxed text-cyan-100/70">{initError}</p>
            <div className="mt-4 space-y-2">
              <button
                onClick={() => {
                  setInitError(null);
                  setRetryKey((k) => k + 1);
                }}
                className="touch-btn w-full rounded-2xl border border-cyan-200/40 bg-gradient-to-b from-cyan-400/85 to-sky-700/85 py-3 font-extrabold text-white"
              >
                تلاش دوباره
              </button>
              <button
                onClick={() => window.location.reload()}
                className="touch-btn w-full rounded-2xl border border-slate-400/25 bg-slate-800/70 py-2.5 text-sm font-bold text-cyan-100"
              >
                رفرش صفحه
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
