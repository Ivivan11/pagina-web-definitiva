// Prototipo de parkour: render en silueta, entrada y bucle.

const pkCanvas = document.getElementById("pk");
const pkCtx = pkCanvas.getContext("2d", { alpha: false });
const W = PK.CANVAS_W;
const H = PK.CANVAS_H;

const pkEls = {};
["dist", "speed", "gap", "gapbar", "tricks", "start", "over", "over-dist", "over-detail", "retry", "hint"].forEach(
  (id) => (pkEls[id] = document.getElementById("pk-" + id))
);

const pk = {
  screen: "start", // start | running | over
  runner: null,
  chaser: null,
  course: null,
  input: { jump: false, slide: false },
  camX: 0,
  t: 0,
  acc: 0,
  last: performance.now(),
  best: 0,
  events: [],
};

try {
  pk.best = parseInt(localStorage.getItem("camuflaje.pk.best") || "0", 10) || 0;
} catch (e) {}

function startRun() {
  const seed = (Date.now() & 0xffff) || 1;
  pk.course = createCourse(seed);
  pk.runner = createRunner();
  pk.chaser = createChaser();
  pk.camX = 0;
  pk.acc = 0;
  pk.screen = "running";
  pkEls.start.hidden = true;
  pkEls.over.hidden = true;
}

function endRun(caught) {
  pk.screen = "over";
  const d = Math.floor(pk.runner.distance / 10);
  if (d > pk.best) {
    pk.best = d;
    try {
      localStorage.setItem("camuflaje.pk.best", String(d));
    } catch (e) {}
  }
  pkEls["over-dist"].textContent = d + " m";
  pkEls["over-detail"].textContent =
    `${caught ? "Te ha pillado" : "No has llegado"} · ${pk.runner.tricks} trucos · ` +
    `${pk.runner.stumbles} tropiezos · récord ${pk.best} m`;
  pkEls.over.hidden = false;
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------
const PK_KEYS = {
  " ": "jump", ArrowUp: "jump", w: "jump", W: "jump",
  ArrowDown: "slide", s: "slide", S: "slide", Shift: "slide",
};

window.addEventListener("keydown", (e) => {
  const a = PK_KEYS[e.key];
  if (a) {
    pk.input[a] = true;
    e.preventDefault();
  }
  if (pk.screen !== "running" && (e.key === " " || e.key === "Enter")) startRun();
});

window.addEventListener("keyup", (e) => {
  const a = PK_KEYS[e.key];
  if (a) pk.input[a] = false;
});

// En móvil: mitad derecha saltar, mitad izquierda deslizarse.
function touchAction(e) {
  const rect = pkCanvas.getBoundingClientRect();
  return e.clientX - rect.left > rect.width / 2 ? "jump" : "slide";
}

pkCanvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  if (pk.screen !== "running") {
    startRun();
    return;
  }
  pk.input[touchAction(e)] = true;
});
pkCanvas.addEventListener("pointerup", (e) => {
  e.preventDefault();
  pk.input.jump = false;
  pk.input.slide = false;
});
pkCanvas.addEventListener("pointercancel", () => {
  pk.input.jump = false;
  pk.input.slide = false;
});

pkEls.retry.addEventListener("click", startRun);
pkEls.start.addEventListener("click", startRun);

// ---------------------------------------------------------------------------
// Fondo en silueta: cielo al amanecer y ciudad a contraluz
// ---------------------------------------------------------------------------
// La profundidad se consigue con el COLOR, no con transparencia: las capas
// lejanas tiran hacia el tono de la bruma y las cercanas hacia el negro. Con
// alfa los edificios se solapaban y la ciudad parecía de cristal.
const LAYER_TONES = [
  ["#4d3c63", "#9a7178"], // lejos: casi disuelta en la bruma
  ["#2c2242", "#5b3f54"],
  ["#161227", "#2b1f30"], // cerca: ya casi negro
];

