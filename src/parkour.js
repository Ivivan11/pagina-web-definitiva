// Prototipo de parkour: carrera automática con inercia, verbos de parkour y un
// perseguidor que te quita la opción de ir con miedo. La generación es
// determinista (semilla), así que las repeticiones y los retos siguen valiendo.

const PK = {
  STEP: 1 / 60,
  GRAVITY: 2400,
  JUMP_V: -730,
  JUMP_CUT: 0.45,
  COYOTE: 0.1,
  BUFFER: 0.12,

  SPEED_BASE: 215, // al arrancar o tras un tropiezo
  SPEED_MAX: 430,
  SPEED_ACCEL: 34, // px/s por segundo corriendo limpio
  TRICK_BONUS: 38, // recompensa por encadenar un truco bien
  STUMBLE_KEEP: 0.55, // qué fracción de velocidad conservas al tropezar
  STUMBLE_TIME: 0.4,

  SLIDE_TIME: 0.55,
  VAULT_TIME: 0.3,
  VAULT_REACH: 95, // a qué distancia de una valla el salto se vuelve voltereta
  ROLL_TIME: 0.32,

  CHASER_BASE: 185,
  CHASER_RAMP: 6, // px/s que gana por segundo
  CHASER_MAX: 452,
  LEAD_START: 380,
  LEAD_MAX: 620,

  GROUND_Y: 470,
  CANVAS_W: 960,
  CANVAS_H: 540,
};

// Generador con semilla: la misma semilla da siempre el mismo recorrido.
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Generación del recorrido
// ---------------------------------------------------------------------------
// Tipos: gap (hueco), barrier (valla: voltereta), beam (viga: deslizarse),
// wall (pared: rebote), fake (suelo que cede: tropiezo), spikes (mortal).
// El recorrido enseña un verbo cada vez antes de mezclarlos: primero saltar,
// luego la voltereta, luego deslizarse, luego la pared, y por último lo que
// engaña (suelo falso) y lo que mata (pinchos).
const UNLOCKS = [
  { at: 0, type: "gap", weight: 24 },
  { at: 850, type: "barrier", weight: 26 },
  { at: 1900, type: "beam", weight: 22 },
  { at: 3000, type: "wall", weight: 15 },
  { at: 4200, type: "fake", weight: 16 },
  { at: 5400, type: "spikes", weight: 10 },
];

function createCourse(seed) {
  return { seed, rng: makeRng(seed), obstacles: [], generatedTo: 0, nextAt: 620, lastType: null };
}

// 0 al empezar, 1 pasados ~9000px: aprieta el espaciado y permite encadenados.
function difficultyAt(x) {
  return Math.max(0, Math.min(1, x / 9000));
}

function pickType(course, x) {
  let total = 0;
  for (const u of UNLOCKS) {
    if (x < u.at) continue;
    // lo recién desbloqueado sale más a menudo, para que lo aprendas
    total += u.weight * (x - u.at < 1200 ? 2.2 : 1);
  }
  let r = course.rng() * total;
  for (const u of UNLOCKS) {
    if (x < u.at) continue;
    r -= u.weight * (x - u.at < 1200 ? 2.2 : 1);
    if (r <= 0) return u.type;
  }
  return "gap";
}

function makeObstacle(course, type, x) {
  const G = PK.GROUND_Y;
  switch (type) {
    // Los huecos y los pinchos se dimensionan para poder salvarse a la
    // velocidad MÍNIMA (215 px/s salta ~131px): si no, un tropiezo previo los
    // volvía insalvables sin que fuera culpa del jugador.
    case "gap":
      return { type, x, w: 85 + Math.floor(course.rng() * 30), y: G, h: 80 };
    case "barrier":
      return { type, x, w: 34 + Math.floor(course.rng() * 22), y: G - 52, h: 52 };
    case "beam":
      return { type, x, w: 120 + Math.floor(course.rng() * 90), y: G - 118, h: 62 };
    case "wall":
      // Justo por encima de un salto normal: se puede pasar a lo bruto, pero
      // el rebote en pared es mucho más rápido y más bonito.
      return { type, x, w: 40, y: G - 108, h: 108 };
    case "fake":
      return { type, x, w: 70 + Math.floor(course.rng() * 50), y: G, h: 70, broken: false };
    case "spikes":
      return { type, x, w: 45 + Math.floor(course.rng() * 28), y: G - 26, h: 26 };
    default:
      return { type: "gap", x, w: 100, y: G, h: 80 };
  }
}

