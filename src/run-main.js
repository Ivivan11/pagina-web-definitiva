// Juego de la carrera: menú, partidas con semilla, fantasmas, medallas,
// récords y el bucle de render en silueta.

const W = PK.CANVAS_W;
const H = PK.CANVAS_H;
const INK = "#07080f";

// Medallas por distancia, en metros. Los umbrales salen de medir miles de
// carreras de bots con distinta pericia: el bronce lo saca casi cualquiera que
// se defienda, la plata pide una carrera buena y el oro es poco común.
const RUN_MEDALS = [
  { id: "oro", label: "Oro", color: "#f5c451", at: 1100 },
  { id: "plata", label: "Plata", color: "#c8d2de", at: 700 },
  { id: "bronce", label: "Bronce", color: "#c98a52", at: 450 },
];

const STORE = {
  best: "camuflaje.run.best",
  runs: "camuflaje.run.count",
  daily: "camuflaje.run.daily",
  medal: "camuflaje.run.medal",
};

const cv = document.getElementById("game");
const ctx = cv.getContext("2d", { alpha: false });

const el = {};
[
  "hud", "hud-dist", "hud-speed", "hud-tricks", "hud-ghost", "gapbar",
  "mute-btn", "camo-btn", "pause-btn", "stage",
  "menu", "menu-best", "menu-medals", "play-btn", "daily-btn", "daily-note",
  "challenge-input", "challenge-btn", "challenge-status",
  "over", "over-dist", "over-medal", "over-detail", "retry-btn", "share-btn",
  "menu-btn", "revive-btn", "pause-panel", "resume-btn", "quit-btn", "ghost-btn",
  "toast", "transition",
].forEach((id) => (el[id] = document.getElementById(id)));

const G = {
  screen: "menu", // menu | running | over | paused
  runner: null,
  chaser: null,
  course: null,
  seed: 1,
  daily: false,
  rec: null,
  ghost: null, // fantasma propio o del reto
  ghostIsRival: false,
  pendingRival: null,
  input: { jump: false, slide: false },
  camX: 0,
  t: 0,
  acc: 0,
  last: performance.now(),
  events: [],
  ghostsOn: true,
  runs: 0,
  best: 0,
  revivedThisRun: false,
};

// ---------------------------------------------------------------------------
// Guardado
// ---------------------------------------------------------------------------
function getNum(key, fallback) {
  try {
    const v = parseInt(localStorage.getItem(key) || "", 10);
    return isNaN(v) ? fallback : v;
  } catch (e) {
    return fallback;
  }
}
function setVal(key, v) {
  try {
    localStorage.setItem(key, String(v));
  } catch (e) {}
}
function getStr(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch (e) {
    return "";
  }
}

function todaySeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function medalFor(meters) {
  for (const m of RUN_MEDALS) if (meters >= m.at) return m;
  return null;
}

function show(e) { if (e) e.hidden = false; }
function hide(e) { if (e) e.hidden = true; }

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.remove("show"), 2200);
}

function transition(fn) {
  el.transition.classList.add("cover");
  setTimeout(() => {
    fn();
    el.transition.classList.remove("cover");
  }, 230);
}

// ---------------------------------------------------------------------------
// Menú
// ---------------------------------------------------------------------------
function refreshMenu() {
  G.best = getNum(STORE.best, 0);
  G.runs = getNum(STORE.runs, 0);
  el["menu-best"].textContent = G.best > 0 ? G.best + " m" : "todavía nada";

  const bestMedal = getStr(STORE.medal);
  const m = RUN_MEDALS.find((x) => x.id === bestMedal);
  el["menu-medals"].innerHTML = m
    ? `Mejor medalla: <b style="color:${m.color}">${m.label}</b> · ${G.runs} carreras`
    : `Sin medalla aún · ${G.runs} carreras · el bronce está en ${RUN_MEDALS[2].at} m`;

  const dailyDone = getNum(STORE.daily + "." + todaySeed(), 0);
  el["daily-note"].textContent = dailyDone
    ? `Hoy llevas ${dailyDone} m — mismo recorrido para toda la clase`
    : "El mismo recorrido para todo el mundo, cambia cada día";
}

