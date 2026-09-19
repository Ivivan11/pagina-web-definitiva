// theme.js — Camuflaje: todo el dibujo del juego con Canvas 2D puro.
// Falso 3D: extrusión de bloques (cara superior clara, frontal media, base oscura),
// parallax pre-renderizado y sombras planas. Sin WebGL, sin assets, sin ctx.filter,
// sin shadowBlur. Luz siempre desde arriba-izquierda.
const Theme = (() => {
  'use strict';

  // ---------------------------------------------------------------- utilidades

  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function mod(a, n) { return n > 0 ? ((a % n) + n) % n : 0; }

  // PRNG determinista (mulberry32): mismas texturas en cada partida y equipo
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let x = Math.imul(s ^ (s >>> 15), 1 | s);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  // color: parseo y mezcla hacia blanco/negro (cacheado, se usa sobre todo al init)
  const shadeCache = new Map();
  function parseColor(c) {
    if (typeof c !== 'string') return [128, 128, 128];
    let s = c.trim();
    if (s.charAt(0) === '#') {
      s = s.slice(1);
      if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
      const n = parseInt(s, 16);
      if (!isFinite(n)) return [128, 128, 128];
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const m = s.match(/(-?\d+(\.\d+)?)/g);
    if (m && m.length >= 3) return [+m[0] | 0, +m[1] | 0, +m[2] | 0];
    return [128, 128, 128];
  }
  function hex2(v) { const s = Math.round(clamp(v, 0, 255)).toString(16); return s.length < 2 ? '0' + s : s; }
  // amt > 0 aclara, amt < 0 oscurece
  function shade(c, amt) {
    const key = c + '|' + amt;
    const hit = shadeCache.get(key);
    if (hit) return hit;
    const rgb = parseColor(c);
    const f = amt >= 0
      ? function (v) { return v + (255 - v) * amt; }
      : function (v) { return v * (1 + amt); };
    const out = '#' + hex2(f(rgb[0])) + hex2(f(rgb[1])) + hex2(f(rgb[2]));
    if (shadeCache.size < 600) shadeCache.set(key, out);
    return out;
  }
  function rgba(c, a) {
    const rgb = parseColor(c);
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + clamp(num(a, 1), 0, 1) + ')';
  }

  // ---------------------------------------------------------------- paleta

  const P = {
    bgDeep: '#0d1117',
    tileFront: '#3f4756',
    tileTop: '#58647b',
    wood: '#6b5a45',
    steel: '#3c4a5f',
    phase: '#2f5766',
    metal: '#2b3340',
    slam: '#4a3a3c',
    danger: '#c1392b',
    dangerLight: '#e0604c',
    dangerDark: '#8d2a20',
    goal: '#2ecc71',
    goalDark: '#1d8f4e',
    goalLight: '#8af3b3',
    player: '#f5c451',
    accent: '#f5c451',
  };

  // Paleta de caras de una caja extruida a partir de un color base.
  function mkPal(front, top) {
    const t = top || shade(front, 0.2);
    return {
      front: front,
      top: t,
      sideL: shade(front, 0.07),   // izquierda: luz
      sideR: shade(front, -0.24),  // derecha: sombra
      bottom: shade(front, -0.48),
      edge: shade(t, 0.38),
    };
  }

  const PAL = {
    solid: mkPal(P.tileFront, P.tileTop),
    crumble: mkPal(P.wood, '#7d6b52'),
    moving: mkPal(P.steel, '#4e6079'),
    phase: mkPal(P.phase, '#3f7488'),
    metal: mkPal(P.metal, '#3b4553'),
    slam: mkPal(P.slam, '#5c4849'),
    goal: mkPal(P.goalDark, '#2ecc71'),
    springPad: mkPal(P.goalDark, P.goal),
  };

  // ---------------------------------------------------------------- primitivas

  function mkCanvas(w, h) {
    try {
      if (typeof document === 'undefined' || !document.createElement) return null;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w));
      c.height = Math.max(1, Math.round(h));
      const g = c.getContext('2d');
      if (!g) return null;
      return { c: c, g: g };
    } catch (e) { return null; }
  }

  function rrPath(g, x, y, w, h, r) {
    const rad = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
    g.beginPath();
    g.moveTo(x + rad, y);
    g.lineTo(x + w - rad, y);
    g.quadraticCurveTo(x + w, y, x + w, y + rad);
    g.lineTo(x + w, y + h - rad);
    g.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    g.lineTo(x + rad, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - rad);
    g.lineTo(x, y + rad);
    g.quadraticCurveTo(x, y, x + rad, y);
    g.closePath();
  }

  function poly(g, pts) {
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.closePath();
  }

  function ell(g, cx, cy, rx, ry) {
    g.beginPath();
    if (typeof g.ellipse === 'function') {
      g.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
    } else {
      g.moveTo(cx + rx, cy);
      for (let i = 1; i <= 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        g.lineTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
      }
      g.closePath();
    }
  }

  // Caja extruida "en vivo": caras superior/laterales/base + panel frontal.
  // La cara de arriba es más ancha que la de abajo => la caja se lee vista algo desde arriba.
  const BOX = { s: 0, top: 0, bot: 0 };
  function paintBox(g, x, y, w, h, pal, depth) {
    const s = clamp(num(depth, Math.min(w, h) * 0.24), 2, 9);
    const dT = Math.min(s * 1.45, h * 0.4);
    const dB = Math.min(s * 0.6, h * 0.22);
    g.fillStyle = pal.front;
    rrPath(g, x, y, w, h, Math.min(3, w * 0.2, h * 0.2));
    g.fill();
    poly(g, [x, y, x + w, y, x + w - s, y + dT, x + s, y + dT]); g.fillStyle = pal.top; g.fill();
    poly(g, [x, y, x + s, y + dT, x + s, y + h - dB, x, y + h]); g.fillStyle = pal.sideL; g.fill();
    poly(g, [x + w, y, x + w, y + h, x + w - s, y + h - dB, x + w - s, y + dT]); g.fillStyle = pal.sideR; g.fill();
    poly(g, [x, y + h, x + s, y + h - dB, x + w - s, y + h - dB, x + w, y + h]); g.fillStyle = pal.bottom; g.fill();
    g.fillStyle = rgba(pal.edge, 0.55); g.fillRect(x, y, w, 1);
    g.fillStyle = rgba(pal.edge, 0.22); g.fillRect(x, y, 1, h);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, y + h - 1, w, 1);
    BOX.s = s; BOX.top = dT; BOX.bot = dB;
    return s;
  }

  // ---------------------------------------------------------------- sprites de bloque

  const tileCache = new Map();

  // Pinta el bloque completo en coordenadas locales (0,0,w,h).
  function paintTile(g, w, h, kind) {
    const pal = PAL[kind] || PAL.solid;
    paintBox(g, 0, 0, w, h, pal);
    const ix = BOX.s, iy = BOX.top;
    const iw = Math.max(1, w - BOX.s * 2), ih = Math.max(1, h - BOX.top - BOX.bot);

    // degradado suave del panel frontal: más luz arriba
    try {
      const gr = g.createLinearGradient(0, iy, 0, iy + ih);
      gr.addColorStop(0, 'rgba(255,255,255,0.04)');
      gr.addColorStop(1, 'rgba(0,0,0,0.22)');
      g.fillStyle = gr;
      g.fillRect(ix, iy, iw, ih);
    } catch (e) { /* sin degradado si falla */ }
    g.fillStyle = rgba(pal.edge, 0.18);
    g.fillRect(ix, iy, iw, 1);

    // grano sutil, determinista por tamaño
    const rnd = rng(Math.imul(w, 73856093) ^ Math.imul(h, 19349663) ^ (kind.length * 977));
    const specks = Math.min(70, Math.round((iw * ih) / 420));
    for (let i = 0; i < specks; i++) {
      const sx = ix + rnd() * iw, sy = iy + rnd() * ih;
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)';
      g.fillRect(sx, sy, 1, 1);
    }

    if (kind === 'crumble') {
      // veta de madera: líneas horizontales onduladas + nudo
      g.strokeStyle = 'rgba(58,46,32,0.35)';
      g.lineWidth = 1;
      const lines = Math.max(1, Math.round(ih / 7));
      for (let i = 1; i < lines; i++) {
        const ly = iy + (ih * i) / lines;
        g.beginPath();
        for (let x = ix; x <= ix + iw; x += 6) {
          const yy = ly + Math.sin((x + i * 13) * 0.16) * 1.1;
          if (x === ix) g.moveTo(x, yy); else g.lineTo(x, yy);
        }
        g.stroke();
      }
      if (iw > 14 && ih > 12) {
        g.strokeStyle = 'rgba(58,46,32,0.45)';
        ell(g, ix + iw * 0.32, iy + ih * 0.5, Math.min(5, iw * 0.12), Math.min(3.4, ih * 0.14));
        g.stroke();
      }
    } else if (kind === 'moving') {
      // galones ámbar en el panel frontal (recortados al panel)
      g.save();
      try {
        g.beginPath(); g.rect(ix, iy, iw, ih); g.clip();
        g.strokeStyle = rgba(P.accent, 0.34);
        g.lineWidth = Math.max(2, Math.min(4, ih * 0.18));
        const step = 14, cy = iy + ih / 2, a = Math.min(5, ih * 0.28);
        for (let x = ix - step; x < ix + iw + step; x += step) {
          g.beginPath();
          g.moveTo(x, cy + a); g.lineTo(x + step * 0.5, cy - a); g.lineTo(x + step, cy + a);
          g.stroke();
        }
      } finally { g.restore(); }
    } else if (kind === 'phase') {
      // aire de plataforma "fantasma": contorno punteado interior
      g.strokeStyle = rgba('#7fd6e8', 0.5);
      g.lineWidth = 1;
      if (typeof g.setLineDash === 'function') g.setLineDash([4, 4]);
      rrPath(g, ix + 1.5, iy + 1.5, Math.max(1, iw - 3), Math.max(1, ih - 3), 2);
      g.stroke();
      if (typeof g.setLineDash === 'function') g.setLineDash([]);
    }
  }

  function tileSprite(kind, w, h) {
    const key = kind + '|' + w + '|' + h;
    let c = tileCache.get(key);
    if (c !== undefined) return c;
    if (tileCache.size > 180) tileCache.clear();
    const o = mkCanvas(w, h);
    c = o ? o.c : null;
    if (o) paintTile(o.g, w, h, kind);
    tileCache.set(key, c);
    return c;
  }

  function blitTile(ctx, kind, x, y, w, h) {
    const s = tileSprite(kind, w, h);
    if (s) { ctx.drawImage(s, x, y); return; }
    ctx.save();
    try { ctx.translate(x, y); paintTile(ctx, w, h, kind); } finally { ctx.restore(); }
  }

  // ---------------------------------------------------------------- fondo (parallax)

  const VPAD = 120; // margen vertical de las capas para el parallax en Y
  const bgCache = new Map();

  function skyPalette(tint) {
    switch (tint) {
      case 'dawn': return { skyTop: '#141a2e', skyMid: '#2c2a45', horizon: '#6d4c58', glow: 'rgba(242,152,110,0.22)', star: '#ffe6c8', stars: 0.35, moon: '#ffd9a8', far: '#3a3450', mid: '#2a2740', near: '#171730', win: '#ffd9a8', dust: '#ffe9d2' };
      case 'night': return { skyTop: '#05070d', skyMid: '#090e18', horizon: '#111a2b', glow: 'rgba(70,110,200,0.16)', star: '#cddcf5', stars: 1.3, moon: '#e8f0ff', far: '#151e2f', mid: '#101825', near: '#090e17', win: '#9dc4ff', dust: '#cfe0ff' };
      case 'sunset': return { skyTop: '#181228', skyMid: '#3b2440', horizon: '#8a4433', glow: 'rgba(255,140,70,0.26)', star: '#ffd9b0', stars: 0.3, moon: '#ffb36b', far: '#4a2c3f', mid: '#331f31', near: '#1b1121', win: '#ffcf9a', dust: '#ffd9b8' };
      case 'void': return { skyTop: '#05040a', skyMid: '#0a0714', horizon: '#17102a', glow: 'rgba(170,80,220,0.2)', star: '#d9b3ff', stars: 0.8, moon: '#b07dff', far: '#1b1231', mid: '#130d23', near: '#0b0816', win: '#c79bff', dust: '#e0c8ff' };
      default: return { skyTop: '#080b12', skyMid: '#0d1117', horizon: '#1b2230', glow: 'rgba(80,120,190,0.18)', star: '#a9bcd8', stars: 1, moon: '#c9d6ea', far: '#1b2434', mid: '#151d2a', near: '#0d131c', win: '#f5c451', dust: '#cfe0ff' };
    }
  }

  function makeSky(w, h, pal) {
    const o = mkCanvas(w, h + VPAD * 2); if (!o) return null;
    const g = o.g, H = o.c.height;
    try {
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, pal.skyTop);
      gr.addColorStop(0.58, pal.skyMid);
      gr.addColorStop(1, pal.horizon);
      g.fillStyle = gr;
    } catch (e) { g.fillStyle = pal.skyMid; }
    g.fillRect(0, 0, w, H);

    const hy = VPAD + h * 0.66;
    try {
      const rg = g.createRadialGradient(w * 0.66, hy, 4, w * 0.66, hy, Math.max(w, h) * 0.75);
      rg.addColorStop(0, pal.glow);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, w, H);
    } catch (e) { /* opcional */ }

    // astro con halo suave (gradiente, sólo al pre-renderizar; nada de shadowBlur)
    const mx = w * 0.74, my = VPAD + h * 0.24, mr = Math.max(13, w * 0.032);
    try {
      const hg = g.createRadialGradient(mx, my, mr * 0.9, mx, my, mr * 4.5);
      hg.addColorStop(0, rgba(pal.moon, 0.16));
      hg.addColorStop(0.4, rgba(pal.moon, 0.06));
      hg.addColorStop(1, rgba(pal.moon, 0));
      g.fillStyle = hg;
      g.fillRect(mx - mr * 4.5, my - mr * 4.5, mr * 9, mr * 9);
    } catch (e) { /* opcional */ }
    g.fillStyle = rgba(pal.moon, 0.9);
    ell(g, mx, my, mr, mr); g.fill();
    g.fillStyle = rgba(pal.skyMid, 0.55);
    ell(g, mx + mr * 0.42, my - mr * 0.24, mr * 0.9, mr * 0.9); g.fill();
    return o.c;
  }

  // Cresta periódica (suma de senos con frecuencias enteras) => sin costuras al repetir
  function ridge(g, W, H, baseY, amp, fill, rim, harm) {
    const step = Math.max(3, Math.round(W / 140));
    const pts = [];
    for (let x = 0; x <= W; x += step) {
      let v = 0;
      for (let i = 0; i < harm.length; i++) v += harm[i][1] * Math.sin((2 * Math.PI * harm[i][0] * x) / W + harm[i][2]);
      pts.push(x, baseY - v * amp);
    }
    g.beginPath();
    g.moveTo(0, H);
    for (let i = 0; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.lineTo(W, H);
    g.closePath();
    g.fillStyle = fill; g.fill();
    if (rim) {
      g.beginPath();
      for (let i = 0; i < pts.length; i += 2) { if (i === 0) g.moveTo(pts[i], pts[i + 1]); else g.lineTo(pts[i], pts[i + 1]); }
      g.strokeStyle = rim; g.lineWidth = 1.2; g.stroke();
    }
  }

  function makeFar(w, h, pal) {
    const o = mkCanvas(w, h + VPAD * 2); if (!o) return null;
    const g = o.g, H = o.c.height;
    const rnd = rng(1337 + Math.imul(w, 31) + h);
    const hy = VPAD + h * 0.64;
    const n = Math.round((w * h) / 5200 * clamp(pal.stars, 0, 3));
    for (let i = 0; i < n; i++) {
      const sx = 1 + rnd() * (w - 2), sy = 1 + rnd() * (hy - 24);
      const r = rnd() < 0.87 ? 1 : 2;
      g.fillStyle = rgba(pal.star, 0.12 + rnd() * 0.55);
      g.fillRect(sx, sy, r, r);
    }
    ridge(g, w, H, hy + 30, h * 0.15, pal.far, rgba(shade(pal.far, 0.22), 0.7),
      [[1, 0.52, 0.4], [2, 0.3, 1.9], [3, 0.16, 3.0], [5, 0.08, 0.8]]);
    return o.c;
  }

  function makeMid(w, h, pal) {
    const o = mkCanvas(w, h + VPAD * 2); if (!o) return null;
    const g = o.g, H = o.c.height;
    const rnd = rng(911 + Math.imul(w, 17) + h * 3);
    const hy = VPAD + h * 0.74;
    const cells = Math.max(6, Math.round(w / 72));
    const cw = w / cells;
    const top = shade(pal.mid, 0.12), lit = shade(pal.mid, 0.06);
    for (let i = 0; i < cells; i++) {
      const bw = cw * (0.5 + rnd() * 0.38);
      const bx = i * cw + (cw - bw) / 2;
      const bh = h * (0.07 + rnd() * 0.28);
      const by = hy - bh;
      g.fillStyle = pal.mid; g.fillRect(bx, by, bw, H - by);
      g.fillStyle = top; g.fillRect(bx, by, bw, 3);          // cara superior
      g.fillStyle = lit; g.fillRect(bx, by, 2, bh);          // arista izquierda (luz)
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(bx + bw - 2, by, 2, bh);
      // ventanitas
      const cols = Math.max(1, Math.floor(bw / 9));
      const rows = Math.max(1, Math.floor(bh / 12));
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (rnd() > 0.22) continue;
          g.fillStyle = rgba(pal.win, 0.18 + rnd() * 0.3);
          g.fillRect(bx + 4 + c * 9, by + 7 + r * 12, 2, 3);
        }
      }
    }
    ridge(g, w, H, hy + 6, h * 0.035, pal.mid, null, [[2, 0.6, 1.1], [4, 0.3, 2.4]]);
    return o.c;
  }

  function makeNear(w, h, pal) {
    const o = mkCanvas(w, h + VPAD * 2); if (!o) return null;
    const g = o.g, H = o.c.height;
    const rnd = rng(4242 + Math.imul(w, 7) + h * 11);
    const cells = Math.max(3, Math.round(w / 200));
    const cw = w / cells;
    const top = shade(pal.near, 0.16), lit = shade(pal.near, 0.08);
    for (let i = 0; i < cells; i++) {
      const pw = cw * (0.28 + rnd() * 0.3);
      const px = i * cw + (cw - pw) * rnd();
      const py = VPAD + h * (0.48 + rnd() * 0.22);
      const d = Math.min(10, pw * 0.16);
      g.fillStyle = pal.near; g.fillRect(px, py, pw, H - py);
      poly(g, [px, py, px + pw, py, px + pw - d, py + d, px + d, py + d]); g.fillStyle = top; g.fill();
      g.fillStyle = lit; g.fillRect(px, py, d * 0.6, H - py);
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(px + pw - d * 0.6, py, d * 0.6, H - py);
      g.fillStyle = rgba(shade(pal.near, 0.4), 0.35); g.fillRect(px, py, pw, 1);
    }
    return o.c;
  }

  function bgLayers(w, h, tint) {
    const key = w + '|' + h + '|' + (tint || 'base');
    let L = bgCache.get(key);
    if (L) return L;
    if (bgCache.size > 6) bgCache.clear();
    const pal = skyPalette(tint);
    L = { pal: pal, sky: makeSky(w, h, pal), far: makeFar(w, h, pal), mid: makeMid(w, h, pal), near: makeNear(w, h, pal) };
    bgCache.set(key, L);
    return L;
  }

  // Repite la capa en horizontal con 1-2 drawImage; nada de geometría nueva por frame.
  function blitLayer(ctx, c, camX, camY, fx, fy, w) {
    if (!c) return;
    const W = c.width;
    const oy = -VPAD + clamp(-camY * fy, -VPAD, VPAD);
    if (fx === 0) { ctx.drawImage(c, 0, oy); return; }
    const ox = -mod(camX * fx, W);
    ctx.drawImage(c, ox, oy);
    if (ox + W < w) ctx.drawImage(c, ox + W, oy);
  }

  function drawBackground(ctx, camX, camY, w, h, t, levelTint) {
    const W = Math.max(1, Math.round(num(w, 0)));
    const H = Math.max(1, Math.round(num(h, 0)));
    const cx = num(camX, 0), cy = num(camY, 0), tt = num(t, 0);
    const L = bgLayers(W, H, levelTint);
    if (!L || !L.sky) { ctx.fillStyle = P.bgDeep; ctx.fillRect(0, 0, W, H); return; }

    blitLayer(ctx, L.sky, cx, cy, 0, 0.03, W);
    blitLayer(ctx, L.far, cx, cy, 0.08, 0.05, W);
    blitLayer(ctx, L.mid, cx, cy, 0.22, 0.10, W);
    blitLayer(ctx, L.near, cx, cy, 0.45, 0.18, W);

    // motas de polvo: 18 rectángulos, sin asignaciones
    ctx.fillStyle = L.pal.dust;
    for (let i = 0; i < 18; i++) {
      const sp = 5 + (i % 4) * 5;
      const px = mod(i * 97.3 + tt * sp - cx * 0.12, W + 40) - 20;
      const py = mod(i * 61.7 + Math.sin(tt * 0.45 + i) * 16 + H * 0.35, H);
      const r = 1 + (i % 3) * 0.7;
      ctx.globalAlpha = 0.05 + 0.05 * Math.sin(tt * 0.9 + i);
      ctx.fillRect(px, py, r, r);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- bloques

  function drawCracks(ctx, x, y, w, h, pr) {
    const rnd = rng(Math.imul(w, 2654435761) ^ h);
    ctx.strokeStyle = rgba('#241d14', 0.35 + 0.55 * pr);
    ctx.lineWidth = 1 + pr;
    const lines = 3;
    for (let i = 0; i < lines; i++) {
      let px = x + w * (0.15 + rnd() * 0.7);
      let py = y + h * 0.1;
      ctx.beginPath();
      ctx.moveTo(px, py);
      const segs = 3 + ((i * 2) % 3);
      for (let s = 0; s < segs; s++) {
        px += (rnd() - 0.5) * w * 0.35;
        py += (h * 0.9) / segs;
        ctx.lineTo(clamp(px, x + 1, x + w - 1), Math.min(py, y + h - 1));
      }
      ctx.stroke();
    }
    if (pr > 0.35) { // polvillo cayendo
      ctx.fillStyle = rgba('#8d7a5e', 0.35 * pr);
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(x + w * (0.2 + 0.2 * i), y + h + 2 + ((pr * 26 + i * 7) % 14), 2, 2);
      }
    }
  }

  function drawSpring(ctx, x, y, w, h, st) {
    const pressed = !!st.pressed;
    const tt = num(st.t, 0);
    const padH = clamp(h * 0.3, 5, 12);
    const sink = pressed ? Math.min(h * 0.32, padH * 1.4) : 0;
    const houseY = y + h * 0.45;
    paintBox(ctx, x + 1, houseY, Math.max(2, w - 2), Math.max(3, y + h - houseY), PAL.metal);

    // muelles: dos zigzags que se comprimen
    const topY = y + sink + padH;
    ctx.strokeStyle = shade(P.metal, 0.45);
    ctx.lineWidth = 2;
    for (let s = 0; s < 2; s++) {
      const sx = x + w * (0.3 + s * 0.4);
      ctx.beginPath();
      ctx.moveTo(sx, topY);
      const turns = 3, seg = Math.max(2, (houseY - topY) / turns);
      for (let i = 1; i <= turns; i++) ctx.lineTo(sx + (i % 2 ? 4 : -4), topY + seg * i);
      ctx.stroke();
    }

    // plataforma elástica
    const padPal = mkPal(P.goalDark, P.goal);
    paintBox(ctx, x, y + sink, w, padH, padPal, Math.min(4, padH * 0.4));
    // flechas hacia arriba, parpadeo suave
    ctx.globalAlpha = 0.35 + 0.35 * Math.sin(tt * 6);
    ctx.strokeStyle = P.goalLight;
    ctx.lineWidth = 2;
    const ay = y + sink + padH * 0.55, ah = padH * 0.3;
    for (let i = -1; i <= 1; i++) {
      const ax = x + w * 0.5 + i * Math.min(12, w * 0.28);
      ctx.beginPath();
      ctx.moveTo(ax - 4, ay + ah); ctx.lineTo(ax, ay - ah); ctx.lineTo(ax + 4, ay + ah);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawSlam(ctx, x, y, w, h, st) {
    const trig = !!st.triggered;
    const tt = num(st.t, 0);
    const dx = trig ? Math.sin(tt * 55) * 1.6 : 0;
    paintBox(ctx, x + dx, y, w, h, PAL.slam);
    const s = BOX.s, dT = BOX.top, dB = BOX.bot;

    // bandas de peligro en el panel frontal
    ctx.save();
    try {
      ctx.beginPath(); ctx.rect(x + dx + s, y + dT, Math.max(1, w - s * 2), Math.max(1, h - dT - dB)); ctx.clip();
      ctx.fillStyle = rgba(P.accent, trig ? 0.3 : 0.16);
      for (let sx = -h; sx < w + h; sx += 20) {
        poly(ctx, [x + dx + sx, y + h, x + dx + sx + 8, y + h, x + dx + sx + 8 + h, y, x + dx + sx + h, y]);
        ctx.fill();
      }
    } finally { ctx.restore(); }

    // remaches en las esquinas
    ctx.fillStyle = shade(P.slam, 0.35);
    const rr = Math.min(2.2, Math.min(w, h) * 0.08);
    const px = [x + dx + s + 2, x + dx + w - s - 2];
    const py = [y + dT + 2, y + h - dB - 2];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { ell(ctx, px[i], py[j], rr, rr); ctx.fill(); }

    // dientes en la cara inferior
    const n = Math.max(2, Math.round(w / 15));
    const tw = w / n, th = Math.min(7, h * 0.3);
    for (let i = 0; i < n; i++) {
      const cx0 = x + dx + tw * i;
      poly(ctx, [cx0, y + h - 1, cx0 + tw, y + h - 1, cx0 + tw * 0.5, y + h - 1 + th]);
      ctx.fillStyle = i % 2 ? P.danger : P.dangerDark;
      ctx.fill();
    }
    if (trig) {
      ctx.fillStyle = rgba(P.dangerLight, 0.18 + 0.12 * Math.sin(tt * 18));
      ctx.fillRect(x + dx, y, w, h);
    }
  }

  function drawTile(ctx, rect, kind, state) {
    if (!rect) return;
    const w = Math.max(1, Math.round(num(rect.w, 0)));
    const h = Math.max(1, Math.round(num(rect.h, 0)));
    if (num(rect.w, 0) < 1 || num(rect.h, 0) < 1) return;
    const x = Math.round(num(rect.x, 0));
    const y = Math.round(num(rect.y, 0));
    const st = state || {};

    // 'fake' (y cualquier kind desconocido) cae en la MISMA rama que 'solid':
    // mismo sprite cacheado, misma clave, cero diferencias posibles.
    let k = kind;
    if (k !== 'crumble' && k !== 'moving' && k !== 'phase' && k !== 'spring' && k !== 'slam') k = 'solid';

    if (k === 'solid') { blitTile(ctx, 'solid', x, y, w, h); return; }

    if (k === 'crumble') {
      if (st.broken) return;
      const pr = clamp(num(st.crumbleProgress, 0), 0, 1);
      const tt = num(st.t, 0);
      const ox = pr > 0 ? Math.sin(tt * 47) * pr * 1.8 : 0;
      const oy = pr > 0 ? Math.cos(tt * 39) * pr * 1.2 : 0;
      blitTile(ctx, 'crumble', x + ox, y + oy, w, h);
      if (pr > 0.02) drawCracks(ctx, x + ox, y + oy, w, h, pr);
      return;
    }

    if (k === 'moving') {
      blitTile(ctx, 'moving', x, y, w, h);
      const tt = num(st.t, 0);
      ctx.fillStyle = rgba(P.accent, 0.3 + 0.35 * (0.5 + 0.5 * Math.sin(tt * 4)));
      const r = Math.min(2, h * 0.12);
      ell(ctx, x + 4, y + 3, r, r); ctx.fill();
      ell(ctx, x + w - 4, y + 3, r, r); ctx.fill();
      return;
    }

    if (k === 'phase') {
      const a = clamp(num(st.phaseAlpha, 1), 0, 1);
      const base = ctx.globalAlpha;
      if (a > 0.02) {
        ctx.globalAlpha = base * a;
        blitTile(ctx, 'phase', x, y, w, h);
      }
      // contorno siempre algo visible para que se lea como plataforma intermitente
      ctx.globalAlpha = base * Math.max(0.22, a);
      ctx.strokeStyle = rgba('#7fd6e8', 0.8);
      ctx.lineWidth = 1;
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash([5, 4]);
      rrPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 3);
      ctx.stroke();
      ctx.globalAlpha = base;
      return;
    }

    if (k === 'spring') { drawSpring(ctx, x, y, w, h, st); return; }
    drawSlam(ctx, x, y, w, h, st);
  }

  // ---------------------------------------------------------------- pinchos

  // Fila de pinchos en local: base abajo, puntas hacia arriba (-y).
  function spikeRow(ctx, lw, lh, tt) {
    const baseH = clamp(lh * 0.2, 2.5, 5);
    const n = Math.max(1, Math.round(lw / 14));
    const sw = lw / n;
    const x0 = -lw / 2, yBase = lh / 2 - baseH, yTip = -lh / 2;

    ctx.fillStyle = P.dangerDark;
    ctx.fillRect(x0, yBase, lw, baseH + 0.5);
    ctx.fillStyle = rgba(P.dangerLight, 0.4);
    ctx.fillRect(x0, yBase, lw, 1);

    for (let i = 0; i < n; i++) {
      const cx = x0 + sw * (i + 0.5);
      const half = sw * 0.47;
      poly(ctx, [cx - half, yBase + 0.5, cx, yTip, cx, yBase + 0.5]);
      ctx.fillStyle = P.dangerLight; ctx.fill();          // cara iluminada
      poly(ctx, [cx, yTip, cx + half, yBase + 0.5, cx, yBase + 0.5]);
      ctx.fillStyle = P.danger; ctx.fill();               // cara en sombra
      const gl = 0.12 + 0.18 * (0.5 + 0.5 * Math.sin(tt * 2.1 + i * 0.8));
      ctx.fillStyle = rgba('#ffffff', gl);
      poly(ctx, [cx, yTip, cx - half * 0.3, yTip + lh * 0.3, cx + half * 0.12, yTip + lh * 0.24]);
      ctx.fill();
    }
  }

  function drawSpikes(ctx, rect, dir, t) {
    if (!rect) return;
    const x = num(rect.x, 0), y = num(rect.y, 0);
    const w = Math.max(2, num(rect.w, 0)), h = Math.max(2, num(rect.h, 0));
    const tt = num(t, 0);
    let lw = w, lh = h;
    ctx.translate(x + w / 2, y + h / 2);
    if (dir === 'down') ctx.rotate(Math.PI);
    else if (dir === 'left') { ctx.rotate(-Math.PI / 2); lw = h; lh = w; }
    else if (dir === 'right') { ctx.rotate(Math.PI / 2); lw = h; lh = w; }
    spikeRow(ctx, lw, lh, tt);
  }

  // ---------------------------------------------------------------- meta

  function drawGoal(ctx, rect, t, reached) {
    if (!rect) return;
    const x = num(rect.x, 0), y = num(rect.y, 0);
    const w = Math.max(8, num(rect.w, 0)), h = Math.max(12, num(rect.h, 0));
    const tt = num(t, 0);
    const cx = x + w / 2;
    const baseH = clamp(h * 0.16, 6, 14);
    const baseY = y + h - baseH;
    const pulse = 0.5 + 0.5 * Math.sin(tt * 2.2);

    // halo por capas (elipses), nada de shadowBlur
    ctx.fillStyle = P.goal;
    for (let i = 3; i >= 1; i--) {
      ctx.globalAlpha = (reached ? 0.2 : 0.09) * (i / 3) * (0.6 + 0.4 * pulse);
      ell(ctx, cx, baseY + baseH * 0.35, w * (0.4 + 0.3 * i) * (reached ? 1.3 : 1), h * (0.08 + 0.06 * i));
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // pedestal extruido
    paintBox(ctx, x + w * 0.1, baseY, w * 0.8, baseH, PAL.goal, Math.min(5, baseH * 0.4));

    // mástil con arista de luz a la izquierda
    const poleW = Math.max(3, w * 0.09);
    const poleX = x + w * 0.22;
    ctx.fillStyle = '#7b8798'; ctx.fillRect(poleX, y + h * 0.04, poleW, baseY - y - h * 0.04);
    ctx.fillStyle = '#a7b3c4'; ctx.fillRect(poleX, y + h * 0.04, Math.max(1, poleW * 0.35), baseY - y - h * 0.04);
    ctx.fillStyle = '#5b6575'; ctx.fillRect(poleX + poleW - 1, y + h * 0.04, 1, baseY - y - h * 0.04);

    // bandera ondeando
    const fx = poleX + poleW - 0.5, fy = y + h * 0.08;
    const fw = Math.max(10, w * 0.6), fh = Math.max(8, h * 0.4);
    const segs = 6, sp = reached ? 7 : 3.6;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      ctx.lineTo(fx + fw * u, fy + Math.sin(tt * sp + u * 5) * 3 * u);
    }
    for (let i = segs; i >= 0; i--) {
      const u = i / segs;
      ctx.lineTo(fx + fw * u, fy + fh + Math.sin(tt * sp + u * 5 + 0.7) * 4 * u);
    }
    ctx.closePath();
    ctx.fillStyle = reached ? P.goalLight : P.goal;
    ctx.fill();
    ctx.save();
    try {
      ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(fx, fy + fh * 0.52, fw, fh);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(fx, fy, fw, 2);
    } finally { ctx.restore(); }

    // chispas ascendentes
    ctx.fillStyle = reached ? P.goalLight : P.goal;
    for (let i = 0; i < 5; i++) {
      const u = mod(tt * (0.4 + i * 0.09) + i * 0.2, 1);
      ctx.globalAlpha = (reached ? 0.7 : 0.4) * (1 - u);
      const sx = cx + Math.sin(tt * 1.6 + i * 2.1) * w * 0.4;
      ctx.fillRect(sx, baseY - u * h * 0.9, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- personaje

  function drawCharacter(ctx, p, opts) {
    if (!p) return;
    const o = opts || {};
    const w = Math.max(6, num(p.w, 28)), h = Math.max(6, num(p.h, 36));
    const x = num(p.x, 0), y = num(p.y, 0);
    const tt = num(o.t, 0);
    const facing = num(o.facing, 1) < 0 ? -1 : 1;
    const vx = num(o.vx, 0), vy = num(o.vy, 0);
    const onGround = !!o.onGround, dead = !!o.dead, ghost = !!o.ghost;
    const color = typeof o.color === 'string' ? o.color : P.player;
    let alpha = clamp(num(o.alpha, 1), 0, 1);
    if (ghost) alpha *= 0.45;
    if (alpha <= 0.01) return;
    const squash = clamp(num(o.squash, 0), 0, 1);

    // squash & stretch conservando volumen
    let sy = 1;
    if (!onGround && !dead) sy += Math.min(Math.abs(vy) / 1500, 0.2);
    sy *= 1 - 0.32 * squash;
    if (dead) sy = 0.78;
    sy = clamp(sy, 0.55, 1.3);
    const sx = clamp(1 / sy, 0.75, 1.5);

    ctx.globalAlpha = ctx.globalAlpha * alpha;
    ctx.translate(x + w / 2, y + h + (ghost ? Math.sin(tt * 2) * 2 : 0));
    if (dead) ctx.rotate(0.22);
    ctx.scale(sx, sy);

    const bw = w, bh = h, r = Math.min(bw * 0.42, bh * 0.36);
    const bodyTop = -bh;

    // cuerpo + volumen (recortado a la silueta)
    ctx.save();
    try {
      rrPath(ctx, -bw / 2, bodyTop, bw, bh, r);
      ctx.fillStyle = dead ? shade(color, -0.22) : color;
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = rgba(shade(color, 0.45), 0.5);              // luz arriba-izquierda
      ell(ctx, -bw * 0.14, bodyTop + bh * 0.2, bw * 0.4, bh * 0.2); ctx.fill();
      const dark = shade(color, -0.5);
      for (let i = 0; i < 3; i++) {                               // costado derecho escalonado
        ctx.fillStyle = rgba(dark, 0.1);
        ctx.fillRect(bw * (0.18 + i * 0.1), bodyTop, bw * 0.5, bh);
      }
      for (let i = 0; i < 3; i++) {                               // base escalonada
        ctx.fillStyle = rgba(dark, 0.12);
        ctx.fillRect(-bw / 2, -bh * (0.2 - i * 0.06), bw, bh * 0.25);
      }
    } finally { ctx.restore(); }

    rrPath(ctx, -bw / 2, bodyTop, bw, bh, r);
    ctx.strokeStyle = 'rgba(15,18,24,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // piececitos con ciclo de paso
    if (!ghost) {
      const step = onGround && Math.abs(vx) > 12 ? Math.sin(tt * 14) * bw * 0.1 : 0;
      ctx.fillStyle = shade(color, -0.55);
      rrPath(ctx, -bw * 0.34 + step, -3, bw * 0.28, 4, 2); ctx.fill();
      rrPath(ctx, bw * 0.06 - step, -3, bw * 0.28, 4, 2); ctx.fill();
    }

    // mechón que se inclina con el movimiento
    ctx.strokeStyle = shade(color, -0.45);
    ctx.lineWidth = Math.max(1.5, bw * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-bw * 0.05, bodyTop + 1);
    ctx.quadraticCurveTo(-bw * 0.05 - vx * 0.012, bodyTop - bh * 0.16, bw * 0.12 - vx * 0.02, bodyTop - bh * 0.1);
    ctx.stroke();

    // ojos
    const ey = bodyTop + bh * 0.36;
    const eSep = bw * 0.23;
    const eOff = facing * bw * 0.05;
    const erx = bw * 0.16, ery = bw * 0.18;
    const look = clamp(vy / 900, -1, 1);
    const blink = !dead && mod(tt * 0.85 + 0.31, 3.3) < 0.1;

    if (dead) {
      ctx.strokeStyle = '#2b2f38';
      ctx.lineWidth = Math.max(1.6, bw * 0.08);
      for (let s = -1; s <= 1; s += 2) {
        const ex = s * eSep;
        ctx.beginPath();
        ctx.moveTo(ex - erx * 0.7, ey - ery * 0.7); ctx.lineTo(ex + erx * 0.7, ey + ery * 0.7);
        ctx.moveTo(ex + erx * 0.7, ey - ery * 0.7); ctx.lineTo(ex - erx * 0.7, ey + ery * 0.7);
        ctx.stroke();
      }
    } else if (blink) {
      ctx.strokeStyle = '#2b2f38';
      ctx.lineWidth = Math.max(1.4, bw * 0.07);
      for (let s = -1; s <= 1; s += 2) {
        ctx.beginPath();
        ctx.moveTo(s * eSep - erx * 0.8 + eOff, ey);
        ctx.lineTo(s * eSep + erx * 0.8 + eOff, ey);
        ctx.stroke();
      }
    } else {
      for (let s = -1; s <= 1; s += 2) {
        const ex = s * eSep + eOff;
        ctx.fillStyle = '#fdfdfd';
        ell(ctx, ex, ey, erx, ery); ctx.fill();
        ctx.fillStyle = '#23272f';
        ell(ctx, ex + facing * erx * 0.35, ey + look * ery * 0.35, erx * 0.5, ery * 0.5); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ell(ctx, ex + facing * erx * 0.2 - erx * 0.2, ey - ery * 0.35, erx * 0.18, ery * 0.18); ctx.fill();
      }
    }

    // cejas: preocupadas al caer o al morir
    const worried = dead || (!onGround && vy > 380);
    ctx.strokeStyle = rgba(shade(color, -0.6), 0.75);
    ctx.lineWidth = Math.max(1.2, bw * 0.06);
    for (let s = -1; s <= 1; s += 2) {
      const ex = s * eSep + eOff;
      const tilt = s * -bw * (worried ? 0.06 : 0.018);
      ctx.beginPath();
      ctx.moveTo(ex - erx * 0.8, ey - ery * 1.25 + tilt);
      ctx.lineTo(ex + erx * 0.8, ey - ery * 1.25 - tilt);
      ctx.stroke();
    }

    // mofletes
    ctx.fillStyle = 'rgba(232,110,96,0.22)';
    ell(ctx, -eSep - bw * 0.06 + eOff, ey + ery * 1.5, bw * 0.12, bw * 0.08); ctx.fill();
    ell(ctx, eSep + bw * 0.06 + eOff, ey + ery * 1.5, bw * 0.12, bw * 0.08); ctx.fill();

    // boca
    const my = ey + ery * 1.9;
    ctx.strokeStyle = '#2b2f38';
    ctx.lineWidth = Math.max(1.3, bw * 0.06);
    ctx.beginPath();
    if (dead || worried) {
      ctx.fillStyle = '#2b2f38';
      ell(ctx, eOff, my, bw * 0.1, bw * 0.12); ctx.fill();
    } else {
      const smile = onGround ? bh * 0.07 : bh * 0.03;
      ctx.moveTo(eOff - bw * 0.12, my);
      ctx.quadraticCurveTo(eOff, my + smile, eOff + bw * 0.12, my);
      ctx.stroke();
    }

    if (ghost) { // contorno punteado para distinguir al fantasma
      ctx.globalAlpha = ctx.globalAlpha * 0.8;
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      rrPath(ctx, -bw / 2, bodyTop, bw, bh, r);
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- sombra

  function drawShadow(ctx, p, groundY) {
    if (!p || groundY === null || groundY === undefined) return;
    const gy = num(groundY, NaN);
    if (!isFinite(gy)) return;
    const w = Math.max(4, num(p.w, 28)), h = Math.max(4, num(p.h, 36));
    const cx = num(p.x, 0) + w / 2;
    const dist = Math.max(0, gy - (num(p.y, 0) + h));
    const k = clamp(1 - dist / 240, 0, 1);
    if (k <= 0.02) return;
    const rx = w * 0.5 * (0.45 + 0.55 * k);
    const ry = Math.max(2, rx * 0.3);
    // dos elipses = desenfoque falso barato
    ctx.fillStyle = 'rgba(0,0,0,' + (0.14 * k).toFixed(3) + ')';
    ell(ctx, cx, gy + 1, rx * 1.35, ry * 1.3); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,' + (0.3 * k).toFixed(3) + ')';
    ell(ctx, cx, gy + 1, rx, ry); ctx.fill();
  }

  // ---------------------------------------------------------------- viñeta + grano

  const vigCache = new Map();
  let vigTick = 0;

  function makeVignette(w, h, variant) {
    const o = mkCanvas(w, h); if (!o) return null;
    const g = o.g;
    try {
      const rg = g.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.32, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
      rg.addColorStop(0, 'rgba(0,0,0,0)');
      rg.addColorStop(0.65, 'rgba(0,0,0,0.28)');
      rg.addColorStop(1, 'rgba(0,0,0,0.72)');
      g.fillStyle = rg;
      g.fillRect(0, 0, w, h);
    } catch (e) { /* sin viñeta si falla */ }
    // grano horneado (una sola vez por variante)
    const rnd = rng(7 + variant * 9173 + w);
    const n = Math.round((w * h) / 900);
    for (let i = 0; i < n; i++) {
      const gx = rnd() * w, gy = rnd() * h;
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
      g.fillRect(gx, gy, 1, 1);
    }
    return o.c;
  }

  function drawVignette(ctx, w, h, intensity) {
    const W = Math.max(1, Math.round(num(w, 0)));
    const H = Math.max(1, Math.round(num(h, 0)));
    const a = clamp(num(intensity, 1), 0, 1);
    if (a <= 0.01) return;
    vigTick++;
    const v = Math.floor(vigTick / 6) % 3; // el grano rota, así no se ve "pegado"
    const key = W + '|' + H + '|' + v;
    let c = vigCache.get(key);
    if (c === undefined) {
      if (vigCache.size > 9) vigCache.clear();
      c = makeVignette(W, H, v);
      vigCache.set(key, c);
    }
    if (!c) return;
    ctx.globalAlpha = ctx.globalAlpha * a;
    ctx.drawImage(c, 0, 0);
  }

  // ---------------------------------------------------------------- API

  // Envoltorio: nunca lanza y siempre deja el contexto como estaba.
  function api(fn) {
    return function (ctx) {
      if (!ctx || typeof ctx.save !== 'function') return;
      ctx.save();
      try { fn.apply(null, arguments); } catch (e) { /* silencio: el juego sigue */ }
      ctx.restore();
    };
  }

  return {
    drawBackground: api(drawBackground),
    drawTile: api(drawTile),
    drawSpikes: api(drawSpikes),
    drawGoal: api(drawGoal),
    drawCharacter: api(drawCharacter),
    drawShadow: api(drawShadow),
    drawVignette: api(drawVignette),
  };
})();
