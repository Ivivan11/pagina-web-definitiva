// Orquestador: máquina de estados, cámara, bucle de juego, y el pegamento
// entre el motor determinista y las capas de presentación (Theme, FX, Sfx).

const CANVAS_W = 960;
const CANVAS_H = 540;
const DEATHS_PER_AD = 6;
const DEATHS_BEFORE_SKIP_OFFER = 8;
const DEATH_FREEZE = 0.5; // segundos de secuencia de muerte antes de reaparecer
const STORAGE_PREFIX = "camuflaje.v1.level.";
const STORAGE_TOTAL = "camuflaje.v1.totalDeaths";
const STORAGE_GHOSTS = "camuflaje.v1.ghosts";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d", { alpha: false });

const els = {};
[
  "hud", "hud-level", "hud-deaths", "hud-timer", "hud-best", "hud-ghost",
  "camo-btn", "mute-btn", "pause-btn", "game-wrap", "hint-banner",
  "menu-overlay", "level-grid", "menu-stats", "challenge-input",
  "challenge-load-btn", "challenge-status", "complete-overlay", "complete-title",
  "complete-time", "complete-best", "share-btn", "next-btn", "menu-btn-complete",
  "pause-overlay", "resume-btn", "restart-btn", "menu-btn-pause", "ghost-toggle",
  "skip-bar", "skip-btn", "transition", "touch-controls", "touch-left",
  "touch-right", "touch-jump", "death-flash-text",
].forEach((id) => {
  els[id] = document.getElementById(id);
});

const state = {
  screen: "menu", // menu | playing | dying | complete | paused
  levelIndex: 0,
  level: null,
  player: null,
  recorder: null,
  ownGhost: null,
  rivalGhost: null,
  pendingRival: null,
  input: { left: false, right: false, jump: false },
  deathsThisLevel: 0,
  deathsTotal: 0,
  elapsed: 0,
  dyingTimer: 0,
  camX: 0,
  bgTime: 0,
  lastRunCode: null,
  ghostsEnabled: true,
  transitioning: false,
};

const DEATH_MESSAGES = {
  fake: ["Parecía suelo.", "Era idéntica. Y mentía.", "Esa baldosa te odia.", "Confiaste. Error."],
  flip: ["Se dio la vuelta.", "El suelo te traicionó.", "Demasiado lento."],
  spikes: ["Pinchos. Clásico.", "Ay.", "Eso ha tenido que doler."],
  fall: ["Al vacío.", "Abajo no había nada.", "La gravedad gana otra vez."],
  slam: ["Aplastado.", "Lo que cuelga, cae.", "Deberías haber corrido."],
};

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------
function safeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw;
  } catch (e) {
    return fallback;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    /* almacenamiento bloqueado: se juega igual, solo no se guarda */
  }
}

function loadStat(i) {
  try {
    const raw = safeGet(STORAGE_PREFIX + i, null);
    if (!raw) return { deaths: 0, bestTimeMs: null, bestReplay: null, done: false };
    return JSON.parse(raw);
  } catch (e) {
    return { deaths: 0, bestTimeMs: null, bestReplay: null, done: false };
  }
}

function saveStat(i, stat) {
  safeSet(STORAGE_PREFIX + i, JSON.stringify(stat));
}

function formatTime(ms) {
  if (ms == null) return "--:--";
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  const s = (total % 60).toFixed(2);
  return `${m}:${s.padStart(5, "0")}`;
}

