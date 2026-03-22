import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────
type GameState = "start" | "playing" | "gameover";

interface Platform {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  vanishing: boolean;
  vanishTimer: number; // ms until gone (starts at 2000)
  gone: boolean;
}

interface Coin {
  id: number;
  x: number;
  y: number;
  radius: number;
  collected: boolean;
  platformId: number;
}

interface Cloud {
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
}

interface Hero {
  x: number;
  y: number;
  width: number;
  height: number;
  vy: number; // vertical velocity (px/s)
  onGround: boolean;
  legPhase: number; // animation
}

interface GameRef {
  state: GameState;
  hero: Hero;
  platforms: Platform[];
  coins: Coin[];
  clouds: Cloud[];
  score: number;
  highScore: number;
  baseSpeed: number; // platform scroll speed px/s
  platformIdCounter: number;
  coinIdCounter: number;
  lastTime: number;
  animFrameId: number;
  canvasWidth: number;
  canvasHeight: number;
}

// ── Constants ──────────────────────────────────────────────────────────────
const GRAVITY = 1800; // px/s²
const JUMP_VELOCITY = -700; // px/s upward
const HERO_WIDTH = 22;
const HERO_HEIGHT = 32;
const PLATFORM_HEIGHT = 14;
const BASE_SPEED = 160; // px/s
const SPEED_GROWTH = 0.1; // +10% per 10 pts
const VANISH_DURATION = 2000; // ms
const HIGH_SCORE_KEY = "skyJumpHero_highScore";

const PLATFORM_COLORS = [
  "#4FC3F7",
  "#29B6F6",
  "#7E57C2",
  "#AB47BC",
  "#26C6DA",
  "#66BB6A",
  "#42A5F5",
  "#EC407A",
];

// ── Audio helpers ──────────────────────────────────────────────────────────
let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function playJump() {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(300, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(600, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch (_) {
    /* silent on restricted contexts */
  }
}

function playCoin() {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "triangle";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.12);
  } catch (_) {
    /* */
  }
}

