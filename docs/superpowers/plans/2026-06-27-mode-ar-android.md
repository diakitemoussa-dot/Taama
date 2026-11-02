# Mode AR Android Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brancher le bouton AR pour lancer une expérience WebXR `immersive-ar` sur Android — la mosquée de Djenné posée en maquette sur une surface réelle, avec pinch-to-scale et rotation tactile.

**Architecture:** Le module `app/ar-mode.js` est autonome, exposant une seule fonction `enter()`. Il réutilise `window.MosqueScene.renderer/scene/camera` et suspend/reprend la boucle RAF du viewer via deux nouvelles méthodes `pauseLoop()/resumeLoop()`. Le GLB allégé `djenne-mosque-only.glb` est généré une seule fois par `tools/extract-ar-model.mjs`.

**Tech Stack:** Three.js WebXR (`renderer.xr`), WebXR `hit-test` feature, `@gltf-transform/core` v4 + `@gltf-transform/extensions` (extraction), événements pointer natifs (gestes).

---

## Fichiers

| Fichier | Action |
|---|---|
| `tools/extract-ar-model.mjs` | Créer — script one-shot d'extraction |
| `assets/models/djenne-mosque-only.glb` | Générer puis commiter |
| `app/ar-mode.js` | Créer — module AR complet |
| `app/mosque-viewer.js` | Modifier lignes ~487-493 (MosqueScene) et ~851-853 (btnAr) |
| `index.html` | Modifier — ajouter overlay AR dans `#mosqueStage` |
| `styles/mosque.css` | Modifier — styles overlay AR |

---

## Task 1 : Extraire djenne-mosque-only.glb

**Files:**
- Create: `tools/extract-ar-model.mjs`
- Generate: `assets/models/djenne-mosque-only.glb`

- [ ] **Step 1 : Créer le script d'extraction**

Créer `tools/extract-ar-model.mjs` :

```javascript
import { NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3d';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { statSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT  = resolve(__dirname, '../assets/models/djenne-ar.glb');
const OUTPUT = resolve(__dirname, '../assets/models/djenne-mosque-only.glb');

const io = new NodeIO()
  .registerExtensions([EXTTextureWebP, KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });

const doc = await io.read(INPUT);
const root = doc.getRoot();
const scene = root.listScenes()[0];

// Le node parent de toute la mosquée (nom avec espace final intentionnel)
const mosqueNode = root.listNodes().find(n => n.getName().trim() === 'la mosque en globale');
if (!mosqueNode) throw new Error('Node "la mosque en globale" introuvable dans le GLB');

// Supprimer tous les autres enfants de la scène (ciel, sol, nuage, arbre)
scene.listChildren()
  .filter(n => n !== mosqueNode)
  .forEach(n => { console.log('  supprime :', n.getName()); n.dispose(); });

await io.write(OUTPUT, doc);
const mb = (statSync(OUTPUT).size / 1024 / 1024).toFixed(2);
console.log(`✓ djenne-mosque-only.glb écrit — ${mb} MB`);
```

- [ ] **Step 2 : Exécuter le script**

```bash
cd mosquee-djenne
node tools/extract-ar-model.mjs
```

Résultat attendu :
```
  supprime : WEB_Cloud3D_4
  supprime : home
  supprime : land
  supprime : WEB_Sky
  supprime : arbre
✓ djenne-mosque-only.glb écrit — 4.49 MB
```

- [ ] **Step 3 : Vérifier le contenu du GLB généré**

```bash
node -e "
const fs = require('fs');
const buf = fs.readFileSync('assets/models/djenne-mosque-only.glb');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20+jsonLen).toString('utf8'));
console.log('Nodes:', json.nodes.map(n=>n.name));
console.log('Scene roots:', json.scenes[0].nodes);
"
```

Résultat attendu : uniquement `la mosque en globale ` et ses 15 enfants (Canaris, Minarets, Mosquee_Base, etc.). Aucun WEB_Sky, home, land, arbre.

- [ ] **Step 4 : Commiter**

```bash
git add tools/extract-ar-model.mjs assets/models/djenne-mosque-only.glb
git commit -m "Asset AR : extrait djenne-mosque-only.glb (15 meshes mosquée sans env)"
```

---

## Task 2 : Overlay HTML + CSS

**Files:**
- Modify: `index.html` (dans `#mosqueStage`, après la div `mosqueVideo`)
- Modify: `styles/mosque.css` (ajouter à la fin)