function show(el) {
  if (el) el.classList.remove("hidden");
}
function hide(el) {
  if (el) el.classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Transiciones de pantalla
// ---------------------------------------------------------------------------
function transition(midpoint) {
  if (state.transitioning) {
    midpoint();
    return;
  }
  state.transitioning = true;
  els["transition"].classList.add("cover");
  setTimeout(() => {
    midpoint();
    els["transition"].classList.remove("cover");
    setTimeout(() => (state.transitioning = false), 260);
  }, 240);
}

// ---------------------------------------------------------------------------
// Menú
// ---------------------------------------------------------------------------
function renderMenu() {
  const grid = els["level-grid"];
  grid.innerHTML = "";
  let completed = 0;

  LEVEL_DEFS.forEach((def, i) => {
    const stat = loadStat(i);
    if (stat.done) completed++;
    const btn = document.createElement("button");
    btn.className = "level-btn" + (stat.done ? " done" : "");
    btn.style.animationDelay = `${Math.min(i * 28, 400)}ms`;
    btn.innerHTML =
      `<span class="level-num">${String(i + 1).padStart(2, "0")}</span>` +
      `<span class="level-info"><span class="level-name">${def.name}</span>` +
      `<span class="level-best">${stat.done ? formatTime(stat.bestTimeMs) : "sin superar"}</span></span>` +
      (stat.done ? '<span class="level-check">✓</span>' : "");
    btn.addEventListener("click", () => {
      Sfx.unlock();
      Sfx.play("click");
      transition(() => startLevel(i));
    });
    grid.appendChild(btn);
  });

  els["menu-stats"].textContent =
    `${completed}/${LEVEL_DEFS.length} niveles superados · ${state.deathsTotal} muertes acumuladas`;
}

function goToMenu() {
  state.screen = "menu";
  Ads.notifyGameplayStop();
  FX.reset();
  hide(els["hud"]);
  hide(els["game-wrap"]);
  hide(els["complete-overlay"]);
  hide(els["pause-overlay"]);
  hide(els["skip-bar"]);
  renderMenu();
  show(els["menu-overlay"]);
}

// ---------------------------------------------------------------------------
// Ciclo de vida de un nivel
// ---------------------------------------------------------------------------
function makeGhost(index, code) {
  if (!code) return null;
  const decoded = decodeReplay(code);
  if (!decoded || decoded.levelIndex !== index) return null;
  return createGhost(index, decoded.frames);
}

function loadLevel(index, isRetry) {
  state.levelIndex = index;
  state.level = buildLevel(index);
  state.player = createPlayer(state.level.spawn);
  state.recorder = createRecorder();
  state.elapsed = 0;
  state.dyingTimer = 0;
  FX.reset();

  const stat = loadStat(index);
  if (state.ghostsEnabled) {
    state.ownGhost = makeGhost(index, stat.bestReplay);
    state.rivalGhost = makeGhost(index, state.pendingRival);
  } else {
    state.ownGhost = null;
    state.rivalGhost = null;
  }

  state.camX = Math.max(0, Math.min(state.player.x - CANVAS_W / 2, state.level.width - CANVAS_W));

  els["hud-level"].textContent = state.level.name;
  els["hud-best"].textContent = "Mejor " + formatTime(stat.bestTimeMs);
  els["hud-ghost"].textContent = state.rivalGhost ? "Reto activo" : "";
  updateDeathHud();

  if (!isRetry) {
    els["hint-banner"].textContent = state.level.hint;
    els["hint-banner"].classList.add("show");
    setTimeout(() => els["hint-banner"].classList.remove("show"), 2800);
    if (state.rivalGhost) FX.floatText(state.player.x, state.player.y - 30, "¡Reto!", { color: "#b48be0" });
  }

  FX.burst(state.player.x + state.player.w / 2, state.player.y + state.player.h, {
    count: 12,
    color: "#f5c451",
    speed: 130,
    spread: Math.PI * 2,
    life: 0.4,
    size: 3,
  });

  state.screen = "playing";
  Ads.notifyGameplayStart();
}

function startLevel(index) {
  state.deathsThisLevel = 0;
  hide(els["menu-overlay"]);
  hide(els["complete-overlay"]);
  hide(els["pause-overlay"]);
  hide(els["skip-bar"]);
  show(els["hud"]);
  show(els["game-wrap"]);
  loadLevel(index, false);
}

function updateDeathHud() {
  const n = state.deathsThisLevel;
  els["hud-deaths"].textContent = n === 0 ? "Sin morir" : `${n} muerte${n === 1 ? "" : "s"}`;
  els["hud-deaths"].classList.toggle("clean", n === 0);
}

function onDeath() {
  state.screen = "dying";
  state.dyingTimer = DEATH_FREEZE;
  state.deathsThisLevel++;
  state.deathsTotal++;
  safeSet(STORAGE_TOTAL, String(state.deathsTotal));

  const stat = loadStat(state.levelIndex);
  stat.deaths = (stat.deaths || 0) + 1;
  saveStat(state.levelIndex, stat);

  updateDeathHud();

  const cause = state.player.deathCause || "fall";
  const pool = DEATH_MESSAGES[cause] || DEATH_MESSAGES.fall;
  els["death-flash-text"].textContent = pool[Math.floor(Math.random() * pool.length)];
  els["death-flash-text"].classList.add("show");
  setTimeout(() => els["death-flash-text"].classList.remove("show"), 900);

  if (state.deathsThisLevel >= DEATHS_BEFORE_SKIP_OFFER) show(els["skip-bar"]);
}

function respawn() {
  const needsAd = state.deathsTotal > 0 && state.deathsTotal % DEATHS_PER_AD === 0;
  if (needsAd) {
    Ads.notifyGameplayStop();
    Ads.showInterstitial(() => loadLevel(state.levelIndex, true));
  } else {
    loadLevel(state.levelIndex, true);
  }
}

function onComplete() {
  state.screen = "complete";
  Ads.notifyGameplayStop();
  Sfx.play("win");
  FX.burst(state.level.goal.x + 20, state.level.goal.y + 40, {
    count: 46,
    colors: ["#2ecc71", "#f5c451", "#5aa9e6", "#ffffff"],
    speed: 260,
    spread: Math.PI * 2,
    gravity: 420,
    life: 1.1,
    size: 5,
  });
  FX.shake(6, 0.25);

  const finalMs = state.elapsed * 1000;
  const stat = loadStat(state.levelIndex);
  const improved = stat.bestTimeMs == null || finalMs < stat.bestTimeMs;
  if (improved) {
    stat.bestTimeMs = finalMs;
    stat.bestReplay = encodeReplay(state.levelIndex, state.recorder.frames);
  }
  stat.done = true;
  saveStat(state.levelIndex, stat);
  state.lastRunCode = stat.bestReplay;

  const isLast = state.levelIndex === LEVEL_DEFS.length - 1;
  els["complete-title"].textContent = isLast ? "¡Te lo has pasado entero!" : improved ? "¡Nuevo récord!" : "¡Superado!";
  els["complete-time"].textContent = formatTime(finalMs);

  if (isLast) {
    let done = 0;
    let total = 0;
    for (let i = 0; i < LEVEL_DEFS.length; i++) {
      const s = loadStat(i);
      if (s.done) done++;
      if (s.bestTimeMs != null) total += s.bestTimeMs;
    }
    els["complete-best"].textContent =
      `${done}/${LEVEL_DEFS.length} niveles · ${formatTime(total)} sumando tus récords · ${state.deathsTotal} muertes en total`;
  } else {
    els["complete-best"].textContent =
      `Mejor ${formatTime(stat.bestTimeMs)} · ${state.deathsThisLevel} muerte${state.deathsThisLevel === 1 ? "" : "s"}`;
  }
  els["next-btn"].textContent = isLast ? "Volver al menú" : "Siguiente nivel";

  setTimeout(() => show(els["complete-overlay"]), 420);
}

function goToNextLevel() {
  const isLast = state.levelIndex === LEVEL_DEFS.length - 1;
  Sfx.play("click");
  if (isLast) transition(goToMenu);
  else transition(() => startLevel(state.levelIndex + 1));
}

function skipLevelWithAd() {
  Ads.notifyGameplayStop();
  Ads.showRewarded(
    () => {
      const stat = loadStat(state.levelIndex);
      stat.done = true;
      saveStat(state.levelIndex, stat);
      hide(els["skip-bar"]);
      goToNextLevel();
    },
    () => {
      Ads.notifyGameplayStart();
    }
  );
}

function togglePause(force) {
  const shouldPause = force !== undefined ? force : state.screen === "playing";
  if (shouldPause && state.screen === "playing") {
    state.screen = "paused";
    Ads.notifyGameplayStop();
    show(els["pause-overlay"]);
  } else if (!shouldPause && state.screen === "paused") {
    state.screen = "playing";
    Ads.notifyGameplayStart();
    hide(els["pause-overlay"]);
  }
}

async function copyChallengeCode() {
  if (!state.lastRunCode) return;
  try {
    await navigator.clipboard.writeText(state.lastRunCode);
    els["share-btn"].textContent = "¡Copiado! Pásaselo a alguien";
  } catch (e) {
    els["challenge-status"].textContent = state.lastRunCode;
    els["share-btn"].textContent = "Copia el código de abajo";
  }
  setTimeout(() => (els["share-btn"].textContent = "Retar a un compañero"), 2400);
}

function loadChallengeCode() {
  const code = els["challenge-input"].value.trim();
  const decoded = decodeReplay(code);
  if (!decoded || !LEVEL_DEFS[decoded.levelIndex]) {
    els["challenge-status"].textContent = "Ese código no vale. ¿Lo copiaste entero?";
    return;
  }
  state.pendingRival = code;
  Sfx.play("ghost");
  els["challenge-status"].textContent = `Reto aceptado en "${LEVEL_DEFS[decoded.levelIndex].name}".`;
  transition(() => startLevel(decoded.levelIndex));
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------
const KEY_ACTIONS = {
  ArrowLeft: "left", a: "left", A: "left",
  ArrowRight: "right", d: "right", D: "right",
  ArrowUp: "jump", w: "jump", W: "jump", " ": "jump",
};

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  Sfx.unlock();

  const action = KEY_ACTIONS[e.key];
  if (action) {
    state.input[action] = true;
    if (e.key === " " || e.key.startsWith("Arrow")) e.preventDefault();
  }

  if (e.key === "Escape") {
    if (state.screen === "playing" || state.screen === "paused") togglePause();
  }
  if (e.key === "r" || e.key === "R") {
    if (state.screen === "playing") loadLevel(state.levelIndex, true);
  }
  if (e.key === " " && state.screen === "complete") goToNextLevel();
  if (e.key === "m" || e.key === "M") toggleMute();
});

