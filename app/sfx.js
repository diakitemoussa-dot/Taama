/* ==========================================================
   SFX — moteur sonore central de Taama (effets, ambiances, musique)
   ----------------------------------------------------------
   Tout est synthétisé en WebAudio : aucun fichier audio. Identité : cordes pincées
   de type kora/ngoni (Karplus-Strong pré-calculé), carillons, vent sahélien, oiseaux,
   grillons ; côté NÉANTIS : bourdons froids et bips électroniques.

   Un seul AudioContext, créé au premier geste utilisateur (politique autoplay).
   Trois bus (effects / ambience / music) enregistrés dans GameAudio.ctx : les curseurs
   d'Options, « tout couper » et la coupure en arrière-plan s'appliquent donc à tout.

   API (window.Sfx) :
     play(nom, opts)       un son nommé (opts : volume, pan, rate, + options propres au son)
     ambience(nom | null)  'djenne' | 'base' | null  (un seul graphe réutilisé, fondu enchaîné)
     music(nom | null)     'menu' | 'explore' | 'base' | 'victoire' | null  (motifs courts et rares)
     setDuck(on, raison)   baisse musique + ambiance (dialogue Tapama, pause…)
     names()  info(nom)    liste / description des sons (page dev/sons.html)
     ready  ownsSteps()  setZone('mosquee' | null)  stats()

   Branchement découplé : écoute les événements window du jeu (voir EVENTS) et observe
   l'état (carte, voiture, écrans, pas du joueur) par un petit minuteur de 50 ms.
   Les modules appellent aussi window.Sfx?.play('…') quand aucun événement n'existe.
   ========================================================== */

/* ==========================================================
   RÉGLAGES — tout le mixage se règle ici
   ========================================================== */
export const LEVELS = { effects: 0.9, ambience: 0.6, music: 0.5 };   // gain interne par bus (avant les curseurs d'Options)
export const MAX_VOICES = 24;                                         // sons simultanés au plus
export const DUCK = { music: 0.22, ambience: 0.45, fade: 0.35 };      // facteur pendant un dialogue + durée du fondu (s)
export const BEAT = 0.42;                                             // durée d'un temps des motifs de kora (s)
export const AMB_LEVEL = { vent: 0.09, marche: 0.035, oiseaux: 0.05, grillons: 0.02, lointain: 0.05, base: 0.14, ventilation: 0.03 };
export const MUSIC_GAPS = { menu: [16, 30], explore: [30, 60], base: [16, 30], victoire: [0, 0] };   // pause entre deux motifs (s)
export const STEP_STRIDE = { marche: 0.82, course: 1.25 };            // distance entre deux pas (m)

/* ==========================================================
   LOGIQUE PURE (testée sous Node : tests/sfx.test.mjs)
   ========================================================== */

/** Numéro MIDI -> fréquence (Hz). */
export function noteToFreq(midi, a4 = 440) { return a4 * Math.pow(2, (midi - 69) / 12); }

const NOTE_IDX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'A4' / 'C#3' / 'Bb2' -> numéro MIDI (null si invalide). */
export function noteToMidi(name) {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(name));
  if (!m) return null;
  return NOTE_IDX[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
}

/** Gammes (demi-tons depuis la tonique). */
export const SCALES = {
  pentaMaj: [0, 2, 4, 7, 9],        // chaleureuse (victoire, ouverture)
  pentaMin: [0, 3, 5, 7, 10],       // kora du soir (exploration)
  sahel: [0, 2, 5, 7, 9],           // pentatonique « suspendue » (menus)
  neantis: [0, 1, 5, 7, 8],         // froide, tendue (base NÉANTIS)
};

/** Degré de gamme (peut dépasser l'octave ou être négatif) -> numéro MIDI. */
export function scaleNote(root, scale, degree) {
  const sc = Array.isArray(scale) ? scale : (SCALES[scale] || SCALES.pentaMaj);
  const n = sc.length, oct = Math.floor(degree / n), idx = ((degree % n) + n) % n;
  return root + oct * 12 + sc[idx];
}

/** Valeur ± amount (relatif), pour éviter la répétition mécanique. */
export function jitter(value, amount, rng = Math.random) { return value * (1 + (rng() * 2 - 1) * amount); }

/** Choisit un élément sans jamais répéter le précédent (renvoie { value, index }). */
export function pickVariation(list, lastIndex = -1, rng = Math.random) {
  if (!list || !list.length) return { value: undefined, index: -1 };
  if (list.length === 1) return { value: list[0], index: 0 };
  let i = Math.floor(rng() * list.length);
  if (i === lastIndex) i = (i + 1 + Math.floor(rng() * (list.length - 1))) % list.length;
  return { value: list[i], index: i };
}

/** Limiteur de polyphonie : au plus `max` voix ; une voix plus prioritaire peut en évincer une plus faible. */
export class VoiceLimiter {
  constructor(max = MAX_VOICES) { this.max = max; this.voices = []; this.dropped = 0; }
  purge(now) { this.voices = this.voices.filter((v) => v.end > now); }
  active(now) { this.purge(now); return this.voices.length; }
  /** Renvoie true si le son peut jouer. */
  acquire(now, dur, prio = 1) {
    this.purge(now);
    if (this.voices.length >= this.max) {
      let k = -1;
      for (let i = 0; i < this.voices.length; i++) if (this.voices[i].prio < prio && (k < 0 || this.voices[i].prio < this.voices[k].prio)) k = i;
      if (k < 0) { this.dropped++; return false; }
      this.voices.splice(k, 1);
    }
    this.voices.push({ end: now + dur, prio });
    return true;
  }
}

/** Délai minimal entre deux déclenchements d'un même son. */
export class Cooldowns {
  constructor() { this.last = {}; }
  can(name, now, gap) { if (!gap) return true; const l = this.last[name]; return l === undefined || now - l >= gap; }
  mark(name, now) { this.last[name] = now; }
}

/** Convertit une distance parcourue en nombre de pas (foulée fixe, reste conservé). */
export class Stepper {
  constructor() { this.acc = 0; }
  feed(dist, stride) { this.acc += dist; let n = 0; while (this.acc >= stride) { this.acc -= stride; n++; } return n; }
  reset() { this.acc = 0; }
}

/** Nuit (0..1) selon l'heure in-game 0-24 : jour franc 7h-18h, nuit franche 20h-5h, transitions douces. */
export function nightFactor(hour) {
  if (!Number.isFinite(hour)) return 0;
  const h = ((hour % 24) + 24) % 24;
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  if (h >= 12) return ss(18, 20, h);
  return 1 - ss(5, 7, h);
}

/** Sol sous les pieds. */
export function surfaceFor({ zone = null, nearBase = false, high = false } = {}) {
  if (nearBase) return 'metal';
  if (zone === 'mosquee') return 'mosquee';
  if (high) return 'toit';
  return 'terre';
}

/** Niveau de chaque couche d'ambiance (0..1 × AMB_LEVEL) selon la scène et l'heure. */
export function ambienceTargets(name, hour) {
  const night = nightFactor(hour), day = 1 - night;
  const z = { vent: 0, marche: 0, oiseaux: 0, grillons: 0, lointain: 0, base: 0, ventilation: 0 };
  if (name === 'djenne') {
    z.vent = AMB_LEVEL.vent * (0.7 + 0.3 * day);
    z.marche = AMB_LEVEL.marche * day;
    z.oiseaux = AMB_LEVEL.oiseaux * day;
    z.grillons = AMB_LEVEL.grillons * night;
    z.lointain = AMB_LEVEL.lointain;
  } else if (name === 'base') {
    z.base = AMB_LEVEL.base;
    z.ventilation = AMB_LEVEL.ventilation;
  }
  return z;
}

/** Plan d'enveloppe ADSR sans clic : { events:[[type,valeur,temps,constante]], end }. */
export function adsrPlan(t, { a = 0.005, d = 0.1, s = 0, dur = 0.2, r = 0.1, peak = 1 } = {}) {
  const dd = Math.max(a + 0.002, dur);
  return {
    events: [
      ['set', 0, t, 0],
      ['ramp', peak, t + a, 0],
      ['target', peak * s, t + a, Math.max(0.005, d / 3)],
      ['target', 0, t + dd, Math.max(0.005, r / 4)],
    ],
    end: t + dd + r * 1.3,
  };
}

/** Corde pincée (Karplus-Strong) : tampon mono normalisé à 1, de longueur seconds × sr. */
export function karplusStrong(freq, sr, seconds, { decay = 0.996, bright = 0.55, rng = Math.random } = {}) {
  const n = Math.max(2, Math.round(sr / freq));
  const len = Math.max(n * 2, Math.round(sr * seconds));
  const ring = new Float32Array(n), out = new Float32Array(len);
  let prev = 0, mean = 0;
  for (let i = 0; i < n; i++) { prev += bright * ((rng() * 2 - 1) - prev); ring[i] = prev; mean += prev; }
  mean /= n;
  for (let i = 0; i < n; i++) ring[i] -= mean;                 // pas de composante continue
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const j = idx + 1 === n ? 0 : idx + 1;
    out[i] = ring[idx];
    ring[idx] = (ring[idx] + ring[j]) * 0.5 * decay;
    idx = j;
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = peak > 0 ? 1 / peak : 1, fade = Math.min(len, 400);
  for (let i = 0; i < len; i++) out[i] *= g * (i > len - 1 - fade ? (len - 1 - i) / fade : 1);
  return out;
}
/** Fréquence réellement produite par karplusStrong (période entière + 1/2 échantillon de filtre). */
export function ksBaseFreq(freq, sr) { return sr / (Math.max(2, Math.round(sr / freq)) + 0.5); }

/* ==========================================================
   MOTIFS DE MUSIQUE : [degré de gamme, temps de départ, durée en temps]
   ========================================================== */