function playGameOver() {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(80, ctx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch (_) {
    /* */
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function randomPlatformColor() {
  return PLATFORM_COLORS[Math.floor(Math.random() * PLATFORM_COLORS.length)];
}

function computeSpeed(score: number) {
  const tier = Math.floor(score / 10);
  return BASE_SPEED * (1 + SPEED_GROWTH) ** tier;
}

function makePlatform(
  id: number,
  x: number,
  y: number,
  width: number,
  vanishing: boolean,
): Platform {
  return {
    id,
    x,
    y,
    width,
    height: PLATFORM_HEIGHT,
    color: randomPlatformColor(),
    vanishing,
    vanishTimer: VANISH_DURATION,
    gone: false,
  };
}

function spawnInitialPlatforms(cw: number, ch: number, g: GameRef) {
  g.platforms = [];
  g.coins = [];
  // first platform under hero
  const pw = 120;
  const heroX = cw * 0.22;
  const py = ch * 0.65;
  g.platforms.push(
    makePlatform(
      g.platformIdCounter++,
      heroX - pw / 2 + HERO_WIDTH / 2,
      py,
      pw,
      false,
    ),
  );
  // spawn several ahead
  let nextX = heroX + pw + rand(80, 150);
  for (let i = 0; i < 6; i++) {
    const pw2 = rand(60, 120);
    const py2 = rand(ch * 0.25, ch * 0.75);
    const van = Math.random() < 0.25;
    const p = makePlatform(g.platformIdCounter++, nextX, py2, pw2, van);
    g.platforms.push(p);
    if (Math.random() < 0.35) {
      g.coins.push({
        id: g.coinIdCounter++,
        x: p.x + p.width / 2,
        y: p.y - 16,
        radius: 8,
        collected: false,
        platformId: p.id,
      });
    }
    nextX += pw2 + rand(80, 160);
  }
}

function spawnClouds(cw: number, ch: number): Cloud[] {
  const clouds: Cloud[] = [];
  for (let i = 0; i < 5; i++) {
    clouds.push({
      x: rand(0, cw),
      y: rand(0, ch * 0.5),
      width: rand(80, 160),
      height: rand(30, 55),
      speed: rand(15, 35),
    });
  }
  return clouds;
}

// ── Drawing ────────────────────────────────────────────────────────────────
function drawBackground(ctx: CanvasRenderingContext2D, cw: number, ch: number) {
  const grad = ctx.createLinearGradient(0, 0, 0, ch);
  grad.addColorStop(0, "#0ea5e9");
  grad.addColorStop(0.5, "#38bdf8");
  grad.addColorStop(1, "#7dd3fc");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, ch);
}

function drawCloud(ctx: CanvasRenderingContext2D, c: Cloud) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  const r = c.height / 2;
  ctx.beginPath();
  ctx.ellipse(c.x + r, c.y + r, r, r, 0, 0, Math.PI * 2);
  ctx.ellipse(c.x + r * 2, c.y + r * 0.7, r * 1.1, r * 0.8, 0, 0, Math.PI * 2);
  ctx.ellipse(c.x + r * 3.2, c.y + r, r * 0.9, r * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlatform(ctx: CanvasRenderingContext2D, p: Platform) {
  if (p.gone) return;
  const alpha = p.vanishing && p.vanishTimer < 600 ? p.vanishTimer / 600 : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  // body
  ctx.fillStyle = p.color;
  ctx.beginPath();
  const r = 6;
  ctx.moveTo(p.x + r, p.y);
  ctx.lineTo(p.x + p.width - r, p.y);
  ctx.quadraticCurveTo(p.x + p.width, p.y, p.x + p.width, p.y + r);
  ctx.lineTo(p.x + p.width, p.y + p.height);
  ctx.lineTo(p.x, p.y + p.height);
  ctx.lineTo(p.x, p.y + r);
  ctx.quadraticCurveTo(p.x, p.y, p.x + r, p.y);
  ctx.closePath();
  ctx.fill();
  // grass top
  ctx.fillStyle = "#4ade80";
  ctx.beginPath();
  ctx.moveTo(p.x + r, p.y);
  ctx.lineTo(p.x + p.width - r, p.y);
  ctx.quadraticCurveTo(p.x + p.width, p.y, p.x + p.width, p.y + r);
  ctx.lineTo(p.x + p.width, p.y + 5);
  ctx.lineTo(p.x, p.y + 5);
  ctx.lineTo(p.x, p.y + r);
  ctx.quadraticCurveTo(p.x, p.y, p.x + r, p.y);
  ctx.closePath();
  ctx.fill();
  // vanish flash indicator
  if (p.vanishing) {
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

function drawCoin(ctx: CanvasRenderingContext2D, coin: Coin) {
  if (coin.collected) return;
  ctx.save();
  const grad = ctx.createRadialGradient(
    coin.x - coin.radius * 0.3,
    coin.y - coin.radius * 0.3,
    1,
    coin.x,
    coin.y,
    coin.radius,
  );
  grad.addColorStop(0, "#fde68a");
  grad.addColorStop(1, "#f59e0b");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(coin.x, coin.y, coin.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#d97706";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // coin shine
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.arc(coin.x - 2, coin.y - 2, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHero(ctx: CanvasRenderingContext2D, hero: Hero) {
  const { x, y, width, height, onGround, legPhase } = hero;
  ctx.save();
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.beginPath();
  ctx.ellipse(
    x + width / 2,
    y + height + 3,
    width * 0.45,
    4,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // legs
  const legBob = onGround ? Math.sin(legPhase * 8) * 4 : 0;
  ctx.fillStyle = "#1d4ed8";
  ctx.fillRect(x + 3, y + height - 8, 6, 8 + legBob);
  ctx.fillRect(x + width - 9, y + height - 8, 6, 8 - legBob);
  // body
  ctx.fillStyle = "#2563eb";
  ctx.beginPath();
  ctx.roundRect(x, y + 10, width, height - 10, 4);
  ctx.fill();
  // cape flicker
  ctx.fillStyle = "#dc2626";
  ctx.beginPath();
  ctx.moveTo(x, y + 14);
  ctx.lineTo(x - 8, y + 20 + (onGround ? 0 : 4));
  ctx.lineTo(x, y + 24);
  ctx.closePath();
  ctx.fill();
  // head
  ctx.fillStyle = "#fcd34d";
  ctx.beginPath();
  ctx.arc(x + width / 2, y + 6, 10, 0, Math.PI * 2);
  ctx.fill();
  // visor
  ctx.fillStyle = "#1e3a8a";
  ctx.beginPath();
  ctx.roundRect(x + width / 2 - 7, y + 2, 14, 6, 3);
  ctx.fill();
  // eyes
  ctx.fillStyle = "#60a5fa";
  ctx.beginPath();
  ctx.arc(x + width / 2 - 3, y + 5, 2, 0, Math.PI * 2);
  ctx.arc(x + width / 2 + 3, y + 5, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawScore(ctx: CanvasRenderingContext2D, score: number, cw: number) {
  ctx.save();
  ctx.font = "bold 28px 'Bricolage Grotesque', sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.shadowColor = "rgba(0,0,50,0.4)";
  ctx.shadowBlur = 8;
  ctx.fillText(`${score}`, cw / 2, 44);
  ctx.restore();
}

// ── Main Component ──────────────────────────────────────────────────────────
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>("start");
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    try {
      return (
        Number.parseInt(localStorage.getItem(HIGH_SCORE_KEY) ?? "0", 10) || 0
      );
    } catch {
      return 0;
    }
  });

  const g = useRef<GameRef>({
    state: "start",
    hero: {
      x: 0,
      y: 0,
      width: HERO_WIDTH,
      height: HERO_HEIGHT,
      vy: 0,
      onGround: false,
      legPhase: 0,
    },
    platforms: [],
    coins: [],
    clouds: [],
    score: 0,
    highScore: 0,
    baseSpeed: BASE_SPEED,
    platformIdCounter: 0,
    coinIdCounter: 0,
    lastTime: 0,
    animFrameId: 0,
    canvasWidth: window.innerWidth,
    canvasHeight: window.innerHeight,
  });

  // sync highScore ref
  useEffect(() => {
    g.current.highScore = highScore;
  }, [highScore]);

  const startGame = useCallback(() => {
    const cw = window.innerWidth;
    const ch = window.innerHeight;
    const heroX = cw * 0.22 - HERO_WIDTH / 2;
    g.current.state = "playing";
    g.current.canvasWidth = cw;
    g.current.canvasHeight = ch;
    g.current.score = 0;
    g.current.platformIdCounter = 0;
    g.current.coinIdCounter = 0;
    g.current.hero = {
      x: heroX,
      y: ch * 0.65 - HERO_HEIGHT - PLATFORM_HEIGHT,
      width: HERO_WIDTH,
      height: HERO_HEIGHT,
      vy: 0,
      onGround: true,
      legPhase: 0,
    };
    spawnInitialPlatforms(cw, ch, g.current);
    g.current.clouds = spawnClouds(cw, ch);
    setScore(0);
    setGameState("playing");
  }, []);

  const jump = useCallback(() => {
    if (g.current.state !== "playing") return;
    if (!g.current.hero.onGround) return;
    g.current.hero.vy = JUMP_VELOCITY;
    g.current.hero.onGround = false;
    playJump();
  }, []);

  // Game loop
  useEffect(() => {
    if (gameState !== "playing") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    g.current.lastTime = performance.now();

    function loop(now: number) {
      if (!ctx) return;
      const dt = Math.min((now - g.current.lastTime) / 1000, 0.05);
      g.current.lastTime = now;

      const cw = canvas!.width;
      const ch = canvas!.height;
      const speed = computeSpeed(g.current.score);

      // ── Update clouds ──
      for (const c of g.current.clouds) {
        c.x -= c.speed * dt;
        if (c.x + c.width < 0) {
          c.x = cw + 20;
          c.y = rand(0, ch * 0.45);
        }
      }

      // ── Update platforms ──
      const heroX = g.current.hero.x;
      for (const p of g.current.platforms) {
        p.x -= speed * dt;
        if (p.vanishing && !p.gone) {
          // start timer once hero has passed it
          if (p.x + p.width < heroX) {
            p.vanishTimer -= dt * 1000;
            if (p.vanishTimer <= 0) p.gone = true;
          }
        }
      }
      // remove off-screen platforms
      g.current.platforms = g.current.platforms.filter(
        (p) => p.x + p.width > -50,
      );

      // ── Update coins ──
      for (const c of g.current.coins) {
        c.x -= speed * dt;
      }
      g.current.coins = g.current.coins.filter((c) => c.x + c.radius > -50);

      // ── Spawn new platforms ──
      const rightMost = g.current.platforms.reduce(
        (m, p) => Math.max(m, p.x + p.width),
        0,
      );
      if (rightMost < cw + 200) {
        const pw = rand(60, 120);
        const py = rand(ch * 0.2, ch * 0.75);
        const van = Math.random() < 0.28;
        const p = makePlatform(
          g.current.platformIdCounter++,
          rightMost + rand(80, 170),
          py,
          pw,
          van,
        );
        g.current.platforms.push(p);
        if (Math.random() < 0.35) {
          g.current.coins.push({
            id: g.current.coinIdCounter++,
            x: p.x + p.width / 2,
            y: p.y - 16,
            radius: 8,
            collected: false,
            platformId: p.id,
          });
        }
      }

      // ── Update hero physics ──
      const hero = g.current.hero;
      hero.vy += GRAVITY * dt;
      hero.y += hero.vy * dt;
      hero.onGround = false;

      // Platform collision (only when falling)
      if (hero.vy >= 0) {
        for (const p of g.current.platforms) {
          if (p.gone) continue;
          const heroBottom = hero.y + hero.height;
          const prevBottom = heroBottom - hero.vy * dt;
          if (
            hero.x + hero.width > p.x + 4 &&
            hero.x < p.x + p.width - 4 &&
            prevBottom <= p.y + 2 &&
            heroBottom >= p.y
          ) {
            hero.y = p.y - hero.height;
            hero.vy = 0;
            hero.onGround = true;
            // score for landing
            g.current.score += 1;
            setScore(g.current.score);
            break;
          }
        }
      }

      // Coin collision
      for (const coin of g.current.coins) {
        if (coin.collected) continue;
        const dx = hero.x + hero.width / 2 - coin.x;
        const dy = hero.y + hero.height / 2 - coin.y;
        if (Math.sqrt(dx * dx + dy * dy) < coin.radius + 14) {
          coin.collected = true;
          g.current.score += 1;
          setScore(g.current.score);
          playCoin();
        }
      }

      // Leg animation
      hero.legPhase += dt;

      // ── Death check ──
      if (hero.y > ch + 50 || hero.x + hero.width < 0) {
        g.current.state = "gameover";
        const hs = Math.max(g.current.score, g.current.highScore);
        g.current.highScore = hs;
        try {
          localStorage.setItem(HIGH_SCORE_KEY, String(hs));
        } catch (_) {
          /* */
        }
        setHighScore(hs);
        setGameState("gameover");
        playGameOver();
        return;
      }

      // ── Draw ──
      ctx.clearRect(0, 0, cw, ch);
      drawBackground(ctx, cw, ch);
      for (const c of g.current.clouds) drawCloud(ctx, c);
      for (const p of g.current.platforms) drawPlatform(ctx, p);
      for (const coin of g.current.coins) drawCoin(ctx, coin);
      drawHero(ctx, hero);
      drawScore(ctx, g.current.score, cw);

      g.current.animFrameId = requestAnimationFrame(loop);
    }

    g.current.animFrameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(g.current.animFrameId);
  }, [gameState]);

  // Resize
  useEffect(() => {
    function onResize() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      g.current.canvasWidth = window.innerWidth;
      g.current.canvasHeight = window.innerHeight;
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Jump on touch/click (handled on canvas when playing)
  const handleCanvasInteract = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      jump();
    },
    [jump],
  );

  const year = new Date().getFullYear();

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: "#0ea5e9",
      }}
    >
      {/* Canvas always rendered so it's ready */}
      <canvas
        ref={canvasRef}
        data-ocid="game.canvas_target"
        style={{
          display: "block",
          position: "absolute",
          inset: 0,
          touchAction: "none",
          cursor: gameState === "playing" ? "none" : "default",
        }}
        onMouseDown={gameState === "playing" ? handleCanvasInteract : undefined}
        onTouchStart={
          gameState === "playing" ? handleCanvasInteract : undefined
        }
      />

      {/* START SCREEN */}
      {gameState === "start" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background:
              "linear-gradient(180deg, #0369a1 0%, #0ea5e9 40%, #38bdf8 100%)",
            fontFamily: "'Bricolage Grotesque', sans-serif",
          }}
        >
          {/* Decorative clouds */}
          <div
            style={{
              position: "absolute",
              top: "8%",
              left: "5%",
              opacity: 0.7,
            }}
          >
            <CloudShape width={120} />
          </div>
          <div
            style={{
              position: "absolute",
              top: "15%",
              right: "8%",
              opacity: 0.6,
            }}
          >
            <CloudShape width={90} />
          </div>
          <div
            style={{
              position: "absolute",
              bottom: "20%",
              left: "12%",
              opacity: 0.5,
            }}
          >
            <CloudShape width={100} />
          </div>

          {/* Hero preview */}
          <div
            style={{
              width: 44,
              height: 64,
              position: "relative",
              marginBottom: 12,
              filter: "drop-shadow(0 8px 24px rgba(0,0,0,0.35))",
            }}
          >
            <HeroPreview />
          </div>

          <h1
            style={{
              color: "#fff",
              fontSize: "clamp(2.2rem, 8vw, 3.8rem)",
              fontWeight: 800,
              textAlign: "center",
              lineHeight: 1.1,
              textShadow: "0 4px 20px rgba(0,30,80,0.4)",
              marginBottom: 6,
              letterSpacing: "-0.02em",
            }}
          >
            Sky Jump
            <br />
            <span style={{ color: "#fde68a" }}>Hero</span>
          </h1>

          <p
            style={{
              color: "rgba(255,255,255,0.85)",
              fontSize: "1rem",
              marginBottom: 36,
              textAlign: "center",
              maxWidth: 260,
              lineHeight: 1.5,
            }}
          >
            Tap to jump between platforms.
            <br />
            Collect coins. Reach for the sky!
          </p>

          {highScore > 0 && (
            <div
              style={{
                background: "rgba(255,255,255,0.15)",
                backdropFilter: "blur(8px)",
                border: "1px solid rgba(255,255,255,0.3)",
                borderRadius: 12,
                padding: "8px 24px",
                color: "#fde68a",
                fontSize: "0.95rem",
                fontWeight: 700,
                marginBottom: 28,
                letterSpacing: "0.04em",
              }}
            >
              🏆 BEST: {highScore}
            </div>
          )}

          <button
            type="button"
            data-ocid="game.primary_button"
            onClick={startGame}
            style={{
              background: "linear-gradient(135deg, #fde68a, #f59e0b)",
              color: "#78350f",
              fontFamily: "'Bricolage Grotesque', sans-serif",
              fontWeight: 800,
              fontSize: "1.25rem",
              letterSpacing: "0.06em",
              border: "none",
              borderRadius: 999,
              padding: "16px 52px",
              cursor: "pointer",
              boxShadow:
                "0 8px 32px rgba(245,158,11,0.45), 0 2px 8px rgba(0,0,0,0.2)",
              transform: "translateY(0)",
              transition: "transform 0.1s, box-shadow 0.1s",
              touchAction: "manipulation",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.transform =
                "translateY(-3px)";
              (e.target as HTMLButtonElement).style.boxShadow =
                "0 12px 40px rgba(245,158,11,0.55), 0 4px 12px rgba(0,0,0,0.2)";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.transform = "translateY(0)";
              (e.target as HTMLButtonElement).style.boxShadow =
                "0 8px 32px rgba(245,158,11,0.45), 0 2px 8px rgba(0,0,0,0.2)";
            }}
          >
            ▶ START
          </button>

          <p
            style={{
              position: "absolute",
              bottom: 16,
              color: "rgba(255,255,255,0.5)",
              fontSize: "0.72rem",
              textAlign: "center",
            }}
          >
            © {year}.{" "}
            <a
              href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: "rgba(255,255,255,0.6)", textDecoration: "none" }}
            >
              Built with ♥ using caffeine.ai
            </a>
          </p>
        </div>
      )}

      {/* GAME OVER OVERLAY */}
      {gameState === "gameover" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,20,60,0.75)",
            backdropFilter: "blur(6px)",
            fontFamily: "'Bricolage Grotesque', sans-serif",
          }}
        >
          <div
            style={{
              background:
                "linear-gradient(145deg, rgba(255,255,255,0.12), rgba(255,255,255,0.05))",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 24,
              padding: "40px 48px",
              textAlign: "center",
              maxWidth: 320,
              width: "88%",
              boxShadow: "0 24px 64px rgba(0,0,40,0.5)",
            }}
          >
            <div style={{ fontSize: "3.5rem", marginBottom: 4 }}>💥</div>
            <h2
              style={{
                color: "#fff",
                fontSize: "2rem",
                fontWeight: 800,
                marginBottom: 20,
                letterSpacing: "-0.02em",
              }}
            >
              Game Over
            </h2>

            <div
              style={{
                display: "flex",
                gap: 16,
                justifyContent: "center",
                marginBottom: 28,
              }}
            >
              <ScorePill label="SCORE" value={score} accent="#60a5fa" />
              <ScorePill label="BEST" value={highScore} accent="#fde68a" />
            </div>

            <button
              type="button"
              data-ocid="game.secondary_button"
              onClick={startGame}
              style={{
                background: "linear-gradient(135deg, #60a5fa, #2563eb)",
                color: "#fff",
                fontFamily: "'Bricolage Grotesque', sans-serif",
                fontWeight: 800,
                fontSize: "1.1rem",
                letterSpacing: "0.05em",
                border: "none",
                borderRadius: 999,
                padding: "14px 44px",
                cursor: "pointer",
                boxShadow: "0 6px 24px rgba(37,99,235,0.5)",
                width: "100%",
                touchAction: "manipulation",
                transition: "transform 0.1s",
              }}
            >
              ↩ Play Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────
