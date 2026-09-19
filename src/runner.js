// Corredor humano en silueta (estilo Vector) dibujado 100% con Canvas 2D.
//
// La figura se pinta como UN SOLO path relleno: los solapes entre miembros se
// funden con la regla nonzero, así que no hay costuras ni dobles mezclas con
// alpha < 1. Para que eso funcione TODOS los subpaths deben recorrerse en el
// mismo sentido; los helpers cap()/dot()/coat()/scarf() ya lo garantizan.
//
// Sistema local: suelo en y = 0, y negativa hacia arriba, x positiva hacia
// delante (el volteo se hace con scale(facing, 1)). Cuerpo de pie = 100 u.
// Los ángulos de los miembros son absolutos: 0 = apuntando hacia abajo,
// positivo = hacia delante.
//
// Volumen sin dejar de ser silueta: se rellena el mismo cuerpo dos veces, la
// primera desplazada ~1,5 px hacia el sol y en color cálido. El relleno negro
// tapa todo menos ese filo de luz del lado iluminado.
//
// opts (todo opcional): pose, t, speed, facing, phase, color, alpha,
//   id     -> clave de estado por personaje (transiciones, tela y estela).
//             Sin id se deduce de tamaño+alpha, que basta para jugador,
//             fantasma y perseguidor, pero pasarlo es más fiable.
//   rim    -> false apaga la luz de borde;  rimColor -> color del filo
//   trail  -> false apaga la estela;        sun -> 1 sol a la derecha, -1 izq.

