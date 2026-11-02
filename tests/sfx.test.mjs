/**
 * Tests unitaires de la logique pure du moteur sonore (aucune dépendance navigateur).
 * Usage : node tests/sfx.test.mjs
 */
import assert from 'node:assert/strict';
import * as S from '../app/sfx.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`ok - ${name}`); };
const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

test('noteToFreq : La4 = 440 Hz, octave = x2, Do4 ~ 261,63 Hz', () => {
  assert.equal(S.noteToFreq(69), 440);
  assert.ok(Math.abs(S.noteToFreq(81) - 880) < 1e-9);
  assert.ok(Math.abs(S.noteToFreq(60) - 261.6256) < 1e-3);
});

test('noteToMidi : noms de notes, dièses, bémols, invalides', () => {
  assert.equal(S.noteToMidi('A4'), 69);
  assert.equal(S.noteToMidi('C4'), 60);
  assert.equal(S.noteToMidi('C#4'), 61);
  assert.equal(S.noteToMidi('Bb3'), 58);
  assert.equal(S.noteToMidi('H9'), null);
});

test('scaleNote : degrés, octaves, négatifs, gamme personnalisée', () => {
  assert.equal(S.scaleNote(60, 'pentaMaj', 0), 60);
  assert.equal(S.scaleNote(60, 'pentaMaj', 4), 69);
  assert.equal(S.scaleNote(60, 'pentaMaj', 5), 72);       // octave suivante
  assert.equal(S.scaleNote(60, 'pentaMaj', -1), 57);      // sous la tonique
  assert.equal(S.scaleNote(60, [0, 3, 7], 4), 60 + 12 + 3);
});

test('gammes : cinq degrés croissants dans l\'octave', () => {
  for (const [k, sc] of Object.entries(S.SCALES)) {
    assert.equal(sc.length, 5, k);
    assert.equal(sc[0], 0);
    for (let i = 1; i < sc.length; i++) assert.ok(sc[i] > sc[i - 1] && sc[i] < 12, k);
  }
});

test('jitter : reste dans la plage relative', () => {
  const r = seeded(7);
  for (let i = 0; i < 500; i++) { const v = S.jitter(100, 0.1, r); assert.ok(v >= 90 && v <= 110); }
  assert.equal(S.jitter(100, 0, r), 100);
});

test('pickVariation : jamais deux fois de suite le même élément, couvre toute la liste', () => {
  const r = seeded(3), list = ['a', 'b', 'c', 'd'], seen = new Set();
  let last = -1;
  for (let i = 0; i < 300; i++) { const p = S.pickVariation(list, last, r); assert.notEqual(p.index, last); last = p.index; seen.add(p.value); }
  assert.equal(seen.size, 4);
  assert.deepEqual(S.pickVariation(['x'], 0, r), { value: 'x', index: 0 });
  assert.equal(S.pickVariation([], -1, r).value, undefined);
});

test('VoiceLimiter : plafonne à max, libère à l\'échéance, priorité plus haute évince', () => {
  const L = new S.VoiceLimiter(3);
  assert.ok(L.acquire(0, 1, 1)); assert.ok(L.acquire(0, 1, 1)); assert.ok(L.acquire(0, 2, 1));
  assert.equal(L.active(0.5), 3);
  assert.equal(L.acquire(0.5, 1, 1), false);               // plein, même priorité : refusé
  assert.equal(L.dropped, 1);
  assert.equal(L.acquire(0.5, 1, 2), true);                // plus prioritaire : prend une place
  assert.equal(L.active(0.5), 3);
  assert.equal(L.active(1.5), 1);                          // les courtes sont terminées
  for (let i = 0; i < 100; i++) L.acquire(2, 5, 1);
  assert.ok(L.active(2) <= 3);
});

test('VoiceLimiter : la valeur par défaut est MAX_VOICES (24)', () => {
  assert.equal(S.MAX_VOICES, 24);
  const L = new S.VoiceLimiter();
  let ok = 0; for (let i = 0; i < 60; i++) if (L.acquire(0, 10, 0)) ok++;
  assert.equal(ok, 24);
});

