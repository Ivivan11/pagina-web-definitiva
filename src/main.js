// Controlador principal: máquina de estados (menu/playing/dead/complete),
// render en canvas, HUD y overlays en DOM, guardado en localStorage y enganche
// del módulo de anuncios en los puntos de corte naturales del juego.

const CANVAS_W = 960;
const CANVAS_H = 540;
const DEATHS_PER_AD = 4;
const DEATHS_BEFORE_SKIP_OFFER = 3;
const STORAGE_PREFIX = "camuflaje.v1.level.";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const els = {
  hud: document.getElementById("hud"),
  hudLevel: document.getElementById("hud-level"),
  hudAttempts: document.getElementById("hud-attempts"),
  hudTimer: document.getElementById("hud-timer"),
  hudBest: document.getElementById("hud-best"),
  camoBtn: document.getElementById("camo-btn"),
  gameWrap: document.getElementById("game-wrap"),
  hintBanner: document.getElementById("hint-banner"),
  menuOverlay: document.getElementById("menu-overlay"),
  levelGrid: document.getElementById("level-grid"),
  challengeInput: document.getElementById("challenge-input"),
  challengeLoadBtn: document.getElementById("challenge-load-btn"),
  challengeStatus: document.getElementById("challenge-status"),
  deathOverlay: document.getElementById("death-overlay"),
  deathText: document.getElementById("death-text"),
  retryBtn: document.getElementById("retry-btn"),
  skipBtn: document.getElementById("skip-btn"),
  menuBtnDeath: document.getElementById("menu-btn-death"),
  completeOverlay: document.getElementById("complete-overlay"),
  completeText: document.getElementById("complete-text"),
  shareBtn: document.getElementById("share-btn"),
  nextBtn: document.getElementById("next-btn"),
  menuBtnComplete: document.getElementById("menu-btn-complete"),
  interstitialOverlay: document.getElementById("interstitial-overlay"),
};

const state = {
  screen: "menu",
  levelIndex: 0,
  level: null,
  player: null,
  recorder: null,
  ownGhost: null,
  importedGhost: null,
  pendingImportedFrames: null,
  input: { left: false, right: false, jump: false },
  attempts: 0,
  elapsed: 0,
  deathsThisLevel: 0,
  deathsTotal: 0,
  lastRunReplayCode: null,
};

function loadStat(i) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + i);
    if (!raw) return { attempts: 0, bestTimeMs: null, bestReplay: null };
    return JSON.parse(raw);
  } catch (e) {
    return { attempts: 0, bestTimeMs: null, bestReplay: null };
  }
}

function saveStat(i, stat) {
  try {
    localStorage.setItem(STORAGE_PREFIX + i, JSON.stringify(stat));
  } catch (e) {
    // localStorage no disponible (privado/bloqueado): el juego sigue
    // funcionando, simplemente no persiste progreso entre sesiones.
  }
}

function formatTime(ms) {
  if (ms == null) return "--:--";
  const totalSeconds = ms / 1000;
  const m = Math.floor(totalSeconds / 60);
  const s = (totalSeconds % 60).toFixed(2);
  return `${m}:${s.padStart(5, "0")}`;
}

