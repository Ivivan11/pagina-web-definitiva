// Niveles. Cada uno se reconstruye desde cero en cada intento para que no
// arrastre estado (plataformas rotas, temporizadores, trampas ya disparadas).
//
// Vocabulario de bloques:
//   solid    — plataforma normal
//   fake     — IDÉNTICA a solid a la vista, pero mata al tocarla
//   crumble  — se agrieta y se rompe poco después de pisarla
//   flip     — parece normal; al pisarla se voltea y se convierte en pinchos
//   moving   — plataforma que oscila y arrastra al jugador
//   phase    — aparece y desaparece en ciclo
//   spring   — muelle que lanza hacia arriba
//   slam     — bloque suspendido que se desploma al pasar por debajo
// Peligros: spikes (fijos), movingSpikes (oscilan), dropSpikes (caen al pasar).

const GROUND_Y = 470;
const GROUND_TH = 70;
const LEVEL_CANVAS_H = 540;
const PLAYER_H = 34;
const SPAWN_Y = GROUND_Y - PLAYER_H;

function tile(kind, x, y, w, h, extra) {
  return Object.assign({ kind, x, y, w, h, cx: x, cy: y, px: x, py: y }, extra);
}

const ground = (x, w) => tile("solid", x, GROUND_Y, w, GROUND_TH);
const fakeGround = (x, w) => tile("fake", x, GROUND_Y, w, GROUND_TH);
const crumbleGround = (x, w) =>
  tile("crumble", x, GROUND_Y, w, GROUND_TH, { standTime: null, broken: false, crumbleProgress: 0 });
const flipGround = (x, w) => tile("flip", x, GROUND_Y, w, GROUND_TH, { standTime: null, flipped: false });

const plat = (x, y, w, h) => tile("solid", x, y, w, h);
const fakePlat = (x, y, w, h) => tile("fake", x, y, w, h);
const crumblePlat = (x, y, w, h) =>
  tile("crumble", x, y, w, h, { standTime: null, broken: false, crumbleProgress: 0 });

const mover = (x, y, w, h, opts) =>
  tile("moving", x, y, w, h, {
    rangeX: opts.rangeX || 0,
    rangeY: opts.rangeY || 0,
    speed: opts.speed || 1.2,
    phase: opts.phase || 0,
  });

const phasePlat = (x, y, w, h, onTime, offTime, phase) =>
  tile("phase", x, y, w, h, { onTime, offTime, phase: phase || 0, solidNow: true, alpha: 1 });

// El muelle va a ras de suelo: si sobresaliera, el jugador chocaría de lado
// con él en vez de pisarlo. Así se pisa al correr (y para esquivarlo, se salta).
const spring = (x, w) => tile("spring", x, GROUND_Y, w, GROUND_TH, { pressedUntil: 0 });

const slam = (x, y, w, h, drop, triggerX, triggerW) =>
  tile("slam", x, y, w, h, { drop, triggerX, triggerW, triggered: false, slamming: false, offset: 0 });

// Los pinchos de foso van algo por debajo del borde del suelo: así no se
// cruzan visualmente con las plataformas móviles que pasan a ras.
function spikes(x, w, y, dir) {
  const top = y == null ? GROUND_Y + 32 : y;
  return { kind: "spikes", x, y: top, w, h: 22, cx: x, cy: top, px: x, py: top, dir: dir || "up" };
}

function ceilingSpikes(x, y, w) {
  return { kind: "spikes", x, y, w, h: 26, cx: x, cy: y, px: x, py: y, dir: "down" };
}

function movingSpikes(x, y, w, h, opts) {
  return {
    kind: "movingSpikes",
    x,
    y,
    w,
    h,
    cx: x,
    cy: y,
    px: x,
    py: y,
    dir: opts.dir || "up",
    rangeX: opts.rangeX || 0,
    rangeY: opts.rangeY || 0,
    speed: opts.speed || 1,
    phase: opts.phase || 0,
  };
}

function dropSpikes(x, y, w, triggerX, triggerW) {
  return {
    kind: "dropSpikes",
    x,
    y,
    w,
    h: 46,
    cx: x,
    cy: y,
    px: x,
    py: y,
    dir: "down",
    restY: GROUND_Y - 46,
    triggerX,
    triggerW,
    triggered: false,
    vy: 0,
    landed: false,
  };
}

