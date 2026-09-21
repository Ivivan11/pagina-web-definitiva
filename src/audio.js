// Sfx: efectos de sonido 100% procedurales con Web Audio API.
// Cero assets externos: todo se sintetiza con osciladores, un buffer de ruido
// reutilizado, envolventes de ganancia y filtros.
// OJO: el módulo NO se llama Audio (chocaría con window.Audio).
// Por defecto el juego arranca SILENCIADO: se juega en clase.

const Sfx = (() => {
  const STORAGE_KEY = "camuflaje.v1.muted";
  const MASTER_VOL = 0.5;   // ganancia global de efectos
  const MUSIC_VOL = 0.03;   // ambiente: casi inaudible a propósito
  const MAX_VOICES = 32;    // tope de voces vivas (equipos lentos)

  let ctx = null;
  let master = null;        // efectos
  let musicBus = null;      // ambiente
  let noiseBuf = null;      // buffer de ruido, generado UNA sola vez
  let voices = 0;
  let broken = false;       // audio no disponible: todo queda en no-op
  let music = null;         // nodos del bucle ambiental
  let musicWanted = false;  // se pidió música (aunque esté silenciado)
  let muted = loadMuted();

  // --- preferencia persistente -------------------------------------------

  function loadMuted() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "0" || v === "false") return false;
      if (v === "1" || v === "true") return true;
    } catch (e) { /* localStorage bloqueado */ }
    return true; // sin nada guardado -> silenciado
  }

  function saveMuted(val) {
    try { localStorage.setItem(STORAGE_KEY, val ? "1" : "0"); } catch (e) {}
  }

  // --- contexto ------------------------------------------------------------

  // Crea el AudioContext perezosamente. Seguro llamarlo muchas veces.
  function init() {
    if (ctx || broken) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { broken = true; return null; }
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER_VOL;
      master.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0;
      musicBus.connect(ctx.destination);
    } catch (e) {
      broken = true;
      ctx = null;
      master = null;
      musicBus = null;
    }
    return ctx;
  }

  // Llamar en el primer input real del usuario (política de autoplay).
  function unlock() {
    try {
      if (broken || muted) return;
      if (!init()) return;
      if (ctx.state !== "running" && ctx.resume) {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
      if (musicWanted && !music) startMusic();
    } catch (e) {}
  }

  // ¿Podemos sonar ahora mismo? Si no, no creamos ni un nodo.
  function ready() {
    if (broken || muted) return false;
    if (!ctx && !init()) return false;
    if (ctx.state !== "running") {
      // intentamos despertar, pero este disparo se descarta (evita fugas)
      try {
        if (ctx.resume) {
          const p = ctx.resume();
          if (p && p.catch) p.catch(() => {});
        }
      } catch (e) {}
      return false;
    }
    return !!master;
  }

  // Ruido blanco de 1 s, en bucle: se genera una vez y se reutiliza siempre.
  function getNoise() {
    if (noiseBuf) return noiseBuf;
    const n = Math.floor(ctx.sampleRate * 1);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf = buf;
    return buf;
  }

  // --- ladrillos de síntesis ----------------------------------------------

  // Limpieza: al terminar el nodo se desconecta todo y se libera la voz.
  function reap(src, nodes) {
    voices++;
    src.onended = () => {
      voices--;
      src.onended = null;
      for (let i = 0; i < nodes.length; i++) {
        try { nodes[i].disconnect(); } catch (e) {}
      }
    };
  }

  // Oscilador con envolvente y sweep opcional de frecuencia.
  function tone(o) {
    if (voices >= MAX_VOICES) return;
    const t = ctx.currentTime + (o.delay || 0);
    const dur = o.dur;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const chain = [osc, g];

    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(Math.max(1, o.f0), t);
    if (o.f1) {
      const end = t + (o.sweep || dur);
      if (o.linear) osc.frequency.linearRampToValueAtTime(Math.max(1, o.f1), end);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), end);
    }
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);

    const atk = o.atk == null ? 0.004 : o.atk;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, o.vol), t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    let out = g;
    if (o.lp) { // paso bajo opcional para redondear
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(o.lp, t);
      g.connect(f);
      chain.push(f);
      out = f;
    }
    osc.connect(g);
    out.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    reap(osc, chain);
  }

  // Golpe de ruido filtrado (impactos, grietas, crujidos).
  function noiseHit(o) {
    if (voices >= MAX_VOICES) return;
    const t = ctx.currentTime + (o.delay || 0);
    const dur = o.dur;
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    src.loop = true; // nunca se queda corto
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();

    f.type = o.type || "bandpass";
    f.frequency.setValueAtTime(Math.max(20, o.f0), t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + dur);
    f.Q.value = o.q == null ? 1 : o.q;

    const atk = o.atk == null ? 0.003 : o.atk;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, o.vol), t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t, Math.random() * 0.9); // offset aleatorio: no suena clonado
    src.stop(t + dur + 0.02);
    reap(src, [src, f, g]);
  }

  // --- catálogo de efectos (v = volumen relativo, p = multiplicador de tono)

  const EFFECTS = {
    // salto corto y saltarín
    jump(v, p) {
      tone({ type: "triangle", f0: 300 * p, f1: 640 * p, sweep: 0.09, dur: 0.13, vol: 0.22 * v });
      tone({ type: "square", f0: 600 * p, f1: 1280 * p, sweep: 0.08, dur: 0.09, vol: 0.05 * v });
    },
    // aterrizaje seco y grave
    land(v, p) {
      tone({ type: "sine", f0: 165 * p, f1: 72 * p, dur: 0.11, vol: 0.17 * v });
      noiseHit({ type: "lowpass", f0: 900 * p, f1: 260 * p, dur: 0.07, vol: 0.06 * v });
    },
    // muerte: crujido descendente, más cómico que gore
    death(v, p) {
      tone({ type: "square", f0: 430 * p, f1: 62 * p, sweep: 0.3, dur: 0.34, vol: 0.18 * v });
      tone({ type: "sawtooth", f0: 215 * p, f1: 48 * p, sweep: 0.3, dur: 0.3, vol: 0.07 * v });
      noiseHit({ f0: 1700 * p, f1: 300 * p, q: 1.2, dur: 0.26, vol: 0.11 * v });
      // "boing" final de dibujo animado
      tone({ type: "triangle", f0: 150 * p, f1: 330 * p, sweep: 0.1, dur: 0.16, vol: 0.1 * v, delay: 0.22 });
    },
    // suelo agrietándose
    crumble(v, p) {
      noiseHit({ f0: 950 * p, f1: 360 * p, q: 3, dur: 0.22, vol: 0.15 * v });
      noiseHit({ type: "highpass", f0: 2200 * p, dur: 0.05, vol: 0.07 * v, delay: 0.06 });
      noiseHit({ type: "highpass", f0: 1600 * p, dur: 0.05, vol: 0.05 * v, delay: 0.14 });
    },
    // muelle: sweep largo y elástico
    spring(v, p) {
      tone({ type: "sine", f0: 170 * p, f1: 980 * p, sweep: 0.26, dur: 0.32, vol: 0.2 * v, atk: 0.01 });
      tone({ type: "triangle", f0: 255 * p, f1: 1470 * p, sweep: 0.26, dur: 0.3, vol: 0.06 * v, atk: 0.01 });
      // rebote corto al final, para el punto elástico
      tone({ type: "sine", f0: 880 * p, f1: 620 * p, dur: 0.12, vol: 0.08 * v, delay: 0.26 });
    },
    // bloque pesado que cae de golpe
    slam(v, p) {
      tone({ type: "sine", f0: 130 * p, f1: 36 * p, sweep: 0.22, dur: 0.3, vol: 0.3 * v, atk: 0.002 });
      noiseHit({ type: "lowpass", f0: 700 * p, f1: 150 * p, dur: 0.22, vol: 0.17 * v });
      noiseHit({ type: "highpass", f0: 3000 * p, dur: 0.03, vol: 0.09 * v });
    },
    // "¡te pillé!": la trampa se revela
    trapReveal(v, p) {
      tone({ type: "sawtooth", f0: 560 * p, dur: 0.18, vol: 0.09 * v, lp: 2200, atk: 0.002 });
      tone({ type: "sawtooth", f0: 793 * p, dur: 0.18, vol: 0.08 * v, lp: 2200, atk: 0.002 }); // tritono: tensión
      noiseHit({ type: "highpass", f0: 2600 * p, dur: 0.06, vol: 0.08 * v });
      tone({ type: "square", f0: 300 * p, f1: 420 * p, dur: 0.12, vol: 0.06 * v, delay: 0.1 });
    },
    // nivel completado: arpegio alegre de 4 notas
    win(v, p) {
      const notas = [523.25, 659.25, 783.99, 1046.5];
      for (let i = 0; i < notas.length; i++) {
        tone({
          type: "triangle", f0: notas[i] * p, dur: 0.2, vol: 0.15 * v,
          delay: i * 0.085, atk: 0.008, lp: 4000
        });
      }
    },
    // clic de interfaz, muy discreto
    click(v, p) {
      tone({ type: "sine", f0: 880 * p, f1: 660 * p, dur: 0.035, vol: 0.07 * v, atk: 0.001 });
    },
    // fantasma de un compañero: etéreo y suave
    ghost(v, p) {
      tone({ type: "sine", f0: 620 * p, f1: 880 * p, sweep: 0.5, dur: 0.75, vol: 0.09 * v, atk: 0.14, lp: 1800 });
      tone({ type: "sine", f0: 933 * p, f1: 1320 * p, sweep: 0.5, dur: 0.7, vol: 0.04 * v, atk: 0.18, lp: 2400, detune: 8 });
    }
  };

  function play(name, opts) {
    try {
      if (!ready()) return;
      const fn = EFFECTS[name];
      if (!fn) return;
      const o = opts || {};
      const v = typeof o.volume === "number" ? Math.max(0, Math.min(2, o.volume)) : 1;
      const p = typeof o.pitch === "number" && o.pitch > 0 ? Math.max(0.25, Math.min(4, o.pitch)) : 1;
      if (v <= 0) return;
      fn(v, p);
    } catch (e) { /* el audio jamás debe romper el juego */ }
  }

  // --- ambiente ------------------------------------------------------------

  // Pad de dos osciladores (quinta grave) con dos LFO lentos. Coste mínimo:
  // 4 nodos vivos en total, y volumen ridículamente bajo (se juega a escondidas).
  function startMusic() {
    musicWanted = true;
    try {
      if (broken || muted || music) return;
      if (!init()) return;
      if (ctx.state !== "running") return; // esperamos a unlock()

      const t = ctx.currentTime;
      const a = ctx.createOscillator();
      const b = ctx.createOscillator();
      const lfoAmp = ctx.createOscillator();  // respiración del pad
      const lfoCut = ctx.createOscillator();  // apertura del filtro
      const ampDepth = ctx.createGain();
      const cutDepth = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      a.type = "sine";
      a.frequency.value = 110;      // La2
      b.type = "triangle";
      b.frequency.value = 164.81;   // Mi3
      b.detune.value = -6;          // ligerísimo batido

      filter.type = "lowpass";
      filter.frequency.value = 480;
      filter.Q.value = 0.6;

      lfoAmp.frequency.value = 0.06;
      ampDepth.gain.value = MUSIC_VOL * 0.45;
      lfoAmp.connect(ampDepth);
      ampDepth.connect(musicBus.gain);

      lfoCut.frequency.value = 0.043;
      cutDepth.gain.value = 180;
      lfoCut.connect(cutDepth);
      cutDepth.connect(filter.frequency);

      a.connect(filter);
      b.connect(filter);
      filter.connect(musicBus);

      musicBus.gain.cancelScheduledValues(t);
      musicBus.gain.setValueAtTime(0.0001, t);
      musicBus.gain.linearRampToValueAtTime(MUSIC_VOL * 0.55, t + 3); // entra despacio

      a.start(t); b.start(t); lfoAmp.start(t); lfoCut.start(t);
      music = {
        nodes: [a, b, lfoAmp, lfoCut, ampDepth, cutDepth, filter],
        oscs: [a, b, lfoAmp, lfoCut],
        amp: ampDepth
      };
    } catch (e) { music = null; }
  }

  function stopMusic() {
    musicWanted = false;
    try {
      if (!music) return;
      const m = music;
      music = null;
      const t = ctx.currentTime;
      musicBus.gain.cancelScheduledValues(t);
      musicBus.gain.setValueAtTime(Math.max(0.0001, musicBus.gain.value), t);
      musicBus.gain.linearRampToValueAtTime(0, t + 0.6); // fundido limpio
      // el LFO también suma sobre la ganancia: lo cerramos o quedaría un resto
      m.amp.gain.cancelScheduledValues(t);
      m.amp.gain.setValueAtTime(m.amp.gain.value, t);
      m.amp.gain.linearRampToValueAtTime(0, t + 0.6);
      for (let i = 0; i < m.oscs.length; i++) {
        try { m.oscs[i].stop(t + 0.7); } catch (e) {}
      }
      m.oscs[0].onended = () => {
        for (let i = 0; i < m.nodes.length; i++) {
          try { m.nodes[i].disconnect(); } catch (e) {}
        }
      };
    } catch (e) {}
  }

  // --- silencio ------------------------------------------------------------

  function setMuted(val) {
    muted = !!val;
    saveMuted(muted);
    try {
      if (muted) {
        if (music) { // paramos el pad, pero recordamos que se quería
          stopMusic();
          musicWanted = true;
        }
        if (master && ctx) {
          const t = ctx.currentTime;
          master.gain.cancelScheduledValues(t);
          master.gain.setValueAtTime(master.gain.value, t);
          master.gain.linearRampToValueAtTime(0, t + 0.05);
        }
      } else {
        if (!init()) return muted;
        unlock();
        const t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(MASTER_VOL, t + 0.05);
        if (musicWanted && !music) startMusic();
      }
    } catch (e) {}
    return muted;
  }

  function isMuted() { return muted; }

  function toggleMuted() { return setMuted(!muted); }

  return {
    init: init,
    unlock: unlock,
    setMuted: setMuted,
    isMuted: isMuted,
    toggleMuted: toggleMuted,
    play: play,
    startMusic: startMusic,
    stopMusic: stopMusic
  };
})();
