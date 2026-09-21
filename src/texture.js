// Texturas procedurales: hormigón, asfalto, ladrillo, chapa, óxido, madera y
// suciedad. Todo se genera UNA VEZ al cargar en canvas fuera de pantalla; en
// caliente solo se hace fillRect con un CanvasPattern ya creado, así que el
// coste por frame es el de un relleno normal.
// Sin WebGL, sin imágenes, sin ctx.filter y sin ctx.shadowBlur.

const Tex = (() => {
  const TILE = 128;        // lado del tile de todas las texturas
  const GRAIN_TILE = 256;  // el grano de película usa un tile más grande
  const GRAIN_COUNT = 3;   // se alternan para que el grano "hierva"
  const MAX_TINTS = 48;    // tope de tiles teñidos cacheados
  const TAU = Math.PI * 2;
  const SEED = 0x5eed17;
  const NOPTS = {};        // opts por defecto: evita crear {} en cada llamada

  // ---------------------------------------------------------------- utilidades

  function num(v, d) {
    return Number.isFinite(v) ? v : d;
  }
  function clampNum(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
  // módulo siempre positivo
  function mod(v, m) {
    if (!(m > 0)) return 0;
    const r = v % m;
    return r < 0 ? r + m : r;
  }
  // Generador con semilla: las texturas salen idénticas en cada recarga.
  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5;
      s >>>= 0;
      return s / 4294967296;
    };
  }
  function rr(rng, a, b) {
    return a + rng() * (b - a);
  }
  function grey(lum, a) {
    const c = clampNum(lum | 0, 0, 255);
    return 'rgba(' + c + ',' + c + ',' + c + ',' + clampNum(a, 0, 1).toFixed(3) + ')';
  }

  function mkCanvas(w, h) {
    try {
      if (typeof document === 'undefined' || !document.createElement) return null;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w));
      c.height = Math.max(1, Math.round(h));
      const g = c.getContext('2d');
      if (!g) return null;
      return { c: c, g: g };
    } catch (e) {
      return null;
    }
  }

  // ------------------------------------------------- ruido embaldosable (fbm)

  // Rejilla de valores aleatorios. Se indexa en módulo, así que el borde
  // derecho interpola contra el izquierdo: no hay costura por construcción.
  function lattice(n, rng) {
    const a = new Float32Array(n * n);
    for (let i = 0; i < a.length; i++) a[i] = rng();
    return a;
  }
  function sample(a, n, u, v) {
    let x0 = Math.floor(u), y0 = Math.floor(v);
    const fx = u - x0, fy = v - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    x0 = mod(x0, n) | 0;
    y0 = mod(y0, n) | 0;
    const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const n00 = a[y0 * n + x0], n10 = a[y0 * n + x1];
    const n01 = a[y1 * n + x0], n11 = a[y1 * n + x1];
    const top = n00 + (n10 - n00) * sx;
    const bot = n01 + (n11 - n01) * sx;
    return top + (bot - top) * sy;
  }
  // Campo 0..1 de w*h, suma de octavas. Cada octava embaldosa, luego la suma
  // también embaldosa.
  function fbm(w, h, rng, grid, oct, gain) {
    const out = new Float32Array(w * h);
    let amp = 1, total = 0, n = Math.max(1, grid | 0);
    for (let o = 0; o < oct; o++) {
      const lat = lattice(n, rng);
      const kx = n / w, ky = n / h;
      for (let y = 0; y < h; y++) {
        const v = y * ky, row = y * w;
        for (let x = 0; x < w; x++) out[row + x] += amp * sample(lat, n, x * kx, v);
      }
      total += amp;
      amp *= gain;
      n *= 2;
    }
    if (total > 0) for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  }

  // ------------------------------------------------- primitivas embaldosables

  // Dibuja lo mismo también desplazado ±w/±h cuando la mancha toca un borde:
  // lo que se sale por un lado reaparece por el contrario y la junta casa.
  function wrapAt(w, h, x, y, r, draw) {
    const dx = x < r ? w : (x > w - r ? -w : 0);
    const dy = y < r ? h : (y > h - r ? -h : 0);
    draw(x, y);
    if (dx) draw(x + dx, y);
    if (dy) draw(x, y + dy);
    if (dx && dy) draw(x + dx, y + dy);
  }

  // Mancha suave (gradiente radial) en gris.
  function blob(g, w, h, rng, r, lum, a) {
    const x = rng() * w, y = rng() * h;
    const c0 = grey(lum, a), c1 = grey(lum, 0);
    wrapAt(w, h, x, y, r, (bx, by) => {
      const grd = g.createRadialGradient(bx, by, 0, bx, by, r);
      grd.addColorStop(0, c0);
      grd.addColorStop(1, c1);
      g.fillStyle = grd;
      g.fillRect(bx - r, by - r, r * 2, r * 2);
    });
  }

  // Motas: rectángulos diminutos (más baratos que arc y a 1px se ven igual).
  function speckle(g, w, h, rng, n, rmin, rmax, lum, a) {
    g.fillStyle = grey(lum, a);
    for (let i = 0; i < n; i++) {
      const r = rr(rng, rmin, rmax), x = rng() * w, y = rng() * h;
      wrapAt(w, h, x, y, r, (bx, by) => g.fillRect(bx - r, by - r, r * 2, r * 2));
    }
  }

  // Grano fino por píxel: al ser ruido blanco no tiene correlación espacial,
  // así que nunca marca costura. Solo toca el RGB, respeta el alfa.
  function addGrain(g, w, h, rng, amt) {
    try {
      const img = g.getImageData(0, 0, w, h);
      const d = img.data;
      for (let p = 0; p < d.length; p += 4) {
        const n = (rng() - 0.5) * amt;
        d[p] += n;
        d[p + 1] += n;
        d[p + 2] += n;
      }
      g.putImageData(img, 0, 0);
    } catch (e) { /* sin getImageData nos quedamos sin grano, no pasa nada */ }
  }

  // ------------------------------------------------------------- las texturas

  // Hormigón: gris medio, manchas suaves, grano fino y poros.
  function makeConcrete(g, w, h, rng) {
    const f = fbm(w, h, rng, 4, 3, 0.55);
    const img = g.createImageData(w, h);
    const d = img.data;
    for (let i = 0, p = 0; i < f.length; i++, p += 4) {
      const v = 152 + (f[i] - 0.5) * 46 + (rng() - 0.5) * 20;
      d[p] = d[p + 1] = d[p + 2] = v; // Uint8ClampedArray ya redondea y recorta
      d[p + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 7; i++) blob(g, w, h, rng, rr(rng, 18, 46), 40, rr(rng, 0.04, 0.09));
    for (let i = 0; i < 5; i++) blob(g, w, h, rng, rr(rng, 14, 34), 235, rr(rng, 0.03, 0.07));
    speckle(g, w, h, rng, 150, 0.4, 1.4, 30, 0.20);
    speckle(g, w, h, rng, 90, 0.4, 1.1, 240, 0.12);
  }

  // Asfalto: más oscuro y con árido bien marcado.
  function makeAsphalt(g, w, h, rng) {
    const f = fbm(w, h, rng, 4, 3, 0.5);
    const img = g.createImageData(w, h);
    const d = img.data;
    for (let i = 0, p = 0; i < f.length; i++, p += 4) {
      const v = 80 + (f[i] - 0.5) * 28 + (rng() - 0.5) * 32;
      d[p] = d[p + 1] = d[p + 2] = v;
      d[p + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    speckle(g, w, h, rng, 700, 0.4, 1.9, 205, 0.10);
    speckle(g, w, h, rng, 520, 0.4, 2.2, 14, 0.30);
    for (let i = 0; i < 6; i++) blob(g, w, h, rng, rr(rng, 16, 44), 20, rr(rng, 0.06, 0.14));
    for (let i = 0; i < 3; i++) blob(g, w, h, rng, rr(rng, 12, 30), 210, rr(rng, 0.03, 0.06));
  }

  // Ladrillo: piezas de 32x16 con junta. 4 por fila y 8 filas (par), con el
  // desfase alternando: embaldosa en los dos ejes.
  function makeBrick(g, w, h, rng) {
    const BW = 32, BH = 16, J = 1.5; // ancho, alto y media junta
    g.fillStyle = 'rgb(176,176,176)'; // mortero
    g.fillRect(0, 0, w, h);
    const rows = Math.max(1, Math.round(h / BH));
    const cols = Math.ceil(w / BW);
    for (let r = 0; r < rows; r++) {
      const y = r * BH;
      const off = (r % 2) * (BW * 0.5);
      for (let i = -1; i <= cols; i++) {
        const x = i * BW + off;
        const lum = (132 + rr(rng, -18, 20)) | 0;
        const face = grey(lum, 1);
        // La misma pieza a izquierda y derecha: la que cruza el borde reaparece.
        for (let k = -1; k <= 1; k++) {
          const bx = x + k * w;
          if (bx >= w || bx + BW <= 0) continue;
          g.fillStyle = face;
          g.fillRect(bx + J, y + J, BW - J * 2, BH - J * 2);
          g.fillStyle = 'rgba(0,0,0,0.16)'; // sombra inferior
          g.fillRect(bx + J, y + BH - J - 1.5, BW - J * 2, 1.5);
          g.fillStyle = 'rgba(255,255,255,0.10)'; // luz superior
          g.fillRect(bx + J, y + J, BW - J * 2, 1);
        }
      }
    }
    for (let i = 0; i < 5; i++) blob(g, w, h, rng, rr(rng, 16, 40), 40, rr(rng, 0.04, 0.10));
    addGrain(g, w, h, rng, 30);
  }

  // Chapa: rayado horizontal fino y un brillo en seno (periódico en la altura
  // del tile, por eso no deja costura arriba/abajo).
  function makeMetal(g, w, h, rng) {
    const f = fbm(w, h, rng, 8, 2, 0.5);
    const img = g.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      const sheen = 1 + 0.085 * Math.sin(TAU * y / h) + 0.04 * Math.sin(2 * TAU * y / h + 1.1);
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x, p = i * 4;
        d[p] = d[p + 1] = d[p + 2] = (142 + (f[i] - 0.5) * 16 + (rng() - 0.5) * 10) * sheen;
        d[p + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // Rayas cortas: se dibuja también la copia desplazada -w para cerrar el lado.
    for (let i = 0; i < 280; i++) {
      const y = (rng() * h) | 0;
      const x = rng() * w, len = rr(rng, 16, w);
      const hgt = rng() < 0.18 ? 2 : 1;
      g.fillStyle = rng() < 0.45 ? grey(255, rr(rng, 0.03, 0.09)) : grey(0, rr(rng, 0.04, 0.12));
      g.fillRect(x, y, len, hgt);
      g.fillRect(x - w, y, len, hgt);
    }
    // Unas pocas rayas de lado a lado marcan la dirección del cepillado.
    for (let i = 0; i < 8; i++) {
      g.fillStyle = rng() < 0.5 ? grey(255, 0.07) : grey(0, 0.09);
      g.fillRect(0, (rng() * h) | 0, w, 1);
    }
  }

  // Óxido: manchas irregulares con mucho contraste y picadura.
  function makeRust(g, w, h, rng) {
    const f = fbm(w, h, rng, 3, 4, 0.55);
    const img = g.createImageData(w, h);
    const d = img.data;
    for (let i = 0, p = 0; i < f.length; i++, p += 4) {
      let t = f[i];
      t = t * t * (3 - 2 * t); // más contraste entre costra y chapa limpia
      d[p] = d[p + 1] = d[p + 2] = 78 + t * 132 + (rng() - 0.5) * 26;
      d[p + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 24; i++) blob(g, w, h, rng, rr(rng, 6, 26), 35, rr(rng, 0.12, 0.30));
    for (let i = 0; i < 14; i++) blob(g, w, h, rng, rr(rng, 5, 18), 230, rr(rng, 0.08, 0.18));
    speckle(g, w, h, rng, 520, 0.4, 1.6, 28, 0.22);
    speckle(g, w, h, rng, 240, 0.4, 1.2, 238, 0.14);
  }

  // Madera: tablas de 32px (divisor de 128) y vetas hechas con senos de
  // periodo entero sobre el ancho, así el extremo derecho casa con el izquierdo.
  function makeWood(g, w, h, rng) {
    const PH = 32;
    const planks = Math.max(1, Math.round(h / PH));
    for (let p = 0; p < planks; p++) {
      g.fillStyle = grey(150 + rr(rng, -14, 14), 1);
      g.fillRect(0, p * PH, w, PH);
    }
    for (let p = 0; p < planks; p++) {
      const top = p * PH;
      for (let i = 0; i < 16; i++) {
        const base = top + rr(rng, 1, PH - 1);
        const k1 = 1 + ((rng() * 3) | 0), k2 = 1 + ((rng() * 5) | 0);
        const a1 = rr(rng, 0.6, 2.4), a2 = rr(rng, 0.2, 1.1);
        const f1 = rng() * TAU, f2 = rng() * TAU;
        g.strokeStyle = rng() < 0.65 ? grey(0, rr(rng, 0.06, 0.18)) : grey(255, rr(rng, 0.04, 0.10));
        g.lineWidth = rr(rng, 0.6, 1.7);
        for (let s = -1; s <= 1; s++) {
          // las copias ±h solo hacen falta si la veta roza un borde
          if (s !== 0 && base > 6 && base < h - 6) continue;
          g.beginPath();
          for (let x = 0; x <= w; x += 4) {
            const y = base + s * h + a1 * Math.sin(TAU * k1 * x / w + f1) + a2 * Math.sin(TAU * k2 * x / w + f2);
            if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.stroke();
        }
      }
    }
    // Juntas entre tablas: la de y=0 y la de y=h se reparten el mismo surco.
    for (let p = 0; p <= planks; p++) {
      const y = p * PH;
      g.fillStyle = 'rgba(0,0,0,0.30)';
      g.fillRect(0, y - 1, w, 2);
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.fillRect(0, y + 1, w, 1);
    }
    for (let i = 0; i < 3; i++) knot(g, w, h, rng);
    addGrain(g, w, h, rng, 16);
  }

  // Nudo de la madera: anillos concéntricos.
  function knot(g, w, h, rng) {
    const x = rng() * w, y = rng() * h;
    const rx = rr(rng, 1.6, 2.6), ry = rr(rng, 1.0, 1.7);
    const rings = 4 + ((rng() * 4) | 0);
    const hasEllipse = typeof g.ellipse === 'function';
    wrapAt(w, h, x, y, rx * rings + 3, (bx, by) => {
      for (let r = rings; r >= 1; r--) {
        g.beginPath();
        if (hasEllipse) g.ellipse(bx, by, rx * r, ry * r, 0, 0, TAU);
        else g.arc(bx, by, ry * r, 0, TAU);
        g.strokeStyle = grey(0, 0.10 + 0.04 * (rings - r));
        g.lineWidth = rr(rng, 0.7, 1.4);
        g.stroke();
      }
    });
  }

  // Suciedad: tile con alfa para superponer sobre cualquier otra textura.
  function makeGrime(g, w, h, rng) {
    const f = fbm(w, h, rng, 3, 4, 0.5);
    const img = g.createImageData(w, h);
    const d = img.data;
    for (let i = 0, p = 0; i < f.length; i++, p += 4) {
      let t = clampNum((f[i] - 0.40) * 2.6, 0, 1);
      t = t * t * (3 - 2 * t);
      d[p] = d[p + 1] = d[p + 2] = 52 + rng() * 46; // gris medio: se deja teñir
      d[p + 3] = t * 150 * (0.65 + rng() * 0.7);
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 10; i++) blob(g, w, h, rng, rr(rng, 8, 30), 45, rr(rng, 0.10, 0.26));
    // Chorretones: ocupan todo el alto, así que casan por arriba y por abajo.
    for (let i = 0; i < 7; i++) {
      const x = rng() * w, wd = rr(rng, 2, 8), a = rr(rng, 0.05, 0.16);
      wrapAt(w, h, x, h * 0.5, wd, (bx) => {
        const grd = g.createLinearGradient(bx - wd, 0, bx + wd, 0);
        grd.addColorStop(0, grey(48, 0));
        grd.addColorStop(0.5, grey(48, a));
        grd.addColorStop(1, grey(48, 0));
        g.fillStyle = grd;
        g.fillRect(bx - wd, 0, wd * 2, h);
      });
    }
  }

  const DEFS = {
    concrete: { w: TILE, h: TILE, make: makeConcrete },
    asphalt: { w: TILE, h: TILE, make: makeAsphalt },
    brick: { w: TILE, h: TILE, make: makeBrick },
    metal: { w: TILE, h: TILE, make: makeMetal },
    rust: { w: TILE, h: TILE, make: makeRust },
    wood: { w: TILE, h: TILE, make: makeWood },
    grime: { w: TILE, h: TILE, make: makeGrime },
  };

  // -------------------------------------------------------- caché y construcción

  const tiles = Object.create(null);     // nombre -> canvas del tile base
  const pats = Object.create(null);      // nombre -> CanvasPattern
  const tintPats = Object.create(null);  // "nombre|tinte" -> CanvasPattern
  let tintCount = 0;
  const grainPats = [];
  let grainIx = 0;
  let built = false, ready = false;

  function buildTile(name, def, seed) {
    try {
      const t = mkCanvas(def.w, def.h);
      if (!t) return;
      def.make(t.g, def.w, def.h, makeRng(seed));
      const p = t.g.createPattern(t.c, 'repeat');
      if (!p) return;
      tiles[name] = t.c;
      pats[name] = p;
    } catch (e) { /* si una textura falla, las demás siguen */ }
  }

  // Grano de película: mitad motas claras y mitad oscuras, con alfa al cuadrado
  // para que la mayoría sean muy flojas. Son 65k píxeles por tile, así que aquí
  // el xorshift va en línea (sin closure ni división): cuesta la mitad.
  function buildGrain(seed) {
    try {
      const t = mkCanvas(GRAIN_TILE, GRAIN_TILE);
      if (!t) return;
      const img = t.g.createImageData(GRAIN_TILE, GRAIN_TILE);
      const d = img.data;
      let s = (seed >>> 0) || 1;
      for (let i = 0; i < d.length; i += 4) {
        s ^= s << 13;
        s >>>= 0;
        s ^= s >> 17;
        s ^= s << 5;
        s >>>= 0;
        const q = (s & 0xffff) / 65535;
        d[i] = d[i + 1] = d[i + 2] = (s & 0x10000) ? 255 : 0;
        d[i + 3] = q * q * 255;
      }
      t.g.putImageData(img, 0, 0);
      const p = t.g.createPattern(t.c, 'repeat');
      if (p) grainPats.push(p);
    } catch (e) { /* nada */ }
  }

  // Se llama una vez al cargar; si aún no hay DOM se reintenta en el primer uso.
  function ensure() {
    if (ready) return true;
    if (typeof document === 'undefined' || !document.createElement) return false;
    if (built) return ready;
    built = true;
    let i = 0;
    for (const name in DEFS) buildTile(name, DEFS[name], SEED + i++ * 7919);
    for (let k = 0; k < GRAIN_COUNT; k++) buildGrain(SEED + 104729 + k * 1361);
    ready = true;
    return true;
  }

  // ------------------------------------------------------------------- tinte

  // Resuelve cualquier color CSS a [r,g,b] usando el propio canvas.
  function resolveTint(css) {
    if (typeof css !== 'string' || !css) return null;
    const s = mkCanvas(1, 1);
    if (!s) return null;
    try {
      s.g.fillStyle = '#010203';
      s.g.fillStyle = css;
      if (s.g.fillStyle === '#010203' && css !== '#010203') return null; // color inválido
      s.g.fillRect(0, 0, 1, 1);
      const d = s.g.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]];
    } catch (e) {
      return null;
    }
  }

  // Multiplicar por frame saldría caro, así que se pregenera el tile teñido y
  // se cachea por (nombre + tinte).
  function tintedPattern(name, tint) {
    const key = name + '|' + tint;
    const hit = tintPats[key];
    if (hit) return hit;
    if (tintCount >= MAX_TINTS) return pats[name] || null;
    const base = tiles[name];
    if (!base) return null;
    const rgb = resolveTint(tint);
    if (!rgb) return pats[name] || null;
    const t = mkCanvas(base.width, base.height);
    if (!t) return pats[name] || null;
    try {
      t.g.drawImage(base, 0, 0);
      const img = t.g.getImageData(0, 0, base.width, base.height);
      const d = img.data;
      const kr = rgb[0] / 255, kg = rgb[1] / 255, kb = rgb[2] / 255;
      for (let p = 0; p < d.length; p += 4) {
        d[p] *= kr;
        d[p + 1] *= kg;
        d[p + 2] *= kb;
      }
      t.g.putImageData(img, 0, 0);
      const p = t.g.createPattern(t.c, 'repeat');
      if (!p) return pats[name] || null;
      tintPats[key] = p;
      tintCount++;
      return p;
    } catch (e) {
      return pats[name] || null;
    }
  }

  // ------------------------------------------------ anclaje del patrón al mundo

  // Objeto reutilizado: setTransform acepta un DOMMatrix2DInit plano, así no
  // se asigna memoria en cada frame.
  const PM = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  let useDomMatrix = false;

  function setPatOffset(pat, dx, dy) {
    if (!pat || typeof pat.setTransform !== 'function') return false;
    PM.e = dx;
    PM.f = dy;
    try {
      if (useDomMatrix) {
        pat.setTransform(new DOMMatrix([1, 0, 0, 1, dx, dy]));
      } else {
        pat.setTransform(PM);
      }
      return true;
    } catch (e) {
      // Algún motor exige un DOMMatrix de verdad: se prueba una vez y se recuerda.
      if (!useDomMatrix && typeof DOMMatrix === 'function') {
        try {
          pat.setTransform(new DOMMatrix([1, 0, 0, 1, dx, dy]));
          useDomMatrix = true;
          return true;
        } catch (e2) { /* nada */ }
      }
      return false;
    }
  }

  // -------------------------------------------------------------- API pública

  // Devuelve el CanvasPattern (ya sin desplazamiento) o null si no existe.
  function pattern(name) {
    try {
      if (!ensure()) return null;
      const p = pats[name];
      if (!p) return null;
      setPatOffset(p, 0, 0);
      return p;
    } catch (e) {
      return null;
    }
  }

  // Rellena un rectángulo con una textura anclada a coordenadas de MUNDO:
  // pásale scrollX (la x de la cámara) y el dibujo no patina al hacer scroll.
  // Si el contexto ya viene trasladado por la cámara (ctx.translate(-camX, 0)),
  // el patrón ya va pegado al mundo: en ese caso no hace falta scrollX.
  // opts: { alpha, tint, scrollX, scrollY }
  function fillRect(ctx, x, y, w, h, name, opts) {
    try {
      if (!ctx || !ensure()) return;
      const def = DEFS[name];
      if (!def) return;
      const rx = num(x, 0), ry = num(y, 0), rw = num(w, 0), rh = num(h, 0);
      if (rw <= 0 || rh <= 0) return;
      const o = opts || NOPTS;
      const pat = typeof o.tint === 'string' && o.tint ? tintedPattern(name, o.tint) : pats[name];
      if (!pat) return;
      const a = clampNum(num(o.alpha, 1), 0, 1);
      if (a <= 0) return;

      // Fase del patrón: se redondea para que el tile caiga en píxeles enteros.
      const ox = -mod(Math.round(num(o.scrollX, 0)), def.w);
      const oy = -mod(Math.round(num(o.scrollY, 0)), def.h);

      const prevA = ctx.globalAlpha;
      const prevF = ctx.fillStyle;
      if (a !== 1) ctx.globalAlpha = prevA * a;
      ctx.fillStyle = pat;
      if (setPatOffset(pat, ox, oy)) {
        ctx.fillRect(rx, ry, rw, rh);
      } else {
        // Sin setTransform: se mueve el contexto y se compensa el rectángulo.
        ctx.save();
        ctx.translate(ox, oy);
        ctx.fillRect(rx - ox, ry - oy, rw, rh);
        ctx.restore();
      }
      ctx.globalAlpha = prevA;
      ctx.fillStyle = prevF;
    } catch (e) { /* nunca revienta el bucle de dibujo */ }
  }

  // Grano de película sobre toda la pantalla: un solo fillRect con patrón.
  // Alterna tiles y los desplaza al azar para que el grano se mueva.
  function grain(ctx, w, h, alpha) {
    try {
      if (!ctx || !ensure() || grainPats.length === 0) return;
      const a = clampNum(num(alpha, 0.05), 0, 1);
      const rw = num(w, 0), rh = num(h, 0);
      if (a <= 0 || rw <= 0 || rh <= 0) return;
      grainIx = (grainIx + 1) % grainPats.length;
      const p = grainPats[grainIx];
      setPatOffset(p, (Math.random() * GRAIN_TILE) | 0, (Math.random() * GRAIN_TILE) | 0);
      const prevA = ctx.globalAlpha;
      const prevF = ctx.fillStyle;
      ctx.globalAlpha = prevA * a;
      ctx.fillStyle = p;
      ctx.fillRect(0, 0, rw, rh);
      ctx.globalAlpha = prevA;
      ctx.fillStyle = prevF;
    } catch (e) { /* nada */ }
  }

  // Canvas fuera de pantalla con ruido, por si hace falta para otra cosa.
  // opts: { mono, scale, alpha }. Con scale > 1 el ruido sale a bloques.
  function noise(w, h, opts) {
    try {
      const o = opts || NOPTS;
      const W = clampNum(Math.round(num(w, TILE)), 1, 2048);
      const H = clampNum(Math.round(num(h, TILE)), 1, 2048);
      const sc = clampNum(Math.round(num(o.scale, 1)), 1, 64);
      const mono = o.mono !== false;
      const a = clampNum(num(o.alpha, 1), 0, 1);
      const sw = Math.max(1, Math.ceil(W / sc)), sh = Math.max(1, Math.ceil(H / sc));
      const small = mkCanvas(sw, sh);
      if (!small) return null;
      const img = small.g.createImageData(sw, sh);
      const d = img.data;
      const rng = makeRng((Math.random() * 4294967296) >>> 0);
      const av = (a * 255) | 0;
      for (let p = 0; p < d.length; p += 4) {
        if (mono) {
          const v = (rng() * 256) | 0;
          d[p] = d[p + 1] = d[p + 2] = v;
        } else {
          d[p] = (rng() * 256) | 0;
          d[p + 1] = (rng() * 256) | 0;
          d[p + 2] = (rng() * 256) | 0;
        }
        d[p + 3] = av;
      }
      small.g.putImageData(img, 0, 0);
      if (sc === 1) return small.c;
      const big = mkCanvas(W, H);
      if (!big) return small.c;
      big.g.imageSmoothingEnabled = false; // vecino más cercano: sigue embaldosando
      big.g.drawImage(small.c, 0, 0, W, H);
      return big.c;
    } catch (e) {
      return null;
    }
  }

  // Se genera todo al cargar; si el DOM no estuviera listo, el primer uso lo hace.
  try { ensure(); } catch (e) { /* nada */ }

  return {
    pattern,
    fillRect,
    grain,
    noise,
  };
})();
