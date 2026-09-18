// Motor de físicas: paso fijo (1/60s) para que las repeticiones (replays) sean
// deterministas y el fantasma se reproduzca exactamente igual que la partida original.
const PHYSICS = {
  STEP: 1 / 60,
  GRAVITY: 1700,
  MOVE_SPEED: 260,
  JUMP_VELOCITY: -620,
  MAX_FALL_SPEED: 900,
};

const PLAYER_SIZE = { w: 28, h: 36 };

function createPlayer(spawn) {
  return {
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    w: PLAYER_SIZE.w,
    h: PLAYER_SIZE.h,
    onGround: false,
    dead: false,
    finished: false,
  };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Avanza un único paso fijo de simulación. `input` = {left,right,jump} booleanos.
// `level` debe traer .platforms (con estado runtime propio, ver levels.js) y .goal.
// Devuelve un string de evento si algo relevante ocurrió: 'dead' | 'goal' | null.
function stepPlayer(player, input, level, dt) {
  level.time += dt;
  if (player.dead || player.finished) return null;

  player.vx = 0;
  if (input.left) player.vx -= PHYSICS.MOVE_SPEED;
  if (input.right) player.vx += PHYSICS.MOVE_SPEED;

  if (input.jump && player.onGround) {
    player.vy = PHYSICS.JUMP_VELOCITY;
    player.onGround = false;
  }

  player.vy = Math.min(player.vy + PHYSICS.GRAVITY * dt, PHYSICS.MAX_FALL_SPEED);

  player.x += player.vx * dt;
  player.y += player.vy * dt;

  player.onGround = false;

  for (const p of level.platforms) {
    if (p.type === "crumble" && p.broken) continue;
    if (!p.solid) continue;

    const rect = p.rect ? p.rect(level) : p;
    if (!rectsOverlap(player, rect)) continue;

    // Resolución simple: si venía cayendo, lo apoyamos encima. Si no, es
    // colisión lateral/techo -> lo empujamos fuera por el eje con menor solape.
    const prevBottom = player.y + player.h - player.vy * dt;
    if (player.vy >= 0 && prevBottom <= rect.y + 1) {
      player.y = rect.y - player.h;
      player.vy = 0;
      player.onGround = true;
      if (p.type === "crumble" && p.standTime === null) p.standTime = level.time;
      if (p.type === "fakewall") {
        player.dead = true;
        return "dead";
      }
    } else {
      // colisión lateral o desde abajo: si es una pared falsa, mata igualmente.
      if (p.type === "fakewall") {
        player.dead = true;
        return "dead";
      }
      const fromLeft = player.x + player.w - rect.x;
      const fromRight = rect.x + rect.w - player.x;
      if (fromLeft < fromRight) {
        player.x = rect.x - player.w;
      } else {
        player.x = rect.x + rect.w;
      }
      if (player.vy < 0 && player.y < rect.y + rect.h) {
        player.y = rect.y + rect.h;
        player.vy = 0;
      }
    }
  }

  const CRUMBLE_DELAY = 0.35;
  for (const p of level.platforms) {
    if (p.type === "crumble" && p.standTime !== null && !p.broken) {
      if (level.time - p.standTime > CRUMBLE_DELAY) p.broken = true;
    }
  }

  for (const h of level.hazards) {
    const rect = h.rect ? h.rect(level) : h;
    if (rectsOverlap(player, rect)) {
      player.dead = true;
      return "dead";
    }
  }

  if (player.y > level.height + 200) {
    player.dead = true;
    return "dead";
  }

  if (rectsOverlap(player, level.goal)) {
    player.finished = true;
    return "goal";
  }

  return null;
}