function ScorePill({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.08)",
        border: `1px solid ${accent}44`,
        borderRadius: 12,
        padding: "10px 20px",
        minWidth: 80,
      }}
    >
      <div
        style={{
          color: accent,
          fontSize: "0.65rem",
          fontWeight: 700,
          letterSpacing: "0.1em",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ color: "#fff", fontSize: "1.8rem", fontWeight: 800 }}>
        {value}
      </div>
    </div>
  );
}

function CloudShape({ width }: { width: number }) {
  const h = width * 0.45;
  return (
    <svg
      role="img"
      aria-label="Cloud"
      width={width}
      height={h}
      viewBox={`0 0 ${width} ${h}`}
    >
      <ellipse
        cx={width * 0.25}
        cy={h * 0.65}
        rx={width * 0.22}
        ry={h * 0.5}
        fill="white"
        opacity="0.85"
      />
      <ellipse
        cx={width * 0.5}
        cy={h * 0.42}
        rx={width * 0.28}
        ry={h * 0.6}
        fill="white"
        opacity="0.9"
      />
      <ellipse
        cx={width * 0.76}
        cy={h * 0.62}
        rx={width * 0.2}
        ry={h * 0.48}
        fill="white"
        opacity="0.85"
      />
      <ellipse
        cx={width * 0.5}
        cy={h * 0.8}
        rx={width * 0.48}
        ry={h * 0.32}
        fill="white"
        opacity="0.9"
      />
    </svg>
  );
}

function HeroPreview() {
  return (
    <svg
      role="img"
      aria-label="Sky Jump Hero character"
      width="44"
      height="64"
      viewBox="0 0 44 64"
    >
      {/* cape */}
      <polygon points="0,20 -12,30 0,38" fill="#dc2626" />
      {/* body */}
      <rect x="0" y="18" width="22" height="28" rx="4" fill="#2563eb" />
      {/* legs */}
      <rect x="2" y="42" width="7" height="12" rx="2" fill="#1d4ed8" />
      <rect x="13" y="42" width="7" height="12" rx="2" fill="#1d4ed8" />
      {/* head */}
      <circle cx="11" cy="10" r="11" fill="#fcd34d" />
      {/* visor */}
      <rect x="3" y="5" width="16" height="7" rx="3" fill="#1e3a8a" />
      {/* eyes */}
      <circle cx="8" cy="8" r="2.5" fill="#60a5fa" />
      <circle cx="14" cy="8" r="2.5" fill="#60a5fa" />
    </svg>
  );
}
