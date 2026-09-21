// Motor de físicas. Paso fijo de 1/60s: la simulación es determinista, así que
// la misma secuencia de inputs produce siempre la misma partida (es lo que hace
// posible grabar repeticiones y correr contra el fantasma de un compañero).

const PHYSICS = {
  STEP: 1 / 60,
  GRAVITY: 2050,
  MAX_FALL: 920,
  RUN_SPEED: 278,
  GROUND_ACCEL: 2700,
  AIR_ACCEL: 2000,
  GROUND_FRICTION: 3000,
  AIR_FRICTION: 420,
  JUMP_VELOCITY: -655,
  JUMP_CUT: 0.42, // al soltar el salto mientras subes, se recorta el impulso
  COYOTE: 0.09, // margen para saltar justo después de salir de una plataforma
  JUMP_BUFFER: 0.11, // margen para saltar justo antes de aterrizar
  SUBSTEP_MAX: 7, // px máximos por subpaso de colisión (evita atravesar bloques)
  SPRING_VELOCITY: -980,
  CRUMBLE_DELAY: 0.32,
  FLIP_DELAY: 0.16,
  SLAM_SPEED: 1500,
  DROP_GRAVITY: 2400,
};

const PLAYER_SIZE = { w: 26, h: 34 };

function createPlayer(spawn) {
  return {
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    w: PLAYER_SIZE.w,
    h: PLAYER_SIZE.h,
    onGround: false,
    facing: 1,
    coyote: 0,
    jumpBuffer: 0,
    jumpHeld: false,
    squash: 0, // >0 aplastado al aterrizar, <0 estirado al saltar
    launched: false, // lanzado por un muelle: el salto variable no lo recorta
    dead: false,
    finished: false,
    deathCause: null,
    ridingDx: 0,
  };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function pushEvent(level, name, x, y, extra) {
  level.events.push({ name, x, y, extra });
}

// ---------------------------------------------------------------------------
// Estado dinámico de los bloques
// ---------------------------------------------------------------------------

// ¿Este bloque frena al jugador ahora mismo?
function tileIsSolid(tile) {
  if (tile.kind === "crumble") return !tile.broken;
  if (tile.kind === "phase") return tile.solidNow;
  return true;
}

// ¿Tocar este bloque mata? (las paredes falsas son idénticas a las buenas, y el
// suelo volteado mata una vez ha girado)
function tileIsDeadly(tile) {
  if (tile.kind === "fake") return true;
  if (tile.kind === "flip") return tile.flipped;
  if (tile.kind === "slam") return tile.slamming;
  return false;
}

function updateTiles(level, dt) {
  for (const tile of level.platforms) {
    tile.px = tile.cx;
    tile.py = tile.cy;

    switch (tile.kind) {
      case "moving": {
        const phase = level.time * tile.speed + tile.phase;
        tile.cx = tile.x + Math.sin(phase) * (tile.rangeX || 0);
        tile.cy = tile.y + Math.sin(phase) * (tile.rangeY || 0);
        break;
      }
      case "phase": {
        // Ciclo: sólido durante `onTime`, ausente durante `offTime`.
        const period = tile.onTime + tile.offTime;
        const local = (level.time + tile.phase) % period;
        tile.solidNow = local < tile.onTime;
        // alpha para telegrafiar la desaparición antes de que ocurra
        const remaining = tile.solidNow ? tile.onTime - local : period - local;
        tile.alpha = tile.solidNow ? (remaining < 0.35 ? 0.35 + remaining : 1) : 0.18;
        break;
      }
      case "crumble": {
        if (tile.standTime !== null && !tile.broken) {
          const elapsed = level.time - tile.standTime;
          tile.crumbleProgress = Math.min(1, elapsed / PHYSICS.CRUMBLE_DELAY);
          if (elapsed >= PHYSICS.CRUMBLE_DELAY) {
            tile.broken = true;
            pushEvent(level, "crumbleBreak", tile.cx + tile.w / 2, tile.cy, tile);
          }
        }
        break;
      }
      case "flip": {
        if (tile.standTime !== null && !tile.flipped) {
          if (level.time - tile.standTime >= PHYSICS.FLIP_DELAY) {
            tile.flipped = true;
            pushEvent(level, "trapReveal", tile.cx + tile.w / 2, tile.cy, tile);
          }
        }
        break;
      }
      case "slam": {
        if (tile.triggered && tile.offset < tile.drop) {
          tile.slamming = true;
          tile.offset = Math.min(tile.drop, tile.offset + PHYSICS.SLAM_SPEED * dt);
          tile.cy = tile.y + tile.offset;
          if (tile.offset >= tile.drop) {
            tile.slamming = false;
            pushEvent(level, "slamLand", tile.cx + tile.w / 2, tile.cy + tile.h, tile);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  for (const hz of level.hazards) {
    hz.px = hz.cx;
    hz.py = hz.cy;
    if (hz.kind === "movingSpikes") {
      const phase = level.time * hz.speed + hz.phase;
      hz.cx = hz.x + Math.sin(phase) * (hz.rangeX || 0);
      hz.cy = hz.y + Math.sin(phase) * (hz.rangeY || 0);
    } else if (hz.kind === "dropSpikes" && hz.triggered) {
      hz.vy = Math.min(900, (hz.vy || 0) + PHYSICS.DROP_GRAVITY * dt);
      hz.cy += hz.vy * dt;
      if (hz.cy >= hz.restY) {
        hz.cy = hz.restY;
        if (!hz.landed) {
          hz.landed = true;
          pushEvent(level, "slamLand", hz.cx + hz.w / 2, hz.cy + hz.h, hz);
        }
      }
    }
  }
}

// Disparadores por posición del jugador: deterministas, dependen solo de dónde
// está el jugador, así que el fantasma los activa igual en su propia copia.
function updateTriggers(level, player) {
  const px = player.x + player.w / 2;

  for (const tile of level.platforms) {
    if (tile.kind === "slam" && !tile.triggered) {
      if (px >= tile.triggerX && px <= tile.triggerX + tile.triggerW) {
        tile.triggered = true;
        pushEvent(level, "slamStart", tile.cx + tile.w / 2, tile.cy, tile);
      }
    }
  }

  for (const hz of level.hazards) {
    if (hz.kind === "dropSpikes" && !hz.triggered) {
      if (px >= hz.triggerX && px <= hz.triggerX + hz.triggerW) {
        hz.triggered = true;
        pushEvent(level, "dropStart", hz.cx + hz.w / 2, hz.cy, hz);
      }
    }
  }

  for (const decoy of level.decoys) {
    if (!decoy.escaped) {
      const dist = Math.abs(px - (decoy.x + decoy.w / 2));
      if (dist < decoy.triggerDist) {
        decoy.escaped = true;
        pushEvent(level, "decoyEscape", decoy.x + decoy.w / 2, decoy.y, decoy);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Colisión: eje por eje, en subpasos pequeños
// ---------------------------------------------------------------------------

function collideAxis(player, level, axis, amount) {
  if (amount === 0) return null;

  if (axis === "x") player.x += amount;
  else player.y += amount;

  for (const tile of level.platforms) {
    if (!tileIsSolid(tile)) continue;
    const rect = { x: tile.cx, y: tile.cy, w: tile.w, h: tile.h };
    if (!rectsOverlap(player, rect)) continue;

    if (tileIsDeadly(tile)) {
      player.dead = true;
      player.deathCause = tile.kind === "slam" ? "slam" : tile.kind === "flip" ? "flip" : "fake";
      return "dead";
    }

    if (axis === "x") {
      if (amount > 0) player.x = rect.x - player.w;
      else player.x = rect.x + rect.w;
      player.vx = 0;
    } else {
      if (amount > 0) {
        // Aterrizaje
        player.y = rect.y - player.h;
        if (!player.onGround) {
          pushEvent(level, "land", player.x + player.w / 2, player.y + player.h, {
            speed: player.vy,
          });
          player.squash = Math.min(1, Math.abs(player.vy) / 700);
        }
        player.onGround = true;
        player.groundTile = tile;
        player.vy = 0;

        if (tile.kind === "crumble" && tile.standTime === null) {
          tile.standTime = level.time;
          pushEvent(level, "crumbleStart", tile.cx + tile.w / 2, tile.cy, tile);
        }
        if (tile.kind === "flip" && tile.standTime === null) {
          tile.standTime = level.time;
        }
        if (tile.kind === "spring" && level.time >= tile.pressedUntil) {
          player.vy = PHYSICS.SPRING_VELOCITY;
          player.onGround = false;
          // El impulso del muelle no se recorta al no mantener el salto: si no,
          // soltar la tecla anularía el lanzamiento.
          player.launched = true;
          tile.pressedUntil = level.time + 0.25;
          pushEvent(level, "spring", tile.cx + tile.w / 2, tile.cy, tile);
        }
      } else {
        // Golpe con el techo
        player.y = rect.y + rect.h;
        player.vy = 0;
      }
    }
  }
  return null;
}

function moveAndCollide(player, level, dt) {
  const dx = player.vx * dt + player.ridingDx;
  const dy = player.vy * dt;
  player.ridingDx = 0;

  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / PHYSICS.SUBSTEP_MAX));
  const sx = dx / steps;
  const sy = dy / steps;

  for (let i = 0; i < steps; i++) {
    if (collideAxis(player, level, "x", sx) === "dead") return "dead";
    if (collideAxis(player, level, "y", sy) === "dead") return "dead";
  }
  return null;
}

// Un bloque puede moverse hacia un jugador quieto (un aplastador que cae sobre
// alguien que no se mueve): sin esto no habría ninguna colisión que detectarlo.
function checkDeadlyOverlap(player, level) {
  // Rect 2px más alto: estar DE PIE sobre una baldosa que acaba de voltearse
  // también mata, aunque técnicamente los bordes solo se toquen.
  const body = { x: player.x, y: player.y, w: player.w, h: player.h + 2 };
  for (const tile of level.platforms) {
    if (!tileIsDeadly(tile)) continue;
    if (rectsOverlap(body, { x: tile.cx, y: tile.cy, w: tile.w, h: tile.h })) {
      player.dead = true;
      player.deathCause = tile.kind === "slam" ? "slam" : tile.kind === "flip" ? "flip" : "fake";
      return true;
    }
  }
  return false;
}

// Arrastra al jugador con la plataforma móvil sobre la que va montado.
function applyPlatformCarry(player, level) {
  if (!player.onGround || !player.groundTile) return;
  const tile = player.groundTile;
  if (tile.kind !== "moving") return;
  player.ridingDx += tile.cx - tile.px;
  player.y += tile.cy - tile.py;
}

// ---------------------------------------------------------------------------
// Paso de simulación
// ---------------------------------------------------------------------------

function stepPlayer(player, input, level, dt) {
  level.time += dt;
  updateTiles(level, dt);

  if (player.dead || player.finished) return null;

  updateTriggers(level, player);

  if (checkDeadlyOverlap(player, level)) {
    pushEvent(level, "death", player.x + player.w / 2, player.y + player.h / 2, {
      cause: player.deathCause,
    });
    return "dead";
  }

  applyPlatformCarry(player, level);

  // --- movimiento horizontal con aceleración y fricción ---
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const accel = player.onGround ? PHYSICS.GROUND_ACCEL : PHYSICS.AIR_ACCEL;
  const friction = player.onGround ? PHYSICS.GROUND_FRICTION : PHYSICS.AIR_FRICTION;

  if (dir !== 0) {
    player.vx += dir * accel * dt;
    player.vx = Math.max(-PHYSICS.RUN_SPEED, Math.min(PHYSICS.RUN_SPEED, player.vx));
    player.facing = dir;
  } else if (player.vx !== 0) {
    const drop = friction * dt;
    player.vx = player.vx > 0 ? Math.max(0, player.vx - drop) : Math.min(0, player.vx + drop);
  }

  // --- salto: coyote time + buffer + altura variable ---
  if (input.jump && !player.jumpHeld) player.jumpBuffer = PHYSICS.JUMP_BUFFER;
  player.jumpHeld = input.jump;

  player.coyote = player.onGround ? PHYSICS.COYOTE : Math.max(0, player.coyote - dt);
  player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);

  if (player.jumpBuffer > 0 && player.coyote > 0) {
    player.vy = PHYSICS.JUMP_VELOCITY;
    player.onGround = false;
    player.coyote = 0;
    player.jumpBuffer = 0;
    player.squash = -0.8;
    pushEvent(level, "jump", player.x + player.w / 2, player.y + player.h, null);
  }

  if (!input.jump && player.vy < 0 && !player.launched) player.vy *= PHYSICS.JUMP_CUT;
  if (player.vy >= 0) player.launched = false;

  player.vy = Math.min(player.vy + PHYSICS.GRAVITY * dt, PHYSICS.MAX_FALL);

  // --- desplazamiento y colisiones ---
  player.onGround = false;
  player.groundTile = null;
  if (moveAndCollide(player, level, dt) === "dead") {
    pushEvent(level, "death", player.x + player.w / 2, player.y + player.h / 2, {
      cause: player.deathCause,
    });
    return "dead";
  }

  // El mundo tiene bordes: sin esto se puede andar hacia la izquierda desde el
  // inicio y caerse fuera del nivel.
  if (player.x < 0) {
    player.x = 0;
    player.vx = 0;
  } else if (player.x + player.w > level.width) {
    player.x = level.width - player.w;
    player.vx = 0;
  }

  // --- pegatina escondida (solo cuenta si además terminas el nivel) ---
  for (const tk of level.tokens) {
    if (tk.taken) continue;
    if (rectsOverlap(player, tk)) {
      tk.taken = true;
      pushEvent(level, "token", tk.x + tk.w / 2, tk.y + tk.h / 2, tk);
    }
  }

  // --- peligros ---
  for (const hz of level.hazards) {
    if (rectsOverlap(player, { x: hz.cx, y: hz.cy, w: hz.w, h: hz.h })) {
      player.dead = true;
      player.deathCause = "spikes";
      pushEvent(level, "death", player.x + player.w / 2, player.y + player.h / 2, {
        cause: "spikes",
      });
      return "dead";
    }
  }

  // --- caída al vacío ---
  if (player.y > level.height + 260) {
    player.dead = true;
    player.deathCause = "fall";
    pushEvent(level, "death", player.x + player.w / 2, level.height, { cause: "fall" });
    return "dead";
  }

  // --- meta ---
  if (rectsOverlap(player, level.goal)) {
    player.finished = true;
    pushEvent(level, "goal", level.goal.x + level.goal.w / 2, level.goal.y, null);
    return "goal";
  }

  // --- animación: el aplastado vuelve a su sitio poco a poco ---
  player.squash += (0 - player.squash) * Math.min(1, dt * 12);

  return null;
}