function goMenu() {
  G.screen = "menu";
  Ads.notifyGameplayStop();
  FX.reset();
  hide(el.hud);
  hide(el.over);
  hide(el["pause-panel"]);
  refreshMenu();
  show(el.menu);
}

// ---------------------------------------------------------------------------
// Ciclo de una carrera
// ---------------------------------------------------------------------------
function startRun(seed, isDaily, rivalCode) {
  G.seed = seed >>> 0 || 1;
  G.daily = !!isDaily;
  G.course = createCourse(G.seed);
  G.runner = createRunner();
  G.chaser = createChaser();
  G.rec = createRunRecorder();
  G.camX = 0;
  G.acc = 0;
  G.events.length = 0;
  G.revivedThisRun = false;
  FX.reset();

  G.ghost = null;
  G.ghostIsRival = false;
  if (G.ghostsOn) {
    const code = rivalCode || G.pendingRival;
    const rival = code ? decodeRun(code) : null;
    if (rival && rival.seed === G.seed) {
      G.ghost = createRunGhost(rival.seed, rival.frames);
      G.ghostIsRival = true;
    } else {
      const own = decodeRun(getStr("camuflaje.run.replay." + G.seed));
      if (own && own.seed === G.seed) G.ghost = createRunGhost(own.seed, own.frames);
    }
  }
  el["hud-ghost"].textContent = G.ghost ? (G.ghostIsRival ? "Reto activo" : "Tu fantasma") : "";

  hide(el.menu);
  hide(el.over);
  hide(el["pause-panel"]);
  show(el.hud);

  G.screen = "running";
  Ads.notifyGameplayStart();
}

function finishRun(caught) {
  G.screen = "over";
  Ads.notifyGameplayStop();

  const meters = Math.floor(G.runner.distance / 10);
  const medal = medalFor(meters);

  G.runs++;
  setVal(STORE.runs, G.runs);

  if (meters > G.best) {
    G.best = meters;
    setVal(STORE.best, meters);
    // guarda la repetición de tu mejor carrera en este recorrido
    setVal("camuflaje.run.replay." + G.seed, encodeRun(G.seed, G.rec.frames));
  }
  if (G.daily) {
    const key = STORE.daily + "." + todaySeed();
    if (meters > getNum(key, 0)) setVal(key, meters);
  }
  if (medal) {
    const prev = getStr(STORE.medal);
    const prevIdx = RUN_MEDALS.findIndex((m) => m.id === prev);
    const idx = RUN_MEDALS.findIndex((m) => m.id === medal.id);
    if (prevIdx === -1 || idx < prevIdx) setVal(STORE.medal, medal.id);
  }

  el["over-dist"].textContent = meters + " m";
  if (medal) {
    el["over-medal"].textContent = "Medalla de " + medal.label.toLowerCase();
    el["over-medal"].style.color = medal.color;
  } else {
    el["over-medal"].textContent = "Sin medalla · el bronce está en " + RUN_MEDALS[2].at + " m";
    el["over-medal"].style.color = "";
  }
  el["over-detail"].textContent =
    `${caught ? "Te ha pillado" : "No has llegado"} · ${G.runner.tricks} trucos · ` +
    `${G.runner.stumbles} tropiezos · récord ${G.best} m`;

  // Una sola oportunidad de continuar por carrera, y solo si merece la pena.
  if (!G.revivedThisRun && caught && meters > 150) show(el["revive-btn"]);
  else hide(el["revive-btn"]);

  setTimeout(() => show(el.over), 380);

  // Anuncio en un corte natural, nunca durante la carrera
  if (G.runs % 4 === 0) Ads.showInterstitial(() => {});
}

