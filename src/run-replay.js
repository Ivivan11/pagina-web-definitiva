// Repeticiones de la carrera. El código lleva la semilla dentro, así que
// reproduce el MISMO recorrido: por eso un reto se puede pasar de móvil a
// móvil sin servidor ninguno.

function createRunRecorder() {
  return { frames: [] };
}

function recordRunFrame(rec, input) {
  rec.frames.push((input.jump ? 1 : 0) | (input.slide ? 2 : 0));
}

function encodeRun(seed, frames) {
  const runs = [];
  let i = 0;
  while (i < frames.length) {
    let j = i;
    while (j < frames.length && frames[j] === frames[i] && j - i < 65535) j++;
    runs.push([frames[i], j - i]);
    i = j;
  }

  const buf = new Uint8Array(9 + runs.length * 3);
  const view = new DataView(buf.buffer);
  buf[0] = 1; // versión
  view.setUint32(1, seed >>> 0, true);
  view.setUint32(5, frames.length, true);
  let off = 9;
  for (const [byte, count] of runs) {
    buf[off] = byte;
    view.setUint16(off + 1, count, true);
    off += 3;
  }

  let bin = "";
  for (let k = 0; k < buf.length; k++) bin += String.fromCharCode(buf[k]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeRun(code) {
  try {
    let b64 = String(code).trim().replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) buf[k] = bin.charCodeAt(k);
    const view = new DataView(buf.buffer);
    if (buf[0] !== 1) return null;

    const seed = view.getUint32(1, true);
    const total = view.getUint32(5, true);
    if (!total || total > 200000) return null;

    const frames = new Array(total);
    let off = 9;
    let idx = 0;
    while (off + 2 < buf.length && idx < total) {
      const byte = buf[off];
      const count = view.getUint16(off + 1, true);
      for (let c = 0; c < count && idx < total; c++) frames[idx++] = byte;
      off += 3;
    }
    if (idx < total) return null;
    return { seed, frames };
  } catch (e) {
    return null;
  }
}

// El fantasma corre su propia copia del recorrido (misma semilla = mismos
// obstáculos) reproduciendo las teclas grabadas.
function createRunGhost(seed, frames) {
  return {
    course: createCourse(seed),
    runner: createRunner(),
    frames,
    i: 0,
    done: false,
    events: [],
  };
}

function stepRunGhost(g, dt) {
  if (g.done || g.i >= g.frames.length) {
    g.done = true;
    return;
  }
  const b = g.frames[g.i++];
  stepRunner(g.runner, { jump: !!(b & 1), slide: !!(b & 2) }, g.course, dt, g.events);
  g.events.length = 0;
  if (g.runner.dead || g.runner.caught) g.done = true;
}