export const THEMES = {
  menu: { root: 57, scale: 'sahel', pad: true, vol: 0.9, phrases: [
    [[0, 0, 1], [2, 0.7, 1], [4, 1.4, 1], [3, 2.2, 2]],
    [[4, 0, 1], [2, 0.8, 1], [3, 1.6, 1], [0, 2.4, 2.5]],
    [[0, 0, 1], [4, 0.6, 1], [7, 1.2, 1], [5, 2.0, 1], [4, 2.8, 2]],
  ] },
  explore: { root: 55, scale: 'pentaMin', pad: false, vol: 0.8, phrases: [
    [[0, 0, 1], [2, 1, 1], [3, 2, 1], [2, 3, 2]],
    [[4, 0, 1], [3, 0.9, 1], [2, 1.8, 1], [0, 2.8, 2.5]],
    [[2, 0, 1], [4, 0.7, 1], [5, 1.4, 1], [4, 2.1, 1], [2, 3.0, 2]],
    [[0, 0, 1], [0, 0.5, 1], [3, 1.3, 1], [2, 2.1, 2]],
  ] },
  base: { root: 45, scale: 'neantis', pad: true, vol: 0.85, phrases: [
    [[0, 0, 1], [1, 1.3, 1], [0, 2.6, 2]],
    [[2, 0, 1], [1, 1, 1], [0, 2, 1], [-1, 3, 2]],
    [[0, 0, 1], [3, 1.5, 1], [2, 2.5, 1], [1, 3.5, 2]],
  ] },
  victoire: { root: 60, scale: 'pentaMaj', pad: true, vol: 1, phrases: [
    [[0, 0, 1], [2, 0.6, 1], [4, 1.2, 1], [5, 1.8, 1], [7, 2.6, 3]],
  ] },
};

/* ==========================================================
   MOTEUR (navigateur)
   ========================================================== */
const W = typeof window !== 'undefined' ? window : null;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function applyPlan(param, plan) {
  for (const [type, v, t, tc] of plan.events) {
    if (type === 'set') param.setValueAtTime(v, t);
    else if (type === 'ramp') param.linearRampToValueAtTime(v, t);
    else param.setTargetAtTime(v, t, tc);
  }
  return plan.end;
}

/** Courbe de saturation douce (tanh) pour le limiteur de sortie. */
export function makeSoftCurve(n = 2048) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x); }
  return c;
}

/** Construit les bus, le bruit partagé et les générateurs (tone/noise/pluck/chime) sur un contexte (réel ou hors-ligne). */
export function makeEngine(ctx, { gameAudio = null } = {}) {
  const E = { ctx, bus: {}, trim: {}, ksCache: new Map(), limiter: new VoiceLimiter(), cool: new Cooldowns(), voiceCount: 0 };
  // un seul contexte, un gain de catégorie GameAudio par bus (via un faux contexte dont `destination` est remplacé)
  for (const cat of ['effects', 'ambience', 'music']) {
    const proxy = { createGain: () => ctx.createGain(), destination: ctx.destination };
    if (gameAudio && gameAudio.ctx) gameAudio.ctx(proxy, cat);
    const lim = ctx.createWaveShaper();                  // limiteur doux (tanh) : jamais au-delà de 0 dBFS, sans gain de rattrapage
    lim.curve = E.softCurve || (E.softCurve = makeSoftCurve());
    lim.connect(proxy.destination);
    const bus = ctx.createGain(); bus.gain.value = LEVELS[cat];
    bus.connect(lim);
    E.bus[cat] = bus; E.trim[cat] = 1;
  }
  const sr = ctx.sampleRate, nb = ctx.createBuffer(1, sr * 2, sr), nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  E.noiseBuf = nb;

  const outNode = (node, dest, pan) => {
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); node.connect(p); p.connect(dest); } else node.connect(dest);
  };

  E.tone = ({ type = 'sine', f, f2, t, dur = 0.2, a = 0.005, d = 0.1, s = 0, r = 0.08, vol = 0.1, dest, det = 0, pan = 0 }) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    g.gain.value = 0;                                     // silence avant le début (sinon 1 échantillon à gain 1 = clic)
    o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = det;
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const end = applyPlan(g.gain, adsrPlan(t, { a, d, s, dur, r, peak: vol }));
    o.connect(g); outNode(g, dest, pan); o.start(t); o.stop(end + 0.02);
  };
  E.noise = ({ type = 'bandpass', f = 1000, f2, q = 1, t, dur = 0.1, a = 0.004, d = 0.05, s = 0, r = 0.04, vol = 0.1, dest, pan = 0 }) => {
    const src = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    g.gain.value = 0;
    src.buffer = E.noiseBuf; src.loop = true; fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const end = applyPlan(g.gain, adsrPlan(t, { a, d, s, dur, r, peak: vol }));
    src.connect(fl); fl.connect(g); outNode(g, dest, pan); src.start(t, Math.random() * 1.5); src.stop(end + 0.02);
  };
  /** Corde pincée : tampon Karplus-Strong mis en cache (par demi-ton et style), hauteur fine par playbackRate. */
  E.ks = (m, style) => {
    const key = m + style;
    let ent = E.ksCache.get(key);
    if (!ent) {
      const fr = noteToFreq(m), kora = style === 'kora';
      const data = karplusStrong(fr, sr, kora ? 1.8 : 0.9, { decay: kora ? 0.9975 : 0.988, bright: kora ? 0.6 : 0.4 });
      const buf = ctx.createBuffer(1, data.length, sr); buf.getChannelData(0).set(data);
      ent = { buf, base: ksBaseFreq(fr, sr) };
      if (E.ksCache.size >= 48) E.ksCache.delete(E.ksCache.keys().next().value);
      E.ksCache.set(key, ent);
    }
    return ent;
  };
  E.pluck = ({ midi, f, t, vol = 0.12, dest, style = 'kora', pan = 0, rate = 1 }) => {
    const fr = f || noteToFreq(midi), target = fr * rate, ent = E.ks(Math.round(69 + 12 * Math.log2(fr / 440)), style);
    const src = ctx.createBufferSource(), g = ctx.createGain();
    g.gain.value = 0;
    src.buffer = ent.buf; src.playbackRate.value = target / ent.base;
    const dur = ent.buf.duration / src.playbackRate.value;
    g.gain.setValueAtTime(vol, t); g.gain.setTargetAtTime(0, t + dur - 0.12, 0.03);
    src.connect(g); outNode(g, dest, pan); src.start(t); src.stop(t + dur);
  };
  /** Carillon cristallin (partiels inharmoniques). */
  E.chime = ({ f, t, vol = 0.08, dest, dur = 1.2, pan = 0 }) => {
    [[1, 1, 1], [2.76, 0.42, 0.55], [5.4, 0.18, 0.3], [8.93, 0.07, 0.18]].forEach(([k, a, dk]) => {
      if (f * k < 12000) E.tone({ f: f * k, t, dur: dur * dk, a: 0.003, d: dur * dk * 0.9, s: 0, r: 0.15, vol: vol * a, dest, pan });
    });
  };
  /** Pré-calcule quelques notes de kora pendant les temps morts (pas de calcul pendant un événement de jeu). */
  E.warm = (midis) => {
    const list = midis.slice();
    const step = () => {
      const m = list.shift(); if (m === undefined) return;
      try { E.ks(m, 'kora'); E.ks(m, 'ngoni'); } catch (_) { /* contexte fermé */ }
      (W && W.requestIdleCallback ? W.requestIdleCallback : (fn) => setTimeout(fn, 60))(step);
    };
    step();
  };
  return E;
}

/* ==========================================================
   CATALOGUE DES SONS
   Chaque son : cat (bus), prio (0 faible … 2 vital), gap (délai mini entre deux, s),
   dur (durée estimée pour le limiteur, s), desc (page d'aperçu), play(c).
   c = { E, t, dest, v (volume), o (options), rng, j(x, rel) }
   ========================================================== */
const P = (midi) => noteToFreq(midi);
const pick = (c, arr) => arr[Math.floor(c.rng() * arr.length)];