function show(el) {
  el.classList.remove("hidden");
}
function hide(el) {
  el.classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Menú
// ---------------------------------------------------------------------------
function renderMenu() {
  els.levelGrid.innerHTML = "";
  LEVEL_DEFS.forEach((def, i) => {
    const stat = loadStat(i);
    const btn = document.createElement("button");
    btn.className = "level-btn";
    btn.innerHTML = `<span class="level-btn-name">${def.name}</span><span class="level-btn-best">Mejor: ${formatTime(stat.bestTimeMs)}</span>`;
    btn.addEventListener("click", () => startLevel(i));
    els.levelGrid.appendChild(btn);
  });
}

function goToMenu() {
  state.screen = "menu";
  Ads.notifyGameplayStop();
  hide(els.hud);
  hide(els.gameWrap);
  hide(els.deathOverlay);
  hide(els.completeOverlay);
  renderMenu();
  show(els.menuOverlay);
}

// ---------------------------------------------------------------------------
// Ciclo de vida de un nivel
// ---------------------------------------------------------------------------
function startLevel(index) {
  state.levelIndex = index;
  state.level = buildLevel(index);
  state.player = createPlayer(state.level.spawn);
  state.recorder = createRecorder();
  state.elapsed = 0;
  state.deathsThisLevel = 0;

  const stat = loadStat(index);
  stat.attempts = (stat.attempts || 0) + 1;
  saveStat(index, stat);
  state.attempts = stat.attempts;

  state.ownGhost = stat.bestReplay ? createGhost(index, decodeReplay(stat.bestReplay).frames) : null;

  if (state.pendingImportedFrames && state.pendingImportedFrames.levelIndex === index) {
    state.importedGhost = createGhost(index, state.pendingImportedFrames.frames);
  } else {
    state.importedGhost = null;
  }

  els.hudLevel.textContent = state.level.name;
  els.hudBest.textContent = "Mejor: " + formatTime(stat.bestTimeMs);
  els.hintBanner.textContent = state.level.hint;
  els.hintBanner.classList.add("show");
  setTimeout(() => els.hintBanner.classList.remove("show"), 2600);

  hide(els.menuOverlay);
  hide(els.deathOverlay);
  hide(els.completeOverlay);
  show(els.hud);
  show(els.gameWrap);

  state.screen = "playing";
  Ads.notifyGameplayStart();
}

function retryLevel() {
  hide(els.deathOverlay);
  startLevel(state.levelIndex);
}

function handleDeath() {
  state.screen = "dead";
  state.deathsThisLevel++;
  state.deathsTotal++;
  Ads.notifyGameplayStop();

  const reveal = () => {
    els.deathText.textContent = `Muerte n.º ${state.deathsThisLevel} en este nivel. ${state.level.hint}`;
    if (state.deathsThisLevel >= DEATHS_BEFORE_SKIP_OFFER) {
      show(els.skipBtn);
    } else {
      hide(els.skipBtn);
    }
    show(els.deathOverlay);
  };

  if (state.deathsTotal % DEATHS_PER_AD === 0) {
    Ads.showInterstitial(reveal);
  } else {
    reveal();
  }
}

function skipLevelWithAd() {
  Ads.showRewarded(
    () => {
      hide(els.deathOverlay);
      goToNextLevel();
    },
    () => {
      // el jugador cerró el anuncio sin verlo entero: no hay salto de nivel.
    }
  );
}

function handleComplete() {
  state.screen = "complete";
  Ads.notifyGameplayStop();

  const finalTimeMs = state.elapsed * 1000;
  const stat = loadStat(state.levelIndex);
  let improved = false;
  if (stat.bestTimeMs == null || finalTimeMs < stat.bestTimeMs) {
    stat.bestTimeMs = finalTimeMs;
    stat.bestReplay = encodeReplay(state.levelIndex, state.recorder.frames);
    improved = true;
  }
  saveStat(state.levelIndex, stat);
  state.lastRunReplayCode = stat.bestReplay;

  const isLast = state.levelIndex === LEVEL_DEFS.length - 1;
  els.completeText.textContent = isLast
    ? `¡Nivel completado en ${formatTime(finalTimeMs)}! Has terminado todos los niveles.`
    : `¡Nivel completado en ${formatTime(finalTimeMs)}!${improved ? " Nuevo mejor tiempo." : ""}`;
  els.nextBtn.textContent = isLast ? "Volver al menú" : "Siguiente nivel";
  show(els.completeOverlay);
}

function goToNextLevel() {
  const isLast = state.levelIndex === LEVEL_DEFS.length - 1;
  hide(els.completeOverlay);
  if (isLast) {
    goToMenu();
  } else {
    startLevel(state.levelIndex + 1);
  }
}

async function copyChallengeCode() {
  const code = state.lastRunReplayCode;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    els.shareBtn.textContent = "¡Copiado!";
  } catch (e) {
    els.shareBtn.textContent = code.slice(0, 12) + "… (copia manual)";
  }
  setTimeout(() => (els.shareBtn.textContent = "Copiar código de reto"), 2000);
}