const decoy = (x, dist) => ({ x, y: GROUND_Y - 90, w: 40, h: 90, triggerDist: dist || 190, escaped: false });
const goalAt = (x) => ({ x, y: GROUND_Y - 90, w: 40, h: 90 });

const LEVEL_DEFS = [
  {
    name: "Bienvenido",
    hint: "Flechas o A/D para moverte. Espacio para saltar.",
    width: 1700,
    tint: "dawn",
    build: () => ({
      spawn: { x: 50, y: SPAWN_Y },
      goal: goalAt(1620),
      // Primer hueco cómodo: el salto máximo son ~178px, así que 100 perdona
      // que no saltes justo en el borde.
      platforms: [ground(0, 520), ground(620, 480), fakeGround(1100, 80), ground(1180, 520)],
      hazards: [spikes(520, 100)],
      decoys: [],
    }),
  },
  {
    name: "Confianza",
    hint: "Hay tres baldosas que mienten. Suerte.",
    width: 1900,
    tint: "dawn",
    build: () => ({
      spawn: { x: 50, y: SPAWN_Y },
      goal: goalAt(1820),
      platforms: [
        ground(0, 400),
        fakeGround(400, 70),
        ground(470, 330),
        fakeGround(800, 70),
        ground(870, 430),
        fakeGround(1300, 70),
        ground(1370, 530),
      ],
      hazards: [],
      decoys: [],
    }),
  },
  {
    name: "Se derrumba",
    hint: "Si te paras, te caes.",
    width: 2000,
    tint: "night",
    build: () => ({
      spawn: { x: 50, y: SPAWN_Y },
      goal: goalAt(1920),
      platforms: [
        ground(0, 320),
        crumbleGround(360, 100),
        crumbleGround(500, 100),
        crumbleGround(640, 100),
        ground(780, 320),
        crumbleGround(1140, 100),
        crumbleGround(1280, 100),
        crumbleGround(1420, 100),
        ground(1560, 440),
      ],
      hazards: [spikes(320, 460), spikes(1100, 460)],
      decoys: [],
    }),
  },
  {
    name: "El escalón amable",
    hint: "Esa piedrecita del medio parece muy cómoda, ¿verdad?",
    width: 1900,
    tint: "night",
    build: () => ({
      spawn: { x: 50, y: SPAWN_Y },
      goal: goalAt(1820),
      platforms: [
        ground(0, 500),
        fakePlat(535, 445, 60, 22),
        ground(630, 500),
        fakePlat(1165, 445, 60, 22),
        ground(1260, 640),
      ],
      hazards: [spikes(500, 130), spikes(1130, 130)],
      decoys: [],
    }),
  },
  {
    name: "Mira arriba",
    hint: "Correr es la única defensa.",
    width: 2000,
    tint: "night",
    build: () => ({
      spawn: { x: 50, y: SPAWN_Y },
      goal: goalAt(1920),
      platforms: [ground(0, 2000)],
      // El disparador va muy por delante: los pinchos caen ANTES de que
      // llegues, y el reto pasa a ser saltarlos, no correr más que ellos.
      hazards: [
        dropSpikes(600, 120, 70, 300, 80),
        dropSpikes(1020, 120, 70, 720, 80),
        dropSpikes(1440, 120, 70, 1140, 80),
      ],
      decoys: [],
    }),
  },
  {
    name: "El suelo gira",
    hint: "Píselo y cuente hasta uno. No llegará.",
    width: 2000,
    tint: "sunset",
    build: () => ({
      spawn: { x: 50, y: SPAWN_Y },
      goal: goalAt(1920),
      platforms: [
        ground(0, 300),
        flipGround(300, 130),
        ground(430, 70),
        flipGround(500, 130),
        ground(630, 70),
        flipGround(700, 130),
        ground(830, 1170),
      ],
      hazards: [],
      decoys: [],
    }),
  },
  {
    name: "En marcha",
    hint: "Súbete, pero no te acomodes.",
    width: 2100,
    tint: "sunset",
    build: () => ({
      spawn: { x: 50, y: SPAWN_Y },
      goal: goalAt(2020),
      platforms: [
        ground(0, 480),
        // Los recorridos se solapan con los apoyos: en el momento bueno se
        // puede pasar casi andando, sin saltos al milímetro.
        mover(640, GROUND_Y, 140, 22, { rangeX: 140, speed: 1.0, phase: 0 }),
        plat(920, 420, 150, 24),
        mover(1290, GROUND_Y, 140, 22, { rangeX: 220, speed: 0.9, phase: Math.PI }),
        ground(1600, 500),
      ],
      hazards: [spikes(480, 1120)],
      decoys: [],
    }),
  },
  {
    name: "Ahora sí, ahora no",
    hint: "Las que parpadean avisan. Las demás no.",
    width: 2000,
    tint: "sunset",
    build: () => ({
      spawn: { x: 50, y: SPAWN_Y },
      goal: goalAt(1920),
      platforms: [
        ground(0, 400),
        phasePlat(440, 445, 115, 22, 3.0, 0.8, 0),
        phasePlat(580, 445, 115, 22, 3.0, 0.8, 0.18),
        phasePlat(720, 445, 115, 22, 3.0, 0.8, 0.36),
        phasePlat(860, 445, 115, 22, 3.0, 0.8, 0.54),
        phasePlat(1000, 445, 115, 22, 3.0, 0.8, 0.72),
        ground(1150, 850),
      ],
      hazards: [spikes(400, 750)],
      decoys: [],
    }),
  },
  {
    name: "Muelles",
    hint: "Un muelle es tu amigo. Hasta que mires hacia arriba.",
    width: 2200,
    tint: "void",
    build: () => ({
      spawn: { x: 50, y: SPAWN_Y },
      goal: goalAt(2120),
      platforms: [
        ground(0, 500),
        spring(500, 90),
        plat(640, 300, 170, 24),
        plat(880, 300, 160, 24),
        ground(1120, 210),
        spring(1330, 90),
        ground(1420, 780),
      ],
      hazards: [ceilingSpikes(1290, 165, 170), spikes(1040, 80)],
      decoys: [],
    }),
  },
  {
    name: "Aplastar",
    hint: "Lo que cuelga, cae.",
    width: 2200,
    tint: "void",
    build: () => ({
      spawn: { x: 50, y: SPAWN_Y },
      goal: goalAt(2120),
      platforms: [
        ground(0, 2200),
        // Los bloques caen con bastante antelación: quedan como obstáculo que
        // hay que escalar, no como una muerte imposible de esquivar.
        slam(520, 130, 90, 70, 270, 280, 90),
        slam(1020, 130, 90, 70, 270, 780, 90),
        slam(1520, 130, 90, 70, 270, 1280, 90),
      ],
      hazards: [],
      decoys: [],
    }),
  },
  {
    name: "Grietas y mentiras",
    hint: "La que no cruje es la que miente.",
    width: 2200,
    tint: "night",
    build: () => ({
      spawn: { x: 50, y: SPAWN_Y },
      goal: goalAt(2120),
      platforms: [
        ground(0, 300),
        crumbleGround(340, 100),
        fakeGround(465, 75),
        crumbleGround(570, 100),
        ground(700, 330),
        crumbleGround(1070, 100),
        crumbleGround(1200, 100),
        fakeGround(1325, 75),
        crumbleGround(1430, 100),
        ground(1560, 640),
      ],
      hazards: [spikes(300, 400), spikes(1030, 530)],
      decoys: [],
    }),
  },
  {
    name: "La meta miente",
    hint: "Casi lo tienes. Casi.",
    width: 2400,
    tint: "sunset",
    build: () => ({
      spawn: { x: 50, y: SPAWN_Y },
      goal: goalAt(2320),
      platforms: [
        ground(0, 1250),
        fakeGround(1250, 80),
        ground(1330, 320),
        crumbleGround(1700, 110),
        crumbleGround(1850, 110),
        ground(2000, 400),
      ],
      hazards: [spikes(1650, 350)],
      decoys: [decoy(1150, 200)],
    }),
  },
  {
    name: "Doble engaño",
    hint: "Si te la colaron una vez, te la cuelan dos.",
    width: 2300,
    tint: "night",
    build: () => ({
      spawn: { x: 50, y: SPAWN_Y },
      goal: goalAt(2220),
      platforms: [
        ground(0, 460),
        fakePlat(495, 445, 60, 22),
        ground(590, 420),
        flipGround(1010, 120),
        ground(1130, 330),
        fakePlat(1495, 445, 60, 22),
        ground(1590, 710),
      ],
      hazards: [spikes(460, 130), spikes(1460, 130)],
      decoys: [],
    }),
  },
  {
    name: "Ascensores",
    hint: "Sube, salta, y no mires abajo.",
    width: 2100,
    tint: "void",
    build: () => ({
      spawn: { x: 50, y: SPAWN_Y },
      goal: goalAt(2020),
      platforms: [
        ground(0, 420),
        mover(510, 410, 130, 22, { rangeY: 60, speed: 0.8, phase: 0 }),
        plat(740, 360, 140, 22),
        mover(980, 410, 130, 22, { rangeY: 60, speed: 0.8, phase: Math.PI }),
        plat(1210, 375, 140, 22),
        ground(1420, 680),
      ],
      hazards: [
        spikes(420, 1000),
        movingSpikes(940, 240, 28, 58, { rangeY: 55, speed: 1.4, dir: "down" }),
      ],
      decoys: [],
    }),
  },
  {
    name: "Carrera",
    hint: "Ritmo. No pienses, corre.",
    width: 2500,
    tint: "dawn",
    build: () => ({
      spawn: { x: 50, y: SPAWN_Y },
      goal: goalAt(2420),
      platforms: [
        ground(0, 280),
        crumbleGround(320, 95),
        crumbleGround(445, 95),
        crumbleGround(570, 95),
        crumbleGround(695, 95),
        crumbleGround(820, 95),
        crumbleGround(945, 95),
        crumbleGround(1070, 95),
        crumbleGround(1195, 95),
        crumbleGround(1320, 95),
        crumbleGround(1445, 95),
        ground(1580, 920),
      ],
      hazards: [spikes(280, 1300)],
      decoys: [],
    }),
  },
  {
    name: "Todo a la vez",
    hint: "Ya conoces las piezas. Ahora vienen juntas.",
    width: 2400,
    tint: "void",
    build: () => ({
      spawn: { x: 50, y: SPAWN_Y },
      goal: goalAt(2320),
      platforms: [
        ground(0, 420),
        spring(420, 90),
        plat(570, 300, 140, 24),
        phasePlat(770, 300, 130, 22, 3.0, 0.8, 0),
        phasePlat(960, 300, 130, 22, 3.0, 0.8, 0.4),
        ground(1150, 420),
        slam(1380, 130, 90, 70, 270, 1150, 90),
        ground(1570, 430),
        fakeGround(2000, 80),
        ground(2080, 320),
      ],
      hazards: [spikes(1090, 60)],
      decoys: [],
    }),
  },
  {
    name: "Confianza ciega",
    hint: "Aquí ya no hay pistas. Solo memoria.",
    width: 2400,
    tint: "night",
    build: () => ({
      spawn: { x: 50, y: SPAWN_Y },
      goal: goalAt(2320),
      platforms: [
        ground(0, 340),
        fakeGround(340, 75),
        ground(415, 180),
        flipGround(595, 120),
        ground(715, 190),
        fakeGround(905, 75),
        ground(980, 200),
        flipGround(1180, 120),
        ground(1300, 210),
        fakeGround(1510, 75),
        ground(1585, 815),
      ],
      hazards: [],
      decoys: [],
    }),
  },
  {
    name: "Final",
    hint: "La meta está ahí mismo. Eso es justo el problema.",
    width: 2980,
    tint: "void",
    build: () => ({
      spawn: { x: 50, y: SPAWN_Y },
      goal: goalAt(2900),
      platforms: [
        ground(0, 400),
        mover(600, GROUND_Y, 120, 22, { rangeX: 200, speed: 1.0, phase: 0 }),
        ground(920, 300),
        crumbleGround(1260, 100),
        fakeGround(1375, 70),
        crumbleGround(1460, 110),
        ground(1600, 230),
        spring(1830, 90),
        plat(1990, 300, 150, 24),
        phasePlat(2190, 300, 130, 22, 3.0, 0.8, 0.3),
        ground(2380, 400),
        slam(2500, 130, 90, 70, 270, 2380, 90),
        fakeGround(2780, 70),
        ground(2850, 130),
      ],
      hazards: [spikes(400, 520), spikes(1220, 385), spikes(2340, 40)],
      decoys: [decoy(2300, 170)],
    }),
  },
];

function buildLevel(index) {
  const def = LEVEL_DEFS[index];
  const state = def.build();
  return {
    index,
    name: `${index + 1}. ${def.name}`,
    shortName: def.name,
    hint: def.hint,
    width: def.width,
    height: LEVEL_CANVAS_H,
    tint: def.tint,
    time: 0,
    events: [],
    spawn: state.spawn,
    goal: state.goal,
    platforms: state.platforms,
    hazards: state.hazards,
    decoys: state.decoys || [],
  };
}