export const SOUNDS = {
  /* ---------- Interface ---------- */
  'ui-survol': { cat: 'effects', prio: 0, gap: 0.06, dur: 0.1, group: 'Interface', desc: 'Petit tic de bois très doux au survol',
    play(c) { const f = c.j(1500, 0.08); c.E.tone({ f, t: c.t, dur: 0.05, a: 0.002, d: 0.03, r: 0.02, vol: 0.05 * c.v, dest: c.dest }); c.E.tone({ f: f * 1.5, t: c.t, dur: 0.03, a: 0.002, d: 0.02, r: 0.02, vol: 0.02 * c.v, dest: c.dest }); } },
  'ui-clic': { cat: 'effects', prio: 1, gap: 0.04, dur: 0.5, group: 'Interface', desc: 'Corde pincée courte (ngoni) + petit tac',
    play(c) { c.E.pluck({ midi: pick(c, [64, 67, 69]), t: c.t, vol: 0.2 * c.v, dest: c.dest, style: 'ngoni', rate: c.j(1, 0.01) }); c.E.noise({ f: 2600, q: 1.5, t: c.t, dur: 0.02, vol: 0.05 * c.v, dest: c.dest }); } },
  'ui-valider': { cat: 'effects', prio: 1, gap: 0.1, dur: 0.9, group: 'Interface', desc: 'Deux notes de kora montantes',
    play(c) { c.E.pluck({ midi: 64, t: c.t, vol: 0.2 * c.v, dest: c.dest }); c.E.pluck({ midi: 71, t: c.t + 0.09, vol: 0.22 * c.v, dest: c.dest }); } },
  'ui-retour': { cat: 'effects', prio: 1, gap: 0.1, dur: 0.7, group: 'Interface', desc: 'Deux notes descendantes, douces',
    play(c) { c.E.pluck({ midi: 69, t: c.t, vol: 0.17 * c.v, dest: c.dest, style: 'ngoni' }); c.E.pluck({ midi: 62, t: c.t + 0.08, vol: 0.17 * c.v, dest: c.dest, style: 'ngoni' }); } },
  'ui-ecran': { cat: 'effects', prio: 1, gap: 0.15, dur: 0.8, group: 'Interface', desc: 'Ouverture d\'écran : souffle léger + note',
    play(c) { c.E.noise({ f: 500, f2: 2200, q: 0.8, t: c.t, dur: 0.28, a: 0.08, d: 0.15, r: 0.1, vol: 0.05 * c.v, dest: c.dest }); c.E.pluck({ midi: 76, t: c.t + 0.1, vol: 0.12 * c.v, dest: c.dest }); } },
  'ui-ecran-ferme': { cat: 'effects', prio: 1, gap: 0.15, dur: 0.7, group: 'Interface', desc: 'Fermeture d\'écran : souffle descendant',
    play(c) { c.E.noise({ f: 2000, f2: 400, q: 0.8, t: c.t, dur: 0.25, a: 0.04, d: 0.15, r: 0.1, vol: 0.045 * c.v, dest: c.dest }); c.E.pluck({ midi: 64, t: c.t, vol: 0.1 * c.v, dest: c.dest, style: 'ngoni' }); } },
  'ui-curseur': { cat: 'effects', prio: 0, gap: 0.05, dur: 0.1, group: 'Interface', desc: 'Tic de curseur ; hauteur selon la valeur (option value 0..1)',
    play(c) { const v = clamp(c.o.value ?? 0.5, 0, 1); c.E.tone({ f: P(scaleNote(60, 'pentaMaj', Math.round(v * 9))), t: c.t, dur: 0.07, a: 0.003, d: 0.05, r: 0.03, vol: 0.07 * c.v, dest: c.dest }); } },
  'ui-erreur': { cat: 'effects', prio: 1, gap: 0.2, dur: 0.5, group: 'Interface', desc: 'Deux « toc » graves, sans agressivité',
    play(c) { c.E.tone({ type: 'triangle', f: 190, f2: 150, t: c.t, dur: 0.12, a: 0.004, d: 0.1, r: 0.05, vol: 0.14 * c.v, dest: c.dest }); c.E.tone({ type: 'triangle', f: 180, f2: 140, t: c.t + 0.14, dur: 0.14, a: 0.004, d: 0.12, r: 0.05, vol: 0.14 * c.v, dest: c.dest }); } },
  'notif': { cat: 'effects', prio: 1, gap: 0.3, dur: 1.4, group: 'Interface', desc: 'Notification : deux carillons (quinte)',
    play(c) { c.E.chime({ f: P(81), t: c.t, vol: 0.07 * c.v, dest: c.dest, dur: 1 }); c.E.chime({ f: P(88), t: c.t + 0.16, vol: 0.06 * c.v, dest: c.dest, dur: 1.1 }); } },
  'toast': { cat: 'effects', prio: 0, gap: 0.4, dur: 0.9, group: 'Interface', desc: 'Message court : un seul carillon',
    play(c) { c.E.chime({ f: P(pick(c, [84, 86, 88])), t: c.t, vol: 0.05 * c.v, dest: c.dest, dur: 0.7 }); } },
  'badge': { cat: 'effects', prio: 2, gap: 0.5, dur: 2, group: 'Interface', desc: 'Badge obtenu : arpège montant + scintillement',
    play(c) { [72, 76, 79, 84].forEach((m, i) => c.E.pluck({ midi: m, t: c.t + i * 0.11, vol: 0.13 * c.v, dest: c.dest })); c.E.chime({ f: P(96), t: c.t + 0.5, vol: 0.06 * c.v, dest: c.dest, dur: 1.4 }); } },
  'indice': { cat: 'effects', prio: 1, gap: 0.3, dur: 1.2, group: 'Interface', desc: 'Indice ajouté au journal : page + note claire',
    play(c) { c.E.noise({ f: 3000, q: 0.7, t: c.t, dur: 0.12, a: 0.02, vol: 0.03 * c.v, dest: c.dest }); c.E.pluck({ midi: 79, t: c.t + 0.05, vol: 0.15 * c.v, dest: c.dest }); c.E.chime({ f: P(91), t: c.t + 0.12, vol: 0.035 * c.v, dest: c.dest, dur: 0.8 }); } },

  /* ---------- Tapama ---------- */
  'voix-tapama': { cat: 'effects', prio: 1, gap: 0.12, dur: 0.6, group: 'Tapama', desc: 'Petite « voix » stylisée de Tapama ; option mood : neutre, curieuse, inquiete, surprise, attentive, souriante',
    play(c) {
      const M = { neutre: [64, 0], curieuse: [66, 3], inquiete: [57, -3], surprise: [72, 5], attentive: [62, 0], souriante: [67, 2] };
      const [base, slope] = M[c.o.mood] || M.neutre, n = 3;
      for (let i = 0; i < n; i++) {
        const m = scaleNote(base, 'pentaMaj', Math.round(c.rng() * 2) + (slope > 0 ? i : slope < 0 ? -i : 0)), t = c.t + i * 0.07, f = P(m);
        c.E.tone({ type: 'triangle', f, f2: f * (slope < 0 ? 0.96 : 1.04), t, dur: 0.07, a: 0.01, d: 0.05, s: 0.3, r: 0.04, vol: 0.07 * c.v, dest: c.dest });
        c.E.tone({ f: f * 2, t, dur: 0.05, a: 0.01, d: 0.03, r: 0.03, vol: 0.012 * c.v, dest: c.dest });
      }
    } },
  'voix-joueur': { cat: 'effects', prio: 1, gap: 0.12, dur: 0.5, group: 'Tapama', desc: 'Réponse du joueur : plus grave et plus sobre',
    play(c) { for (let i = 0; i < 2; i++) { const f = P(scaleNote(52, 'pentaMin', Math.round(c.rng() * 3))); c.E.tone({ type: 'triangle', f, t: c.t + i * 0.08, dur: 0.08, a: 0.01, d: 0.06, s: 0.2, r: 0.04, vol: 0.06 * c.v, dest: c.dest }); } } },
  'radio-ouvre': { cat: 'effects', prio: 1, gap: 0.5, dur: 1.0, group: 'Tapama', desc: 'Appel radio : grésillement bref + bip montant',
    play(c) {
      for (let i = 0; i < 8; i++) c.E.noise({ type: 'highpass', f: 1800 + c.rng() * 1500, q: 0.7, t: c.t + i * 0.035 + c.rng() * 0.02, dur: 0.03, a: 0.002, d: 0.02, r: 0.01, vol: (0.02 + c.rng() * 0.03) * c.v, dest: c.dest });
      c.E.tone({ f: 740, t: c.t + 0.3, dur: 0.07, a: 0.005, d: 0.05, r: 0.03, vol: 0.05 * c.v, dest: c.dest }); c.E.tone({ f: 988, t: c.t + 0.38, dur: 0.09, a: 0.005, d: 0.06, r: 0.04, vol: 0.05 * c.v, dest: c.dest });
    } },
  'radio-ferme': { cat: 'effects', prio: 1, gap: 0.5, dur: 0.8, group: 'Tapama', desc: 'Fin d\'appel : bip descendant + dernier crépitement',
    play(c) {
      c.E.tone({ f: 988, t: c.t, dur: 0.06, a: 0.005, d: 0.04, r: 0.03, vol: 0.045 * c.v, dest: c.dest }); c.E.tone({ f: 660, t: c.t + 0.08, dur: 0.08, a: 0.005, d: 0.06, r: 0.04, vol: 0.045 * c.v, dest: c.dest });
      for (let i = 0; i < 5; i++) c.E.noise({ type: 'highpass', f: 2000 + c.rng() * 1500, t: c.t + 0.2 + i * 0.03, dur: 0.025, a: 0.002, d: 0.015, r: 0.01, vol: (0.015 + c.rng() * 0.02) * c.v, dest: c.dest });
    } },

  /* ---------- Dispositif, portail, carte ---------- */
  'dispositif-illumine': { cat: 'effects', prio: 2, gap: 1, dur: 3, group: 'Dispositif', desc: 'Illumination : hum cristallin qui gonfle',
    play(c) {
      [880, 882.5, 1320].forEach((f, i) => c.E.tone({ f, t: c.t, dur: 2.2, a: 0.7, d: 1.2, s: 0.4, r: 0.8, vol: (i === 2 ? 0.025 : 0.045) * c.v, dest: c.dest }));
      c.E.tone({ f: 220, t: c.t, dur: 2.0, a: 0.6, d: 1, s: 0.3, r: 0.8, vol: 0.05 * c.v, dest: c.dest });
      c.E.chime({ f: P(93), t: c.t + 0.9, vol: 0.04 * c.v, dest: c.dest, dur: 1.6 });
    } },
  'dispositif-prise': { cat: 'effects', prio: 2, gap: 1, dur: 3, group: 'Dispositif', desc: 'Récupération : carillon montant magique',
    play(c) {
      [67, 71, 74, 79, 83, 86].forEach((m, i) => { c.E.chime({ f: P(m + 12), t: c.t + i * 0.1, vol: 0.05 * c.v, dest: c.dest, dur: 1.4 }); if (i % 2 === 0) c.E.pluck({ midi: m, t: c.t + i * 0.1, vol: 0.12 * c.v, dest: c.dest }); });
      c.E.tone({ f: 330, f2: 660, t: c.t, dur: 0.7, a: 0.2, d: 0.4, r: 0.4, vol: 0.04 * c.v, dest: c.dest });
    } },
  'portail-whoosh': { cat: 'effects', prio: 2, gap: 1, dur: 2.2, group: 'Portail', desc: 'Passage de portail : souffle montant + résonance',
    play(c) {
      c.E.noise({ f: 300, f2: 3500, q: 1.2, t: c.t, dur: 0.9, a: 0.4, d: 0.4, s: 0.4, r: 0.3, vol: 0.1 * c.v, dest: c.dest });
      c.E.tone({ f: 110, f2: 330, t: c.t, dur: 0.9, a: 0.4, d: 0.5, s: 0.3, r: 0.3, vol: 0.07 * c.v, dest: c.dest });
      c.E.chime({ f: P(79), t: c.t + 0.85, vol: 0.06 * c.v, dest: c.dest, dur: 1.5 }); c.E.chime({ f: P(86), t: c.t + 0.95, vol: 0.04 * c.v, dest: c.dest, dur: 1.4 });
    } },
  'portail-fondu': { cat: 'effects', prio: 1, gap: 1, dur: 2.2, group: 'Portail', desc: 'Fondu du GIF : nappe douce qui retombe',
    play(c) { [220, 330, 440].forEach((f) => c.E.tone({ f, f2: f * 0.97, t: c.t, dur: 1.4, a: 0.5, d: 0.6, s: 0.3, r: 0.7, vol: 0.035 * c.v, dest: c.dest })); } },
  'carte-ouvre': { cat: 'effects', prio: 1, gap: 0.3, dur: 1, group: 'Carte', desc: 'Carte dépliée : froissement de papier + note',
    play(c) { for (let i = 0; i < 4; i++) c.E.noise({ type: 'bandpass', f: 2500 + c.rng() * 2000, q: 0.6, t: c.t + i * 0.045, dur: 0.05, a: 0.005, d: 0.03, r: 0.02, vol: 0.04 * c.v, dest: c.dest }); c.E.pluck({ midi: 74, t: c.t + 0.18, vol: 0.14 * c.v, dest: c.dest }); } },
  'carte-ferme': { cat: 'effects', prio: 1, gap: 0.3, dur: 0.8, group: 'Carte', desc: 'Carte repliée',
    play(c) { for (let i = 0; i < 3; i++) c.E.noise({ type: 'bandpass', f: 2200 + c.rng() * 1500, q: 0.6, t: c.t + i * 0.05, dur: 0.05, a: 0.005, d: 0.03, r: 0.02, vol: 0.035 * c.v, dest: c.dest }); c.E.pluck({ midi: 67, t: c.t + 0.1, vol: 0.1 * c.v, dest: c.dest, style: 'ngoni' }); } },
  'carte-lieu': { cat: 'effects', prio: 1, gap: 0.15, dur: 0.9, group: 'Carte', desc: 'Lieu sélectionné : note claire + « ping »',
    play(c) { c.E.pluck({ midi: 79, t: c.t, vol: 0.17 * c.v, dest: c.dest }); c.E.chime({ f: P(91), t: c.t + 0.05, vol: 0.03 * c.v, dest: c.dest, dur: 0.6 }); } },
  'carte-trace': { cat: 'effects', prio: 1, gap: 0.6, dur: 1.5, group: 'Carte', desc: 'Itinéraire tracé : petite course de notes',
    play(c) { [0, 1, 2, 3, 4, 5].forEach((d, i) => c.E.pluck({ midi: scaleNote(67, 'pentaMaj', d), t: c.t + i * 0.07, vol: (0.05 + i * 0.008) * c.v, dest: c.dest, style: 'ngoni' })); } },
  'arrivee': { cat: 'effects', prio: 1, gap: 1, dur: 2.4, group: 'Dispositif', desc: 'Arrivée à un lieu : accord de kora arpégé, doux',
    play(c) { [60, 64, 67, 72].forEach((m, i) => c.E.pluck({ midi: m, t: c.t + i * 0.06, vol: 0.1 * c.v, dest: c.dest })); } },
  'alerte-detection': { cat: 'effects', prio: 2, gap: 1.2, dur: 1.2, group: 'NÉANTIS', desc: 'Détection : deux bips d\'alerte, pas criards',
    play(c) { [0, 0.17].forEach((dt) => { c.E.tone({ type: 'square', f: 880, t: c.t + dt, dur: 0.1, a: 0.004, d: 0.06, s: 0.3, r: 0.05, vol: 0.03 * c.v, dest: c.dest }); c.E.tone({ f: 1320, t: c.t + dt, dur: 0.1, a: 0.004, d: 0.06, r: 0.05, vol: 0.04 * c.v, dest: c.dest }); }); c.E.tone({ type: 'triangle', f: 110, t: c.t, dur: 0.5, a: 0.02, d: 0.3, r: 0.2, vol: 0.06 * c.v, dest: c.dest }); } },
  'neantis-vol': { cat: 'effects', prio: 2, gap: 2, dur: 3.2, group: 'NÉANTIS', desc: 'Vol du dispositif : grave glacial + trois bips descendants',
    play(c) { c.E.tone({ type: 'sawtooth', f: 55, f2: 41, t: c.t, dur: 2.4, a: 0.5, d: 1.5, s: 0.3, r: 0.8, vol: 0.05 * c.v, dest: c.dest }); [1760, 1480, 1240].forEach((f, i) => c.E.tone({ f, t: c.t + 0.5 + i * 0.25, dur: 0.12, a: 0.005, d: 0.08, r: 0.06, vol: 0.04 * c.v, dest: c.dest })); } },
  'drone-alerte': { cat: 'effects', prio: 1, gap: 1.5, dur: 0.9, group: 'NÉANTIS', desc: 'Drone N : intrus repéré (bip bleu électrique)',
    play(c) { c.E.tone({ f: 1568, f2: 2093, t: c.t, dur: 0.12, a: 0.004, d: 0.08, r: 0.05, vol: 0.04 * c.v, dest: c.dest, pan: c.o.pan || 0 }); c.E.tone({ f: 1568, f2: 2093, t: c.t + 0.18, dur: 0.12, a: 0.004, d: 0.08, r: 0.05, vol: 0.04 * c.v, dest: c.dest, pan: c.o.pan || 0 }); c.E.tone({ type: 'triangle', f: 98, t: c.t, dur: 0.4, a: 0.02, d: 0.25, r: 0.15, vol: 0.05 * c.v, dest: c.dest }); } },
  'drone-neutralise': { cat: 'effects', prio: 1, gap: 0.3, dur: 1.2, group: 'NÉANTIS', desc: 'Drone N neutralisé : chute de hauteur + étincelle (léger)',
    play(c) { c.E.tone({ type: 'sawtooth', f: 700, f2: 90, t: c.t, dur: 0.6, a: 0.01, d: 0.4, r: 0.15, vol: 0.04 * c.v, dest: c.dest }); c.E.noise({ type: 'highpass', f: 3500, t: c.t + 0.1, dur: 0.2, a: 0.003, d: 0.12, r: 0.06, vol: 0.05 * c.v, dest: c.dest }); } },
  'drone-explosion': { cat: 'effects', prio: 1, gap: 0.5, dur: 1.2, group: 'NÉANTIS', desc: 'Explosion légère (2 nœuds seulement, préchauffée)',
    play(c) { c.E.noise({ type: 'lowpass', f: 1400, f2: 200, q: 0.5, t: c.t, dur: 0.55, a: 0.005, d: 0.35, r: 0.15, vol: 0.14 * c.v, dest: c.dest }); c.E.tone({ f: 85, f2: 38, t: c.t, dur: 0.6, a: 0.005, d: 0.4, r: 0.2, vol: 0.2 * c.v, dest: c.dest }); } },
  'gadget-charge': { cat: 'effects', prio: 1, gap: 0.3, dur: 0.8, group: 'Gadget', desc: 'Charge du gadget : sifflement électronique montant',
    play(c) { c.E.tone({ type: 'sawtooth', f: 260, f2: 1100, t: c.t, dur: 0.4, a: 0.05, d: 0.3, s: 0.5, r: 0.1, vol: 0.025 * c.v, dest: c.dest }); c.E.tone({ f: 520, f2: 2200, t: c.t, dur: 0.4, a: 0.05, d: 0.3, s: 0.5, r: 0.1, vol: 0.02 * c.v, dest: c.dest }); } },
  'gadget-tir': { cat: 'effects', prio: 1, gap: 0.1, dur: 0.4, group: 'Gadget', desc: 'Tir du gadget (aperçu ; le jeu garde son tir existant)',
    play(c) { c.E.tone({ type: 'triangle', f: c.j(640, 0.05), f2: 110, t: c.t, dur: 0.13, a: 0.005, d: 0.1, r: 0.04, vol: 0.075 * c.v, dest: c.dest }); } },
  'gadget-impact': { cat: 'effects', prio: 1, gap: 0.1, dur: 0.5, group: 'Gadget', desc: 'Impact du gadget : petit « tsh » cristallin',
    play(c) { c.E.noise({ type: 'highpass', f: 2800, t: c.t, dur: 0.1, a: 0.002, d: 0.06, r: 0.03, vol: 0.05 * c.v, dest: c.dest }); c.E.tone({ f: c.j(1800, 0.1), f2: 900, t: c.t, dur: 0.12, a: 0.002, d: 0.08, r: 0.04, vol: 0.04 * c.v, dest: c.dest }); } },

  /* ---------- Pas du joueur ---------- */
  'pas-terre': { cat: 'effects', prio: 0, gap: 0.09, dur: 0.2, group: 'Pas', desc: 'Pas sur terre sableuse (option run)',
    play(c) { const k = c.o.run ? 1.25 : 1; c.E.noise({ type: 'bandpass', f: c.j(1300, 0.2), q: 0.5, t: c.t, dur: 0.09, a: 0.006, d: 0.05, r: 0.04, vol: 0.07 * k * c.v, dest: c.dest, pan: c.j(0, 1) * 0.15 }); c.E.tone({ f: c.j(95, 0.1), f2: 60, t: c.t, dur: 0.08, a: 0.004, d: 0.05, r: 0.03, vol: 0.09 * k * c.v, dest: c.dest }); } },
  'pas-mosquee': { cat: 'effects', prio: 0, gap: 0.09, dur: 0.25, group: 'Pas', desc: 'Pas sur le sol de la mosquée (pierre/banco lisse, un peu d\'écho)',
    play(c) { const k = c.o.run ? 1.2 : 1; c.E.noise({ type: 'bandpass', f: c.j(800, 0.15), q: 0.8, t: c.t, dur: 0.08, a: 0.004, d: 0.04, r: 0.03, vol: 0.06 * k * c.v, dest: c.dest }); c.E.tone({ f: c.j(210, 0.08), f2: 150, t: c.t, dur: 0.1, a: 0.003, d: 0.07, r: 0.05, vol: 0.05 * k * c.v, dest: c.dest }); c.E.tone({ f: c.j(210, 0.08), f2: 150, t: c.t + 0.07, dur: 0.1, a: 0.003, d: 0.07, r: 0.05, vol: 0.015 * k * c.v, dest: c.dest }); } },
  'pas-toit': { cat: 'effects', prio: 0, gap: 0.09, dur: 0.2, group: 'Pas', desc: 'Pas sur le toit en banco : sec, granuleux',
    play(c) { const k = c.o.run ? 1.2 : 1; c.E.noise({ type: 'lowpass', f: c.j(1500, 0.15), q: 0.4, t: c.t, dur: 0.07, a: 0.004, d: 0.04, r: 0.03, vol: 0.07 * k * c.v, dest: c.dest }); c.E.noise({ type: 'highpass', f: 3500, t: c.t, dur: 0.03, a: 0.002, d: 0.02, r: 0.01, vol: 0.025 * k * c.v, dest: c.dest }); c.E.tone({ f: c.j(75, 0.1), f2: 55, t: c.t, dur: 0.07, a: 0.003, d: 0.05, r: 0.03, vol: 0.08 * k * c.v, dest: c.dest }); } },
  'pas-metal': { cat: 'effects', prio: 0, gap: 0.09, dur: 0.25, group: 'Pas', desc: 'Pas sur le sol métallique de la base : « tonk » clair',
    play(c) { const k = c.o.run ? 1.2 : 1; c.E.noise({ type: 'bandpass', f: c.j(2500, 0.1), q: 3, t: c.t, dur: 0.04, a: 0.002, d: 0.025, r: 0.02, vol: 0.05 * k * c.v, dest: c.dest }); c.E.tone({ f: c.j(520, 0.06), t: c.t, dur: 0.12, a: 0.002, d: 0.08, r: 0.04, vol: 0.035 * k * c.v, dest: c.dest }); c.E.tone({ f: c.j(1370, 0.06), t: c.t, dur: 0.07, a: 0.002, d: 0.05, r: 0.03, vol: 0.015 * k * c.v, dest: c.dest }); c.E.tone({ f: 80, f2: 55, t: c.t, dur: 0.07, a: 0.003, d: 0.05, r: 0.03, vol: 0.07 * k * c.v, dest: c.dest }); } },
  'saut': { cat: 'effects', prio: 1, gap: 0.3, dur: 0.5, group: 'Pas', desc: 'Saut : souffle d\'effort + tissu',
    play(c) { c.E.noise({ f: 700, f2: 1800, q: 0.7, t: c.t, dur: 0.18, a: 0.04, d: 0.1, r: 0.06, vol: 0.09 * c.v, dest: c.dest }); } },
  'atterrissage': { cat: 'effects', prio: 1, gap: 0.25, dur: 0.5, group: 'Pas', desc: 'Atterrissage : choc sourd (option force 0..1)',
    play(c) { const f = clamp(c.o.force ?? 0.6, 0.2, 1); c.E.tone({ f: 100, f2: 50, t: c.t, dur: 0.14, a: 0.003, d: 0.1, r: 0.05, vol: 0.14 * f * c.v, dest: c.dest }); c.E.noise({ type: 'lowpass', f: 1000, t: c.t, dur: 0.12, a: 0.004, d: 0.07, r: 0.04, vol: 0.09 * f * c.v, dest: c.dest }); } },

  /* ---------- Base NÉANTIS ---------- */
  'porte-coulisse': { cat: 'effects', prio: 1, gap: 0.5, dur: 1.6, group: 'NÉANTIS', desc: 'Porte coulissante : souffle pneumatique + servo + clac (option close pour la fermeture)',
    play(c) {
      const up = !c.o.close, f0 = up ? 140 : 210, f1 = up ? 230 : 120;
      c.E.noise({ f: up ? 700 : 1800, f2: up ? 1800 : 700, q: 0.7, t: c.t, dur: 0.7, a: 0.1, d: 0.3, s: 0.3, r: 0.2, vol: 0.05 * c.v, dest: c.dest, pan: c.o.pan || 0 });
      c.E.tone({ type: 'triangle', f: f0, f2: f1, t: c.t, dur: 0.7, a: 0.1, d: 0.4, s: 0.5, r: 0.2, vol: 0.05 * c.v, dest: c.dest, pan: c.o.pan || 0 });
      c.E.tone({ f: 880, t: c.t + 0.72, dur: 0.12, a: 0.002, d: 0.08, r: 0.05, vol: 0.03 * c.v, dest: c.dest }); c.E.tone({ f: 70, t: c.t + 0.72, dur: 0.1, a: 0.003, d: 0.07, r: 0.04, vol: 0.08 * c.v, dest: c.dest });
    } },

  /* ---------- Pick-up ---------- */
  'voiture-portiere-ouvre': { cat: 'effects', prio: 1, gap: 0.4, dur: 0.8, group: 'Pick-up', desc: 'Portière qui s\'ouvre : clic de poignée + grincement léger',
    play(c) { c.E.tone({ f: 1300, t: c.t, dur: 0.05, a: 0.002, d: 0.03, r: 0.02, vol: 0.04 * c.v, dest: c.dest }); c.E.tone({ type: 'triangle', f: 90, f2: 70, t: c.t + 0.05, dur: 0.12, a: 0.004, d: 0.08, r: 0.05, vol: 0.1 * c.v, dest: c.dest }); c.E.noise({ f: 1100, f2: 1600, q: 5, t: c.t + 0.1, dur: 0.3, a: 0.06, d: 0.2, r: 0.1, vol: 0.02 * c.v, dest: c.dest }); } },
  'voiture-portiere-ferme': { cat: 'effects', prio: 1, gap: 0.4, dur: 0.8, group: 'Pick-up', desc: 'Portière qui claque doucement : « tchong » sourd',
    play(c) { c.E.tone({ type: 'triangle', f: 120, f2: 55, t: c.t, dur: 0.18, a: 0.003, d: 0.12, r: 0.06, vol: 0.18 * c.v, dest: c.dest }); c.E.noise({ type: 'bandpass', f: 900, q: 0.8, t: c.t, dur: 0.1, a: 0.003, d: 0.06, r: 0.04, vol: 0.08 * c.v, dest: c.dest }); c.E.tone({ f: 1500, t: c.t + 0.02, dur: 0.06, a: 0.002, d: 0.04, r: 0.03, vol: 0.025 * c.v, dest: c.dest }); } },
  'voiture-demarrage': { cat: 'effects', prio: 2, gap: 1.5, dur: 2.2, group: 'Pick-up', desc: 'Clé et démarreur (3 tours) puis le moteur prend',
    play(c) {
      c.E.tone({ f: 1800, t: c.t, dur: 0.04, a: 0.002, d: 0.02, r: 0.02, vol: 0.03 * c.v, dest: c.dest });
      for (let i = 0; i < 3; i++) c.E.tone({ type: 'sawtooth', f: 62 + i * 3, f2: 80 + i * 4, t: c.t + 0.2 + i * 0.22, dur: 0.2, a: 0.02, d: 0.15, s: 0.4, r: 0.05, vol: 0.08 * c.v, dest: c.dest });
      c.E.tone({ type: 'sawtooth', f: 55, f2: 100, t: c.t + 0.9, dur: 0.6, a: 0.05, d: 0.5, s: 0.3, r: 0.4, vol: 0.07 * c.v, dest: c.dest });
      c.E.noise({ type: 'lowpass', f: 400, t: c.t + 0.9, dur: 0.5, a: 0.04, d: 0.3, r: 0.2, vol: 0.04 * c.v, dest: c.dest });
    } },
  'voiture-coupe': { cat: 'effects', prio: 1, gap: 1, dur: 1.4, group: 'Pick-up', desc: 'Moteur coupé : ralentissement + tic de refroidissement',
    play(c) { c.E.tone({ type: 'sawtooth', f: 95, f2: 30, t: c.t, dur: 0.8, a: 0.02, d: 0.6, s: 0.2, r: 0.3, vol: 0.06 * c.v, dest: c.dest }); c.E.tone({ f: 2200, t: c.t + 1.0, dur: 0.03, a: 0.002, d: 0.02, r: 0.02, vol: 0.015 * c.v, dest: c.dest }); } },
  'voiture-klaxon': { cat: 'effects', prio: 2, gap: 0.3, dur: 0.8, group: 'Pick-up', desc: 'Klaxon (touche G en conduisant) : deux tons, adouci',
    play(c) { [370, 466].forEach((f) => { c.E.tone({ type: 'sawtooth', f, t: c.t, dur: 0.32, a: 0.01, d: 0.1, s: 0.8, r: 0.06, vol: 0.035 * c.v, dest: c.dest }); c.E.tone({ type: 'square', f: f * 2, t: c.t, dur: 0.32, a: 0.01, d: 0.1, s: 0.6, r: 0.06, vol: 0.01 * c.v, dest: c.dest }); }); } },
  'voiture-frein': { cat: 'effects', prio: 1, gap: 0.8, dur: 0.7, group: 'Pick-up', desc: 'Freinage : crissement léger (option force 0..1)',
    play(c) { const f = clamp(c.o.force ?? 0.6, 0.2, 1); c.E.noise({ f: 2600, f2: 1700, q: 6, t: c.t, dur: 0.45, a: 0.05, d: 0.3, s: 0.3, r: 0.15, vol: 0.03 * f * c.v, dest: c.dest }); c.E.noise({ type: 'lowpass', f: 600, t: c.t, dur: 0.3, a: 0.03, d: 0.2, r: 0.1, vol: 0.04 * f * c.v, dest: c.dest }); } },
  'voiture-gravier': { cat: 'effects', prio: 0, gap: 0.05, dur: 0.1, group: 'Pick-up', desc: 'Grain de gravier sous les roues (joué par rafales selon la vitesse)',
    play(c) { c.E.noise({ type: 'highpass', f: c.j(2800, 0.3), t: c.t, dur: 0.04, a: 0.002, d: 0.025, r: 0.015, vol: 0.03 * clamp(c.o.speed ?? 0.5, 0.1, 1) * c.v, dest: c.dest, pan: c.j(0, 1) * 0.3 }); } },

  /* ---------- Laboratoire, dossier, fin ---------- */
  'lab-ouvre': { cat: 'effects', prio: 1, gap: 1, dur: 2, group: 'Laboratoire', desc: 'Entrée dans le labo : machines qui s\'éveillent',
    play(c) { c.E.tone({ f: 300, f2: 600, t: c.t, dur: 0.9, a: 0.4, d: 0.4, s: 0.3, r: 0.4, vol: 0.04 * c.v, dest: c.dest }); [72, 79, 84].forEach((m, i) => c.E.chime({ f: P(m), t: c.t + 0.5 + i * 0.12, vol: 0.035 * c.v, dest: c.dest, dur: 1 })); } },
  'lab-fini': { cat: 'effects', prio: 2, gap: 1, dur: 3, group: 'Laboratoire', desc: 'Labo terminé : petit thème de réussite',
    play(c) { [60, 64, 67, 72, 76].forEach((m, i) => c.E.pluck({ midi: m, t: c.t + i * 0.12, vol: 0.12 * c.v, dest: c.dest })); c.E.chime({ f: P(96), t: c.t + 0.6, vol: 0.045 * c.v, dest: c.dest, dur: 1.5 }); } },
  'dossier-ouvre': { cat: 'effects', prio: 1, gap: 1, dur: 1.2, group: 'Laboratoire', desc: 'Dossier NÉANTIS : froissement de papier + note froide',
    play(c) { for (let i = 0; i < 5; i++) c.E.noise({ type: 'bandpass', f: 2800 + c.rng() * 1800, q: 0.6, t: c.t + i * 0.05, dur: 0.05, a: 0.005, d: 0.03, r: 0.02, vol: 0.035 * c.v, dest: c.dest }); c.E.pluck({ midi: 57, t: c.t + 0.25, vol: 0.12 * c.v, dest: c.dest, style: 'ngoni' }); c.E.tone({ f: 1760, t: c.t + 0.3, dur: 0.1, a: 0.004, d: 0.07, r: 0.05, vol: 0.02 * c.v, dest: c.dest }); } },
  'dossier-fini': { cat: 'effects', prio: 1, gap: 1, dur: 1.6, group: 'Laboratoire', desc: 'Dossier refermé : deux notes graves, pensives',
    play(c) { c.E.pluck({ midi: 57, t: c.t, vol: 0.15 * c.v, dest: c.dest }); c.E.pluck({ midi: 64, t: c.t + 0.25, vol: 0.14 * c.v, dest: c.dest }); } },
  'fin-chapitre': { cat: 'effects', prio: 2, gap: 5, dur: 4, group: 'Laboratoire', desc: 'Fin de chapitre : accord de kora large + carillons',
    play(c) { [48, 55, 60, 64, 67, 72, 76].forEach((m, i) => c.E.pluck({ midi: m, t: c.t + i * 0.14, vol: 0.11 * c.v, dest: c.dest })); [91, 95, 98].forEach((m, i) => c.E.chime({ f: P(m), t: c.t + 1.1 + i * 0.2, vol: 0.04 * c.v, dest: c.dest, dur: 1.8 })); } },

  /* ---------- Ambiance : éléments ponctuels (aussi jouables seuls) ---------- */
  'amb-oiseau': { cat: 'ambience', prio: 0, gap: 0.3, dur: 0.8, group: 'Ambiance', desc: 'Un oiseau du Sahel : 2 à 4 trilles courts',
    play(c) {
      const n = 2 + Math.floor(c.rng() * 3), base = c.j(3000, 0.25), pan = c.o.pan ?? (c.rng() * 2 - 1) * 0.6;
      for (let i = 0; i < n; i++) c.E.tone({ f: base * (1 + c.rng() * 0.25), f2: base * (0.8 + c.rng() * 0.6), t: c.t + i * 0.09, dur: 0.06, a: 0.008, d: 0.04, r: 0.03, vol: 0.05 * c.v, dest: c.dest, pan });
    } },
  'amb-lointain': { cat: 'ambience', prio: 0, gap: 1, dur: 3, group: 'Ambiance', desc: 'Au loin : deux cordes pincées étouffées (un joueur de kora quelque part dans la ville)',
    play(c) { const m = pick(c, [57, 60, 62, 64]); c.E.pluck({ midi: m, t: c.t, vol: 0.1 * c.v, dest: c.dest, pan: c.o.pan ?? 0.5 }); c.E.pluck({ midi: m + (c.rng() < 0.5 ? 3 : 2), t: c.t + 0.55, vol: 0.08 * c.v, dest: c.dest, pan: c.o.pan ?? 0.5 }); } },
  'amb-bip-base': { cat: 'ambience', prio: 0, gap: 1, dur: 0.6, group: 'Ambiance', desc: 'Bip électronique lointain de la base',
    play(c) { const f = pick(c, [1760, 2093, 1568]); c.E.tone({ f, t: c.t, dur: 0.09, a: 0.004, d: 0.06, r: 0.05, vol: 0.02 * c.v, dest: c.dest, pan: c.o.pan ?? (c.rng() * 2 - 1) * 0.5 }); c.E.tone({ f, t: c.t + 0.14, dur: 0.07, a: 0.004, d: 0.05, r: 0.05, vol: 0.012 * c.v, dest: c.dest, pan: c.o.pan ?? 0 }); } },

  /* ---------- Motifs de musique (appelés par music(), aussi jouables seuls) ---------- */
  'musique-menu': { cat: 'music', prio: 1, gap: 2, dur: 14, group: 'Musique', desc: 'Motif de menu : kora pentatonique + nappe douce', play(c) { playMotif(c, 'menu'); } },
  'musique-explore': { cat: 'music', prio: 1, gap: 2, dur: 12, group: 'Musique', desc: 'Motif d\'exploration : kora du soir, clairsemé', play(c) { playMotif(c, 'explore'); } },
  'musique-base': { cat: 'music', prio: 1, gap: 2, dur: 14, group: 'Musique', desc: 'Motif de la base NÉANTIS : grave, tendu, bips bleus', play(c) { playMotif(c, 'base'); } },
  'musique-victoire': { cat: 'music', prio: 2, gap: 2, dur: 14, group: 'Musique', desc: 'Thème de victoire (fin de chapitre), doux et lumineux', play(c) { playMotif(c, 'victoire'); } },
};