test('Cooldowns : délai minimal par son', () => {
  const C = new S.Cooldowns();
  assert.ok(C.can('x', 0, 0.5)); C.mark('x', 0);
  assert.equal(C.can('x', 0.3, 0.5), false);
  assert.ok(C.can('x', 0.5, 0.5));
  assert.ok(C.can('y', 0.1, 0.5));
  assert.ok(C.can('x', 0.1, 0));
});

test('Stepper : un pas par foulée, reste conservé', () => {
  const s = new S.Stepper();
  assert.equal(s.feed(0.5, 0.8), 0);
  assert.equal(s.feed(0.5, 0.8), 1);                       // 1,0 m -> 1 pas, reste 0,2
  assert.equal(s.feed(2.5, 0.8), 3);                       // 2,7 m -> 3 pas
  s.reset(); assert.equal(s.feed(0.79, 0.8), 0);
});

test('nightFactor : jour, nuit, transitions monotones, valeurs invalides', () => {
  assert.equal(S.nightFactor(12), 0);
  assert.equal(S.nightFactor(2), 1);
  assert.equal(S.nightFactor(22), 1);
  assert.equal(S.nightFactor(7.5), 0);
  assert.equal(S.nightFactor(NaN), 0);
  let prev = 0; for (let h = 17; h <= 21; h += 0.25) { const n = S.nightFactor(h); assert.ok(n >= prev); prev = n; }
  prev = 1; for (let h = 4; h <= 8; h += 0.25) { const n = S.nightFactor(h); assert.ok(n <= prev); prev = n; }
  assert.equal(S.nightFactor(26), S.nightFactor(2));
});

test('surfaceFor : priorité base > mosquée > toit > terre', () => {
  assert.equal(S.surfaceFor({}), 'terre');
  assert.equal(S.surfaceFor({ high: true }), 'toit');
  assert.equal(S.surfaceFor({ zone: 'mosquee' }), 'mosquee');
  assert.equal(S.surfaceFor({ zone: 'mosquee', high: true }), 'mosquee');
  assert.equal(S.surfaceFor({ nearBase: true, zone: 'mosquee' }), 'metal');
});

test('ambienceTargets : grillons la nuit, oiseaux le jour, bourdon dans la base, rien sans ambiance', () => {
  const jour = S.ambienceTargets('djenne', 12), nuit = S.ambienceTargets('djenne', 23);
  assert.ok(jour.oiseaux > 0 && nuit.oiseaux === 0);
  assert.ok(nuit.grillons > 0 && jour.grillons === 0);
  assert.ok(jour.vent > 0 && nuit.vent > 0);
  const base = S.ambienceTargets('base', 12);
  assert.ok(base.base > 0 && base.vent === 0);
  assert.ok(Object.values(S.ambienceTargets(null, 12)).every((v) => v === 0));
});

test('adsrPlan : part de 0, attaque puis retour à 0, temps croissants, fin après le relâchement', () => {
  const p = S.adsrPlan(1, { a: 0.01, d: 0.1, s: 0.2, dur: 0.5, r: 0.2, peak: 0.5 });
  assert.deepEqual(p.events[0], ['set', 0, 1, 0]);
  assert.equal(p.events[1][1], 0.5);
  assert.equal(p.events[p.events.length - 1][1], 0);
  for (let i = 1; i < p.events.length; i++) assert.ok(p.events[i][2] >= p.events[i - 1][2]);
  assert.ok(p.end > 1.5 + 0.2);
  assert.ok(S.adsrPlan(0, { dur: 0.001 }).end > 0);        // durée trop courte : corrigée
});

