// Corredor humano en silueta (estilo Vector) dibujado 100% con Canvas 2D.
//
// La figura entera se pinta como UN SOLO path relleno: los solapes entre
// miembros se funden con la regla nonzero, así que no hay costuras ni dobles
// mezclas cuando alpha < 1. Para que eso funcione TODOS los subpaths deben
// recorrerse en el mismo sentido; los helpers cap()/dot() ya lo garantizan.
//
// Sistema local: suelo en y = 0, y negativa hacia arriba, x positiva hacia
// delante (el volteo se hace con scale(facing, 1)). Cuerpo de pie = 100 u.
// Los ángulos de los miembros son absolutos: 0 = apuntando hacia abajo,
// positivo = hacia delante.

const Runner = (() => {
  const sin = Math.sin, cos = Math.cos, atan2 = Math.atan2;
  const PI = Math.PI, TAU = PI * 2, HALF = PI * 0.5;

  // ---------- proporciones del esqueleto ----------
  const HIP_Y = -47;      // altura de cadera en reposo
  const TORSO = 31;       // cadera -> base del cuello
  const HEADD = 13;       // base del cuello -> centro de la cabeza
  const THIGH = 22, SHIN = 21, FOOT = 9;
  const UPARM = 20, FARM = 18;
  const SH_DROP = 4;      // hombros un poco por debajo del cuello
  const SH_HALF = 2.6;    // separación hombro delantero/trasero (vista lateral)
  const HIP_HALF = 1.8;

  // ---------- grosores (radio de cada cápsula) ----------
  const R_HIP = 8.4, R_CHEST = 10, R_NECK = 3.8, R_HEAD = 8.4;
  const R_THIGH = 7.4, R_KNEE = 5.2, R_ANK = 3.4, R_TOE = 2.6;
  const R_SH = 5.2, R_ELB = 4, R_HAND = 3.4;

  // ---------- índices de articulación en el buffer J ----------
  const HIP = 0, CHEST = 1, HEAD = 2;
  const SHB = 3, ELB = 4, HNB = 5;      // brazo trasero
  const SHF = 6, ELF = 7, HNF = 8;      // brazo delantero
  const KNB = 9, ANB = 10, TOB = 11;    // pierna trasera
  const KNF = 12, ANF = 13, TOF = 14;   // pierna delantera
  const J = new Float32Array(30);       // 15 articulaciones x (x,y), reutilizado

  const POSES = ["run", "jump", "fall", "slide", "vault", "wallJump", "roll", "stumble", "idle", "caught"];
  const NOPTS = {};   // opts por defecto: evita crear {} en cada llamada

  // ---------- estado de pose (escalares reutilizados, cero asignaciones) ----------
  let hipX = 0, hipY = HIP_Y, lean = 0.1, tilt = 0;
  let rot = 0, pivX = 0, pivY = -40, snap = false, clamp = false;
  let curT = 0, curSp = 0;
  // piernas y brazos: ángulos absolutos ya resueltos
  let bT = 0, bS = 0, bF = 0, fT = 0, fS = 0, fF = 0;
  let baU = 0, baL = 0, faU = 0, faL = 0;

  // ---------- utilidades ----------
  function num(v, d) { return typeof v === "number" && v === v && v !== Infinity && v !== -Infinity ? v : d; }
  function cl01(v, d) { const n = num(v, d); return n < 0 ? 0 : n > 1 ? 1 : n; }
  function mix(a, b, k) { return a + (b - a) * k; }

  // piernas: muslo, flexión de rodilla (positiva = talón atrás), giro del pie
  function legs(t1, k1, p1, t2, k2, p2) {
    bT = t1; bS = t1 - k1; bF = bS + p1;
    fT = t2; fS = t2 - k2; fF = fS + p2;
  }
  // brazos: hombro y flexión de codo (positiva = mano hacia delante)
  function arms(u1, e1, u2, e2) {
    baU = u1; baL = u1 + e1;
    faU = u2; faL = u2 + e2;
  }

  // ---------- poses ----------
  function setPose(pose, t, sp, ph) {
    hipX = 0; hipY = HIP_Y; lean = 0.1; tilt = 0;
    rot = 0; pivX = 0; pivY = -40; snap = false; clamp = false;
    curT = t; curSp = sp;

    switch (pose) {
      case "run": {
        const u = t * (9 + 7 * sp);
        const cu = cos(u), su = sin(u);
        lean = 0.14 + 0.26 * sp;
        tilt = -0.10 - 0.10 * sp;
        // el muslo oscila como un seno; la rodilla se dobla de golpe solo en
        // la fase de recobro (curva cúbica con un único pico)
        const rb = (1 - su) * 0.5, rf = (1 + su) * 0.5;
        const kb = 0.16 + 2.1 * rb * rb * rb;
        const kf = 0.16 + 2.1 * rf * rf * rf;
        legs(0.06 + 0.62 * cu, kb, 1.5 - 0.45 * rb,
             0.06 - 0.62 * cu, kf, 1.5 - 0.45 * rf);
        // brazos en contrafase con su pierna: al ir hacia delante el codo se
        // cierra más y la mano sube al pecho en vez de salir disparada al aire
        arms(-0.20 - 0.62 * cu, 1.70 - 0.75 * cu,
             -0.20 + 0.62 * cu, 1.70 + 0.75 * cu);
        hipY = HIP_Y + 1;
        snap = true;    // el rebote sale solo al pegar el pie más bajo al suelo
        break;
      }

      case "jump": {
        const k = cl01(ph, 0.4);
        const fl = sin(t * 10) * 0.06;
        lean = 0.22 + 0.15 * k;
        tilt = -0.14;
        hipY = HIP_Y - 1.5;
        legs(-0.75 + 0.40 * k, 0.45 + 1.30 * k, 1.15,   // pierna de atrás que recoge el talón
              0.55 + 0.60 * k, 0.60 + 0.95 * k, 1.30);   // rodilla que sube por delante
        arms(-1.15 + 0.30 * k + fl, 0.90,
              1.75 + 0.35 * k - fl, 0.45);               // brazo alzado en diagonal
        break;
      }

      case "fall": {
        const w = sin(t * 7.5), w2 = sin(t * 6.1 + 1.4);
        lean = -0.06 + 0.05 * w;
        tilt = 0.10;
        hipY = HIP_Y - 1;
        legs(-0.30 + 0.10 * w2, 1.25 + 0.25 * w, 1.20,
              0.42 + 0.10 * w, 0.75 + 0.20 * w2, 1.35);
        arms(-1.55 + 0.12 * w2, 0.70,
              1.85 + 0.12 * w, 0.55);
        break;
      }

      case "slide": {
        const k = cl01(ph, 0.5), hu = sin(PI * k);
        hipX = -6;
        hipY = -17 - 2 * hu;
        lean = -1.30 - 0.10 * hu;   // torso casi tumbado, pies por delante
        tilt = 0.40;                // la cabeza sigue mirando al frente
        legs(1.50, 2.55, -0.52,     // pierna recogida, pie bajo el cuerpo
             1.32, 0.10, 1.25);     // pierna estirada a ras de suelo
        arms(-1.30, 2.20,           // codo atrás, mano hacia el suelo
              0.90, 1.20);
        clamp = true;               // red de seguridad: nada por debajo del suelo
        break;
      }

      case "vault": {
        const k = cl01(ph, (t * 1.6) % 1), hu = sin(PI * k), la = k * k;
        hipX = -12 + 24 * k;
        hipY = HIP_Y - 2 - 16 * hu;
        lean = 0.55 + 0.45 * hu;
        tilt = -0.30;
        // piernas recogidas a un lado que bajan a aterrizar al final
        legs(mix(1.15 + 0.45 * hu, 0.55, la), mix(1.60 + 0.55 * hu, 0.75, la), 1.35,
             mix(0.85 + 0.45 * hu, 0.20, la), mix(2.00 + 0.35 * hu, 0.95, la), 1.35);
        // brazo de apoyo: barre de delante a atrás mientras el cuerpo pasa
        arms(0.95 - 2.15 * k, 0.30 - 0.20 * hu,
             1.35 - 1.30 * k, 0.75);
        break;
      }

      case "wallJump": {
        const k = cl01(ph, (t * 1.6) % 1), hu = sin(PI * k);
        hipX = -8 + 8 * hu;
        hipY = HIP_Y + 6 + 5 * hu;
        lean = -0.40 - 0.30 * hu;   // espalda hacia fuera de la pared
        tilt = 0.25;
        legs(1.35 + 0.75 * hu, 0.85 + 1.05 * hu, 1.30,
             1.55 + 0.75 * hu, 0.55 + 1.15 * hu, 1.30);
        arms(-1.00 - 0.30 * hu, 1.20,
              1.75 - 0.15 * hu, 0.30);   // mano apoyada arriba en la pared
        break;
      }

      case "roll": {
        const k = num(ph, (t * 1.5) % 1);
        rot = k * TAU;
        pivX = 0; pivY = -25;       // centro de giro ~ centro de la bola
        hipX = -17; hipY = -14;
        lean = 0.55; tilt = 1.25;   // cabeza metida hacia las rodillas
        legs(1.95, 2.30, 1.10,
             2.15, 2.45, 1.10);
        arms(1.70, -1.95, 1.90, -2.15);   // brazos abrazando las espinillas
        break;
      }

      case "stumble": {
        const k = cl01(ph, 0.5);
        const w = sin(t * 17), w2 = sin(t * 13 + 0.8);
        hipX = -4;
        hipY = HIP_Y + 8 + 4 * k;
        lean = 0.85 + 0.35 * k + 0.06 * w;
        tilt = -0.35;
        legs(-0.95 + 0.10 * w2, 0.55 + 0.25 * k, 1.45,   // pierna que se queda atrás
              0.65 - 0.20 * k, 1.70 + 0.35 * k, 1.20);   // rodilla que se dobla
        arms(1.55 + 0.12 * w2, 0.55,
             1.75 + 0.10 * w, 0.45);                     // brazos por delante
        break;
      }

      case "caught": {
        const w = sin(t * 24), w2 = sin(t * 19 + 1.1);
        hipX = -2 + 1.5 * w2;
        hipY = HIP_Y + 8;
        lean = -0.55 + 0.10 * w;    // tronco arqueado hacia atrás
        tilt = -0.25;
        legs(0.35 + 0.12 * w2, 1.75, 1.25,
             0.95 + 0.12 * w, 1.05, 1.35);
        arms(-2.25 + 0.18 * w2, 0.55,
             -1.85 + 0.18 * w, 0.85);   // brazos hacia atrás, manoteando
        break;
      }

      default: {  // idle (y cualquier pose desconocida)
        const b = sin(t * 2.2);
        lean = 0.07;
        tilt = 0.02 * b;
        hipY = HIP_Y + 1.2 + 0.7 * b;   // respiración
        legs(-0.10, 0.14, 1.45,
              0.12, 0.22, 1.45);
        arms(-0.08, 0.30, 0.06 + 0.03 * b, 0.22);
        snap = true;
        break;
      }
    }
  }

  // ---------- cinemática directa ----------
  function put(i, x, y) { J[i * 2] = x; J[i * 2 + 1] = y; }

  function chain(rx, ry, a1, l1, a2, l2, a3, l3, i1, i2, i3) {
    const x1 = rx + sin(a1) * l1, y1 = ry + cos(a1) * l1;
    const x2 = x1 + sin(a2) * l2, y2 = y1 + cos(a2) * l2;
    put(i1, x1, y1); put(i2, x2, y2);
    if (i3 >= 0) put(i3, x2 + sin(a3) * l3, y2 + cos(a3) * l3);
  }

  function build() {
    const ux = sin(lean), uy = -cos(lean);       // eje del torso, hacia arriba
    const px = cos(lean), py = sin(lean);        // perpendicular, hacia delante
    const cx = hipX + ux * TORSO, cy = hipY + uy * TORSO;
    const ha = lean + tilt;
    put(HIP, hipX, hipY);
    put(CHEST, cx, cy);
    put(HEAD, cx + sin(ha) * HEADD, cy - cos(ha) * HEADD);

    const sx = cx - ux * SH_DROP, sy = cy - uy * SH_DROP;
    put(SHB, sx - px * SH_HALF, sy - py * SH_HALF);
    put(SHF, sx + px * SH_HALF, sy + py * SH_HALF);

    chain(J[SHB * 2], J[SHB * 2 + 1], baU, UPARM, baL, FARM, 0, 0, ELB, HNB, -1);
    chain(J[SHF * 2], J[SHF * 2 + 1], faU, UPARM, faL, FARM, 0, 0, ELF, HNF, -1);
    chain(hipX - px * HIP_HALF, hipY - py * HIP_HALF, bT, THIGH, bS, SHIN, bF, FOOT, KNB, ANB, TOB);
    chain(hipX + px * HIP_HALF, hipY + py * HIP_HALF, fT, THIGH, fS, SHIN, fF, FOOT, KNF, ANF, TOF);

    // IK barata: baja/sube el cuerpo para que el pie más bajo pise el suelo.
    // De ahí sale el rebote vertical del centro de masas, sin fórmula extra.
    if (snap) {
      let sole = J[ANB * 2 + 1] + R_ANK;
      let v = J[TOB * 2 + 1] + R_TOE; if (v > sole) sole = v;
      v = J[ANF * 2 + 1] + R_ANK; if (v > sole) sole = v;
      v = J[TOF * 2 + 1] + R_TOE; if (v > sole) sole = v;
      let d = -sole;
      if (d > 7) d = 7; else if (d < -7) d = -7;
      for (let i = 1; i < 30; i += 2) J[i] += d;
    }
    // Clamp de seguridad: sube el cuerpo si alguna parte se hunde en el suelo.
    if (clamp) {
      let low = -1e9;
      for (let i = 1; i < 30; i += 2) if (J[i] > low) low = J[i];
      low += R_ANK;
      if (low > 0) {
        let d = low > 26 ? -26 : -low;
        for (let i = 1; i < 30; i += 2) J[i] += d;
      }
    }
  }

  // ---------- primitivas de silueta (mismo sentido de giro siempre) ----------
  function cap(ctx, ax, ay, bx, by, ra, rb) {
    const a = atan2(by - ay, bx - ax), sa = sin(a), ca = cos(a);
    ctx.moveTo(ax - sa * ra, ay + ca * ra);
    ctx.arc(ax, ay, ra, a + HALF, a - HALF);
    ctx.arc(bx, by, rb, a - HALF, a + HALF);
    ctx.closePath();
  }
  function capJ(ctx, i, j, ra, rb) {
    cap(ctx, J[i * 2], J[i * 2 + 1], J[j * 2], J[j * 2 + 1], ra, rb);
  }
  function dot(ctx, i, r) {
    const x = J[i * 2], y = J[i * 2 + 1];
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
    ctx.closePath();
  }

  // Gabardina del perseguidor: cuadrilátero con el borde trasero ondeando.
  // El orden de los vértices mantiene el sentido de giro de las cápsulas.
  function coat(ctx) {
    const cx = J[CHEST * 2], cy = J[CHEST * 2 + 1];
    const hx = J[HIP * 2], hy = J[HIP * 2 + 1];
    let dx = hx - cx, dy = hy - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= len; dy /= len;
    const px = -dy, py = dx;                 // perpendicular hacia atrás
    const flap = sin(curT * 11) * (2.5 + 6 * curSp);
    const trail = 15 + 12 * curSp + flap;
    const hem = 24;
    const x0 = cx + px * 10, y0 = cy + py * 10;          // hombro trasero
    const x1 = cx - px * 9, y1 = cy - py * 9;            // pecho delantero
    const x2 = hx - px * 7 + dx * hem * 0.8, y2 = hy - py * 7 + dy * hem * 0.8;
    const x3 = hx + px * trail + dx * hem, y3 = hy + py * trail + dy * hem;
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.quadraticCurveTo((x3 + x0) * 0.5 + px * (8 + flap * 0.5),
                         (y3 + y0) * 0.5 + py * (8 + flap * 0.5), x0, y0);
    ctx.closePath();
  }

  // ---------- pintado ----------
  function paint(ctx, k, withCoat) {
    ctx.beginPath();
    // brazo y pierna traseros
    capJ(ctx, HIP, KNB, R_THIGH * k, R_KNEE * k);
    capJ(ctx, KNB, ANB, R_KNEE * k, R_ANK * k);
    capJ(ctx, ANB, TOB, R_TOE * 1.3 * k, R_TOE * k);
    capJ(ctx, SHB, ELB, R_SH * k, R_ELB * k);
    capJ(ctx, ELB, HNB, R_ELB * k, R_HAND * 0.85 * k);
    dot(ctx, HNB, R_HAND * k);
    // tronco, cuello y cabeza
    capJ(ctx, HIP, CHEST, R_HIP * k, R_CHEST * k);
    capJ(ctx, SHB, SHF, R_SH * k, R_SH * k);
    capJ(ctx, CHEST, HEAD, R_NECK * k, R_HEAD * 0.6 * k);
    dot(ctx, HEAD, R_HEAD * k);
    if (withCoat) coat(ctx);
    // brazo y pierna delanteros
    capJ(ctx, HIP, KNF, R_THIGH * k, R_KNEE * k);
    capJ(ctx, KNF, ANF, R_KNEE * k, R_ANK * k);
    capJ(ctx, ANF, TOF, R_TOE * 1.3 * k, R_TOE * k);
    capJ(ctx, SHF, ELF, R_SH * k, R_ELB * k);
    capJ(ctx, ELF, HNF, R_ELB * k, R_HAND * 0.85 * k);
    dot(ctx, HNF, R_HAND * k);
    ctx.fill();
  }

  // ---------- entrada común ----------
  function render(ctx, p, o, chaser) {
    if (!ctx || !p) return;
    const opts = o || NOPTS;
    const a = cl01(opts.alpha, 1);
    if (a <= 0) return;

    const w = num(p.w, 26), h = num(p.h, 44);
    if (!(h > 0.5)) return;
    const x = num(p.x, 0), y = num(p.y, 0);
    const t = num(opts.t, 0);
    const sp = cl01(opts.speed, 0.7);
    const fc = num(opts.facing, 1) < 0 ? -1 : 1;
    const pose = typeof opts.pose === "string" ? opts.pose : "idle";

    setPose(pose, t, sp, opts.phase);
    if (chaser) lean += 0.08;   // el perseguidor va más encorvado
    build();

    // Escala única: 100 unidades locales = alto de la caja, con los pies en
    // su borde inferior. Las poses tumbadas (slide/roll) ya se dibujan bajas
    // dentro de esa caja, así que el personaje nunca cambia de tamaño.
    const s = h * 0.01;

    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = typeof opts.color === "string" ? opts.color : "#000";
    ctx.translate(x + w * 0.5, y + h);
    ctx.scale(s * fc, s);
    if (rot !== 0) {
      ctx.translate(pivX, pivY);
      ctx.rotate(rot);
      ctx.translate(-pivX, -pivY);
    }
    paint(ctx, chaser ? 1.22 : 1, chaser);
    ctx.restore();
  }

  return {
    poses: POSES,
    draw: function (ctx, p, opts) { render(ctx, p, opts, false); },
    drawChaser: function (ctx, p, opts) { render(ctx, p, opts, true); }
  };
})();