/** Joue un motif d'un thème : kora, nappe éventuelle, basse. Renvoie la durée du motif en secondes. */
function playMotif(c, themeName) {
  const th = THEMES[themeName], ph = c.o.phrase !== undefined ? th.phrases[c.o.phrase % th.phrases.length] : pick(c, th.phrases);
  const sh = themeName === 'victoire' ? 0 : pick(c, [0, 0, 2, -2]);                 // petite transposition de degré
  const nT = c.o.transpose || 0;
  let end = 0;
  ph.forEach(([deg, st, len]) => {
    const t = c.t + st * BEAT + (c.rng() - 0.5) * 0.02, m = scaleNote(th.root + nT, th.scale, deg + sh);
    c.E.pluck({ midi: m + (themeName === 'base' ? 0 : 12), t, vol: 0.2 * th.vol * c.v * (0.85 + c.rng() * 0.3), dest: c.dest, pan: (c.rng() - 0.5) * 0.4 });
    end = Math.max(end, (st + len) * BEAT);
  });
  c.E.pluck({ midi: scaleNote(th.root + nT, th.scale, sh) - 12 + (themeName === 'base' ? 12 : 0), t: c.t, vol: 0.18 * th.vol * c.v, dest: c.dest, style: 'ngoni' });
  if (th.pad) {
    const f = noteToFreq(th.root + nT + 12), pad = themeName === 'base' ? 'sawtooth' : 'sine', vol = (themeName === 'base' ? 0.012 : 0.03) * c.v;
    [1, 1.5].forEach((k) => c.E.tone({ type: pad, f: f * k, t: c.t, dur: end + 1.5, a: 1.4, d: 2, s: 0.6, r: 2.2, vol, dest: c.dest, det: k === 1 ? -4 : 4 }));
  }
  if (themeName === 'base') [1, 2.4].forEach((dt) => c.E.tone({ f: 1760, t: c.t + dt * BEAT * 2, dur: 0.08, a: 0.004, d: 0.05, r: 0.05, vol: 0.012 * c.v, dest: c.dest, pan: 0.4 }));
  return end;
}