function reviveRun() {
  Ads.showRewarded(
    () => {
      G.revivedThisRun = true;
      hide(el.over);
      // te devuelve al sitio con ventaja y sin el tropiezo encima
      G.runner.dead = false;
      G.runner.caught = false;
      G.runner.stumbleT = 0;
      G.runner.vy = 0;
      G.runner.y = PK.GROUND_Y - G.runner.h;
      G.runner.speed = PK.SPEED_BASE;
      G.chaser.x = G.runner.x - PK.LEAD_START;
      G.chaser.t = Math.max(0, G.chaser.t - 12);
      FX.burst(G.runner.x, G.runner.y + 30, { count: 24, color: "#ffc978", speed: 240, spread: Math.PI * 2, life: 0.6 });
      G.screen = "running";
      Ads.notifyGameplayStart();
    },
    () => toast("El anuncio no ha llegado a terminar")
  );
}

function togglePause(force) {
  const wantPause = force === undefined ? G.screen === "running" : force;
  if (wantPause && G.screen === "running") {
    G.screen = "paused";
    Ads.notifyGameplayStop();
    show(el["pause-panel"]);
  } else if (!wantPause && G.screen === "paused") {
    G.screen = "running";
    Ads.notifyGameplayStart();
    hide(el["pause-panel"]);
  }
}

async function shareRun() {
  const code = encodeRun(G.seed, G.rec.frames);
  try {
    await navigator.clipboard.writeText(code);
    toast("Código copiado: pásaselo a quien quieras retar");
  } catch (e) {
    el["challenge-status"].textContent = code;
    toast("Copia el código que aparece en el menú");
  }
}

function acceptChallenge() {
  const code = el["challenge-input"].value.trim();
  const data = decodeRun(code);
  if (!data) {
    el["challenge-status"].textContent = "Ese código no vale. ¿Lo copiaste entero?";
    return;
  }
  G.pendingRival = code;
  el["challenge-status"].textContent = "Reto aceptado: mismo recorrido, su fantasma al lado.";
  Sfx.play("ghost");
  transition(() => startRun(data.seed, false, code));
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------
const KEYS = {
  " ": "jump", ArrowUp: "jump", w: "jump", W: "jump",
  ArrowDown: "slide", s: "slide", S: "slide", Shift: "slide",
};

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  Sfx.unlock();
  const a = KEYS[e.key];
  if (a) {
    G.input[a] = true;
    if (e.key === " " || e.key.startsWith("Arrow")) e.preventDefault();
  }
  if (e.key === "Escape" && (G.screen === "running" || G.screen === "paused")) togglePause();
  if (e.key === "m" || e.key === "M") toggleMute();
  if ((e.key === " " || e.key === "Enter") && G.screen === "over") {
    transition(() => startRun(G.daily ? todaySeed() : (Date.now() & 0xffff) || 1, G.daily));
  }
});

window.addEventListener("keyup", (e) => {
  const a = KEYS[e.key];
  if (a) G.input[a] = false;
});

window.addEventListener("blur", () => {
  G.input.jump = G.input.slide = false;
  if (G.screen === "running") togglePause(true);
});

// En táctil: mitad derecha saltar, mitad izquierda deslizarse.
function half(e) {
  const r = cv.getBoundingClientRect();
  return e.clientX - r.left > r.width / 2 ? "jump" : "slide";
}
cv.addEventListener("pointerdown", (e) => {
  if (G.screen !== "running") return;
  e.preventDefault();
  Sfx.unlock();
  G.input[half(e)] = true;
});
const releaseAll = (e) => {
  if (e) e.preventDefault();
  G.input.jump = false;
  G.input.slide = false;
};
cv.addEventListener("pointerup", releaseAll);
cv.addEventListener("pointercancel", releaseAll);

function toggleMute() {
  const muted = Sfx.toggleMuted();
  el["mute-btn"].textContent = muted ? "Sonido: no" : "Sonido: sí";
  el["mute-btn"].classList.toggle("on", !muted);
  if (!muted) Sfx.play("click");
}