- [ ] **Step 1 : Ajouter l'overlay AR dans index.html**

Trouver la ligne `</div><!-- /#mosqueStage -->` ou la fin de `#mosqueStage` et insérer juste avant la balise fermante `</div>` de `#mosqueStage` (après le bloc `sanctuaryHud`) :

```html
    <!-- ===== Overlay du mode AR (caché par défaut) ===== -->
    <div id="arOverlay" class="ar-overlay" aria-hidden="true">
      <button id="arQuit" class="ar-quit" type="button" aria-label="Quitter AR">✕</button>
      <p id="arHint" class="ar-hint"></p>
    </div>
```

- [ ] **Step 2 : Ajouter les styles dans mosque.css**

Ajouter à la fin de `styles/mosque.css` :

```css
/* ===== Mode AR ===== */
.ar-overlay{
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 50;
}
.ar-overlay[aria-hidden="true"]{ display: none; }

.ar-quit{
  position: absolute;
  top: clamp(14px, 4vh, 28px);
  right: clamp(14px, 4vw, 28px);
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1.5px solid #f9d58b88;
  background: rgba(8,6,12,.7);
  color: #f9d58b;
  font-size: 1.3rem;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition: background .2s;
}
.ar-quit:hover{ background: rgba(8,6,12,.9); }

.ar-hint{
  position: absolute;
  bottom: clamp(28px, 8vh, 56px);
  left: 50%;
  transform: translateX(-50%);
  padding: .55em 1.2em;
  background: rgba(8,6,12,.7);
  border: 1px solid #f9d58b44;
  border-radius: 2em;
  color: #f9d58b;
  font-family: 'Rajdhani', sans-serif;
  font-size: clamp(.85rem, 3.5vw, 1.05rem);
  font-weight: 600;
  letter-spacing: .04em;
  white-space: nowrap;
  backdrop-filter: blur(8px);
  transition: opacity .8s ease;
  pointer-events: none;
}
```

- [ ] **Step 3 : Commiter**

```bash
git add index.html styles/mosque.css
git commit -m "AR : overlay HTML (arOverlay, arQuit, arHint) + styles CSS"
```

---

## Task 3 : Exposer pauseLoop / resumeLoop sur MosqueScene

**Files:**
- Modify: `app/mosque-viewer.js` lignes ~487-493

- [ ] **Step 1 : Ouvrir mosque-viewer.js et trouver le bloc MosqueScene**

Le bloc actuel (autour de la ligne 487) :

```javascript
window.MosqueScene = {
  scene, camera, renderer, controls,
  viewOverview, viewTarget,
  get domeRadius(){ return domeR; },
  flyTo,
  setGameUpdate(fn){ gameUpdate = (typeof fn === 'function') ? fn : null; },
};
```

- [ ] **Step 2 : Ajouter pauseLoop et resumeLoop**

Remplacer ce bloc par :

```javascript
window.MosqueScene = {
  scene, camera, renderer, controls,
  viewOverview, viewTarget,
  get domeRadius(){ return domeR; },
  flyTo,
  setGameUpdate(fn){ gameUpdate = (typeof fn === 'function') ? fn : null; },
  pauseLoop()  { cancelAnimationFrame(raf); raf = 0; },
  resumeLoop() { if (!raf) tick(); },
};
```

- [ ] **Step 3 : Commiter**

```bash
git add app/mosque-viewer.js
git commit -m "MosqueScene : expose pauseLoop/resumeLoop pour le mode AR"
```

---

## Task 4 : Créer app/ar-mode.js

**Files:**
- Create: `app/ar-mode.js`

- [ ] **Step 1 : Créer le fichier**

Créer `app/ar-mode.js` :