export const SOUND_NAMES = Object.keys(SOUNDS);

/* ==========================================================
   ÉTAT DU MOTEUR (navigateur)
   ========================================================== */
const S = {
  E: null, ready: false, zone: null, duck: new Set(),
  ambName: null, ambLayers: null, ambTimers: [], ambPoll: 0,
  musName: null, musTimer: 0, musOverride: null,
  voiceTotal: 0, errors: 0, lastIdx: {}, counts: {},
  userVol: 1,
};

function rngFn() { return Math.random(); }

function ensure() {
  if (S.E) { if (S.E.ctx.state === 'suspended' && S.E.ctx.resume) S.E.ctx.resume().catch(() => {}); return S.E; }
  if (!W) return null;
  const AC = W.AudioContext || W.webkitAudioContext;
  if (!AC) return null;
  const ua = W.navigator && W.navigator.userActivation;
  if (ua && !ua.hasBeenActive) return null;                          // pas avant un geste utilisateur
  try {
    const ctx = new AC({ latencyHint: 'interactive' });
    S.E = makeEngine(ctx, { gameAudio: W.GameAudio });
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    ctx.onstatechange = () => { S.ready = ctx.state === 'running'; };
    S.ready = ctx.state === 'running';
    S.E.warm([57, 60, 62, 64, 67, 69, 72, 76, 79, 45, 48, 52]);
    applyDuck(true); syncAmbience(); syncMusic();
  } catch (_) { S.E = null; S.ready = false; }
  return S.E;
}

