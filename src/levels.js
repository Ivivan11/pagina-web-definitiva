// Niveles estilo "trampa": nada es lo que parece. Cada nivel se reconstruye
// desde cero en cada intento (buildLevel) para que no quede estado sucio
// (plataformas rotas, temporizadores) entre una partida y la siguiente.

const GROUND_Y = 470;
const GROUND_TH = 70;
const LEVEL_CANVAS_H = 540;
const PLAYER_H = 36;

function ground(x, w) {
  return { type: "solid", solid: true, x, y: GROUND_Y, w, h: GROUND_TH };
}

function fakeGround(x, w) {
  return { type: "fakewall", solid: true, x, y: GROUND_Y, w, h: GROUND_TH };
}

function crumble(x, w) {
  return {
    type: "crumble",
    solid: true,
    x,
    y: GROUND_Y,
    w,
    h: GROUND_TH,
    standTime: null,
    broken: false,
  };
}

function block(x, y, w, h) {
  return { type: "solid", solid: true, x, y, w, h };
}

function fakeBlock(x, y, w, h) {
  return { type: "fakewall", solid: true, x, y, w, h };
}

function movingPlatform({ x, y, w, h, axis, range, speed, phase = 0 }) {
  return {
    type: "moving",
    solid: true,
    w,
    h,
    rect(level) {
      const t = level.time * speed + phase;
      const offset = Math.sin(t) * range;
      return axis === "x"
        ? { x: x + offset, y, w, h }
        : { x, y: y + offset, w, h };
    },
  };
}

function spikes(x, y, w, h) {
  return { x, y, w, h };
}

function movingHazard({ x, y, w, h, axis, range, speed, phase = 0 }) {
  return {
    w,
    h,
    rect(level) {
      const t = level.time * speed + phase;
      const offset = Math.sin(t) * range;
      return axis === "x"
        ? { x: x + offset, y, w, h }
        : { x, y: y + offset, w, h };
    },
  };
}