```javascript
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL    = 'assets/models/djenne-mosque-only.glb';
const INITIAL_SCALE = 0.08;
const SCALE_MIN    = 0.02;
const SCALE_MAX    = 0.5;

/* ---------- État module ---------- */
let _renderer = null;
let _scene    = null;
let _camera   = null;
let _session  = null;
let _hitTestSource = null;
let _mosque   = null;   // THREE.Group chargé depuis le GLB
let _reticle  = null;   // anneau de ciblage sol
let _placed   = false;

/* ---------- Gestes ---------- */
const _ptrs       = new Map();
let _lastPinchDist = null;

/* ---------- DOM ---------- */
let _overlay = null;
let _hintEl  = null;

/* ========== API publique ========== */

export async function enter() {
  if (!navigator.xr) { _toast('AR non disponible sur cet appareil'); return; }

  const supported = await navigator.xr
    .isSessionSupported('immersive-ar')
    .catch(() => false);
  if (!supported) { _toast('AR non disponible sur cet appareil'); return; }

  _renderer = window.MosqueScene.renderer;
  _scene    = window.MosqueScene.scene;
  _camera   = window.MosqueScene.camera;

  window.MosqueScene.pauseLoop();
  window.MosqueScene.controls.enabled = false;

  try {
    await _loadModel();
    await _startSession();
  } catch (err) {
    console.error('[AR]', err);
    _toast('Impossible de démarrer la session AR');
    _exit();
  }
}

/* ========== Privé ========== */

function _loadModel() {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        _mosque = gltf.scene;
        _mosque.scale.setScalar(INITIAL_SCALE);
        _mosque.visible = false;
        _scene.add(_mosque);
        resolve();
      },
      undefined,
      (err) => { _toast('Erreur de chargement du modèle AR'); reject(err); }
    );
  });
}

async function _startSession() {
  _session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: document.getElementById('arOverlay') },
  });
  _session.addEventListener('end', _exit);

  _renderer.xr.enabled = true;
  await _renderer.xr.setSession(_session);

  const viewerSpace    = await _session.requestReferenceSpace('viewer');
  _hitTestSource       = await _session.requestHitTestSource({ space: viewerSpace });

  _buildReticle();
  _setupGestures();
  _showOverlay();
  _renderer.setAnimationLoop(_onXRFrame);
}

function _buildReticle() {
  const geo = new THREE.RingGeometry(0.1, 0.13, 32);
  geo.rotateX(-Math.PI / 2);
  _reticle = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color: 0xf9d58b, side: THREE.DoubleSide })
  );
  _reticle.matrixAutoUpdate = false;
  _reticle.visible = false;
  _scene.add(_reticle);
}

function _onXRFrame(t, frame) {
  if (!frame) return;
  const refSpace = _renderer.xr.getReferenceSpace();
  const hits     = frame.getHitTestResults(_hitTestSource);

  if (!_placed) {
    if (hits.length > 0) {
      const pose = hits[0].getPose(refSpace);
      _reticle.matrix.fromArray(pose.transform.matrix);
      _reticle.visible = true;
    } else {
      _reticle.visible = false;
    }
  }

  _renderer.render(_scene, _camera);
}

function _onTap() {
  if (_placed || !_reticle.visible) return;
  _placed = true;
  _mosque.position.setFromMatrixPosition(_reticle.matrix);
  _mosque.visible = true;
  _reticle.visible = false;
  _setHint('Pincez pour redimensionner · Marchez autour pour explorer');
  setTimeout(() => { if (_hintEl) _hintEl.style.opacity = '0'; }, 4000);
}

function _setupGestures() {
  const el = _renderer.domElement;
  el.addEventListener('pointerdown',   _onPtrDown,   { passive: true });
  el.addEventListener('pointermove',   _onPtrMove,   { passive: true });
  el.addEventListener('pointerup',     _onPtrUp,     { passive: true });
  el.addEventListener('pointercancel', _onPtrUp,     { passive: true });
}

function _teardownGestures() {
  const el = _renderer.domElement;
  el.removeEventListener('pointerdown',   _onPtrDown);
  el.removeEventListener('pointermove',   _onPtrMove);
  el.removeEventListener('pointerup',     _onPtrUp);
  el.removeEventListener('pointercancel', _onPtrUp);
}

function _onPtrDown(e) {
  _ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (_ptrs.size === 1) _onTap();
}

function _onPtrMove(e) {
  if (!_placed) return;
  const prev = _ptrs.get(e.pointerId);
  _ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (_ptrs.size === 2) {
    // Pinch → scale
    const pts  = [..._ptrs.values()];
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    if (_lastPinchDist !== null) {
      const ratio = dist / _lastPinchDist;
      const s = THREE.MathUtils.clamp(_mosque.scale.x * ratio, SCALE_MIN, SCALE_MAX);
      _mosque.scale.setScalar(s);
    }
    _lastPinchDist = dist;
  } else if (_ptrs.size === 1 && prev) {
    // Un doigt → rotation Y
    _mosque.rotation.y += (e.clientX - prev.x) * 0.01;
  }
}

function _onPtrUp(e) {
  _ptrs.delete(e.pointerId);
  if (_ptrs.size < 2) _lastPinchDist = null;
}

function _showOverlay() {
  _overlay = document.getElementById('arOverlay');
  _hintEl  = document.getElementById('arHint');
  document.getElementById('arQuit').onclick = () => _session?.end();
  _overlay.removeAttribute('aria-hidden');
  _setHint('Pointez vers un sol plat · Appuyez pour poser la mosquée');
}

function _setHint(text) {
  if (!_hintEl) return;
  _hintEl.style.opacity = '1';
  _hintEl.textContent = text;
}

function _toast(msg) {
  const stage = document.getElementById('mosqueStage');
  if (!stage) return;
  const el = document.createElement('div');
  el.className = 'mq-toast';
  el.textContent = msg;
  stage.appendChild(el);
  void el.offsetWidth;
  el.classList.add('visible');
  setTimeout(() => el.remove(), 3500);
}

function _exit() {
  _renderer.setAnimationLoop(null);
  _renderer.xr.enabled = false;
  _teardownGestures();

  if (_mosque)  { _scene.remove(_mosque);  _mosque  = null; }
  if (_reticle) { _scene.remove(_reticle); _reticle = null; }
  _hitTestSource = null;
  _session       = null;
  _placed        = false;
  _ptrs.clear();
  _lastPinchDist = null;

  _overlay?.setAttribute('aria-hidden', 'true');
  if (_hintEl) _hintEl.style.opacity = '0';

  // Restaurer le viewer
  window.MosqueScene.controls.enabled = true;
  window.MosqueScene.resumeLoop();
}
```