window.addEventListener("keyup", (e) => {
  const action = KEY_ACTIONS[e.key];
  if (action) state.input[action] = false;
});

window.addEventListener("blur", () => {
  state.input.left = state.input.right = state.input.jump = false;
  if (state.screen === "playing") togglePause(true);
});

function bindTouch(el, action) {
  if (!el) return;
  const set = (v) => (e) => {
    e.preventDefault();
    Sfx.unlock();
    state.input[action] = v;
  };
  el.addEventListener("pointerdown", set(true));
  el.addEventListener("pointerup", set(false));
  el.addEventListener("pointercancel", set(false));
  el.addEventListener("pointerleave", set(false));
}

bindTouch(els["touch-left"], "left");
bindTouch(els["touch-right"], "right");
bindTouch(els["touch-jump"], "jump");

if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
  show(els["touch-controls"]);
}

function toggleMute() {
  const muted = Sfx.toggleMuted();
  els["mute-btn"].textContent = muted ? "Sonido: no" : "Sonido: sí";
  els["mute-btn"].classList.toggle("active", !muted);
  if (muted) {
    Sfx.stopMusic();
  } else {
    Sfx.play("click");
    Sfx.startMusic();
  }
}

els["camo-btn"].addEventListener("click", () => Camo.toggle());
els["mute-btn"].addEventListener("click", toggleMute);
els["pause-btn"].addEventListener("click", () => togglePause());
els["resume-btn"].addEventListener("click", () => togglePause(false));
els["restart-btn"].addEventListener("click", () => {
  togglePause(false);
  loadLevel(state.levelIndex, true);
});
els["menu-btn-pause"].addEventListener("click", () => transition(goToMenu));
els["menu-btn-complete"].addEventListener("click", () => transition(goToMenu));
els["next-btn"].addEventListener("click", goToNextLevel);
els["share-btn"].addEventListener("click", copyChallengeCode);
els["challenge-load-btn"].addEventListener("click", loadChallengeCode);
els["challenge-input"].addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadChallengeCode();
});
els["skip-btn"].addEventListener("click", skipLevelWithAd);
els["ghost-toggle"].addEventListener("click", () => {
  state.ghostsEnabled = !state.ghostsEnabled;
  els["ghost-toggle"].textContent = state.ghostsEnabled ? "Fantasmas: sí" : "Fantasmas: no";
  els["ghost-toggle"].classList.toggle("active", state.ghostsEnabled);
  if (!state.ghostsEnabled) {
    state.ownGhost = null;
    state.rivalGhost = null;
  }
});