function generateAhead(course, uptoX) {
  while (course.generatedTo < uptoX) {
    let x = course.nextAt;
    const d = difficultyAt(x);
    let type = pickType(course, x);
    // Sin dos iguales seguidos: mata la monotonía del recorrido generado.
    if (type === course.lastType && course.rng() < 0.7) type = pickType(course, x);
    course.lastType = type;

    const ob = makeObstacle(course, type, x);
    course.obstacles.push(ob);
    course.generatedTo = x + ob.w;

    // Encadenados: a partir de media dificultad, a veces viene otro pegado y
    // hay que enlazar dos verbos sin recuperar velocidad.
    if (d > 0.35 && course.rng() < 0.16 + d * 0.22) {
      const second = pickType(course, x);
      if (second !== "spikes" && !(type === "gap" && second === "gap")) {
        // Si en el encadenado hay un hueco o una pared hace falta sitio para
        // aterrizar y volver a saltar; si no, el segundo obstáculo es injusto.
        const needsRoom = type === "gap" || type === "wall" || second === "gap" || second === "wall";
        const linkGap = (needsRoom ? 250 : 140) + Math.floor(course.rng() * 90);
        const ob2 = makeObstacle(course, second, course.generatedTo + linkGap);
        course.obstacles.push(ob2);
        course.generatedTo = ob2.x + ob2.w;
        course.lastType = second;
      }
    }

    // El hueco entre grupos se estrecha con la dificultad
    const breather = Math.round(330 - 150 * d) + Math.floor(course.rng() * (200 - 90 * d));
    course.nextAt = course.generatedTo + breather;
  }

  // Suelta lo que ya quedó muy atrás para no crecer sin límite
  while (course.obstacles.length && course.obstacles[0].x + course.obstacles[0].w < uptoX - 2200) {
    course.obstacles.shift();
  }
}


// ---------------------------------------------------------------------------
// Estado del corredor
// ---------------------------------------------------------------------------
function createRunner() {
  return {
    x: 160,
    y: PK.GROUND_Y - 62,
    vy: 0,
    w: 30,
    h: 62,
    speed: PK.SPEED_BASE,
    onGround: true,
    coyote: 0,
    buffer: 0,
    jumpHeld: false,
    pose: "run",
    poseTime: 0,
    slideT: 0,
    vaultT: 0,
    stumbleT: 0,
    rollT: 0,
    wallT: 0,
    wantRoll: false,
    dead: false,
    caught: false,
    distance: 0,
    tricks: 0,
    stumbles: 0,
  };
}

function hitboxOf(r) {
  // Al deslizarse el cuerpo baja: es lo que te deja pasar bajo una viga.
  const sliding = r.slideT > 0 || r.rollT > 0;
  const h = sliding ? 30 : r.h;
  return { x: r.x, y: r.y + (r.h - h), w: sliding ? r.w + 10 : r.w, h };
}

function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function stumble(r, course, events, reason) {
  if (r.stumbleT > 0) return;
  r.speed = Math.max(PK.SPEED_BASE * 0.75, r.speed * PK.STUMBLE_KEEP);
  r.stumbleT = PK.STUMBLE_TIME;
  r.slideT = 0;
  r.vaultT = 0;
  r.stumbles++;
  events.push({ name: "stumble", x: r.x, y: r.y, reason });
}