const skyLayers = [];
function buildSky() {
  const rng = makeRng(20260919);
  for (let layer = 0; layer < 3; layer++) {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = H;
    const g = c.getContext("2d");
    const baseY = [330, 380, 440][layer];
    const maxH = [150, 190, 230][layer];
    const tone = g.createLinearGradient(0, 120, 0, PK.GROUND_Y);
    tone.addColorStop(0, LAYER_TONES[layer][0]);
    tone.addColorStop(1, LAYER_TONES[layer][1]);
    g.fillStyle = tone;
    let x = -40;
    while (x < 1240) {
      const bw = 40 + rng() * 90;
      const bh = 40 + rng() * maxH;
      g.fillRect(x, baseY - bh, bw, bh + 200);
      // alguna antena
      if (rng() < 0.25) g.fillRect(x + bw * 0.45, baseY - bh - 26, 3, 26);
      x += bw + 6 + rng() * 40;
    }
    skyLayers.push({ canvas: c, speed: [0.12, 0.26, 0.48][layer] });
  }
}
buildSky();

function drawSky() {
  const g = pkCtx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#14224a");
  g.addColorStop(0.42, "#6d3b6b");
  g.addColorStop(0.72, "#e0714a");
  g.addColorStop(0.92, "#ffc978");
  g.addColorStop(1, "#ffe6b0");
  pkCtx.fillStyle = g;
  pkCtx.fillRect(0, 0, W, H);

  // sol bajo
  const sx = W * 0.72;
  const sy = H * 0.66;
  const sun = pkCtx.createRadialGradient(sx, sy, 6, sx, sy, 190);
  sun.addColorStop(0, "rgba(255,240,200,0.95)");
  sun.addColorStop(0.35, "rgba(255,190,120,0.35)");
  sun.addColorStop(1, "rgba(255,170,90,0)");
  pkCtx.fillStyle = sun;
  pkCtx.fillRect(sx - 200, sy - 200, 400, 400);

  for (const layer of skyLayers) {
    const off = -((pk.camX * layer.speed) % 1200);
    pkCtx.drawImage(layer.canvas, off, 0);
    pkCtx.drawImage(layer.canvas, off + 1200, 0);
  }

  // Franja de luz justo sobre el suelo: es lo que hace que el personaje y los
  // obstáculos negros se recorten con nitidez.
  const haze = pkCtx.createLinearGradient(0, PK.GROUND_Y - 190, 0, PK.GROUND_Y);
  haze.addColorStop(0, "rgba(255,196,132,0)");
  haze.addColorStop(0.75, "rgba(255,206,150,0.34)");
  haze.addColorStop(1, "rgba(255,226,182,0.62)");
  pkCtx.fillStyle = haze;
  pkCtx.fillRect(0, PK.GROUND_Y - 190, W, 190);
}

// ---------------------------------------------------------------------------
// Primer plano: todo negro recortado
// ---------------------------------------------------------------------------
const INK = "#07080f";

function drawGround(course) {
  pkCtx.fillStyle = INK;
  const y = PK.GROUND_Y;
  let cursor = pk.camX - 60;
  const end = pk.camX + W + 60;

  const holes = course.obstacles
    .filter((o) => o.type === "gap" || (o.type === "fake" && o.broken))
    .sort((a, b) => a.x - b.x);

  // Se pinta en tramos continuos: el borde superior es una línea seguida, así
  // que un suelo falso todavía intacto es indistinguible del suelo bueno.
  const runs = [];
  for (const hole of holes) {
    if (hole.x + hole.w < cursor || hole.x > end) continue;
    if (hole.x > cursor) runs.push([cursor, hole.x]);
    cursor = Math.max(cursor, hole.x + hole.w);
  }
  if (cursor < end) runs.push([cursor, end]);

  for (const [a, b] of runs) pkCtx.fillRect(a, y, b - a, H - y + 40);
  pkCtx.fillStyle = "rgba(255,214,166,0.5)";
  for (const [a, b] of runs) pkCtx.fillRect(a, y, b - a, 2);
}