test('karplusStrong : fini, normalisé, sans composante continue, hauteur juste, décroissant', () => {
  const sr = 44100, f = 220, b = S.karplusStrong(f, sr, 1, { rng: seeded(5) });
  assert.equal(b.length, sr);
  let peak = 0, mean = 0, bad = 0;
  for (const v of b) { if (!Number.isFinite(v)) bad++; peak = Math.max(peak, Math.abs(v)); mean += v; }
  assert.equal(bad, 0);
  assert.ok(Math.abs(peak - 1) < 1e-6);
  assert.ok(Math.abs(mean / b.length) < 0.01);
  // hauteur : autocorrélation (maximum autour de la période attendue)
  const lo = Math.floor(sr / f * 0.8), hi = Math.ceil(sr / f * 1.2);
  let bestLag = 0, best = -Infinity;
  for (let lag = lo; lag <= hi; lag++) { let c = 0; for (let i = 2000; i < 6000; i++) c += b[i] * b[i + lag]; if (c > best) { best = c; bestLag = lag; } }
  const est = sr / bestLag, base = S.ksBaseFreq(f, sr);
  assert.ok(Math.abs(est - base) / base < 0.03, `${est} vs ${base}`);
  const rms = (a, c) => { let s = 0; for (let i = a; i < c; i++) s += b[i] * b[i]; return Math.sqrt(s / (c - a)); };
  assert.ok(rms(0, 4410) > rms(30000, 34410));              // la corde s'éteint
  assert.ok(Math.abs(b[b.length - 1]) < 1e-9);                         // fondu final : pas de clic
});

test('ksBaseFreq : proche de la fréquence demandée', () => {
  for (const f of [110, 220, 440, 880]) assert.ok(Math.abs(S.ksBaseFreq(f, 44100) - f) / f < 0.03);
});

test('catalogue : tous les sons ont bus valide, description, durée et fonction', () => {
  assert.ok(S.SOUND_NAMES.length >= 50);
  for (const n of S.SOUND_NAMES) {
    const d = S.SOUNDS[n];
    assert.ok(['effects', 'ambience', 'music'].includes(d.cat), n);
    assert.equal(typeof d.play, 'function', n);
    assert.ok(d.desc && d.group && d.dur > 0, n);
    assert.ok(d.prio >= 0 && d.prio <= 2, n);
  }
  for (const n of ['ui-clic', 'voix-tapama', 'radio-ouvre', 'dispositif-prise', 'porte-coulisse', 'pas-terre', 'pas-metal', 'voiture-klaxon', 'drone-alerte', 'fin-chapitre']) assert.ok(S.SOUNDS[n], n);
});

test('thèmes de musique : degrés/temps cohérents, pauses définies pour chaque thème', () => {
  for (const [k, th] of Object.entries(S.THEMES)) {
    assert.ok(S.SCALES[th.scale], k);
    assert.ok(S.MUSIC_GAPS[k], k);
    for (const ph of th.phrases) for (const [deg, st, len] of ph) assert.ok(Number.isInteger(deg) && st >= 0 && len > 0, k);
  }
});

test('boxFromPoints / inBox : boîte des ancrages + marge', () => {
  const b = S.boxFromPoints([{ x: 0, y: 0, z: 0 }, { x: 40, y: 2, z: 30 }], 8);
  assert.ok(S.inBox(b, { x: 20, y: 1, z: 15 }));
  assert.ok(S.inBox(b, { x: -7, y: 1, z: -7 }));
  assert.equal(S.inBox(b, { x: -9, y: 1, z: 0 }), false);
  assert.equal(S.inBox(b, { x: 20, y: 30, z: 15 }), false);   // trop haut : sur le toit
  assert.equal(S.boxFromPoints([], 8), null);
  assert.equal(S.inBox(null, { x: 0, y: 0, z: 0 }), false);
});

test('Sfx hors navigateur : API présente, play ne lève rien et renvoie false', () => {
  assert.equal(S.Sfx.play('ui-clic'), false);
  assert.equal(S.Sfx.play('nom-inconnu'), false);
  assert.equal(S.Sfx.ready, false);
  S.Sfx.ambience('djenne'); S.Sfx.music('menu'); S.Sfx.music(null); S.Sfx.ambience(null); S.Sfx.setDuck(true); S.Sfx.setDuck(false);
  assert.equal(S.Sfx.stats().voices, 0);
});

console.log(`\n${passed} tests réussis`);