/** Joue un son nommé. Renvoie true s'il est parti. Ne lève jamais d'exception. */
function play(name, opts = {}) {
  try {
    const def = SOUNDS[name];
    if (!def) return false;
    const E = ensure();
    if (!E || E.ctx.state !== 'running') return false;
    const now = E.ctx.currentTime;
    if (!E.cool.can(name, now, opts.force ? 0 : def.gap)) return false;
    if (!E.limiter.acquire(now, def.dur || 1, def.prio ?? 1)) return false;
    E.cool.mark(name, now); S.voiceTotal++; S.counts[name] = (S.counts[name] || 0) + 1;
    runDef(E, def, opts, now + 0.01);
    return true;
  } catch (_) { S.errors++; return false; }
}

function runDef(E, def, opts, t) {
  const rng = rngFn;
  const pitch = opts.rate || 1;
  const c = { E, t, dest: E.bus[def.cat], v: (opts.volume ?? 1) * S.userVol, o: opts, rng, j: (x, rel) => jitter(x, rel, rng) * (x ? pitch : 1) };
  return def.play(c);
}

/* ---------- ducking ---------- */
function applyDuck(immediate) {
  const E = S.E; if (!E) return;
  const on = S.duck.size > 0, t = E.ctx.currentTime;
  for (const cat of ['music', 'ambience']) {
    const target = LEVELS[cat] * (on ? DUCK[cat] : 1);
    if (immediate) E.bus[cat].gain.setValueAtTime(target, t);
    else E.bus[cat].gain.setTargetAtTime(target, t, DUCK.fade / 3);
  }
}
function setDuck(on, reason = 'dialogue') {
  const had = S.duck.has(reason);
  if (on) S.duck.add(reason); else S.duck.delete(reason);
  if (had !== !!on) applyDuck(false);
}