el["play-btn"].addEventListener("click", () => {
  Sfx.unlock();
  Sfx.play("click");
  transition(() => startRun((Date.now() & 0xffff) || 1, false));
});
el["daily-btn"].addEventListener("click", () => {
  Sfx.unlock();
  Sfx.play("click");
  transition(() => startRun(todaySeed(), true));
});
el["challenge-btn"].addEventListener("click", acceptChallenge);
el["challenge-input"].addEventListener("keydown", (e) => {
  if (e.key === "Enter") acceptChallenge();
});
el["retry-btn"].addEventListener("click", () =>
  transition(() => startRun(G.daily ? todaySeed() : (Date.now() & 0xffff) || 1, G.daily))
);
el["share-btn"].addEventListener("click", shareRun);
el["menu-btn"].addEventListener("click", () => transition(goMenu));
el["revive-btn"].addEventListener("click", reviveRun);
el["resume-btn"].addEventListener("click", () => togglePause(false));
el["quit-btn"].addEventListener("click", () => {
  togglePause(false);
  transition(goMenu);
});
el["ghost-btn"].addEventListener("click", () => {
  G.ghostsOn = !G.ghostsOn;
  el["ghost-btn"].textContent = G.ghostsOn ? "Fantasmas: sí" : "Fantasmas: no";
  el["ghost-btn"].classList.toggle("on", G.ghostsOn);
  if (!G.ghostsOn) G.ghost = null;
});
el["mute-btn"].addEventListener("click", toggleMute);
el["camo-btn"].addEventListener("click", () => Camo.toggle());
el["pause-btn"].addEventListener("click", () => togglePause());

Camo.init((active) => {
  if (active && G.screen === "running") togglePause(true);
});

function drawGround(course) {
  const y = PK.GROUND_Y;
  let cursor = G.camX - 60;
  const end = G.camX + W + 60;
  const holes = course.obstacles
    .filter((o) => o.type === "gap" || (o.type === "fake" && o.broken))
    .sort((a, b) => a.x - b.x);

  // En tramos continuos: el borde iluminado es una línea seguida, así que un
  // suelo falso intacto es indistinguible del bueno.
  const runs = [];
  for (const hole of holes) {
    if (hole.x + hole.w < cursor || hole.x > end) continue;
    if (hole.x > cursor) runs.push([cursor, hole.x]);
    cursor = Math.max(cursor, hole.x + hole.w);
  }
  if (cursor < end) runs.push([cursor, end]);

  // Los huecos deben leerse como agujeros, no como ventanas a la ciudad:
  // paredes laterales y oscuridad hacia el fondo.
  for (const hole of holes) {
    if (hole.x + hole.w < G.camX - 60 || hole.x > G.camX + W + 60) continue;
    const pit = ctx.createLinearGradient(0, y, 0, y + 90);
    pit.addColorStop(0, "rgba(4,5,10,0.92)");
    pit.addColorStop(1, "rgba(4,5,10,0.35)");
    ctx.fillStyle = pit;
    ctx.fillRect(hole.x, y, hole.w, H - y + 40);
    ctx.fillStyle = "rgba(255,200,150,0.14)";
    ctx.fillRect(hole.x, y, 2, 26);
    ctx.fillRect(hole.x + hole.w - 2, y, 2, 26);
  }

  ctx.fillStyle = INK;
  for (const [a, b] of runs) ctx.fillRect(a, y, b - a, H - y + 40);
  // Hormigón real encima de la silueta: sin esto era una mancha negra plana.
  // El contexto ya viene trasladado por la cámara, así que no hace falta scrollX.
  for (const [a, b] of runs) Tex.fillRect(ctx, a, y, b - a, H - y + 40, "concrete", { alpha: 0.68 });
  // relieve (grietas, cascotes, charcos) y filo iluminado por el sol
  for (const [a, b] of runs) Scenery.drawGroundStrip(ctx, a, b, y);
  ctx.fillStyle = "rgba(255,222,178,0.55)";
  for (const [a, b] of runs) ctx.fillRect(a, y, b - a, 2);
  ctx.fillStyle = "rgba(255,190,130,0.16)";
  for (const [a, b] of runs) ctx.fillRect(a, y + 2, b - a, 3);
}

// El sol está arriba a la derecha: todos los objetos llevan filo de luz en su
// cara superior y en la derecha. Es lo que convierte una mancha negra en un
// objeto con volumen.
const RIM_TOP = "rgba(255,226,180,0.5)";
const RIM_SIDE = "rgba(255,196,140,0.26)";

