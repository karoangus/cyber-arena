import { useCallback, useEffect, useRef, useState } from "react";
import Hud from "./components/Hud";
import TouchControls from "./components/TouchControls";
import { FullscreenButton, GameOverOverlay, OrientationHint, PauseOverlay, StartScreen } from "./components/Overlays";
import { sound } from "./game/audio";
import { Game } from "./game/engine";
import { bestScore, loadSettings, saveSettings, type Settings } from "./game/settings";
import type { GameEvent, HudState } from "./game/types";

type Phase = "menu" | "playing" | "paused" | "dead";

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
  const [floats, setFloats] = useState<{ id: number; text: string }[]>([]);
  const [banner, setBanner] = useState<{ id: number; text: string } | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    phaseRef.current = phase;
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
        setFloats((f) => [...f.slice(-4), { id, text: e.text ?? "+" }]);
        window.setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 950);
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
        const text = e.text === "cleared" ? `موج ${e.wave} پاک شد!` : `موج ${e.wave} شروع شد`;
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

  // ساخت بازی
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.touchAction = "none";
    host.appendChild(canvas);

    const g = new Game(canvas, {
      onState: (s) => setHud(s),
      onEvent: (e) => eventRef.current(e),
      onAutoPause: () => {
        if (phaseRef.current === "playing") {
          setPhase("paused");
          gameRef.current?.pause();
        }
      },
    });
    g.sensitivity = settingsRef.current.sensitivity;
    g.autoFire = settingsRef.current.autoFire;
    g.haptics = settingsRef.current.haptics;
    gameRef.current = g;
    setGame(g);

    const onOrient = () => g.resize();
    window.addEventListener("orientationchange", onOrient);

    return () => {
      window.removeEventListener("orientationchange", onOrient);
      g.dispose();
      canvas.remove();
      gameRef.current = null;
      setGame(null);
    };
  }, []);

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

      {(playing || phase === "paused" || phase === "dead") && (
        <Hud
          hud={hud}
          game={playing ? game : null}
          hitId={hitId}
          dmgId={dmgId}
          floats={floats}
          banner={banner}
          toast={toast}
          onPause={pauseGame}
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
        <div className="pointer-events-none absolute bottom-[8.5rem] left-1/2 z-40 w-[min(92vw,30rem)] -translate-x-1/2">
          <div className="glass rounded-2xl px-3 py-2 text-center text-[11px] leading-relaxed text-cyan-100/90">
            جوی‌استیک را کامل <b className="text-amber-300">رو به جلو</b> بکش تا بدوی ⚡ (عقب/کنار = راه‌رفتن) • دکمه شلیک را نگه دار و
            انگشتت را بکش تا هم شلیک کنی هم دید بچرخد • انگشت را روی دکمه شلیک <b className="text-cyan-300">به بالا بکش تا بپری</b>
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
      {phase === "dead" && <GameOverOverlay hud={hud} best={best} onRestart={restartGame} onMenu={toMenu} />}
    </div>
  );
}