/* ---------- ambiances (un seul graphe) ---------- */
function buildAmbience(E) {
  const ctx = E.ctx, dest = E.bus.ambience, L = {};
  const layer = (name) => { const g = ctx.createGain(); g.gain.value = 0; g.connect(dest); L[name] = g; return g; };
  const loopNoise = () => { const s = ctx.createBufferSource(); s.buffer = E.noiseBuf; s.loop = true; s.start(0, Math.random()); return s; };
  // vent sahélien : bruit filtré, fréquence balayée lentement
  { const n = loopNoise(), bp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.6; lp.type = 'lowpass'; lp.frequency.value = 1400;
    lfo.frequency.value = 0.07; lg.gain.value = 260; lfo.connect(lg); lg.connect(bp.frequency); lfo.start();
    n.connect(bp); bp.connect(lp); lp.connect(layer('vent')); }
  // murmure du marché (loin, jour)
  { const n = loopNoise(), bp = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), lg = ctx.createGain(), mg = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.9; mg.gain.value = 0.5;
    lfo.frequency.value = 0.23; lg.gain.value = 0.35; lfo.connect(lg); lg.connect(mg.gain); lfo.start();
    n.connect(bp); bp.connect(mg); mg.connect(layer('marche')); }
  // grillons : deux oscillateurs modulés en amplitude (chrrr)
  { const out = layer('grillons');
    [[4300, 9], [4650, 12.5]].forEach(([f, r]) => {
      const o = ctx.createOscillator(), am = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain(), sw = ctx.createOscillator(), sg = ctx.createGain();
      o.frequency.value = f; am.gain.value = 0.5; lfo.frequency.value = r; lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain);
      sw.frequency.value = 0.11 + r * 0.004; sg.gain.value = 0.25; sw.connect(sg); sg.connect(out.gain);   // la couche respire
      o.connect(am); am.connect(out); o.start(); lfo.start(); sw.start();
    }); }
  // base NÉANTIS : bourdon froid (deux dents de scie désaccordées + sinus) et ventilation
  { const lp = ctx.createBiquadFilter(), out = layer('base'); lp.type = 'lowpass'; lp.frequency.value = 240; lp.Q.value = 0.7;
    [[55, 'sawtooth'], [55.45, 'sawtooth'], [110.2, 'sine']].forEach(([f, ty]) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = ty; o.frequency.value = f; g.gain.value = ty === 'sine' ? 0.5 : 0.35; o.connect(g); g.connect(lp); o.start(); });
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.12; lg.gain.value = 60; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
    lp.connect(out); }
  { const n = loopNoise(), hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 250; lp.type = 'lowpass'; lp.frequency.value = 900;
    n.connect(hp); hp.connect(lp); lp.connect(layer('ventilation')); }
  return L;
}

function hourNow() { try { return W.DayCycle && W.DayCycle.now ? W.DayCycle.now() : 12; } catch (_) { return 12; } }

function updateAmbienceLevels() {
  const E = S.E; if (!E || !S.ambLayers) return;
  const z = ambienceTargets(S.ambName, hourNow()), t = E.ctx.currentTime;
  for (const k in S.ambLayers) S.ambLayers[k].gain.setTargetAtTime(z[k] || 0, t, 1.2);
}
function clearAmbTimers() { S.ambTimers.forEach(clearTimeout); S.ambTimers = []; clearInterval(S.ambPoll); S.ambPoll = 0; }
function ambSchedule(fn, lo, hi) {                           // événement aléatoire récurrent tant que l'ambiance est active
  const name = S.ambName;
  const tick = () => { if (S.ambName !== name) return; fn(); S.ambTimers.push(setTimeout(tick, (lo + Math.random() * (hi - lo)) * 1000)); };
  S.ambTimers.push(setTimeout(tick, (lo + Math.random() * (hi - lo)) * 1000));
}

function syncAmbience() {
  const E = S.E; if (!E) return;
  clearAmbTimers();
  if (!S.ambLayers) S.ambLayers = buildAmbience(E);
  updateAmbienceLevels();
  if (!S.ambName) return;
  S.ambPoll = setInterval(updateAmbienceLevels, 2500);       // l'heure du jour change les couches
  if (S.ambName === 'djenne') {
    ambSchedule(() => { if (nightFactor(hourNow()) < 0.6) play('amb-oiseau'); }, 3, 8);
    ambSchedule(() => { if (nightFactor(hourNow()) < 0.8) play('amb-lointain'); }, 25, 55);
  } else if (S.ambName === 'base') {
    ambSchedule(() => play('amb-bip-base'), 7, 16);
  }
}
function ambience(name) {
  name = name || null;
  if (name === S.ambName) return;
  S.ambName = name;
  if (S.E) syncAmbience();
}

/* ---------- musique ---------- */
function clearMusic() { clearTimeout(S.musTimer); S.musTimer = 0; }
function syncMusic() {
  clearMusic();
  const name = S.musName;
  if (!S.E || !name || !THEMES[name]) return;
  const [lo, hi] = MUSIC_GAPS[name] || [20, 40];
  const next = (first) => {
    S.musTimer = setTimeout(() => {
      if (S.musName !== name) return;
      if (!(W.document && W.document.hidden)) play('musique-' + name, { force: true });
      if (name !== 'victoire') next(false);
    }, first ? (1.5 + Math.random() * 3) * 1000 : (lo + Math.random() * (hi - lo)) * 1000);
  };
  next(true);
}
function music(name) {
  name = name || null;
  if (name === S.musName) return;
  S.musName = name;
  syncMusic();
}

/* ==========================================================
   BRANCHEMENT SUR LE JEU (navigateur uniquement)
   ========================================================== */
const EVENTS = {
  'dispositif1:active': () => play('dispositif-illumine'),
  'dispositif1:taken': () => play('dispositif-prise'),
  'neantis:dispositif': () => play('dispositif-prise'),
  'dispositif1:spotted': () => play('alerte-detection'),
  'neantis:vol': () => play('neantis-vol'),
  'taama:carte-labo': () => play('notif'),
  'taama:carte-base': () => play('notif'),
  'taama:arrive-labo': () => play('arrivee'),
  'taama:arrive-labo2': () => play('arrivee'),
  'taama:chapitre1-fin': () => { play('fin-chapitre'); victory(); },
  'lab:open': () => play('lab-ouvre'),
  'lab:done': () => play('lab-fini'),
  'dossier:open': () => play('dossier-ouvre'),
  'dossier:done': () => play('dossier-fini'),
  'tapama:journal': () => play('indice'),
  'explore:start': () => play('ui-ecran'),
  'sanctuary:exit': () => play('ui-ecran-ferme'),
};

function victory() {                                         // thème de victoire une fois, puis retour à la musique de la scène
  S.musOverride = 'victoire'; S.musName = null; music('victoire');
  setTimeout(() => { S.musOverride = null; S.musName = null; sceneTick(true); }, 22000);
}

/* ---------- interface : survol, clic, curseurs, écrans ---------- */
const UI_SCOPE = '.gu-screen,#labRoot,#dsRoot,[class^="tp-"],[class*=" tp-"],[class^="cm-"],[class*=" cm-"]';
const UI_CLICKABLE = 'button,a[href],[role="button"],[data-act],input[type="checkbox"],input[type="radio"],select,summary,.sw,[data-lang]';
function pathEls(e) { return (e.composedPath ? e.composedPath() : []).filter((n) => n && n.nodeType === 1); }
function inScope(els) { return els.some((n) => n.matches && n.matches(UI_SCOPE)); }
function clickable(els) { return els.find((n) => n.matches && n.matches(UI_CLICKABLE) && !n.disabled && n.getAttribute('aria-disabled') !== 'true'); }
function classify(el) {
  const act = (el.dataset && el.dataset.act) || '', txt = ((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')).slice(0, 40).toLowerCase();
  if (act === 'back' || /^(retour|back|fermer|close|annuler|cancel|quitter)\b/.test(txt.trim()) || el.classList.contains('cm-route-x')) return 'ui-retour';
  if (/^(start|new|begin|profile-save|resume|continue)/.test(act) || /^(valider|confirmer|commencer|jouer|continuer|enregistrer)\b/.test(txt.trim())) return 'ui-valider';
  return 'ui-clic';
}
let lastHover = null, lastSlider = 0;
function installUi() {
  const d = W.document;
  d.addEventListener('pointerover', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const els = pathEls(e); if (!inScope(els)) return;
    const el = clickable(els); if (!el || el === lastHover) return;
    lastHover = el; play('ui-survol');
  }, true);
  d.addEventListener('click', (e) => {
    const els = pathEls(e); if (!inScope(els)) return;
    const el = clickable(els); if (!el) return;
    if (el.closest && el.closest('.tp-btn') && el.classList.contains('tp-d-skip')) return play('ui-retour');
    play(classify(el));
  }, true);
  d.addEventListener('input', (e) => {
    const t = pathEls(e)[0]; if (!t || t.type !== 'range') return;
    const now = performance.now(); if (now - lastSlider < 70) return; lastSlider = now;
    const mn = Number(t.min || 0), mx = Number(t.max || 100);
    play('ui-curseur', { value: (Number(t.value) - mn) / Math.max(1e-6, mx - mn) });
  }, true);
  const unlock = () => { ensure(); };
  ['pointerdown', 'keydown', 'touchend'].forEach((ev) => d.addEventListener(ev, unlock, { capture: true, passive: true }));
  d.addEventListener('visibilitychange', () => { if (!d.hidden && S.E && S.E.ctx.state !== 'running') S.E.ctx.resume().catch(() => {}); });
  W.addEventListener('keydown', (e) => {                      // klaxon : G en conduisant
    if (e.code === 'KeyG' && !e.repeat && W.Vehicle && W.Vehicle.state === 'drive') play('voiture-klaxon');
  });
}

/* ---------- observation légère de l'état du jeu (toutes les 50 ms) ---------- */
const W_ = { stepper: new Stepper(), last: null, lastT: 0, vy: 0, air: false, groundY: null, spd: 0, nearBase: false, tState: 0, tScene: 0,
  screen: undefined, mapOpen: false, sel: null, route: null, carSt: null, carSpeed: 0, toastWrapped: false, base: null };
const STEP_NAMES = { terre: 'pas-terre', mosquee: 'pas-mosquee', toit: 'pas-toit', metal: 'pas-metal' };

/** Boîte englobante de la base NÉANTIS, déduite de ses points d'ancrage (+ marge) : le sol y est métallique. */
export function boxFromPoints(pts, margin = 8) {
  if (!pts.length) return null;
  const b = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const p of pts) { b.x0 = Math.min(b.x0, p.x); b.x1 = Math.max(b.x1, p.x); b.z0 = Math.min(b.z0, p.z); b.z1 = Math.max(b.z1, p.z); b.y0 = Math.min(b.y0, p.y); b.y1 = Math.max(b.y1, p.y); }
  b.x0 -= margin; b.x1 += margin; b.z0 -= margin; b.z1 += margin; b.y0 -= 4; b.y1 += 8;
  return b;
}
export function inBox(b, p) { return !!b && p.x >= b.x0 && p.x <= b.x1 && p.z >= b.z0 && p.z <= b.z1 && p.y >= b.y0 && p.y <= b.y1; }