function rimLight(x, y, w, h) {
  ctx.fillStyle = RIM_TOP;
  ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = RIM_SIDE;
  ctx.fillRect(x + w - 2, y, 2, h);
}

function drawObstacles(course) {
  for (const ob of course.obstacles) {
    if (ob.x + ob.w < G.camX - 80 || ob.x > G.camX + W + 80) continue;
    if (ob.type === "gap" || ob.type === "fake") continue;

    ctx.fillStyle = INK;

    if (ob.type === "spikes") {
      const n = Math.max(3, Math.floor(ob.w / 16));
      const sw = ob.w / n;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        ctx.moveTo(ob.x + i * sw, ob.y + ob.h);
        ctx.lineTo(ob.x + i * sw + sw / 2, ob.y);
        ctx.lineTo(ob.x + (i + 1) * sw, ob.y + ob.h);
      }
      ctx.closePath();
      ctx.fill();
      const spikeTex = Tex.pattern("metal");
      if (spikeTex) { ctx.fillStyle = spikeTex; ctx.fill(); }
      ctx.strokeStyle = "rgba(255,120,90,0.9)";
      ctx.lineWidth = 2;
      ctx.stroke();
      // brillo en la punta de cada pincho
      ctx.fillStyle = "rgba(255,226,190,0.55)";
      for (let i = 0; i < n; i++) ctx.fillRect(ob.x + i * sw + sw / 2 - 1, ob.y, 2, 3);
      continue;
    }

    if (ob.type === "beam") {
      // andamio: cuerpo, cruces de arriostrado y pernos colgando
      ctx.fillRect(ob.x, ob.y, ob.w, ob.h);
      Tex.fillRect(ctx, ob.x, ob.y, ob.w, ob.h, "metal", { alpha: 0.6 });
      Tex.fillRect(ctx, ob.x, ob.y, ob.w, ob.h, "rust", { alpha: 0.22 });
      ctx.strokeStyle = "rgba(255,200,150,0.16)";
      ctx.lineWidth = 2;
      const cells = Math.max(1, Math.round(ob.w / 60));
      const cw = ob.w / cells;
      for (let i = 0; i < cells; i++) {
        const x0 = ob.x + i * cw + 5;
        const x1 = ob.x + (i + 1) * cw - 5;
        ctx.beginPath();
        ctx.moveTo(x0, ob.y + 5);
        ctx.lineTo(x1, ob.y + ob.h - 5);
        ctx.moveTo(x1, ob.y + 5);
        ctx.lineTo(x0, ob.y + ob.h - 5);
        ctx.stroke();
      }
      ctx.fillStyle = INK;
      ctx.fillRect(ob.x + 4, ob.y + ob.h, 6, 16);
      ctx.fillRect(ob.x + ob.w - 10, ob.y + ob.h, 6, 16);
      rimLight(ob.x, ob.y, ob.w, ob.h);
      continue;
    }

    if (ob.type === "wall") {
      ctx.fillRect(ob.x, ob.y, ob.w, ob.h);
      Tex.fillRect(ctx, ob.x, ob.y, ob.w, ob.h, "brick", { alpha: 0.6 });
      // ladrillo: juntas tenues, solo del lado que ve el sol
      ctx.fillStyle = "rgba(255,200,150,0.1)";
      for (let yy = ob.y + 9; yy < ob.y + ob.h - 4; yy += 11) {
        ctx.fillRect(ob.x + ob.w * 0.35, yy, ob.w * 0.65, 1);
      }
      for (let yy = ob.y + 9, row = 0; yy < ob.y + ob.h - 4; yy += 11, row++) {
        const bx = ob.x + ob.w * (row % 2 ? 0.55 : 0.75);
        ctx.fillRect(bx, yy, 1, 10);
      }
      rimLight(ob.x, ob.y, ob.w, ob.h);
      continue;
    }

    // valla de obra: dos tablones con hueco entre ellos y patas
    const plank = Math.max(9, ob.h * 0.3);
    ctx.fillRect(ob.x, ob.y, ob.w, plank);
    ctx.fillRect(ob.x, ob.y + plank * 1.75, ob.w, plank);
    ctx.fillRect(ob.x + 3, ob.y, 5, ob.h);
    ctx.fillRect(ob.x + ob.w - 8, ob.y, 5, ob.h);
    Tex.fillRect(ctx, ob.x, ob.y, ob.w, plank, "wood", { alpha: 0.65 });
    Tex.fillRect(ctx, ob.x, ob.y + plank * 1.75, ob.w, plank, "wood", { alpha: 0.65 });
    Tex.fillRect(ctx, ob.x + 3, ob.y, 5, ob.h, "metal", { alpha: 0.5 });
    Tex.fillRect(ctx, ob.x + ob.w - 8, ob.y, 5, ob.h, "metal", { alpha: 0.5 });
    rimLight(ob.x, ob.y, ob.w, plank);
    ctx.fillStyle = RIM_TOP;
    ctx.fillRect(ob.x, ob.y + plank * 1.75, ob.w, 1.5);
  }
}

