// Paisaje: cielo, ciudad a contraluz con detalle, atmósfera y una capa que
// pasa por delante de la cámara. Todo lo caro se hornea una vez en canvas
// fuera de pantalla; en cada frame solo se hace drawImage y cuatro adornos.

const Scenery = (() => {
  let W = 960;
  let H = 540;
  let GY = 470;
  let ready = false;

  const layers = []; // ciudad, de lejos a cerca
  const beacons = []; // luces de antena que parpadean (no se pueden hornear)
  let cloudCanvas = null;
  let overhead = null; // cables y farolas que pasan por delante
  let street = null;   // mobiliario urbano a pie de calle
  const motes = [];
  const birds = [];

  // Tonos de cada capa: la profundidad la da el color (bruma), no el alfa.
  const TONES = [
    ["#4d3c63", "#9a7178"],
    ["#2c2242", "#5b3f54"],
    ["#161227", "#2b1f30"],
  ];
  const WINDOW_TONES = ["rgba(255,214,150,", "rgba(255,190,120,", "rgba(255,170,110,"];

  function rngFrom(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  // --- una capa de ciudad, con ventanas y trastos en las azoteas ---
  function buildCityLayer(index, rng) {
    const tileW = 1200;
    const c = makeCanvas(tileW, H);
    const g = c.getContext("2d");
    const baseY = [330, 380, 440][index];
    const maxH = [150, 190, 230][index];
    const lit = [0.5, 0.36, 0.2][index]; // los de lejos brillan más (bruma)
    const winAlpha = [0.55, 0.34, 0.18][index];

    const body = g.createLinearGradient(0, 120, 0, GY);
    body.addColorStop(0, TONES[index][0]);
    body.addColorStop(1, TONES[index][1]);

    let x = -40;
    while (x < tileW + 40) {
      const bw = 40 + rng() * 90;
      const bh = 40 + rng() * maxH;
      const top = baseY - bh;

      g.fillStyle = body;
      g.fillRect(x, top, bw, bh + 200);

      // filo iluminado por el sol (está a la derecha): da volumen al bloque
      g.fillStyle = `rgba(255,205,150,${0.1 + lit * 0.14})`;
      g.fillRect(x + bw - 2, top, 2, bh + 200);
      g.fillStyle = `rgba(255,225,180,${0.08 + lit * 0.1})`;
      g.fillRect(x, top, bw, 2);

      // ventanas
      const cols = Math.max(1, Math.floor(bw / 13));
      const rows = Math.max(1, Math.floor(bh / 16));
      const padX = (bw - cols * 8) / (cols + 1);
      for (let cx = 0; cx < cols; cx++) {
        for (let cy = 0; cy < rows; cy++) {
          if (rng() > (index === 2 ? 0.3 : 0.44)) continue;
          const wx = x + padX + cx * (8 + padX);
          const wy = top + 9 + cy * 16;
          if (wy > GY - 6) continue;
          const tone = WINDOW_TONES[Math.floor(rng() * WINDOW_TONES.length)];
          g.fillStyle = tone + (winAlpha * (0.45 + rng() * 0.55)).toFixed(2) + ")";
          g.fillRect(wx, wy, 5, 7);
        }
      }

      // trastos de azotea: depósito de agua, cajas, antena
      const roll = rng();
      if (roll < 0.22 && bw > 55) {
        const tw = 16 + rng() * 10;
        g.fillStyle = body;
        g.fillRect(x + bw * 0.5 - tw / 2, top - 16, tw, 16);
        g.fillRect(x + bw * 0.5 - tw / 2 + 2, top - 22, tw - 4, 6);
      } else if (roll < 0.42) {
        g.fillStyle = body;
        g.fillRect(x + 6 + rng() * (bw - 26), top - 7, 12 + rng() * 8, 7);
      }
      if (rng() < 0.3) {
        const ax = x + bw * (0.3 + rng() * 0.4);
        const ah = 18 + rng() * 26;
        g.fillStyle = body;
        g.fillRect(ax, top - ah, 2, ah);
        if (index >= 1 && rng() < 0.55) {
          beacons.push({ layer: index, x: ax + 1, y: top - ah - 2, phase: rng() * 6.28 });
        }
      }

      x += bw + 6 + rng() * 40;
    }

    return { canvas: c, tileW, speed: [0.12, 0.26, 0.48][index] };
  }

  // --- mobiliario a pie de calle, justo detrás del plano de juego ---
  // Va en un tono apagado y luego lo tapa la bruma: así se lee como fondo y
  // nunca se confunde con un obstáculo, que siempre es negro puro.
  function buildStreetLayer(rng) {
    const tileW = 1500;
    const top = GY - 150;
    const c = makeCanvas(tileW, 150);
    const g = c.getContext("2d");
    const body = g.createLinearGradient(0, 0, 0, 150);
    body.addColorStop(0, "#412f4e");
    body.addColorStop(1, "#1d1529");
    const B = 150; // línea de suelo dentro del tile

    // filo cálido en la cara derecha de cualquier bulto (el sol está allí)
    const edge = (x, y, w, h) => {
      g.fillStyle = "rgba(255,198,140,0.20)";
      g.fillRect(x + w - 1.5, y, 1.5, h);
      g.fillStyle = "rgba(255,216,168,0.16)";
      g.fillRect(x, y, w, 1.5);
    };
    const box = (x, y, w, h) => { g.fillStyle = body; g.fillRect(x, y, w, h); edge(x, y, w, h); };

    let x = 0;
    while (x < tileW) {
      const roll = rng();

      if (roll < 0.12) {
        // farola con brazo curvo y lámpara encendida
        const h = 74 + rng() * 26;
        box(x, B - h, 4, h);
        g.fillStyle = body;
        g.beginPath();
        g.moveTo(x + 2, B - h);
        g.quadraticCurveTo(x + 2, B - h - 13, x + 19, B - h - 13);
        g.lineTo(x + 19, B - h - 10);
        g.quadraticCurveTo(x + 5, B - h - 10, x + 5, B - h);
        g.closePath();
        g.fill();
        g.fillStyle = "rgba(255,222,160,0.62)";
        g.fillRect(x + 15, B - h - 11, 9, 4);
        const halo = g.createRadialGradient(x + 19, B - h - 8, 1, x + 19, B - h - 8, 34);
        halo.addColorStop(0, "rgba(255,216,150,0.24)");
        halo.addColorStop(1, "rgba(255,216,150,0)");
        g.fillStyle = halo;
        g.fillRect(x - 15, B - h - 42, 68, 68);
        x += 30 + rng() * 40;
        continue;
      }

      if (roll < 0.36) {
        // valla de obra metálica: marco y malla
        const w = 80 + rng() * 50, h = 44;
        g.fillStyle = body;
        g.fillRect(x, B - h, w, 3);
        g.fillRect(x, B - 4, w, 4);
        g.fillRect(x, B - h, 3, h);
        g.fillRect(x + w - 3, B - h, 3, h);
        g.strokeStyle = "rgba(190,164,190,0.16)";
        g.lineWidth = 1;
        g.beginPath();
        for (let m = -h; m < w; m += 9) {
          g.moveTo(x + m, B); g.lineTo(x + m + h, B - h);
          g.moveTo(x + m, B - h); g.lineTo(x + m + h, B);
        }
        g.save();
        g.beginPath(); g.rect(x + 3, B - h + 3, w - 6, h - 7); g.clip();
        g.stroke();
        g.restore();
        edge(x, B - h, w, h);
        x += w + 10 + rng() * 50;
        continue;
      }

      if (roll < 0.5) {
        // contenedor con tapa entreabierta
        const w = 54 + rng() * 22, h = 30 + rng() * 8;
        box(x, B - h, w, h);
        g.fillStyle = body;
        g.beginPath();
        g.moveTo(x - 2, B - h);
        g.lineTo(x + w * 0.62, B - h - 9);
        g.lineTo(x + w * 0.66, B - h - 5);
        g.lineTo(x + 2, B - h + 3);
        g.closePath();
        g.fill();
        g.fillStyle = "rgba(255,198,140,0.18)";
        g.fillRect(x + w * 0.2, B - h - 6, w * 0.42, 1.5);
        x += w + 16 + rng() * 60;
        continue;
      }

      if (roll < 0.62) {
        // coche aparcado, de perfil
        const w = 104 + rng() * 34;
        const roof = 26 + rng() * 5;
        g.fillStyle = body;
        g.beginPath();
        g.moveTo(x, B - 14);
        g.quadraticCurveTo(x + 2, B - 22, x + w * 0.2, B - 23);
        g.lineTo(x + w * 0.31, B - 23 - roof);
        g.quadraticCurveTo(x + w * 0.5, B - 26 - roof, x + w * 0.69, B - 23 - roof);
        g.lineTo(x + w * 0.82, B - 23);
        g.quadraticCurveTo(x + w - 2, B - 22, x + w, B - 14);
        g.lineTo(x + w, B - 5);
        g.lineTo(x, B - 5);
        g.closePath();
        g.fill();
        g.fillStyle = "rgba(255,206,150,0.22)"; // reflejo del amanecer en el techo
        g.fillRect(x + w * 0.32, B - 24 - roof, w * 0.36, 2);
        g.fillStyle = "rgba(190,170,200,0.13)"; // cristales
        g.fillRect(x + w * 0.34, B - 21 - roof, w * 0.13, roof - 4);
        g.fillRect(x + w * 0.52, B - 21 - roof, w * 0.15, roof - 4);
        g.fillStyle = "#0b0914";
        for (const cx of [x + w * 0.24, x + w * 0.76]) {
          g.beginPath(); g.arc(cx, B - 6, 9, 0, 6.29); g.fill();
        }
        x += w + 20 + rng() * 70;
        continue;
      }

      if (roll < 0.72) {
        // árbol raquítico de acera
        const h = 54 + rng() * 26;
        const cx = x + 3;
        g.fillStyle = body;
        g.beginPath();                      // tronco que se abre en dos ramas
        g.moveTo(cx - 3, B);
        g.lineTo(cx - 2, B - h * 0.6);
        g.lineTo(cx - 9, B - h);
        g.lineTo(cx - 5, B - h);
        g.lineTo(cx + 1, B - h * 0.62);
        g.lineTo(cx + 8, B - h * 0.95);
        g.lineTo(cx + 11, B - h * 0.9);
        g.lineTo(cx + 3, B - h * 0.55);
        g.lineTo(cx + 3, B);
        g.closePath();
        g.fill();
        // copa: elipses solapadas, densas en el centro y deshilachadas fuera
        const clumps = [];
        for (let i = 0; i < 14; i++) {
          const a = rng() * 6.28;
          const r = (i < 6 ? 6 : 16) + rng() * 16;
          clumps.push({ cx: cx + Math.cos(a) * r, cy: B - h - 6 + Math.sin(a) * r * 0.62,
                        rx: 11 + rng() * 11, ry: 8 + rng() * 8 });
        }
        g.fillStyle = body;
        g.beginPath();
        for (const c2 of clumps) { g.moveTo(c2.cx + c2.rx, c2.cy); g.ellipse(c2.cx, c2.cy, c2.rx, c2.ry, 0, 0, 6.28); }
        g.fill();
        // el amanecer solo roza la parte de arriba de la copa
        g.save();
        g.beginPath();
        for (const c2 of clumps) { g.moveTo(c2.cx + c2.rx, c2.cy); g.ellipse(c2.cx, c2.cy, c2.rx, c2.ry, 0, 0, 6.28); }
        g.clip();
        const lightTop = g.createLinearGradient(0, B - h - 30, 0, B - h + 6);
        lightTop.addColorStop(0, "rgba(255,206,152,0.30)");
        lightTop.addColorStop(1, "rgba(255,206,152,0)");
        g.fillStyle = lightTop;
        g.fillRect(cx - 50, B - h - 34, 100, 46);
        g.restore();
        x += 40 + rng() * 80;
        continue;
      }

      if (roll < 0.8) {
        // marquesina de autobús
        const w = 96 + rng() * 30;
        g.fillStyle = body;
        g.fillRect(x, B - 62, w, 5);
        g.fillRect(x, B - 62, 4, 62);
        g.fillRect(x + w - 4, B - 62, 4, 62);
        g.fillRect(x + w * 0.62, B - 40, w * 0.3, 16); // banco
        g.fillStyle = "rgba(196,176,210,0.1)";
        g.fillRect(x + 4, B - 57, w - 8, 40);
        g.fillStyle = "rgba(255,214,158,0.3)"; // panel iluminado
        g.fillRect(x + 8, B - 53, 16, 26);
        edge(x, B - 62, w, 62);
        x += w + 24 + rng() * 80;
        continue;
      }

      if (roll < 0.87) {
        // pila de palés y bidones
        const n = 2 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) box(x + i * 3, B - 9 - i * 8, 30 + rng() * 10, 8);
        g.fillStyle = body;
        g.fillRect(x + 42, B - 26, 15, 26);
        g.fillStyle = "rgba(255,198,140,0.16)";
        for (let i = 0; i < 3; i++) g.fillRect(x + 42, B - 22 + i * 8, 15, 1);
        x += 70 + rng() * 80;
        continue;
      }

      // tramo de acera vacío: el ritmo también necesita aire
      x += 60 + rng() * 150;
    }

    return { canvas: c, tileW, top, speed: 0.7 };
  }

  // --- nubes largas y blandas, horneadas una vez ---
  function buildClouds(rng) {
    const c = makeCanvas(1400, 260);
    const g = c.getContext("2d");
    for (let i = 0; i < 16; i++) {
      const cx = rng() * 1400;
      const cy = 40 + rng() * 170;
      const w = 120 + rng() * 260;
      const h = 12 + rng() * 22;
      const a = 0.05 + rng() * 0.09;
      const grad = g.createLinearGradient(cx - w / 2, cy, cx + w / 2, cy);
      grad.addColorStop(0, "rgba(255,200,170,0)");
      grad.addColorStop(0.5, `rgba(255,214,186,${a})`);
      grad.addColorStop(1, "rgba(255,200,170,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
      g.fill();
      // la misma nube repetida al otro lado, para que la cinta case
      g.beginPath();
      g.ellipse(cx - 1400, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  }

  // --- cables y farolas que cruzan por DELANTE de la cámara ---
  // Van más rápido que el mundo (parallax de primer plano), así que cruzan
  // la escena de vez en cuando: es lo mismo que una farola de verdad pasando
  // rápido en primer término al correr. El poste llega hasta el suelo de
  // verdad (antes se cortaba en seco a media altura y quedaba flotando): el
  // canvas mide GY de alto y su borde inferior es la línea de suelo, igual
  // que la calle y el propio juego.
  function buildOverhead(rng) {
    const tileW = 1400;
    const baseH = GY;
    const c = makeCanvas(tileW, baseH);
    const g = c.getContext("2d");
    g.strokeStyle = "rgba(6,7,14,0.85)";
    g.fillStyle = "rgba(6,7,14,0.9)";

    let x = 40;
    while (x < tileW) {
      const poleH = 150 + rng() * 90;
      const foot = baseH;               // el pie del poste pisa el suelo
      g.fillRect(x, foot - poleH, 7, poleH);
      // base ensanchada para que se lea como algo apoyado, no clavado en el aire
      g.fillRect(x - 2, foot - 6, 11, 6);
      // brazo con farola
      const arm = 26 + rng() * 22;
      g.fillRect(x + 7, foot - poleH + 6, arm, 5);
      g.beginPath();
      g.ellipse(x + 7 + arm, foot - poleH + 14, 7, 5, 0, 0, Math.PI * 2);
      g.fill();
      // cables colgando hacia el siguiente poste
      const next = x + 300 + rng() * 240;
      g.lineWidth = 2;
      for (let k = 0; k < 2; k++) {
        const y0 = foot - poleH + 18 + k * 10;
        g.beginPath();
        g.moveTo(x + 7, y0);
        g.quadraticCurveTo((x + next) / 2, y0 + 34 + k * 8, next, y0);
        g.stroke();
      }
      x = next;
    }
    return { canvas: c, tileW };
  }

  // --- relieve del suelo: grietas, cascotes y charcos, horneado una vez ---
  let groundTile = null;
  const GROUND_TILE_W = 760;  // ancho generoso: si es corto, la repetición canta
  const GROUND_TILE_H = 90;

  function buildGroundTile(rng) {
    const c = makeCanvas(GROUND_TILE_W, GROUND_TILE_H);
    const g = c.getContext("2d");

    // base con un punto de luz que se apaga hacia abajo
    const base = g.createLinearGradient(0, 0, 0, GROUND_TILE_H);
    base.addColorStop(0, "#14151f");
    base.addColorStop(0.18, "#0c0d16");
    base.addColorStop(1, "#05060c");
    g.fillStyle = base;
    g.fillRect(0, 0, GROUND_TILE_W, GROUND_TILE_H);

    // grano
    for (let i = 0; i < 2100; i++) {
      const a = 0.02 + rng() * 0.05;
      g.fillStyle = rng() < 0.5 ? `rgba(255,220,180,${a})` : `rgba(0,0,0,${a * 2})`;
      g.fillRect(rng() * GROUND_TILE_W, rng() * GROUND_TILE_H, 1, 1);
    }

    // juntas de las losas: verticales tenues que embaldosan
    g.strokeStyle = "rgba(255,210,165,0.07)";
    g.lineWidth = 1;
    for (let x = 60; x < GROUND_TILE_W; x += 95 + rng() * 70) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + (rng() - 0.5) * 4, 20 + rng() * 40);
      g.stroke();
    }

    // grietas ramificadas
    g.strokeStyle = "rgba(0,0,0,0.28)";
    for (let i = 0; i < 4; i++) {
      let x = rng() * GROUND_TILE_W;
      let y = 6 + rng() * 26;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (rng() - 0.5) * 34;
        y += 4 + rng() * 10;
        g.lineTo(x, y);
      }
      g.stroke();
    }

    // charcos: reflejan el cielo, es lo que más vida le da al asfalto
    for (let i = 0; i < 2; i++) {
      const px = rng() * GROUND_TILE_W;
      const pw = 30 + rng() * 60;
      const py = 4 + rng() * 10;
      const pud = g.createLinearGradient(0, py, 0, py + 7);
      pud.addColorStop(0, "rgba(255,196,140,0.13)");
      pud.addColorStop(1, "rgba(120,90,140,0.04)");
      g.fillStyle = pud;
      g.beginPath();
      g.ellipse(px, py + 3, pw / 2, 3.5, 0, 0, Math.PI * 2);
      g.fill();
    }

    // cascotes sueltos
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(255,215,175,${0.05 + rng() * 0.09})`;
      const sx = rng() * GROUND_TILE_W;
      const sy = 3 + rng() * 22;
      g.fillRect(sx, sy, 1 + rng() * 2.5, 1 + rng() * 1.6);
    }

    return c;
  }

  // Dibuja el relieve del suelo en un tramo, anclado al mundo para que no
  // patine con la cámara. Se llama por tramo continuo, así que un suelo falso
  // intacto recibe exactamente la misma textura que el suelo bueno.
  function drawGroundStrip(ctx, x0, x1, y) {
    if (!groundTile) return;
    const start = Math.floor(x0 / GROUND_TILE_W) * GROUND_TILE_W;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y, x1 - x0, GROUND_TILE_H);
    ctx.clip();
    for (let x = start; x < x1; x += GROUND_TILE_W) {
      ctx.drawImage(groundTile, x, y);
    }
    ctx.restore();
  }

  function init(width, height, groundY) {
    W = width;
    H = height;
    GY = groundY;
    layers.length = 0;
    beacons.length = 0;
    motes.length = 0;
    birds.length = 0;

    const rng = rngFrom(20260919);
    for (let i = 0; i < 3; i++) layers.push(buildCityLayer(i, rng));
    cloudCanvas = buildClouds(rng);
    street = buildStreetLayer(rng);
    groundTile = buildGroundTile(rng);
    overhead = buildOverhead(rng);

    for (let i = 0; i < 46; i++) {
      motes.push({
        x: rng() * W * 2,
        y: 120 + rng() * (GY - 140),
        r: 0.7 + rng() * 1.6,
        sp: 0.25 + rng() * 0.5, // parallax propio
        drift: rng() * 6.28,
        a: 0.12 + rng() * 0.3,
      });
    }
    for (let i = 0; i < 7; i++) {
      birds.push({ x: rng() * 2400, y: 90 + rng() * 150, sp: 14 + rng() * 16, phase: rng() * 6.28, size: 3 + rng() * 3 });
    }
    ready = true;
  }

  // --- cielo, sol y rayos ---
  function drawSky(ctx, camX, t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#111d42");
    g.addColorStop(0.38, "#5e3566");
    g.addColorStop(0.68, "#d9694a");
    g.addColorStop(0.9, "#ffc478");
    g.addColorStop(1, "#ffe7b6");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const sx = W * 0.72;
    const sy = H * 0.64;

    // rayos de sol: triángulos larguísimos y casi invisibles
    ctx.save();
    ctx.translate(sx, sy);
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9 + Math.sin(t * 0.08 + i) * 0.06;
      const spread = 0.05 + (i % 3) * 0.02;
      ctx.fillStyle = `rgba(255,214,160,${0.045 + (i % 2) * 0.02})`;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a - spread) * 900, Math.sin(a - spread) * 900);
      ctx.lineTo(Math.cos(a + spread) * 900, Math.sin(a + spread) * 900);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    const sun = ctx.createRadialGradient(sx, sy, 6, sx, sy, 200);
    sun.addColorStop(0, "rgba(255,244,214,0.97)");
    sun.addColorStop(0.32, "rgba(255,192,124,0.38)");
    sun.addColorStop(1, "rgba(255,170,90,0)");
    ctx.fillStyle = sun;
    ctx.fillRect(sx - 210, sy - 210, 420, 420);

    // nubes
    if (cloudCanvas) {
      const off = -((camX * 0.05 + t * 5) % 1400);
      ctx.drawImage(cloudCanvas, off, 60);
      ctx.drawImage(cloudCanvas, off + 1400, 60);
    }

    // pájaros lejanos
    ctx.strokeStyle = "rgba(22,16,30,0.5)";
    ctx.lineWidth = 1.5;
    for (const b of birds) {
      const bx = ((b.x - camX * 0.08 - t * b.sp) % 2400 + 2400) % 2400 - 200;
      if (bx < -40 || bx > W + 40) continue;
      const flap = Math.sin(t * 6 + b.phase) * b.size * 0.6;
      ctx.beginPath();
      ctx.moveTo(bx - b.size, b.y + flap);
      ctx.lineTo(bx, b.y);
      ctx.lineTo(bx + b.size, b.y + flap);
      ctx.stroke();
    }

    // ciudad
    for (const layer of layers) {
      const off = -((camX * layer.speed) % layer.tileW);
      ctx.drawImage(layer.canvas, off, 0);
      ctx.drawImage(layer.canvas, off + layer.tileW, 0);
    }

    // luces de antena parpadeando
    for (const b of beacons) {
      const layer = layers[b.layer];
      const off = -((camX * layer.speed) % layer.tileW);
      for (let rep = 0; rep < 2; rep++) {
        const bx = b.x + off + rep * layer.tileW;
        if (bx < -10 || bx > W + 10) continue;
        const pulse = 0.35 + 0.65 * Math.pow(Math.max(0, Math.sin(t * 1.7 + b.phase)), 6);
        ctx.fillStyle = `rgba(255,90,70,${0.75 * pulse})`;
        ctx.fillRect(bx - 1.5, b.y - 1.5, 3, 3);
      }
    }

    // bruma cálida: hunde la base de la ciudad y recorta el primer plano
    const haze = ctx.createLinearGradient(0, GY - 200, 0, GY);
    haze.addColorStop(0, "rgba(255,196,132,0)");
    haze.addColorStop(0.72, "rgba(255,206,150,0.24)");
    haze.addColorStop(1, "rgba(255,226,182,0.46)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, GY - 200, W, 200);

    // Mobiliario a pie de calle. Va después de la bruma general (si no, se
    // lo traga) y lleva la suya propia, mucho más floja: queda separado de
    // la ciudad y a la vez nunca compite con el negro puro del juego.
    if (street) {
      const off = -((camX * street.speed) % street.tileW);
      ctx.drawImage(street.canvas, off, street.top);
      ctx.drawImage(street.canvas, off + street.tileW, street.top);
      const near = ctx.createLinearGradient(0, street.top, 0, GY);
      near.addColorStop(0, "rgba(255,200,146,0.05)");
      near.addColorStop(1, "rgba(255,216,168,0.20)");
      ctx.fillStyle = near;
      ctx.fillRect(0, street.top, W, GY - street.top);
    }
  }

  // Motas de polvo flotando en la luz. Van después del suelo para que se vean
  // también sobre el primer plano.
  function drawMotes(ctx, camX, t) {
    for (const m of motes) {
      const x = ((m.x - camX * m.sp) % (W * 2) + W * 2) % (W * 2);
      if (x > W + 6) continue;
      const y = m.y + Math.sin(t * 0.7 + m.drift) * 9;
      ctx.fillStyle = `rgba(255,226,180,${m.a})`;
      ctx.beginPath();
      ctx.arc(x, y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Cables y farolas cruzando por delante, más rápido que el resto.
  function drawOverhead(ctx, camX) {
    if (!overhead) return;
    const off = -((camX * 1.35) % overhead.tileW);
    ctx.drawImage(overhead.canvas, off, 0);
    ctx.drawImage(overhead.canvas, off + overhead.tileW, 0);
  }

  return {
    init,
    drawSky,
    drawMotes,
    drawOverhead,
    drawGroundStrip,
    isReady: () => ready,
  };
})();