function nearBaseNow(pp) {
  const B = W.NeantisBase; if (!B || !B.loaded || !B.anchors) return false;
  if (!W_.base) W_.base = boxFromPoints(Object.values(B.anchors).filter((p) => p && Number.isFinite(p.x)));
  return inBox(W_.base, pp);
}

function footsteps(dt) {
  const sm = W.SanctuaryMode, pp = sm && sm.playerPosition ? sm.playerPosition() : null;
  const car = W.Vehicle && W.Vehicle.state;
  if (!pp || (car && car !== 'parked') || (W.Tapama && W.Tapama.isBusy && W.Tapama.isBusy())) { W_.last = null; W_.stepper.reset(); return; }
  if (!W_.last) { W_.last = { x: pp.x, y: pp.y, z: pp.z }; return; }
  const dx = pp.x - W_.last.x, dz = pp.z - W_.last.z, dy = pp.y - W_.last.y, dist = Math.hypot(dx, dz);
  W_.last = { x: pp.x, y: pp.y, z: pp.z };
  if (dist > 3) { W_.stepper.reset(); return; }               // téléportation
  const spd = dist / Math.max(dt, 0.001), vy = dy / Math.max(dt, 0.001);
  W_.spd = spd;
  const nearBase = nearBaseNow(pp); W_.nearBase = nearBase;
  if (W_.groundY === null || (S.zone !== 'mosquee' && !nearBase && pp.y < W_.groundY)) W_.groundY = pp.y;   // niveau du sol de référence
  // saut / atterrissage (vitesse verticale)
  if (!W_.air && vy > 3) { W_.air = true; play('saut'); }
  else if (W_.air && vy < -3.5) W_.air = 'fall';
  else if (W_.air && Math.abs(vy) < 1.2) { if (W_.air === 'fall') play('atterrissage', { force: clamp(-W_.vy / 8, 0.3, 1) }); W_.air = false; }
  W_.vy = vy;
  if (W_.air) return;
  if (spd < 0.6) { W_.stepper.reset(); return; }
  const run = spd > 4.3, n = W_.stepper.feed(dist, run ? STEP_STRIDE.course : STEP_STRIDE.marche);
  if (n > 0) {
    const surf = surfaceFor({ zone: S.zone, nearBase, high: pp.y > (W_.groundY ?? pp.y) + 3.2 });
    play(STEP_NAMES[surf], { run, volume: 0.85 + Math.random() * 0.3, rate: 1 });
  }
}

function sceneTick(force) {
  const U = W.GameUI, sm = W.SanctuaryMode;
  if (!U) return;                                            // hors du jeu (page d'aperçu) : ambiance et musique pilotées à la main
  const uiOpen = !!(U && U.isOpen && U.isOpen()), inGame = !!(U && U.isInGame && U.isInGame());
  const sanct = !!(sm && sm.isActive && sm.isActive());
  S.sanct = sanct;
  setDuck(uiOpen && inGame, 'pause');
  const talking = !!(W.Tapama && W.Tapama.isBusy && W.Tapama.isBusy()) || !!(W.document.querySelector('.tp-radio.on'));
  if (talking !== !!S.duck.has('dialogue')) setDuck(talking, 'dialogue');
  let amb = null, mus = null;
  if (uiOpen && !inGame) mus = 'menu';
  else if (!uiOpen && sanct && S.zone !== 'mosquee') {
    if (W_.nearBase) { amb = 'base'; mus = 'base'; } else { amb = 'djenne'; mus = 'explore'; }
  }
  if (!S.musOverride) music(mus);
  ambience(amb);
}

function stateTick(dt) {
  const d = W.document;
  // écran de l'interface
  const on = d.querySelector('.gu-screen.on'), id = on ? on.dataset.screen || '?' : null;
  if (W_.screen !== undefined && id !== W_.screen) {
    if (id && !W_.screen) play('ui-ecran'); else if (!id && W_.screen) play('ui-ecran-ferme'); else if (id && W_.screen) play('ui-ecran');
  }
  W_.screen = id;
  // carte
  const CM = W.CityMap;
  if (CM) {
    if (!!CM.isOpen !== W_.mapOpen) { W_.mapOpen = !!CM.isOpen; play(W_.mapOpen ? 'carte-ouvre' : 'carte-ferme'); }
    if (CM.selected !== W_.sel) { W_.sel = CM.selected; if (W_.sel) play('carte-lieu'); }
    const rt = CM.route ? CM.route.id : null;
    if (rt !== W_.route) { W_.route = rt; if (rt) play('carte-trace'); }
  }
  // pick-up
  const V = W.Vehicle;
  if (V) {
    const st = V.state;
    if (W_.carSt !== null && st !== W_.carSt) {
      if (st === 'open_in' || st === 'open_out') play('voiture-portiere-ouvre');
      else if (st === 'vanish_in') play('voiture-portiere-ferme');
      else if (st === 'drive') play('voiture-demarrage');
      else if (st === 'appear_out') play('voiture-coupe');
      else if (st === 'parked' && W_.carSt === 'appear_out') play('voiture-portiere-ferme');
    }
    W_.carSt = st;
    if (st === 'drive') {
      const sp = Math.abs(V.speed || 0);
      if (W_.carSpeed > 10 && sp < W_.carSpeed - 2.5 * dt * 20 && sp < W_.carSpeed * 0.8) play('voiture-frein', { force: clamp((W_.carSpeed - sp) / 15, 0.3, 1) });
      if (sp > 3 && Math.random() < Math.min(0.9, sp / 20)) play('voiture-gravier', { speed: sp / 34 });
      W_.carSpeed = sp;
    } else W_.carSpeed = 0;
  }
  // GamepadKit.toast : petit carillon à chaque message
  if (!W_.toastWrapped && W.GamepadKit && W.GamepadKit.toast) {
    const orig = W.GamepadKit.toast; W_.toastWrapped = true;
    W.GamepadKit.toast = function (...a) { play('toast'); return orig.apply(this, a); };
  }
}

function install() {
  if (!W || !W.document || S.installed) return;
  S.installed = true;
  for (const ev in EVENTS) W.addEventListener(ev, () => { try { EVENTS[ev](); } catch (_) { S.errors++; } });
  installUi();
  let last = performance.now();
  setInterval(() => {
    if (W.document.hidden) return;
    const now = performance.now(), dt = Math.min(0.25, (now - last) / 1000); last = now;
    try {
      if (!S.E) ensure();
      if (!S.E || !S.ready) return;
      footsteps(dt);
      if (now - W_.tState >= 150) { stateTick((now - W_.tState) / 1000); W_.tState = now; }
      if (now - W_.tScene >= 250) { sceneTick(); W_.tScene = now; }
    } catch (_) { S.errors++; }
  }, 50);
}

/* ---------- API publique ---------- */
function info(name) { const d = SOUNDS[name]; return d ? { name, cat: d.cat, group: d.group || '', desc: d.desc || '', dur: d.dur } : null; }

export const Sfx = {
  play, ambience, music, setDuck,
  names: () => SOUND_NAMES.slice(),
  info,
  unlock: () => !!ensure(),
  get ready() { return S.ready; },
  ownsSteps: () => S.ready,                                   // true : les pas synthétisés remplacent la boucle mp3
  setZone(z) { S.zone = z || null; },
  setVolume(v) { S.userVol = clamp(Number(v) || 0, 0, 2); },   // page d'aperçu seulement : volume global des sons
  stats: () => ({ ready: S.ready, voices: S.E ? S.E.limiter.active(S.E.ctx.currentTime) : 0, max: MAX_VOICES, played: S.voiceTotal, dropped: S.E ? S.E.limiter.dropped : 0, errors: S.errors, ambience: S.ambName, music: S.musName, ducked: S.duck.size > 0, cache: S.E ? S.E.ksCache.size : 0, zone: S.zone, counts: { ...S.counts } }),
  get engine() { return S.E; },
};

/** Rend un son hors-ligne (tests objectifs de niveau) : renvoie un AudioBuffer. */
export async function renderSound(name, opts = {}, seconds = 3, sr = 44100) {
  const OAC = W && (W.OfflineAudioContext || W.webkitOfflineAudioContext);
  const oc = new OAC(2, Math.ceil(seconds * sr), sr);
  const E = makeEngine(oc, {});
  runDef(E, SOUNDS[name], opts, 0.01);
  return oc.startRendering();
}
Sfx.render = renderSound;

if (W) { W.Sfx = Sfx; install(); }
