// Efectos visuales: partículas, temblor de pantalla, hitstop, flashes y texto flotante.
// Todo es puramente estético (no toca la física determinista), así que aquí se usa
// Math.random() sin problema. Pool preasignado: nunca se crean objetos en caliente.

const FX = (() => {
  const MAX_PARTICLES = 520;   // tope del pool; al pasarse se recicla la más vieja
  const MAX_TEXTS = 16;
  const MAX_BUCKETS = 12;      // nº de colores agrupados por frame
  const TAU = Math.PI * 2;
  const NOPTS = {};            // opts por defecto, evita crear {} en cada llamada

  // Tipos de partícula
  const K_SQUARE = 0;
  const K_CIRCLE = 1;
  const K_DEBRIS = 2;

  // Colores por defecto (paleta del juego)
  const C_PLAYER = "#f5c451";
  const C_DUST = "#8a94a6";
  const C_WOOD = "#6b5a45";

  // ---------- utilidades ----------
  function num(v, d) {
    return Number.isFinite(v) ? v : d;
  }
  function clampNum(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
  function intIn(v, d, lo, hi) {
    return clampNum(num(v, d), lo, hi) | 0;
  }
  function rnd(a, b) {
    return a + Math.random() * (b - a);
  }
  function str(v, d) {
    return typeof v === "string" && v.length > 0 ? v : d;
  }
  function pickColor(o, d) {
    const list = o.colors;
    if (Array.isArray(list) && list.length > 0) {
      const c = list[(Math.random() * list.length) | 0];
      if (typeof c === "string" && c.length > 0) return c;
    }
    return str(o.color, d);
  }

  // ---------- pool de partículas ----------
  const pool = new Array(MAX_PARTICLES);
  for (let i = 0; i < MAX_PARTICLES; i++) {
    pool[i] = {
      a: false,       // viva
      k: K_SQUARE,    // tipo
      x: 0, y: 0, vx: 0, vy: 0,
      g: 0,           // gravedad px/s²
      dr: 0,          // rozamiento (1/s)
      life: 0, ml: 1, // vida restante / vida total
      s: 3,           // lado o diámetro
      w: 0, h: 0,     // sólo escombros
      rot: 0, vr: 0,
      shrink: 0,      // 0 = tamaño fijo, 1 = encoge hasta 0
      hold: 0.45,     // fracción de vida con alfa 1 antes de desvanecer
      col: C_PLAYER,
      b: -1,          // grupo de color del frame actual
    };
  }
  let live = 0;
  let cursor = 0;

  // Busca hueco desde el cursor; si está todo lleno recicla la más vieja.
  function alloc() {
    if (live < MAX_PARTICLES) {
      let i = cursor;
      for (let n = 0; n < MAX_PARTICLES; n++) {
        const p = pool[i];
        i++;
        if (i === MAX_PARTICLES) i = 0;
        if (!p.a) {
          cursor = i;
          p.a = true;
          live++;
          return p;
        }
      }
    }
    const p = pool[cursor];
    cursor++;
    if (cursor === MAX_PARTICLES) cursor = 0;
    p.a = true;
    return p;
  }

  // Valores comunes a cada emisión, para no olvidar campos entre tipos.
  function initCommon(p, x, y, col) {
    p.x = x; p.y = y;
    p.w = 0; p.h = 0;
    p.rot = 0; p.vr = 0;
    p.col = col;
    p.b = -1;
  }

  // ---------- pool de textos ----------
  const texts = new Array(MAX_TEXTS);
  for (let i = 0; i < MAX_TEXTS; i++) {
    texts[i] = { a: false, x: 0, y: 0, vy: 0, life: 0, ml: 1, size: 14, col: C_PLAYER, txt: "", scr: false };
  }
  let liveTexts = 0;
  let textCursor = 0;

  function allocText() {
    for (let n = 0; n < MAX_TEXTS; n++) {
      const t = texts[textCursor];
      textCursor++;
      if (textCursor === MAX_TEXTS) textCursor = 0;
      if (!t.a) {
        t.a = true;
        liveTexts++;
        return t;
      }
    }
    const t = texts[textCursor];
    textCursor++;
    if (textCursor === MAX_TEXTS) textCursor = 0;
    return t;
  }

  // ---------- estado de pantalla ----------
  let shakeAmp = 0, shakeT = 0, shakeDur = 0, shakePhase = 0, seedA = 0, seedB = 0;
  const shk = { x: 0, y: 0 };   // objeto reutilizado: no se asigna memoria por frame
  let hitstopT = 0;
  let flashCol = "#ffffff", flashT = 0, flashDur = 1;
  let vignCol = "#c1392b", vignT = 0, vignDur = 1;

  // ---------- emisores ----------
  function burst(x, y, opts) {
    const o = opts || NOPTS;
    const px = num(x, 0), py = num(y, 0);
    const count = intIn(o.count, 14, 0, 120);
    const speed = num(o.speed, 220);
    const spread = num(o.spread, TAU);
    const angle = num(o.angle, -Math.PI / 2);
    const g = num(o.gravity, 900);
    const life = clampNum(num(o.life, 0.55), 0.05, 6);
    const size = clampNum(num(o.size, 3), 0.5, 40);
    const drag = clampNum(num(o.drag, 1.1), 0, 20);
    const kind = o.shape === "circle" ? K_CIRCLE : K_SQUARE;
    for (let i = 0; i < count; i++) {
      const p = alloc();
      const ang = angle + (Math.random() - 0.5) * spread;
      const sp = speed * (0.45 + Math.random() * 0.75);
      initCommon(p, px, py, pickColor(o, C_PLAYER));
      p.k = kind;
      p.vx = Math.cos(ang) * sp;
      p.vy = Math.sin(ang) * sp;
      p.g = g;
      p.dr = drag;
      p.ml = p.life = life * (0.7 + Math.random() * 0.6);
      p.s = size * (0.6 + Math.random() * 0.8);
      p.shrink = 0.85;
      p.hold = 0.45;
    }
  }

  // Polvillo de aterrizaje/carrera: bajo, corto y discreto. dir -1/0/1.
  function dust(x, y, opts) {
    const o = opts || NOPTS;
    const px = num(x, 0), py = num(y, 0);
    const count = intIn(o.count, 6, 0, 40);
    const dir = clampNum(num(o.dir, 0), -1, 1);
    const col = pickColor(o, C_DUST);
    for (let i = 0; i < count; i++) {
      const p = alloc();
      initCommon(p, px + rnd(-5, 5), py + rnd(-2, 2), col);
      p.k = K_SQUARE;
      p.vx = dir * rnd(25, 95) + rnd(-28, 28);
      p.vy = -rnd(10, 65);
      p.g = 200;
      p.dr = 2.6;
      p.ml = p.life = rnd(0.22, 0.45);
      p.s = rnd(2, 4.5);
      p.shrink = 1;
      p.hold = 0.35;
    }
  }

  // Trozos de una plataforma rota: se parte el rect en una rejilla que cae y gira.
  function debris(x, y, w, h, opts) {
    const o = opts || NOPTS;
    const rx = num(x, 0), ry = num(y, 0);
    const rw = clampNum(num(w, 24), 2, 4000);
    const rh = clampNum(num(h, 24), 2, 4000);
    const count = intIn(o.count, 8, 1, 40);
    let cols = Math.round(Math.sqrt(count * (rw / rh)));
    if (cols < 1) cols = 1;
    if (cols > count) cols = count;
    let rows = Math.ceil(count / cols);
    if (rows < 1) rows = 1;
    const pw = rw / cols, ph = rh / rows;
    const speed = num(o.speed, 170);
    const g = num(o.gravity, 1150);
    const life = clampNum(num(o.life, 0.9), 0.1, 6);
    const cx = rx + rw * 0.5, cy = ry + rh * 0.5;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const p = alloc();
        const bx = rx + c * pw + pw * 0.5;
        const by = ry + r * ph + ph * 0.5;
        initCommon(p, bx, by, pickColor(o, C_WOOD));
        p.k = K_DEBRIS;
        const dx = bx - cx, dy = by - cy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        p.vx = (dx / len) * speed * rnd(0.5, 1.3) + rnd(-30, 30);
        p.vy = (dy / len) * speed * 0.4 - rnd(70, 230);
        p.w = pw;
        p.h = ph;
        p.g = g;
        p.dr = 0.25;
        p.ml = p.life = life * rnd(0.75, 1.25);
        p.vr = rnd(-7, 7);
        p.shrink = 0;
        p.hold = 0.5;
      }
    }
  }

  // Estela: cuadraditos que se apagan enseguida. vx/vy = velocidad del jugador.
  function trail(x, y, opts) {
    const o = opts || NOPTS;
    const px = num(x, 0), py = num(y, 0);
    const count = intIn(o.count, 1, 0, 8);
    const life = clampNum(num(o.life, 0.22), 0.04, 2);
    const size = clampNum(num(o.size, 5), 0.5, 40);
    const vx = num(o.vx, 0), vy = num(o.vy, 0);
    const col = pickColor(o, C_PLAYER);
    for (let i = 0; i < count; i++) {
      const p = alloc();
      initCommon(p, px + rnd(-2, 2), py + rnd(-2, 2), col);
      p.k = K_SQUARE;
      p.vx = vx * -0.08 + rnd(-8, 8);
      p.vy = vy * -0.08 + rnd(-8, 8);
      p.g = num(o.gravity, 0);
      p.dr = 3;
      p.ml = p.life = life;
      p.s = size;
      p.shrink = 1;
      p.hold = 1;   // se desvanece desde el primer frame
    }
  }

  function floatText(x, y, text, opts) {
    if (text === null || text === undefined) return;
    const o = opts || NOPTS;
    const t = allocText();
    t.x = num(x, 0);
    t.y = num(y, 0);
    t.txt = String(text);
    t.col = str(o.color, C_PLAYER);
    t.size = clampNum(num(o.size, 16), 6, 96);
    t.ml = t.life = clampNum(num(o.life, 0.9), 0.1, 6);
    t.vy = num(o.vy, -55);
    t.scr = o.screen === true;   // extra: si true se dibuja en drawScreen
  }

  // ---------- pantalla ----------
  function shake(intensity, duration) {
    const i = clampNum(num(intensity, 6), 0, 24);
    const d = clampNum(num(duration, 0.22), 0.02, 1.2);
    if (i <= 0) return;
    if (shakeT <= 0) {
      // temblor nuevo: fase aleatoria para que no se repita igual
      shakeAmp = i;
      shakeT = shakeDur = d;
      shakePhase = 0;
      seedA = Math.random() * TAU;
      seedB = Math.random() * TAU;
      return;
    }
    // solapado: se toma el máximo, nunca se suman
    if (i > shakeAmp) shakeAmp = i;
    if (d > shakeT) shakeT = d;
    if (shakeT > shakeDur) shakeDur = shakeT;
  }

  function shakeOffset() {
    return shk;
  }

  function hitstop(duration) {
    const d = clampNum(num(duration, 0.06), 0, 0.3);
    if (d > hitstopT) hitstopT = d;
  }

  function isHitstopped() {
    return hitstopT > 0;
  }

  function flash(color, duration) {
    flashCol = str(color, "#ffffff");
    flashDur = clampNum(num(duration, 0.18), 0.03, 2);
    flashT = flashDur;
  }

  // Extra: viñeta oscura de bordes para la muerte (drawScreen la pinta).
  function vignette(color, duration) {
    vignCol = str(color, "#c1392b");
    vignDur = clampNum(num(duration, 0.5), 0.05, 4);
    vignT = vignDur;
  }

  // ---------- update ----------
  function update(dt) {
    let d = num(dt, 0);
    if (d < 0) d = 0;
    if (d > 0.05) d = 0.05;   // evita saltos enormes al volver de otra pestaña

    if (hitstopT > 0) {
      hitstopT -= d;          // el hitstop corre en tiempo real, no en tiempo de juego
      if (hitstopT < 0) hitstopT = 0;
    }

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = pool[i];
      if (!p.a) continue;
      p.life -= d;
      if (p.life <= 0) {
        p.a = false;
        live--;
        continue;
      }
      p.vy += p.g * d;
      if (p.dr > 0) {
        let k = 1 - p.dr * d;
        if (k < 0) k = 0;
        p.vx *= k;
        p.vy *= k;
      }
      p.x += p.vx * d;
      p.y += p.vy * d;
      if (p.vr !== 0) p.rot += p.vr * d;
    }

    for (let i = 0; i < MAX_TEXTS; i++) {
      const t = texts[i];
      if (!t.a) continue;
      t.life -= d;
      if (t.life <= 0) {
        t.a = false;
        liveTexts--;
        continue;
      }
      t.y += t.vy * d;
      t.vy *= 1 - 1.2 * d;    // el texto frena al subir
    }

    if (shakeT > 0) {
      shakeT -= d;
      if (shakeT <= 0) {
        shakeT = 0;
        shakeAmp = 0;
        shk.x = 0;
        shk.y = 0;
      } else {
        shakePhase += d;
        const k = shakeT / shakeDur;
        const s = shakeAmp * k * k;   // decaimiento suave, sin tirones
        shk.x = Math.round(Math.sin(shakePhase * 121 + seedA) * s);
        shk.y = Math.round(Math.cos(shakePhase * 97 + seedB) * s * 0.8);
      }
    }

    if (flashT > 0) {
      flashT -= d;
      if (flashT < 0) flashT = 0;
    }
    if (vignT > 0) {
      vignT -= d;
      if (vignT < 0) vignT = 0;
    }
  }

  // ---------- dibujo ----------
  const drawList = new Int32Array(MAX_PARTICLES);
  const buckets = new Array(MAX_BUCKETS);
  let curA = -1;   // alfa cuantizado ya aplicado al contexto

  function setAlpha(ctx, al) {
    let q = (al * 10 + 0.5) | 0;
    if (q > 10) q = 10;
    if (q <= 0) return false;
    if (q !== curA) {
      curA = q;
      ctx.globalAlpha = q * 0.1;
    }
    return true;
  }

  function drawOne(ctx, p) {
    const t = p.life / p.ml;
    const al = t >= p.hold ? 1 : t / p.hold;
    if (!setAlpha(ctx, al)) return;
    if (p.k === K_DEBRIS) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.w * 0.5, -p.h * 0.5, p.w, p.h);
      ctx.restore();
      return;
    }
    const s = p.shrink > 0 ? p.s * (1 - p.shrink * (1 - t)) : p.s;
    if (s <= 0.3) return;
    if (p.k === K_CIRCLE) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, s * 0.5, 0, TAU);
      ctx.fill();
      return;
    }
    ctx.fillRect(p.x - s * 0.5, p.y - s * 0.5, s, s);
  }

  function drawTextItem(ctx, t) {
    const k = t.life / t.ml;
    const al = k > 0.6 ? 1 : k / 0.6;
    ctx.globalAlpha = al < 0 ? 0 : al;
    curA = -1;
    ctx.font = "bold " + (t.size | 0) + "px system-ui, Segoe UI, sans-serif";
    ctx.fillStyle = "#0d1117";
    ctx.fillText(t.txt, t.x + 1, t.y + 2);
    ctx.fillStyle = t.col;
    ctx.fillText(t.txt, t.x, t.y);
  }

  // Coordenadas de MUNDO (la cámara ya está aplicada por el motor).
  function draw(ctx) {
    if (!ctx || typeof ctx.fillRect !== "function") return;
    // Recoge las vivas y las agrupa por color para tocar fillStyle lo mínimo.
    let n = 0, nb = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = pool[i];
      if (!p.a) continue;
      let b = -1;
      for (let j = 0; j < nb; j++) {
        if (buckets[j] === p.col) {
          b = j;
          break;
        }
      }
      if (b < 0 && nb < MAX_BUCKETS) {
        b = nb;
        buckets[nb] = p.col;
        nb++;
      }
      p.b = b;
      drawList[n] = i;
      n++;
    }
    if (n === 0 && liveTexts === 0) return;

    ctx.save();
    curA = -1;
    for (let b = 0; b < nb; b++) {
      ctx.fillStyle = buckets[b];
      for (let k = 0; k < n; k++) {
        const p = pool[drawList[k]];
        if (p.b === b) drawOne(ctx, p);
      }
    }
    // Restos con más colores que grupos: se pintan sueltos.
    for (let k = 0; k < n; k++) {
      const p = pool[drawList[k]];
      if (p.b >= 0) continue;
      ctx.fillStyle = p.col;
      drawOne(ctx, p);
    }
    if (liveTexts > 0) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let i = 0; i < MAX_TEXTS; i++) {
        const t = texts[i];
        if (t.a && !t.scr) drawTextItem(ctx, t);
      }
    }
    ctx.restore();
    curA = -1;
  }

  // Viñeta: el degradado se cachea porque crearlo cada frame es caro.
  const rgbCache = new Map();
  let vignGrad = null, vignGW = 0, vignGH = 0, vignGCol = "";

  function rgbOf(col) {
    let v = rgbCache.get(col);
    if (v) return v;
    v = "0,0,0";
    if (typeof col === "string" && col.charCodeAt(0) === 35) {
      let hex = col.slice(1);
      if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      if (hex.length === 6) {
        const nn = parseInt(hex, 16);
        if (Number.isFinite(nn)) v = ((nn >> 16) & 255) + "," + ((nn >> 8) & 255) + "," + (nn & 255);
      }
    }
    rgbCache.set(col, v);
    return v;
  }

  function vignetteGrad(ctx, w, h) {
    if (vignGrad && vignGW === w && vignGH === h && vignGCol === vignCol) return vignGrad;
    const rgb = rgbOf(vignCol);
    const g = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.22, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
    g.addColorStop(0, "rgba(" + rgb + ",0)");
    g.addColorStop(0.55, "rgba(" + rgb + ",0.28)");
    g.addColorStop(1, "rgba(" + rgb + ",0.85)");
    vignGrad = g;
    vignGW = w;
    vignGH = h;
    vignGCol = vignCol;
    return g;
  }

  // Coordenadas de PANTALLA: flash, viñeta y textos fijos.
  function drawScreen(ctx, w, h) {
    if (!ctx || typeof ctx.fillRect !== "function") return;
    const sw = num(w, 0), sh = num(h, 0);
    if (sw <= 0 || sh <= 0) return;
    if (vignT <= 0 && flashT <= 0 && liveTexts === 0) return;

    ctx.save();
    if (vignT > 0 && typeof ctx.createRadialGradient === "function") {
      const prog = 1 - vignT / vignDur;              // 0 → 1
      const a = prog < 0.15 ? prog / 0.15 : 1 - (prog - 0.15) / 0.85;
      ctx.globalAlpha = clampNum(a, 0, 1);
      ctx.fillStyle = vignetteGrad(ctx, sw, sh);
      ctx.fillRect(0, 0, sw, sh);
    }
    if (flashT > 0) {
      ctx.globalAlpha = clampNum((flashT / flashDur) * 0.55, 0, 1);
      ctx.fillStyle = flashCol;
      ctx.fillRect(0, 0, sw, sh);
    }
    if (liveTexts > 0) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let i = 0; i < MAX_TEXTS; i++) {
        const t = texts[i];
        if (t.a && t.scr) drawTextItem(ctx, t);
      }
    }
    ctx.restore();
    curA = -1;
  }

  // ---------- varios ----------
  function reset() {
    for (let i = 0; i < MAX_PARTICLES; i++) pool[i].a = false;
    for (let i = 0; i < MAX_TEXTS; i++) {
      texts[i].a = false;
      texts[i].txt = "";
    }
    live = 0;
    liveTexts = 0;
    cursor = 0;
    textCursor = 0;
    shakeAmp = shakeT = shakeDur = shakePhase = 0;
    shk.x = 0;
    shk.y = 0;
    hitstopT = 0;
    flashT = 0;
    vignT = 0;
    curA = -1;
  }

  function count() {
    return live + liveTexts;
  }

  return {
    update,
    draw,
    drawScreen,
    burst,
    dust,
    debris,
    trail,
    shake,
    shakeOffset,
    hitstop,
    isHitstopped,
    flash,
    floatText,
    vignette,
    reset,
    count,
  };
})();
