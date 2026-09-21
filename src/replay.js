// Graba los inputs de cada paso fijo de físicas y los comprime con RLE para
// poder compartirlos como un código corto de texto (carrera fantasma sin
// necesitar ningún servidor: el "backend" es copiar y pegar un código).

function createRecorder() {
  return { frames: [] };
}

function recordFrame(recorder, input) {
  let byte = 0;
  if (input.left) byte |= 1;
  if (input.right) byte |= 2;
  if (input.jump) byte |= 4;
  recorder.frames.push(byte);
}

function encodeReplay(levelIndex, frames) {
  const runs = [];
  let i = 0;
  while (i < frames.length) {
    let j = i;
    while (j < frames.length && frames[j] === frames[i] && j - i < 65535) j++;
    runs.push([frames[i], j - i]);
    i = j;
  }

  const buf = new Uint8Array(5 + runs.length * 3);
  const view = new DataView(buf.buffer);
  buf[0] = levelIndex;
  view.setUint32(1, frames.length, true);
  let offset = 5;
  for (const [byte, count] of runs) {
    buf[offset] = byte;
    view.setUint16(offset + 1, count, true);
    offset += 3;
  }

  let binary = "";
  for (let k = 0; k < buf.length; k++) binary += String.fromCharCode(buf[k]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeReplay(code) {
  try {
    let b64 = String(code).trim().replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const binary = atob(b64);
    const buf = new Uint8Array(binary.length);
    for (let k = 0; k < binary.length; k++) buf[k] = binary.charCodeAt(k);
    const view = new DataView(buf.buffer);

    const levelIndex = buf[0];
    const frameCount = view.getUint32(1, true);
    const frames = new Array(frameCount);
    let offset = 5;
    let idx = 0;
    while (offset < buf.length && idx < frameCount) {
      const byte = buf[offset];
      const count = view.getUint16(offset + 1, true);
      for (let c = 0; c < count && idx < frameCount; c++) frames[idx++] = byte;
      offset += 3;
    }
    if (idx < frameCount) return null;
    return { levelIndex, frames };
  } catch (e) {
    return null;
  }
}

function createGhost(levelIndex, frames) {
  const level = buildLevel(levelIndex);
  const player = createPlayer(level.spawn);
  return { level, player, frames, frameIndex: 0, done: false };
}

function stepGhost(ghost, dt) {
  if (ghost.done || ghost.frameIndex >= ghost.frames.length) {
    ghost.done = true;
    return;
  }
  const byte = ghost.frames[ghost.frameIndex++];
  const input = { left: !!(byte & 1), right: !!(byte & 2), jump: !!(byte & 4) };
  const event = stepPlayer(ghost.player, input, ghost.level, dt);
  if (event === "dead" || event === "goal") ghost.done = true;
}