const Runner = (() => {
  const sin = Math.sin, cos = Math.cos, atan2 = Math.atan2, sqrt = Math.sqrt;
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

  // ---------- luz y estela ----------
  const RIM_X = 1.6, RIM_Y = -0.5;    // desplazamiento del filo, en píxeles
  const RIM_HERO = "#ffd9a0";         // filo cálido del corredor
  const RIM_CHASER = "#ff6a4a";       // filo rojizo del perseguidor
  const TRAIL_MIN = 0.72;             // velocidad a partir de la cual hay estela
  const TRAIL_DT = 0.034;             // cada cuánto se guarda una instantánea
  const BLEND_T = 0.12;               // duración del cruce entre posturas

  // ---------- índices de articulación en el buffer J ----------
  const HIP = 0, CHEST = 1, HEAD = 2;
  const SHB = 3, ELB = 4, HNB = 5;      // brazo trasero
  const SHF = 6, ELF = 7, HNF = 8;      // brazo delantero
  const KNB = 9, ANB = 10, TOB = 11;    // pierna trasera
  const KNF = 12, ANF = 13, TOF = 14;   // pierna delantera
  const J = new Float32Array(30);       // 15 articulaciones x (x,y), reutilizado

  // ---------- ángulos de la pose (se interpolan como bloque) ----------
  const A_HX = 0, A_HY = 1, A_LEAN = 2, A_TILT = 3;
  const A_BT = 4, A_BS = 5, A_BF = 6, A_FT = 7, A_FS = 8, A_FF = 9;
  const A_BAU = 10, A_BAL = 11, A_FAU = 12, A_FAL = 13;
  const NA = 14;
  const A = new Float32Array(NA);       // pose objetivo / ya mezclada

  const POSES = ["run", "jump", "fall", "slide", "vault", "wallJump", "roll", "stumble", "idle", "caught"];
  const NOPTS = {};   // opts por defecto: evita crear {} en cada llamada

  // ---------- estado no interpolable de la pose ----------
  let rot = 0, pivY = -40, snap = false, clamp = false, openHand = false;
  let blending = false;   // durante un cruce de posturas se vigila el suelo
  let clothA = -0.5, clothSpread = -0.3;   // objetivo de la tela
  let cl0 = -0.5, cl1 = -0.8;              // ángulos de tela ya simulados
  let curT = 0, curSp = 0;

  // ---------- memoria por personaje (todo preasignado, cero basura) ----------
  const SLOTS = 8, SNAP_N = 2, SNAP_W = 36;
  const stKey = new Array(SLOTS);
  const stPose = new Array(SLOTS);
  const stSeen = new Float64Array(SLOTS);
  const stT = new Float64Array(SLOTS);
  const stSnapT = new Float64Array(SLOTS);
  const stBlend = new Float32Array(SLOTS);
  const stFrom = new Float32Array(SLOTS * NA);
  const stCur = new Float32Array(SLOTS * NA);
  const stCloth = new Float32Array(SLOTS * 4);   // a0, v0, a1, v1
  const stSnap = new Float32Array(SLOTS * SNAP_N * SNAP_W);
  const stSnapN = new Int32Array(SLOTS);
  const stHead = new Int32Array(SLOTS);
  const stFresh = new Uint8Array(SLOTS);
  let tick = 0;

  // ---------- utilidades ----------
  function num(v, d) { return typeof v === "number" && v === v && v !== Infinity && v !== -Infinity ? v : d; }
  function cl01(v, d) { const n = num(v, d); return n < 0 ? 0 : n > 1 ? 1 : n; }
  function mix(a, b, k) { return a + (b - a) * k; }

  // piernas: muslo, flexión de rodilla (positiva = talón atrás), giro del pie
  function legs(t1, k1, p1, t2, k2, p2) {
    A[A_BT] = t1; A[A_BS] = t1 - k1; A[A_BF] = t1 - k1 + p1;
    A[A_FT] = t2; A[A_FS] = t2 - k2; A[A_FF] = t2 - k2 + p2;
  }
  // brazos: hombro y flexión de codo (positiva = mano hacia delante)
  function arms(u1, e1, u2, e2) {
    A[A_BAU] = u1; A[A_BAL] = u1 + e1;
    A[A_FAU] = u2; A[A_FAL] = u2 + e2;
  }

  // ---------- poses ----------
  function setPose(pose, t, sp, ph, heavy) {
    let hipX = 0, hipY = HIP_Y, lean = 0.1, tilt = 0;
    rot = 0; pivY = -40; snap = false; clamp = false; openHand = false;
    clothA = -0.45 - 1.10 * sp; clothSpread = -0.30;
    curT = t; curSp = sp;

    switch (pose) {
      case "run": {
        // el perseguidor pisa más fuerte: cadencia más lenta y cuerpo más bajo
        const u = t * (9 + 7 * sp) * (heavy ? 0.84 : 1);
        const cu = cos(u), su = sin(u);
        lean = (0.14 + 0.26 * sp) * (heavy ? 0.86 : 1) + sin(u + 0.7) * 0.025;
        tilt = -0.10 - 0.10 * sp + sin(u * 2) * 0.05;   // rebote de cabeza
        // el muslo oscila como un seno; la rodilla se dobla de golpe solo en
        // la fase de recobro (curva cúbica con un único pico)
        const rb = (1 - su) * 0.5, rf = (1 + su) * 0.5;
        const kb = 0.16 + 2.1 * rb * rb * rb;
        const kf = 0.16 + 2.1 * rf * rf * rf;
        const am = heavy ? 0.67 : 0.62;
        legs(0.06 + am * cu, kb, 1.5 - 0.45 * rb,
             0.06 - am * cu, kf, 1.5 - 0.45 * rf);
        // brazos en contrafase con su pierna: al ir hacia delante el codo se
        // cierra más y la mano sube al pecho en vez de salir disparada al aire
        arms(-0.20 - 0.62 * cu, 1.70 - 0.75 * cu,
             -0.20 + 0.62 * cu, 1.70 + 0.75 * cu);
        hipY = HIP_Y + 1 + (heavy ? 1.2 : 0);
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
              0.55 + 0.60 * k, 0.60 + 0.95 * k, 1.30);  // rodilla que sube por delante
        arms(-1.15 + 0.30 * k + fl, 0.90,
              1.75 + 0.35 * k - fl, 0.45);              // brazo alzado en diagonal
        clothA = -1.75 - 0.25 * k; clothSpread = -0.35; // la tela se estira atrás
        openHand = true;
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
        clothA = -2.20 + 0.12 * w; clothSpread = -0.25;  // flota hacia arriba
        openHand = true;
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
        clothA = -1.52; clothSpread = -0.08;   // la tela se pega al suelo
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
        clothA = -1.45 - 0.35 * hu; clothSpread = -0.40;
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
        clothA = -1.05 - 0.45 * hu; clothSpread = -0.45;
        break;
      }

      case "roll": {
        const k = num(ph, (t * 1.5) % 1);
        rot = k * TAU;
        pivY = -25;                 // centro de giro ~ centro de la bola
        hipX = -17; hipY = -14;
        lean = 0.55; tilt = 1.25;   // cabeza metida hacia las rodillas
        legs(1.95, 2.30, 1.10,
             2.15, 2.45, 1.10);
        arms(1.70, -1.95, 1.90, -2.15);   // brazos abrazando las espinillas
        clothA = -0.65; clothSpread = -0.55;   // tela recogida contra el cuerpo
        clamp = true;
        break;
      }

      case "stumble": {
        const k = cl01(ph, 0.5);
        const w = sin(t * 17), w2 = sin(t * 13 + 0.8);
        hipX = -4;
        hipY = HIP_Y + 8 + 4 * k;
        lean = 0.95 + 0.40 * k + 0.08 * w;   // se va de bruces
        tilt = -0.45 - 0.10 * k;             // cabeza por delante del cuerpo
        legs(-1.05 + 0.10 * w2, 0.50 + 0.25 * k, 1.45,   // pierna que se queda atrás
              0.70 - 0.20 * k, 1.75 + 0.35 * k, 1.20);   // rodilla que se dobla
        arms(1.70 + 0.14 * w2, 0.45,
             2.00 + 0.12 * w, 0.30);                     // manos abiertas al frente
        clothA = -1.25 - 0.20 * k; clothSpread = -0.35;
        clamp = true; openHand = true;
        break;
      }

      case "caught": {
        const w = sin(t * 24), w2 = sin(t * 19 + 1.1);
        hipX = -2 + 1.8 * w2;
        hipY = HIP_Y + 9;
        lean = -0.62 + 0.12 * w;    // tronco arqueado hacia atrás por el tirón
        tilt = -0.30 + 0.10 * w2;
        legs(0.30 + 0.14 * w2, 1.85, 1.25,
             1.05 + 0.14 * w, 1.00, 1.35);   // pies que patalean hacia delante
        arms(-2.30 + 0.22 * w2, 0.50,
             -1.90 + 0.22 * w, 0.80);        // brazos hacia atrás, manoteando
        clothA = -2.05 + 0.15 * w; clothSpread = -0.30;
        clamp = true; openHand = true;
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
        clothA = -0.28; clothSpread = -0.12;
        snap = true;
        break;
      }
    }
    A[A_HX] = hipX; A[A_HY] = hipY; A[A_LEAN] = lean; A[A_TILT] = tilt;
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
    const hipX = A[A_HX], hipY = A[A_HY], lean = A[A_LEAN];
    const ux = sin(lean), uy = -cos(lean);       // eje del torso, hacia arriba
    const px = cos(lean), py = sin(lean);        // perpendicular, hacia delante
    const cx = hipX + ux * TORSO, cy = hipY + uy * TORSO;
    const ha = lean + A[A_TILT];
    put(HIP, hipX, hipY);
    put(CHEST, cx, cy);
    put(HEAD, cx + sin(ha) * HEADD, cy - cos(ha) * HEADD);

    const sx = cx - ux * SH_DROP, sy = cy - uy * SH_DROP;
    put(SHB, sx - px * SH_HALF, sy - py * SH_HALF);
    put(SHF, sx + px * SH_HALF, sy + py * SH_HALF);

    chain(J[SHB * 2], J[SHB * 2 + 1], A[A_BAU], UPARM, A[A_BAL], FARM, 0, 0, ELB, HNB, -1);
    chain(J[SHF * 2], J[SHF * 2 + 1], A[A_FAU], UPARM, A[A_FAL], FARM, 0, 0, ELF, HNF, -1);
    chain(hipX - px * HIP_HALF, hipY - py * HIP_HALF, A[A_BT], THIGH, A[A_BS], SHIN, A[A_BF], FOOT, KNB, ANB, TOB);
    chain(hipX + px * HIP_HALF, hipY + py * HIP_HALF, A[A_FT], THIGH, A[A_FS], SHIN, A[A_FF], FOOT, KNF, ANF, TOF);

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
    // También se activa mientras se cruzan dos posturas, que es cuando el
    // cuerpo puede quedar un instante en una postura intermedia rara.
    if (clamp || blending) {
      let low = -1e9;
      for (let i = 1; i < 30; i += 2) if (J[i] > low) low = J[i];
      low += 1.2;                     // margen: el cuerpo roza el suelo, no lo cruza
      if (low > 0) {
        const d = low > 26 ? -26 : -low;
        for (let i = 1; i < 30; i += 2) J[i] += d;
      }
    }
    // Rodada: el cuerpo gira sobre su propio centro y ese centro se sitúa a la
    // altura del radio, así la bola rueda pegada al suelo en cualquier fase.
    if (rot !== 0) {
      let lx = 1e9, hx = -1e9, lo = 1e9, hi = -1e9;
      for (let i = 0; i < 30; i += 2) {
        if (J[i] < lx) lx = J[i];
        if (J[i] > hx) hx = J[i];
        if (J[i + 1] < lo) lo = J[i + 1];
        if (J[i + 1] > hi) hi = J[i + 1];
      }
      const cx = (lx + hx) * 0.5, cy = (lo + hi) * 0.5;
      let r2 = 0;
      for (let i = 0; i < 30; i += 2) {
        const dx = J[i] - cx, dy = J[i + 1] - cy, d = dx * dx + dy * dy;
        if (d > r2) r2 = d;
      }
      const rad = sqrt(r2) + R_KNEE;
      const dy = -rad - cy;
      for (let i = 0; i < 30; i += 2) { J[i] -= cx; J[i + 1] += dy; }
      pivY = -rad;
    }
  }

  // ---------- tela con inercia (muelle amortiguado de 2 tramos) ----------
  function cloth(si, dt, t, sp) {
    const i = si * 4;
    const fl = sin(t * (10 + 8 * sp)) * 0.10 * (0.3 + sp);
    const t0 = clothA, t1 = clothA + clothSpread + fl;
    let d = dt > 0.05 ? 0.05 : dt;
    // K por debajo del amortiguamiento crítico: la tela rebota y se retrasa
    let a = stCloth[i], v = stCloth[i + 1];
    v += ((t0 - a) * 60 - v * 9) * d; a += v * d;
    stCloth[i] = a; stCloth[i + 1] = v; cl0 = a;
    a = stCloth[i + 2]; v = stCloth[i + 3];
    v += ((t1 - a) * 48 - v * 8) * d; a += v * d;
    stCloth[i + 2] = a; stCloth[i + 3] = v; cl1 = a;
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
  // palma abierta: en el aire y en los tropiezos la mano se despliega
  function palm(ctx, ie, ih, k) {
    const ex = J[ie * 2], ey = J[ie * 2 + 1], hx = J[ih * 2], hy = J[ih * 2 + 1];
    let dx = hx - ex, dy = hy - ey;
    const l = sqrt(dx * dx + dy * dy) || 1;
    cap(ctx, hx, hy, hx + dx / l * 4.4 * k, hy + dy / l * 4.4 * k, R_HAND * 1.2 * k, R_HAND * 0.8 * k);
  }

  // Bufanda del corredor: dos tramos colgando de la nuca, movidos por `cloth`.
  function scarf(ctx, k) {
    const cx = J[CHEST * 2], cy = J[CHEST * 2 + 1];
    const ax = cx + (J[HEAD * 2] - cx) * 0.38, ay = cy + (J[HEAD * 2 + 1] - cy) * 0.38;
    const x1 = ax + sin(cl0) * 15 * k, y1 = ay + cos(cl0) * 15 * k;
    cap(ctx, ax, ay, x1, y1, 5.0 * k, 3.5 * k);
    cap(ctx, x1, y1, x1 + sin(cl1) * 13 * k, y1 + cos(cl1) * 13 * k, 3.5 * k, 1.3 * k);
  }

  // Gabardina del perseguidor: polígono cuyo faldón lo lleva la tela.
  // El orden de los vértices mantiene el sentido de giro de las cápsulas.
  function coat(ctx, k) {
    const cx = J[CHEST * 2], cy = J[CHEST * 2 + 1];
    const hx = J[HIP * 2], hy = J[HIP * 2 + 1];
    let dx = hx - cx, dy = hy - cy;
    const len = sqrt(dx * dx + dy * dy) || 1;
    dx /= len; dy /= len;
    const px = -dy, py = dx;                 // perpendicular hacia atrás
    const hem = 27 * k;
    const x0 = cx + px * 11 * k, y0 = cy + py * 11 * k;                        // hombro trasero
    const x1 = cx - px * 9 * k, y1 = cy - py * 9 * k;                          // pecho delantero
    const x2 = hx - px * 7 * k + dx * hem * 0.78, y2 = hy - py * 7 * k + dy * hem * 0.78;
    const x3 = hx + sin(cl0) * hem, y3 = hy + cos(cl0) * hem;                  // faldón
    const x4 = x3 + sin(cl1) * hem * 0.8, y4 = y3 + cos(cl1) * hem * 0.8;      // punta que ondea
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.lineTo(x4, y4);
    ctx.quadraticCurveTo((x4 + x0) * 0.5 + px * 9 * k, (y4 + y0) * 0.5 + py * 9 * k, x0, y0);
    ctx.closePath();
  }

  // ---------- pintado ----------
  function paint(ctx, k, isChaser) {
    ctx.beginPath();
    // brazo y pierna traseros
    capJ(ctx, HIP, KNB, R_THIGH * k, R_KNEE * k);
    capJ(ctx, KNB, ANB, R_KNEE * k, R_ANK * k);
    capJ(ctx, ANB, TOB, R_TOE * 1.3 * k, R_TOE * k);
    capJ(ctx, SHB, ELB, R_SH * k, R_ELB * k);
    capJ(ctx, ELB, HNB, R_ELB * k, R_HAND * 0.85 * k);
    dot(ctx, HNB, R_HAND * k);
    if (openHand) palm(ctx, ELB, HNB, k);
    // tronco, cuello y cabeza
    capJ(ctx, HIP, CHEST, R_HIP * k, R_CHEST * k);
    capJ(ctx, SHB, SHF, R_SH * k, R_SH * k);
    capJ(ctx, CHEST, HEAD, R_NECK * k, R_HEAD * 0.6 * k);
    dot(ctx, HEAD, R_HEAD * k);
    if (isChaser) coat(ctx, k); else scarf(ctx, k);
    // brazo y pierna delanteros
    capJ(ctx, HIP, KNF, R_THIGH * k, R_KNEE * k);
    capJ(ctx, KNF, ANF, R_KNEE * k, R_ANK * k);
    capJ(ctx, ANF, TOF, R_TOE * 1.3 * k, R_TOE * k);
    capJ(ctx, SHF, ELF, R_SH * k, R_ELB * k);
    capJ(ctx, ELF, HNF, R_ELB * k, R_HAND * 0.85 * k);
    dot(ctx, HNF, R_HAND * k);
    if (openHand) palm(ctx, ELF, HNF, k);
    ctx.fill();
  }

  // deja el contexto listo para pintar en unidades locales
  function xform(ctx, ax, ay, s, fc, r, pv) {
    ctx.translate(ax, ay);
    ctx.scale(s * fc, s);
    if (r !== 0) { ctx.translate(0, pv); ctx.rotate(r); ctx.translate(0, -pv); }
  }

  // ---------- memoria por personaje ----------
  function slotFor(key) {
    tick++;
    let free = -1, old = 0;
    for (let i = 0; i < SLOTS; i++) {
      if (stKey[i] === key) { stSeen[i] = tick; return i; }
      if (stKey[i] === undefined && free < 0) free = i;
      if (stSeen[i] < stSeen[old]) old = i;
    }
    const i = free >= 0 ? free : old;
    stKey[i] = key; stPose[i] = null; stSeen[i] = tick; stFresh[i] = 1;
    stT[i] = 0; stSnapT[i] = 0; stBlend[i] = 0; stSnapN[i] = 0; stHead[i] = 0;
    return i;
  }

  // ---------- entrada común ----------
  function render(ctx, p, o, isChaser) {
    if (!ctx || !p || typeof ctx.beginPath !== "function") return;
    const opts = o || NOPTS;
    const alpha = cl01(opts.alpha, 1);
    if (alpha <= 0) return;

    const w = num(p.w, 26), h = num(p.h, 44);
    if (!(h > 0.5)) return;
    const x = num(p.x, 0), y = num(p.y, 0);
    const t = num(opts.t, 0);
    const sp = cl01(opts.speed, 0.7);
    const fc = num(opts.facing, 1) < 0 ? -1 : 1;
    const pose = typeof opts.pose === "string" ? opts.pose : "idle";
    const k = isChaser ? 1.3 : 1;          // el perseguidor es más corpulento

    // Clave de estado: el id que me pasen o, si no, tamaño + alpha + papel,
    // que ya distingue jugador, fantasma de repetición y perseguidor.
    const key = opts.id !== undefined && opts.id !== null ? opts.id
      : (isChaser ? 1e7 : 0) + ((w * 64 + h) | 0) + ((alpha * 16) | 0) * 1e5;
    const si = slotFor(key);

    let dt = t - stT[si];
    if (!(dt > 0)) dt = 0; else if (dt > 0.1) dt = 0.1;
    stT[si] = t;

    blending = false;
    setPose(pose, t, sp, opts.phase, isChaser);
    if (isChaser) A[A_LEAN] += 0.08;       // va más encorvado

    // Cruce suave entre posturas: se congela lo que había al cambiar de pose
    // y se mezcla con la nueva durante BLEND_T segundos.
    const b = si * NA;
    if (stFresh[si]) {
      for (let i = 0; i < NA; i++) stCur[b + i] = A[i];
      stCloth[si * 4] = clothA; stCloth[si * 4 + 1] = 0;
      stCloth[si * 4 + 2] = clothA + clothSpread; stCloth[si * 4 + 3] = 0;
      stFresh[si] = 0;
    } else {
      if (stPose[si] !== pose) {
        for (let i = 0; i < NA; i++) stFrom[b + i] = stCur[b + i];
        stBlend[si] = 1;
      }
      if (stBlend[si] > 0) {
        stBlend[si] -= dt / BLEND_T;
        if (stBlend[si] < 0) stBlend[si] = 0;
        let u = 1 - stBlend[si];
        u = u * u * (3 - 2 * u);           // suavizado en las dos puntas
        for (let i = 0; i < NA; i++) A[i] = stFrom[b + i] + (A[i] - stFrom[b + i]) * u;
        rot *= u;   // el giro de la rodada entra con el cuerpo ya recogido
        blending = true;
      }
      for (let i = 0; i < NA; i++) stCur[b + i] = A[i];
    }
    stPose[si] = pose;

    cloth(si, dt, t, sp);
    build();

    const s = h * 0.01;   // 100 unidades locales = alto de la caja
    const ax = x + w * 0.5, ay = y + h;
    const body = typeof opts.color === "string" ? opts.color : "#000";

    // --- estela: siluetas fantasma de los fotogramas anteriores ---
    const wantTrail = opts.trail !== false && alpha > 0.6 && sp >= TRAIL_MIN;
    if (wantTrail) {
      ctx.save();
      ctx.fillStyle = body;
      for (let n = stSnapN[si]; n > 0; n--) {
        const o2 = (si * SNAP_N + ((stHead[si] - n) % SNAP_N + SNAP_N) % SNAP_N) * SNAP_W;
        for (let i = 0; i < 30; i++) J[i] = stSnap[o2 + i];
        cl0 = stSnap[o2 + 33]; cl1 = stSnap[o2 + 34];
        ctx.globalAlpha = alpha * (n === stSnapN[si] ? 0.07 : 0.13) * (sp - TRAIL_MIN) * 3.5;
        ctx.save();
        xform(ctx, stSnap[o2 + 30], stSnap[o2 + 31], s, fc, stSnap[o2 + 32], stSnap[o2 + 35]);
        paint(ctx, k, isChaser);
        ctx.restore();
      }
      ctx.restore();
      build();                       // J vuelve a la pose actual
      cl0 = stCloth[si * 4]; cl1 = stCloth[si * 4 + 2];
    }

    // --- filo de luz: el mismo cuerpo, desplazado hacia el sol ---
    if (opts.rim !== false && alpha > 0.6) {
      const sun = num(opts.sun, 1) < 0 ? -1 : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = typeof opts.rimColor === "string" ? opts.rimColor
        : (isChaser ? RIM_CHASER : RIM_HERO);
      xform(ctx, ax + RIM_X * sun, ay + RIM_Y, s, fc, rot, pivY);
      paint(ctx, k, isChaser);
      ctx.restore();
    }

    // --- cuerpo ---
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = body;
    xform(ctx, ax, ay, s, fc, rot, pivY);
    paint(ctx, k, isChaser);
    ctx.restore();

    // --- guarda una instantánea para la estela del próximo fotograma ---
    if (wantTrail && t - stSnapT[si] >= TRAIL_DT) {
      stSnapT[si] = t;
      const o2 = (si * SNAP_N + stHead[si]) * SNAP_W;
      for (let i = 0; i < 30; i++) stSnap[o2 + i] = J[i];
      stSnap[o2 + 30] = ax; stSnap[o2 + 31] = ay; stSnap[o2 + 32] = rot;
      stSnap[o2 + 33] = cl0; stSnap[o2 + 34] = cl1; stSnap[o2 + 35] = pivY;
      stHead[si] = (stHead[si] + 1) % SNAP_N;
      if (stSnapN[si] < SNAP_N) stSnapN[si]++;
    } else if (!wantTrail) {
      stSnapN[si] = 0;
    }
  }

  return {
    poses: POSES,
    draw: function (ctx, p, opts) { render(ctx, p, opts, false); },
    drawChaser: function (ctx, p, opts) { render(ctx, p, opts, true); }
  };
})();