function drawBody(r, opts) {
  const box = { x: r.x, y: r.y, w: r.w, h: r.h };
  if (typeof Runner !== "undefined") {
    if (opts.chaser) Runner.drawChaser(ctx, box, opts);
    else Runner.draw(ctx, box, opts);
    return;
  }
  ctx.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
  ctx.fillStyle = opts.color || INK;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.globalAlpha = 1;
}

function speedPct(v) {
  return Math.max(0, Math.min(1, (v - PK.SPEED_BASE) / (PK.SPEED_MAX - PK.SPEED_BASE)));
}

function render() {
  Scenery.drawSky(ctx, G.camX, G.t);
  ctx.save();
  ctx.translate(-Math.round(G.camX), 0);

  if (G.course) {
    drawGround(G.course);
    drawObstacles(G.course);
  }

  if (G.chaser && G.runner) {
    const cy = PK.GROUND_Y - 62;
    const glow = ctx.createRadialGradient(G.chaser.x + 15, cy + 30, 4, G.chaser.x + 15, cy + 30, 120);
    glow.addColorStop(0, "rgba(220,60,50,0.34)");
    glow.addColorStop(1, "rgba(220,60,50,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(G.chaser.x - 110, cy - 80, 250, 220);
    drawBody({ x: G.chaser.x, y: cy, w: 34, h: 62 }, {
      chaser: true, pose: "run", t: G.t, speed: speedPct(G.chaser.speed), facing: 1, color: INK,
    });
  }

  if (G.ghost && !G.ghost.done) {
    const gr = G.ghost.runner;
    drawBody(gr, {
      pose: gr.pose, t: G.t, speed: speedPct(gr.speed), facing: 1,
      color: G.ghostIsRival ? "#b48be0" : "#5aa9e6", alpha: 0.45,
    });
  }

  if (G.runner && !G.runner.dead) {
    drawBody(G.runner, {
      pose: G.runner.pose, t: G.t, speed: speedPct(G.runner.speed), facing: 1,
      phase: G.runner.vaultT > 0 ? 1 - G.runner.vaultT / PK.VAULT_TIME
        : G.runner.rollT > 0 ? 1 - G.runner.rollT / PK.ROLL_TIME : 0,
      color: INK,
    });
  }

  FX.draw(ctx);
  ctx.restore();

  // Delante de todo: cables y farolas cruzando, y polvo flotando en la luz.
  Scenery.drawOverhead(ctx, G.camX);
  Scenery.drawMotes(ctx, G.camX, G.t);
  FX.drawScreen(ctx, W, H);
  // Grano de película sutilísimo: rompe el degradado plano del cielo sin coste.
  if (typeof Tex !== "undefined") Tex.grain(ctx, W, H, 0.035);
}

// ---------------------------------------------------------------------------
// Eventos -> sonido y efectos
// ---------------------------------------------------------------------------
// Un truco limpio no solo da velocidad: le saca metros al perseguidor. Es lo
// que hace que jugar con estilo se note de verdad en la distancia final.
function trickReward(ev) {
  if (G.chaser) G.chaser.x -= 30;
  FX.floatText(ev.x, ev.y - 16, "+", { color: "#ffd89a", size: 15 });
}

function consumeEvents() {
  for (const ev of G.events) {
    switch (ev.name) {
      case "jump": Sfx.play("jump"); break;
      case "vault":
        Sfx.play("jump", { pitch: 1.2 });
        FX.dust(ev.x + 20, PK.GROUND_Y, { count: 8, color: "#ffcf9a" });
        trickReward(ev);
        break;
      case "wallJump":
        Sfx.play("spring", { volume: 0.7 });
        FX.dust(ev.x, ev.y + 40, { count: 10, color: "#ffcf9a" });
        trickReward(ev);
        break;
      case "slide":
        Sfx.play("crumble", { volume: 0.5 });
        FX.dust(ev.x, PK.GROUND_Y, { count: 10, color: "#ffcf9a" });
        break;
      case "roll":
        Sfx.play("land", { volume: 0.7 });
        FX.dust(ev.x, PK.GROUND_Y, { count: 12, color: "#ffcf9a" });
        trickReward(ev);
        break;
      case "land":
        if (Math.abs(ev.vy || 0) > 500) {
          Sfx.play("land");
          FX.dust(ev.x, PK.GROUND_Y, { count: 8, color: "#ffcf9a" });
        }
        break;
      case "fakeBreak":
        Sfx.play("crumble");
        FX.debris(ev.x - 40, PK.GROUND_Y, 80, 24, { color: "#1a1d2b", count: 12 });
        FX.shake(5, 0.18);
        break;
      case "stumble":
        Sfx.play("trapReveal", { volume: 0.8 });
        FX.shake(7, 0.22);
        FX.hitstop(0.05);
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
  G.events.length = 0;
}

// ---------------------------------------------------------------------------
// Bucle
// ---------------------------------------------------------------------------
function tick(now) {
  requestAnimationFrame(tick);
  let dt = (now - G.last) / 1000;
  G.last = now;
  dt = Math.min(dt, 0.2);
  G.t += dt;
  FX.update(dt);

  const camo = Camo.isActive();
  if (G.screen === "running" && !camo && !FX.isHitstopped()) {
    G.acc += dt;
    let steps = 0;
    while (G.acc >= PK.STEP && steps < 6) {
      recordRunFrame(G.rec, G.input);
      stepRunner(G.runner, G.input, G.course, PK.STEP, G.events);
      if (G.ghost) stepRunGhost(G.ghost, PK.STEP);
      const caught = stepChaser(G.chaser, G.runner, PK.STEP);
      G.acc -= PK.STEP;
      steps++;

      if (G.runner.dead) { consumeEvents(); finishRun(false); break; }
      if (caught) {
        G.runner.caught = true;
        Sfx.play("death");
        FX.shake(10, 0.3);
        finishRun(true);
        break;
      }
    }
    consumeEvents();

    const target = G.runner.x - W * 0.32;
    G.camX += (target - G.camX) * Math.min(1, dt * 9);

    el["hud-dist"].textContent = Math.floor(G.runner.distance / 10) + " m";
    el["hud-speed"].textContent = Math.round(speedPct(G.runner.speed) * 100) + "%";
    el["hud-tricks"].textContent = G.runner.tricks;
    const lead = Math.max(0, Math.min(1, (G.runner.x - G.chaser.x) / PK.LEAD_MAX));
    el.gapbar.style.width = (lead * 100).toFixed(0) + "%";
    el.gapbar.style.background = lead < 0.25 ? "#e5533d" : lead < 0.5 ? "#e8a33d" : "#54c98a";
  } else {
    G.acc = 0;
  }

  if (!camo) {
    const shake = FX.shakeOffset();
    ctx.save();
    ctx.translate(shake.x, shake.y);
    render();
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
Scenery.init(W, H, PK.GROUND_Y);
Sfx.init();
el["mute-btn"].textContent = Sfx.isMuted() ? "Sonido: no" : "Sonido: sí";
el["mute-btn"].classList.toggle("on", !Sfx.isMuted());
el["ghost-btn"].textContent = "Fantasmas: sí";
el["ghost-btn"].classList.add("on");

Ads.init().finally(() => {
  goMenu();
  requestAnimationFrame(tick);
});