function drawObstacles(course) {
  for (const ob of course.obstacles) {
    if (ob.x + ob.w < pk.camX - 80 || ob.x > pk.camX + W + 80) continue;
    if (ob.type === "gap") continue;
    if (ob.type === "fake") continue; // idéntico al suelo: de eso va el juego

    pkCtx.fillStyle = INK;
    if (ob.type === "spikes") {
      // los pinchos sí avisan: son el peligro honesto
      const n = Math.max(3, Math.floor(ob.w / 16));
      const sw = ob.w / n;
      pkCtx.beginPath();
      for (let i = 0; i < n; i++) {
        pkCtx.moveTo(ob.x + i * sw, ob.y + ob.h);
        pkCtx.lineTo(ob.x + i * sw + sw / 2, ob.y);
        pkCtx.lineTo(ob.x + (i + 1) * sw, ob.y + ob.h);
      }
      pkCtx.closePath();
      pkCtx.fill();
      pkCtx.strokeStyle = "rgba(255,120,90,0.85)";
      pkCtx.lineWidth = 2;
      pkCtx.stroke();
    } else if (ob.type === "beam") {
      pkCtx.fillRect(ob.x, ob.y, ob.w, ob.h);
      pkCtx.fillRect(ob.x + 4, ob.y + ob.h, 6, 16);
      pkCtx.fillRect(ob.x + ob.w - 10, ob.y + ob.h, 6, 16);
    } else {
      pkCtx.fillRect(ob.x, ob.y, ob.w, ob.h);
      if (ob.type === "wall") {
        pkCtx.fillStyle = "rgba(255,200,150,0.18)";
        pkCtx.fillRect(ob.x, ob.y, ob.w, 5);
      }
    }
  }
}

function drawCharacter(r, isChaser) {
  const box = { x: r.x, y: r.y, w: r.w, h: r.h };
  const opts = {
    pose: isChaser ? "run" : r.pose,
    t: pk.t,
    speed: Math.min(1, ((isChaser ? pk.chaser.speed : r.speed) - PK.SPEED_BASE) / (PK.SPEED_MAX - PK.SPEED_BASE)),
    facing: 1,
    phase: r.vaultT > 0 ? 1 - r.vaultT / PK.VAULT_TIME : r.rollT > 0 ? 1 - r.rollT / PK.ROLL_TIME : 0,
    color: INK,
    alpha: 1,
  };

  if (typeof Runner !== "undefined") {
    if (isChaser) Runner.drawChaser(pkCtx, box, opts);
    else Runner.draw(pkCtx, box, opts);
    return;
  }
  // Reserva por si el módulo del corredor aún no está cargado
  pkCtx.fillStyle = INK;
  pkCtx.fillRect(box.x, box.y, box.w, box.h);
}

function render() {
  drawSky();
  pkCtx.save();
  pkCtx.translate(-Math.round(pk.camX), 0);

  if (pk.course) {
    drawGround(pk.course);
    drawObstacles(pk.course);
  }

  if (pk.chaser && pk.runner) {
    // aura de amenaza detrás del perseguidor
    const cy = PK.GROUND_Y - 62;
    const glow = pkCtx.createRadialGradient(pk.chaser.x + 15, cy + 30, 4, pk.chaser.x + 15, cy + 30, 120);
    glow.addColorStop(0, "rgba(220,60,50,0.34)");
    glow.addColorStop(1, "rgba(220,60,50,0)");
    pkCtx.fillStyle = glow;
    pkCtx.fillRect(pk.chaser.x - 110, cy - 80, 250, 220);
    drawCharacter({ x: pk.chaser.x, y: cy, w: 34, h: 62, pose: "run" }, true);
  }

  if (pk.runner) drawCharacter(pk.runner, false);
  FX.draw(pkCtx);
  pkCtx.restore();
}