Camo.init((active) => {
  if (active && state.screen === "playing") togglePause(true);
});

// ---------------------------------------------------------------------------
// Eventos del motor -> sonido y efectos
// ---------------------------------------------------------------------------
function consumeEvents(level) {
  for (const ev of level.events) {
    switch (ev.name) {
      case "jump":
        Sfx.play("jump");
        FX.dust(ev.x, ev.y, { count: 6, color: "#8892a4", dir: 0 });
        break;
      case "land": {
        const hard = Math.abs((ev.extra && ev.extra.speed) || 0) > 520;
        Sfx.play("land", { volume: hard ? 1 : 0.6 });
        FX.dust(ev.x, ev.y, { count: hard ? 12 : 5, color: "#8892a4" });
        if (hard) FX.shake(2.5, 0.1);
        break;
      }
      case "crumbleStart":
        Sfx.play("crumble", { volume: 0.7 });
        FX.dust(ev.x, ev.y, { count: 5, color: "#6b5a45" });
        break;
      case "crumbleBreak":
        Sfx.play("crumble");
        FX.debris(ev.extra.cx, ev.extra.cy, ev.extra.w, 26, { color: "#6b5a45", count: 10 });
        break;
      case "trapReveal":
        Sfx.play("trapReveal");
        FX.shake(4, 0.12);
        break;
      case "spring":
        Sfx.play("spring");
        FX.burst(ev.x, ev.y, { count: 14, color: "#5aa9e6", speed: 200, spread: 2.2, angle: -Math.PI / 2, life: 0.5 });
        break;
      case "slamStart":
        Sfx.play("trapReveal", { volume: 0.5 });
        break;
      case "slamLand":
        Sfx.play("slam");
        FX.shake(9, 0.3);
        FX.dust(ev.x, ev.y, { count: 18, color: "#8892a4" });
        break;
      case "dropStart":
        Sfx.play("trapReveal", { volume: 0.4 });
        break;
      case "decoyEscape":
        Sfx.play("ghost");
        FX.burst(ev.x, ev.y + 40, { count: 20, color: "#2ecc71", speed: 190, spread: Math.PI * 2, life: 0.7 });
        FX.floatText(ev.x, ev.y, "¿Era esa?", { color: "#2ecc71" });
        break;
      case "death":
        Sfx.play("death");
        FX.hitstop(0.09);
        FX.shake(10, 0.32);
        FX.flash("rgba(193,57,43,0.32)", 0.16);
        FX.burst(ev.x, ev.y, {
          count: 30,
          colors: ["#f5c451", "#e8b13c", "#ffffff"],
          speed: 280,
          spread: Math.PI * 2,
          gravity: 900,
          life: 0.85,
          size: 4,
        });
        break;
      case "goal":
        FX.flash("rgba(46,204,113,0.22)", 0.2);
        break;
      default:
        break;
    }
  }
  level.events.length = 0;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function drawTiles(level) {
  for (const tile of level.platforms) {
    const rect = { x: tile.cx, y: tile.cy, w: tile.w, h: tile.h };

    if (tile.kind === "flip") {
      if (tile.flipped) {
        Theme.drawSpikes(ctx, rect, "up", state.bgTime);
      } else {
        // Antes de voltearse es indistinguible de una plataforma normal; solo
        // un temblor mínimo durante la fracción de segundo previa.
        let jitter = 0;
        if (tile.standTime !== null) jitter = (Math.random() - 0.5) * 2.2;
        Theme.drawTile(ctx, { x: rect.x + jitter, y: rect.y, w: rect.w, h: rect.h }, "solid", {
          t: state.bgTime,
        });
      }
      continue;
    }

    if (tile.kind === "crumble" && tile.broken) continue;
    if (tile.kind === "phase" && !tile.solidNow) {
      ctx.globalAlpha = tile.alpha;
      Theme.drawTile(ctx, rect, "phase", { t: state.bgTime, phaseAlpha: tile.alpha });
      ctx.globalAlpha = 1;
      continue;
    }

    Theme.drawTile(ctx, rect, tile.kind, {
      t: state.bgTime,
      broken: tile.broken,
      crumbleProgress: tile.crumbleProgress || 0,
      phaseAlpha: tile.alpha == null ? 1 : tile.alpha,
      pressed: tile.pressedUntil ? state.level.time < tile.pressedUntil : false,
      triggered: !!tile.triggered,
    });
  }
}

function drawHazards(level) {
  for (const hz of level.hazards) {
    Theme.drawSpikes(ctx, { x: hz.cx, y: hz.cy, w: hz.w, h: hz.h }, hz.dir || "up", state.bgTime);
  }
}

function groundUnder(entity, level) {
  let best = null;
  for (const tile of level.platforms) {
    if (!tileIsSolid(tile)) continue;
    if (entity.x + entity.w < tile.cx || entity.x > tile.cx + tile.w) continue;
    if (tile.cy + 1 < entity.y + entity.h) continue;
    if (best === null || tile.cy < best) best = tile.cy;
  }
  return best;
}

function render() {
  const level = state.level;
  const shake = FX.shakeOffset();

  Theme.drawBackground(ctx, state.camX, 0, CANVAS_W, CANVAS_H, state.bgTime, level ? level.tint : null);

  if (!level) return;

  ctx.save();
  ctx.translate(-Math.round(state.camX) + shake.x, shake.y);

  drawTiles(level);
  drawHazards(level);

  for (const d of level.decoys) {
    if (d.escaped) continue;
    Theme.drawGoal(ctx, d, state.bgTime, false);
  }
  Theme.drawGoal(ctx, level.goal, state.bgTime, state.screen === "complete");

  if (state.rivalGhost && !state.rivalGhost.done) {
    Theme.drawCharacter(ctx, state.rivalGhost.player, {
      color: "#b48be0", alpha: 0.5, ghost: true, facing: state.rivalGhost.player.facing,
      vx: state.rivalGhost.player.vx, vy: state.rivalGhost.player.vy,
      onGround: state.rivalGhost.player.onGround, t: state.bgTime,
    });
  }
  if (state.ownGhost && !state.ownGhost.done) {
    Theme.drawCharacter(ctx, state.ownGhost.player, {
      color: "#5aa9e6", alpha: 0.42, ghost: true, facing: state.ownGhost.player.facing,
      vx: state.ownGhost.player.vx, vy: state.ownGhost.player.vy,
      onGround: state.ownGhost.player.onGround, t: state.bgTime,
    });
  }

  const p = state.player;
  if (p && !p.dead) {
    Theme.drawShadow(ctx, p, groundUnder(p, level));
    Theme.drawCharacter(ctx, p, {
      color: "#f5c451", alpha: 1, facing: p.facing, vx: p.vx, vy: p.vy,
      onGround: p.onGround, squash: p.squash, t: state.bgTime,
    });
  }

  FX.draw(ctx);
  ctx.restore();

  FX.drawScreen(ctx, CANVAS_W, CANVAS_H);
  Theme.drawVignette(ctx, CANVAS_W, CANVAS_H, state.screen === "dying" ? 0.55 : 0.3);
}

// ---------------------------------------------------------------------------
// Bucle principal
// ---------------------------------------------------------------------------
let accumulator = 0;
let lastTime = performance.now();

function simulate(dt) {
  const level = state.level;
  recordFrame(state.recorder, state.input);
  const event = stepPlayer(state.player, state.input, level, dt);

  if (state.ownGhost) {
    stepGhost(state.ownGhost, dt);
    state.ownGhost.level.events.length = 0;
  }
  if (state.rivalGhost) {
    stepGhost(state.rivalGhost, dt);
    state.rivalGhost.level.events.length = 0;
  }

  state.elapsed += dt;
  consumeEvents(level);

  if (event === "dead") onDeath();
  else if (event === "goal") onComplete();
}

function updateCamera(dt) {
  if (!state.level || !state.player) return;
  const lookAhead = state.player.facing * 70;
  const target = state.player.x + state.player.w / 2 - CANVAS_W / 2 + lookAhead;
  const maxCam = Math.max(0, state.level.width - CANVAS_W);
  const clamped = Math.max(0, Math.min(target, maxCam));
  const smoothing = 1 - Math.exp(-7 * dt);
  state.camX += (clamped - state.camX) * smoothing;
}

function tick(now) {
  requestAnimationFrame(tick);

  let frameDt = (now - lastTime) / 1000;
  lastTime = now;
  frameDt = Math.min(frameDt, 0.2);
  state.bgTime += frameDt;

  FX.update(frameDt);

  const camoActive = Camo.isActive();
  const canSimulate = state.screen === "playing" && !camoActive && !FX.isHitstopped();

  if (state.screen === "dying" && !camoActive) {
    state.dyingTimer -= frameDt;
    if (state.dyingTimer <= 0) respawn();
  }

  // El tiempo solo se acumula cuando la simulación corre: si no, al volver de
  // una pausa (o del hitstop de una muerte) el juego daría un acelerón.
  if (canSimulate) {
    accumulator += frameDt;
    let steps = 0;
    while (accumulator >= PHYSICS.STEP && steps < 6) {
      simulate(PHYSICS.STEP);
      accumulator -= PHYSICS.STEP;
      steps++;
      if (state.screen !== "playing") break; // muerte o meta: no sigas simulando
    }
    if (accumulator > PHYSICS.STEP * 6) accumulator = 0;
  } else {
    accumulator = 0;
  }

  if (state.screen === "playing") {
    els["hud-timer"].textContent = formatTime(state.elapsed * 1000);
  }

  if (!camoActive) {
    updateCamera(frameDt);
    render();
  }
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
function boot() {
  state.deathsTotal = parseInt(safeGet(STORAGE_TOTAL, "0"), 10) || 0;
  Sfx.init();
  els["mute-btn"].textContent = Sfx.isMuted() ? "Sonido: no" : "Sonido: sí";
  els["mute-btn"].classList.toggle("active", !Sfx.isMuted());
  els["ghost-toggle"].textContent = "Fantasmas: sí";
  els["ghost-toggle"].classList.add("active");
  goToMenu();
  requestAnimationFrame(tick);
}

Ads.init().finally(boot);