- [ ] **Step 2 : Commiter**

```bash
git add app/ar-mode.js
git commit -m "AR : module ar-mode.js — WebXR hit-test, placement, pinch/rotate"
```

---

## Task 5 : Brancher le bouton AR dans mosque-viewer.js

**Files:**
- Modify: `app/mosque-viewer.js` lignes ~851-854

- [ ] **Step 1 : Remplacer le handler du bouton AR**

Trouver ce bloc dans `mosque-viewer.js` :

```javascript
if (btnAr) btnAr.addEventListener('click', () => {
  toast('Mode AR · bientôt disponible');
  window.dispatchEvent(new CustomEvent('mosque:action', { detail: 'ar' }));
});
```

Le remplacer par :

```javascript
if (btnAr) btnAr.addEventListener('click', () => {
  import('./ar-mode.js').then(mod => mod.enter());
});
```

- [ ] **Step 2 : Commiter**

```bash
git add app/mosque-viewer.js
git commit -m "AR : bouton AR branche sur ar-mode.enter() via import dynamique"
```

---

## Task 6 : Vérification manuelle sur Android

- [ ] **Step 1 : Démarrer le serveur de développement**

```bash
npm run dev
```

Le terminal affiche l'URL locale (ex : `http://localhost:5173`).

- [ ] **Step 2 : Exposer via ngrok ou réseau local**

Pour tester WebXR sur un vrai appareil Android, le site doit être en HTTPS ou `localhost`. Utiliser le partage réseau de Vite ou ngrok :

```bash
# Optionnel si le téléphone est sur le même Wi-Fi :
npm run dev -- --host
```

Ouvrir l'URL affichée (ex : `http://192.168.x.x:5173`) sur Chrome Android.

- [ ] **Step 3 : Vérifier le flow complet**

Checklist à valider sur l'appareil Android (Chrome) :
- [ ] Le bouton AR est visible dans la vue mosque
- [ ] Clic AR → Chrome demande la permission caméra
- [ ] Après accord → vue caméra réelle en fond
- [ ] Le reticule doré apparaît sur le sol pointé
- [ ] Tap → la mosquée se pose à l'emplacement du reticule
- [ ] Le hint "Pincez pour redimensionner…" s'affiche puis disparaît en 4s
- [ ] Pinch 2 doigts → la mosquée se redimensionne
- [ ] Un doigt horizontal → la mosquée tourne
- [ ] Bouton ✕ → retour à la vue 3D mosque normale

- [ ] **Step 4 : Vérifier sur un navigateur desktop sans WebXR**

Ouvrir l'app sur Chrome desktop, cliquer AR.
Résultat attendu : toast "AR non disponible sur cet appareil".

- [ ] **Step 5 : Commit final si tout est OK**

```bash
git add -A
git commit -m "AR Android : mode complet — hit-test, maquette de table, pinch/rotate, overlay UI"
```