// ---------------------------------------------------------------------------
// Eventos -> sonido (reutiliza el módulo del juego principal)
// ---------------------------------------------------------------------------
function consumePkEvents() {
  for (const ev of pk.events) {
    switch (ev.name) {
      case "jump": Sfx.play("jump"); break;
      case "vault": Sfx.play("jump", { pitch: 1.2 }); FX.dust(ev.x + 20, PK.GROUND_Y, { count: 8, color: "#ffcf9a" }); break;
      case "wallJump": Sfx.play("spring", { volume: 0.7 }); FX.dust(ev.x, ev.y + 40, { count: 10, color: "#ffcf9a" }); break;
      case "slide": Sfx.play("crumble", { volume: 0.5 }); FX.dust(ev.x, PK.GROUND_Y, { count: 10, color: "#ffcf9a" }); break;
      case "roll": Sfx.play("land", { volume: 0.7 }); FX.dust(ev.x, PK.GROUND_Y, { count: 12, color: "#ffcf9a" }); break;
      case "land": if (Math.abs(ev.vy || 0) > 500) { Sfx.play("land"); FX.dust(ev.x, PK.GROUND_Y, { count: 8, color: "#ffcf9a" }); } break;
      case "fakeBreak":
        Sfx.play("crumble");
        FX.debris(ev.x - 40, PK.GROUND_Y, 80, 24, { color: "#1a1d2b", count: 12 });
        FX.shake(5, 0.18);
        break;
      case "stumble":
        Sfx.play("trapReveal", { volume: 0.8 });
        FX.shake(7, 0.22);
        FX.floatText(ev.x, ev.y - 20, "¡tropiezo!", { color: "#ff9b7a" });
        break;
      case "spiked":
      case "fall":
        Sfx.play("death");
        FX.shake(11, 0.32);
        FX.flash("rgba(220,80,60,0.35)", 0.18);
        break;
    }
  }
  pk.events.length = 0;
}

// ---------------------------------------------------------------------------
// Bucle
// ---------------------------------------------------------------------------
function pkTick(now) {
  requestAnimationFrame(pkTick);
  let dt = (now - pk.last) / 1000;
  pk.last = now;
  dt = Math.min(dt, 0.2);
  pk.t += dt;
  FX.update(dt);

  if (pk.screen === "running" && !FX.isHitstopped()) {
    pk.acc += dt;
    let steps = 0;
    while (pk.acc >= PK.STEP && steps < 6) {
      stepRunner(pk.runner, pk.input, pk.course, PK.STEP, pk.events);
      const caught = stepChaser(pk.chaser, pk.runner, PK.STEP);
      pk.acc -= PK.STEP;
      steps++;
      if (pk.runner.dead) { consumePkEvents(); endRun(false); break; }
      if (caught) { pk.runner.caught = true; Sfx.play("death"); FX.shake(10, 0.3); endRun(true); break; }
    }
    consumePkEvents();

    // cámara: el corredor va en el primer tercio
    const target = pk.runner.x - W * 0.32;
    pk.camX += (target - pk.camX) * Math.min(1, dt * 9);

    const speedPct = Math.round(((pk.runner.speed - PK.SPEED_BASE) / (PK.SPEED_MAX - PK.SPEED_BASE)) * 100);
    pkEls.dist.textContent = Math.floor(pk.runner.distance / 10) + " m";
    pkEls.speed.textContent = Math.max(0, speedPct) + "%";
    pkEls.tricks.textContent = pk.runner.tricks;
    const lead = Math.max(0, Math.min(1, (pk.runner.x - pk.chaser.x) / PK.LEAD_MAX));
    pkEls.gapbar.style.width = (lead * 100).toFixed(0) + "%";
    pkEls.gapbar.style.background = lead < 0.25 ? "#e5533d" : lead < 0.5 ? "#e8a33d" : "#54c98a";
  } else {
    pk.acc = 0;
  }

  const shake = FX.shakeOffset();
  pkCtx.save();
  pkCtx.translate(shake.x, shake.y);
  render();
  pkCtx.restore();
  FX.drawScreen(pkCtx, W, H);
}

Sfx.init();
requestAnimationFrame(pkTick);