function nearestAhead(course, r, types, reach) {
  const front = r.x + r.w;
  let best = null;
  for (const ob of course.obstacles) {
    if (types.indexOf(ob.type) === -1) continue;
    const d = ob.x - front;
    if (d < -ob.w || d > reach) continue;
    if (!best || d < best.d) best = { ob, d };
  }
  return best;
}

// Un paso de simulación. input = { jump, slide } booleanos.
function stepRunner(r, input, course, dt, events) {
  if (r.dead || r.caught) return;

  r.poseTime += dt;
  generateAhead(course, r.x + PK.CANVAS_W * 2);

  // --- temporizadores de los trucos ---
  r.slideT = Math.max(0, r.slideT - dt);
  r.vaultT = Math.max(0, r.vaultT - dt);
  r.rollT = Math.max(0, r.rollT - dt);
  r.wallT = Math.max(0, r.wallT - dt);
  r.stumbleT = Math.max(0, r.stumbleT - dt);

  // --- velocidad: sube corriendo limpio, se hunde al tropezar ---
  if (r.stumbleT <= 0) {
    r.speed = Math.min(PK.SPEED_MAX, r.speed + PK.SPEED_ACCEL * dt);
  }

  // --- entrada ---
  if (input.jump && !r.jumpHeld) r.buffer = PK.BUFFER;
  r.jumpHeld = input.jump;
  r.buffer = Math.max(0, r.buffer - dt);
  r.coyote = r.onGround ? PK.COYOTE : Math.max(0, r.coyote - dt);

  if (input.slide && r.stumbleT <= 0) {
    if (r.onGround && r.slideT <= 0 && r.vaultT <= 0) {
      r.slideT = PK.SLIDE_TIME;
      events.push({ name: "slide", x: r.x, y: r.y });
    } else if (!r.onGround) {
      r.wantRoll = true; // rodará al aterrizar y conservará la velocidad
    }
  }

  if (r.buffer > 0 && r.stumbleT <= 0) {
    const wall = nearestAhead(course, r, ["wall"], 26);
    if (!r.onGround && wall && r.vy > -120) {
      // rebote en pared
      r.vy = PK.JUMP_V * 0.92;
      r.x = wall.ob.x - r.w - 2;
      r.wallT = 0.25;
      r.buffer = 0;
      r.speed = Math.min(PK.SPEED_MAX, r.speed + PK.TRICK_BONUS);
      r.tricks++;
      events.push({ name: "wallJump", x: r.x, y: r.y });
    } else if (r.coyote > 0) {
      const barrier = nearestAhead(course, r, ["barrier"], PK.VAULT_REACH);
      if (barrier) {
        // voltereta sobre la valla: más rápida y más rentable que saltarla
        r.vaultT = PK.VAULT_TIME;
        r.vy = PK.JUMP_V * 0.62;
        r.speed = Math.min(PK.SPEED_MAX, r.speed + PK.TRICK_BONUS);
        r.tricks++;
        events.push({ name: "vault", x: r.x, y: r.y });
      } else {
        r.vy = PK.JUMP_V;
        events.push({ name: "jump", x: r.x, y: r.y });
      }
      r.onGround = false;
      r.coyote = 0;
      r.buffer = 0;
    }
  }

  if (!input.jump && r.vy < 0 && r.vaultT <= 0) r.vy *= PK.JUMP_CUT;

  // --- movimiento ---
  const forward = r.speed * (r.stumbleT > 0 ? 0.55 : 1) * dt;
  r.x += forward;
  r.distance += forward;

  r.vy = Math.min(r.vy + PK.GRAVITY * dt, 1100);
  r.y += r.vy * dt;

  // --- suelo (con huecos) ---
  const feetX = r.x + r.w / 2;
  let overGap = false;
  for (const ob of course.obstacles) {
    if (ob.type === "gap" && feetX > ob.x && feetX < ob.x + ob.w) overGap = true;
    if (ob.type === "fake" && ob.broken && feetX > ob.x && feetX < ob.x + ob.w) overGap = true;
  }

  const floor = PK.GROUND_Y - r.h;
  if (!overGap && r.y >= floor) {
    if (!r.onGround) {
      if (r.wantRoll) {
        r.rollT = PK.ROLL_TIME;
        r.speed = Math.min(PK.SPEED_MAX, r.speed + PK.TRICK_BONUS * 0.6);
        r.tricks++;
        events.push({ name: "roll", x: r.x, y: r.y });
      } else {
        events.push({ name: "land", x: r.x, y: r.y, vy: r.vy });
      }
    }
    r.y = floor;
    r.vy = 0;
    r.onGround = true;
    r.wantRoll = false;
  } else {
    r.onGround = false;
  }

  // --- caída al vacío ---
  if (r.y > PK.CANVAS_H + 140) {
    r.dead = true;
    events.push({ name: "fall", x: r.x, y: r.y });
    return;
  }

  // --- choques con los obstáculos ---
  const box = hitboxOf(r);
  for (const ob of course.obstacles) {
    if (ob.type === "gap") continue;

    if (ob.type === "fake") {
      if (!ob.broken && r.onGround && box.x + box.w > ob.x + 6 && box.x < ob.x + ob.w - 6) {
        ob.broken = true;
        events.push({ name: "fakeBreak", x: ob.x + ob.w / 2, y: ob.y });
        stumble(r, course, events, "fake");
      }
      continue;
    }

    if (!overlap(box, ob)) continue;

    if (ob.type === "spikes") {
      r.dead = true;
      events.push({ name: "spiked", x: r.x, y: r.y });
      return;
    }

    // Regla de diseño: nada te bloquea para siempre. Fallar un obstáculo
    // significa superarlo de forma torpe perdiendo velocidad (y metros frente
    // al perseguidor), nunca quedarte encallado contra él.
    if (ob.type === "barrier" || ob.type === "wall") {
      if (box.y + box.h <= ob.y + 14) continue; // ya vas por encima
      if (ob.type === "barrier" && r.vaultT > 0) continue; // voltereta limpia
      if (ob.type === "wall" && r.wallT > 0) continue; // rebote limpio
      // trepada torpe: acabas encaramado encima y sigues, pero te cuesta
      r.y = ob.y - r.h;
      r.vy = 0;
      r.onGround = true;
      stumble(r, course, events, ob.type);
    } else if (ob.type === "beam") {
      if (r.slideT > 0 || r.rollT > 0) continue;
      // te lo comes con la cabeza, pero acabas pasando agachado
      r.slideT = Math.max(r.slideT, PK.SLIDE_TIME * 0.8);
      r.y = PK.GROUND_Y - r.h;
      r.vy = 0;
      r.onGround = true;
      stumble(r, course, events, "beam");
    }
  }

  // --- pose para la animación ---
  if (r.stumbleT > 0) r.pose = "stumble";
  else if (r.rollT > 0) r.pose = "roll";
  else if (r.vaultT > 0) r.pose = "vault";
  else if (r.wallT > 0) r.pose = "wallJump";
  else if (r.slideT > 0) r.pose = "slide";
  else if (!r.onGround) r.pose = r.vy < 0 ? "jump" : "fall";
  else r.pose = "run";
}

// ---------------------------------------------------------------------------
// Perseguidor
// ---------------------------------------------------------------------------
function createChaser() {
  return { x: 160 - PK.LEAD_START, speed: PK.CHASER_BASE, t: 0 };
}

function stepChaser(c, r, dt) {
  c.t += dt;
  c.speed = Math.min(PK.CHASER_MAX, PK.CHASER_BASE + PK.CHASER_RAMP * c.t);
  c.x += c.speed * dt;
  // Nunca se descuelga del todo: si le sacas mucho, mantiene la tensión.
  if (r.x - c.x > PK.LEAD_MAX) c.x = r.x - PK.LEAD_MAX;
  if (c.x >= r.x - 6) return true; // te pilla
  return false;
}