function loadChallengeCode() {
  const code = els.challengeInput.value;
  const decoded = decodeReplay(code);
  if (!decoded || !LEVEL_DEFS[decoded.levelIndex]) {
    els.challengeStatus.textContent = "Código no válido.";
    return;
  }
  state.pendingImportedFrames = decoded;
  els.challengeStatus.textContent = `Fantasma cargado para "${LEVEL_DEFS[decoded.levelIndex].name}". ¡Ábrelo para correr contra él!`;
  startLevel(decoded.levelIndex);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const KEY_MAP = {
  ArrowLeft: "left",
  a: "left",
  A: "left",
  ArrowRight: "right",
  d: "right",
  D: "right",
  ArrowUp: "jump",
  w: "jump",
  W: "jump",
  " ": "jump",
};

window.addEventListener("keydown", (e) => {
  const action = KEY_MAP[e.key];
  if (action) {
    state.input[action] = true;
    if (e.key === " " || e.key.startsWith("Arrow")) e.preventDefault();
  }
  if (e.key === " ") {
    if (state.screen === "dead") retryLevel();
    else if (state.screen === "complete") goToNextLevel();
  }
});

window.addEventListener("keyup", (e) => {
  const action = KEY_MAP[e.key];
  if (action) state.input[action] = false;
});

els.retryBtn.addEventListener("click", retryLevel);
els.skipBtn.addEventListener("click", skipLevelWithAd);
els.menuBtnDeath.addEventListener("click", goToMenu);
els.shareBtn.addEventListener("click", copyChallengeCode);
els.nextBtn.addEventListener("click", goToNextLevel);
els.menuBtnComplete.addEventListener("click", goToMenu);
els.challengeLoadBtn.addEventListener("click", loadChallengeCode);
els.camoBtn.addEventListener("click", () => Camo.toggle());

Camo.init();

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function cameraX() {
  const maxCam = Math.max(0, state.level.width - CANVAS_W);
  return Math.min(Math.max(0, state.player.x - CANVAS_W / 2), maxCam);
}

function drawPlatform(p, level) {
  const r = p.rect ? p.rect(level) : p;
  switch (p.type) {
    case "solid":
    case "fakewall": // a propósito: visualmente IDÉNTICO a "solid".
      ctx.fillStyle = "#3f4756";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = "#4b5568";
      ctx.fillRect(r.x, r.y, r.w, 6);
      break;
    case "crumble":
      ctx.fillStyle = p.broken ? "transparent" : "#6b5a45";
      if (!p.broken) {
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = "#3a2f22";
        ctx.lineWidth = 1;
        for (let cx = r.x + 10; cx < r.x + r.w; cx += 22) {
          ctx.beginPath();
          ctx.moveTo(cx, r.y);
          ctx.lineTo(cx - 5, r.y + r.h);
          ctx.stroke();
        }
      }
      break;
    case "moving":
      ctx.fillStyle = "#3c6e71";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = "#57a0a3";
      ctx.fillRect(r.x, r.y, r.w, 4);
      break;
  }
}

function drawHazard(h, level) {
  const r = h.rect ? h.rect(level) : h;
  ctx.fillStyle = "#c1392b";
  const spikeW = 10;
  for (let sx = r.x; sx < r.x + r.w; sx += spikeW) {
    ctx.beginPath();
    ctx.moveTo(sx, r.y + r.h);
    ctx.lineTo(sx + spikeW / 2, r.y);
    ctx.lineTo(sx + spikeW, r.y + r.h);
    ctx.closePath();
    ctx.fill();
  }
}

function drawCharacter(p, color, alpha) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(p.x, p.y, p.w, p.h);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillRect(p.x + p.w - 10, p.y + 8, 5, 5);
  ctx.globalAlpha = 1;
}

function render() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = "#1b2230";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  if (state.screen === "menu" || !state.level) return;

  const camX = cameraX();
  ctx.save();
  ctx.translate(-camX, 0);

  for (const p of state.level.platforms) drawPlatform(p, state.level);
  for (const h of state.level.hazards) drawHazard(h, state.level);

  const g = state.level.goal;
  ctx.fillStyle = "#2ecc71";
  ctx.fillRect(g.x, g.y, 6, g.h);
  ctx.fillStyle = "#27ae60";
  ctx.beginPath();
  ctx.moveTo(g.x + 6, g.y);
  ctx.lineTo(g.x + g.w, g.y + g.h * 0.25);
  ctx.lineTo(g.x + 6, g.y + g.h * 0.5);
  ctx.closePath();
  ctx.fill();

  if (state.importedGhost) drawCharacter(state.importedGhost.player, "#b48be0", 0.55);
  if (state.ownGhost) drawCharacter(state.ownGhost.player, "#5aa9e6", 0.55);
  if (state.player) drawCharacter(state.player, "#f5c451", 1);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Loop principal (paso fijo para físicas deterministas)
// ---------------------------------------------------------------------------
let accumulator = 0;
let lastTime = performance.now();

function tick(now) {
  requestAnimationFrame(tick);
  let frameDt = (now - lastTime) / 1000;
  lastTime = now;
  frameDt = Math.min(frameDt, 0.25);
  accumulator += frameDt;

  const camoActive = typeof Camo !== "undefined" && Camo.isActive();

  let steps = 0;
  while (accumulator >= PHYSICS.STEP && steps < 8) {
    if (state.screen === "playing" && !camoActive) {
      recordFrame(state.recorder, state.input);
      const event = stepPlayer(state.player, state.input, state.level, PHYSICS.STEP);
      if (state.ownGhost) stepGhost(state.ownGhost, PHYSICS.STEP);
      if (state.importedGhost) stepGhost(state.importedGhost, PHYSICS.STEP);
      state.elapsed += PHYSICS.STEP;
      if (event === "dead") handleDeath();
      else if (event === "goal") handleComplete();
    }
    accumulator -= PHYSICS.STEP;
    steps++;
  }

  if (state.screen === "playing" && !camoActive) {
    els.hudAttempts.textContent = "Intento " + state.attempts;
    els.hudTimer.textContent = formatTime(state.elapsed * 1000);
  }

  if (!camoActive) render();
}

Ads.init().finally(() => {
  requestAnimationFrame(tick);
  goToMenu();
});