const LEVEL_DEFS = [
  {
    name: "1. Bienvenido",
    hint: "No todo lo que pisas es de fiar.",
    width: 1600,
    build() {
      return {
        spawn: { x: 40, y: GROUND_Y - PLAYER_H },
        goal: { x: 1540, y: GROUND_Y - 90, w: 40, h: 90 },
        platforms: [ground(0, 700), fakeGround(700, 80), ground(780, 820)],
        hazards: [],
      };
    },
  },
  {
    name: "2. Se derrumba",
    hint: "Corre, no te pares a pensar.",
    width: 1900,
    build() {
      return {
        spawn: { x: 40, y: GROUND_Y - PLAYER_H },
        goal: { x: 1840, y: GROUND_Y - 90, w: 40, h: 90 },
        platforms: [
          ground(0, 300),
          crumble(340, 90),
          crumble(470, 90),
          crumble(600, 90),
          ground(720, 280),
          crumble(1040, 90),
          crumble(1170, 90),
          ground(1300, 620),
        ],
        hazards: [
          spikes(340, GROUND_Y + 20, 350, 20),
          spikes(1040, GROUND_Y + 20, 220, 20),
        ],
      };
    },
  },
  {
    name: "3. Aterrizaje falso",
    hint: "El camino más cómodo no siempre es el real.",
    width: 1800,
    build() {
      return {
        spawn: { x: 40, y: GROUND_Y - PLAYER_H },
        goal: { x: 1740, y: GROUND_Y - 90, w: 40, h: 90 },
        platforms: [
          ground(0, 500),
          fakeBlock(560, GROUND_Y - 30, 140, 30),
          block(560, GROUND_Y - 90, 140, 30),
          ground(900, 900),
        ],
        hazards: [spikes(500, GROUND_Y + 20, 400, 20)],
      };
    },
  },
  {
    name: "4. En marcha",
    hint: "Súbete, pero no te duermas.",
    width: 2000,
    build() {
      return {
        spawn: { x: 40, y: GROUND_Y - PLAYER_H },
        goal: { x: 1940, y: GROUND_Y - 90, w: 40, h: 90 },
        platforms: [
          ground(0, 500),
          movingPlatform({
            x: 650,
            y: GROUND_Y - 10,
            w: 110,
            h: 20,
            axis: "x",
            range: 220,
            speed: 1.4,
          }),
          ground(1400, 600),
        ],
        hazards: [spikes(500, GROUND_Y + 20, 900, 20)],
      };
    },
  },
  {
    name: "5. Doble trampa",
    hint: "Baja del carrito antes de que sea tarde.",
    width: 2100,
    build() {
      return {
        spawn: { x: 40, y: GROUND_Y - PLAYER_H },
        goal: { x: 2040, y: GROUND_Y - 90, w: 40, h: 90 },
        platforms: [
          ground(0, 450),
          movingPlatform({
            x: 600,
            y: GROUND_Y - 10,
            w: 100,
            h: 20,
            axis: "x",
            range: 200,
            speed: 1.6,
          }),
          fakeGround(1300, 90),
          ground(1000, 300),
          ground(1390, 710),
        ],
        hazards: [spikes(450, GROUND_Y + 20, 850, 20)],
      };
    },
  },
  {
    name: "6. Grietas y mentiras",
    hint: "Las que crujen se rompen. Las que no crujen... a veces mienten.",
    width: 2100,
    build() {
      return {
        spawn: { x: 40, y: GROUND_Y - PLAYER_H },
        goal: { x: 2040, y: GROUND_Y - 90, w: 40, h: 90 },
        platforms: [
          ground(0, 300),
          crumble(340, 90),
          fakeGround(470, 90),
          crumble(600, 90),
          ground(720, 300),
          crumble(1120, 90),
          crumble(1250, 90),
          ground(1380, 720),
        ],
        hazards: [
          spikes(340, GROUND_Y + 20, 350, 20),
          spikes(1120, GROUND_Y + 20, 220, 20),
        ],
      };
    },
  },
  {
    name: "7. Doble engaño",
    hint: "Si la primera te engañó, la segunda también lo intentará.",
    width: 2200,
    build() {
      return {
        spawn: { x: 40, y: GROUND_Y - PLAYER_H },
        goal: { x: 2140, y: GROUND_Y - 90, w: 40, h: 90 },
        platforms: [
          ground(0, 450),
          fakeBlock(510, GROUND_Y - 30, 130, 30),
          block(510, GROUND_Y - 90, 130, 30),
          ground(840, 300),
          fakeBlock(1250, GROUND_Y - 30, 130, 30),
          block(1250, GROUND_Y - 90, 130, 30),
          ground(1580, 620),
        ],
        hazards: [
          spikes(450, GROUND_Y + 20, 390, 20),
          spikes(1140, GROUND_Y + 20, 440, 20),
        ],
      };
    },
  },
  {
    name: "8. Final",
    hint: "La meta está ahí mismo. Eso es justo el problema.",
    width: 2400,
    build() {
      return {
        spawn: { x: 40, y: GROUND_Y - PLAYER_H },
        goal: { x: 2340, y: GROUND_Y - 90, w: 40, h: 90 },
        platforms: [
          ground(0, 400),
          movingPlatform({
            x: 550,
            y: GROUND_Y - 10,
            w: 100,
            h: 20,
            axis: "x",
            range: 210,
            speed: 1.7,
          }),
          ground(1250, 250),
          crumble(1560, 90),
          crumble(1690, 90),
          ground(1820, 380),
          fakeGround(2200, 90),
          ground(2290, 110),
        ],
        hazards: [
          spikes(400, GROUND_Y + 20, 850, 20),
          spikes(1560, GROUND_Y + 20, 220, 20),
          movingHazard({
            x: 2000,
            y: GROUND_Y - 60,
            w: 26,
            h: 60,
            axis: "y",
            range: 40,
            speed: 2.2,
          }),
        ],
      };
    },
  },
];

function buildLevel(index) {
  const def = LEVEL_DEFS[index];
  const state = def.build();
  return {
    index,
    name: def.name,
    hint: def.hint,
    width: def.width,
    height: LEVEL_CANVAS_H,
    time: 0,
    spawn: state.spawn,
    goal: state.goal,
    platforms: state.platforms,
    hazards: state.hazards,
  };
}
