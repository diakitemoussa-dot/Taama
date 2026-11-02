# Mode Sanctuaire — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un mode "Sanctuaire" de visite intérieure FPS de la Mosquée de Djenné — entrée par animation caméra via la porte principale, marche libre avec collisions BVH, joystick unique + drag-to-look, HUD glassmorphism.

**Architecture:** Nouveau module `app/sanctuary-mode.js` (même patron que `drone-game.js`) — expose `window.SanctuaryMode = { enter, exit, isActive }`. Le bouton SANCTUAIRE dans `mosque-viewer.js` appelle `SanctuaryMode.enter()`. Le module s'accroche dans la boucle de rendu via `M.setGameUpdate(update)`. L'animation d'entrée est un lerp 2 segments : position courante → devant la porte → position intérieure de départ. Le FPS utilise `camera.rotation.order = 'YXZ'`, un joystick unique et un drag-to-look sur le canvas.

**Tech Stack:** Three.js 0.165, three-mesh-bvh 0.7.8 (déjà dans l'importmap), ES Modules, CSS custom properties

---

## Fichiers touchés

| Action | Fichier | Responsabilité |
|--------|---------|----------------|
| Créer | `app/sanctuary-mode.js` | Module FPS complet (animation, collisions, contrôles, HUD tick) |
| Créer | `styles/sanctuary.css` | Styles du HUD Sanctuaire (glassmorphism, stick, compass, toolbar) |
| Modifier | `index.html` | Ajouter `<div id="sanctuaryHud">`, `<link>` CSS, `<script>` module |
| Modifier | `app/mosque-viewer.js` | Exposer `flyTo` dans `window.MosqueScene`, brancher `btnInterior` |

---

## Task 1 : HTML — sanctuaryHud + liens

**Files:**
- Modify: `index.html`

- [ ] **Step 1 : Ajouter le lien CSS sanctuary juste après drone-game.css**

Dans `index.html` ligne 18, après `<link rel="stylesheet" href="styles/drone-game.css?v=3" />` :

```html
<link rel="stylesheet" href="styles/sanctuary.css?v=1" />
```

- [ ] **Step 2 : Insérer le HTML du HUD Sanctuaire**

Dans `index.html`, juste après la balise fermante `</div>` du `droneRotate` (ligne ~583, avant `</div><!-- /mosqueStage -->`), insérer :

```html
      <!-- ===== HUD du mode Sanctuaire (visite intérieure FPS) ===== -->
      <div id="sanctuaryHud" class="sn-hud" aria-hidden="true">

        <!-- Haut gauche : boussole -->
        <div class="sn-compass">
          <svg class="sn-compass-svg" viewBox="0 0 80 80" aria-hidden="true">
            <circle cx="40" cy="40" r="36" fill="none" stroke="#f9d58b" stroke-width="1" opacity=".6"/>
            <g stroke="#f9d58b" stroke-width="1">
              <line x1="40" y1="4"  x2="40" y2="12"/>
              <line x1="40" y1="68" x2="40" y2="76"/>
              <line x1="4"  y1="40" x2="12" y2="40"/>
              <line x1="68" y1="40" x2="76" y2="40"/>
            </g>
            <g id="snFan" class="sn-compass-needle">
              <polygon points="40,14 37,40 43,40" fill="#f9d58b"/>
              <polygon points="40,66 37,40 43,40" fill="#f9d58b" opacity=".3"/>
            </g>
            <text x="40" y="3"  text-anchor="middle" font-size="5" fill="#f9d58b">N</text>
          </svg>
        </div>

        <!-- Haut droit : bouton quitter -->
        <button type="button" class="sn-quit" id="snQuit" aria-label="Quitter le mode Sanctuaire">↩</button>

        <!-- Joystick unique — bas droit -->
        <div class="sn-stick" id="snStick">
          <i class="sn-stick-knob"></i>
        </div>

        <!-- Barre d'actions — bas centre -->
        <div class="sn-toolbar">
          <button type="button" class="sn-tool" id="snAvatar"  aria-label="Personnage">🧍</button>
          <button type="button" class="sn-tool" id="snLamp"    aria-label="Lampe torche">💡</button>
          <button type="button" class="sn-tool" id="snPhoto"   aria-label="Capture d'écran">📷</button>
          <button type="button" class="sn-tool" id="snMenu"    aria-label="Menu">☰</button>
          <button type="button" class="sn-tool" id="snVideo"   aria-label="Vidéo">🎥</button>
        </div>

      </div>
```

- [ ] **Step 3 : Ajouter la balise script sanctuary-mode.js**

Dans `index.html`, juste après `<script type="module" src="app/drone-game.js?v=3"></script>` (ligne ~591) :

```html
  <script type="module" src="app/sanctuary-mode.js?v=1"></script>
```

- [ ] **Step 4 : Vérifier dans le navigateur que le HUD est bien dans le DOM**

Lancer le serveur : `node _serve.cjs` puis ouvrir `http://localhost:8123`.
Ouvrir la console DevTools → taper `document.getElementById('sanctuaryHud')`.
Résultat attendu : l'élément DOM est retourné (non null). La page ne doit pas afficher d'erreur rouge.

- [ ] **Step 5 : Commit**

```bash
git add index.html
git commit -m "feat(sanctuaire): HTML HUD + lien CSS + balise script"
```

---

## Task 2 : CSS — styles/sanctuary.css

**Files:**
- Create: `styles/sanctuary.css`

- [ ] **Step 1 : Créer le fichier CSS**

Créer `styles/sanctuary.css` avec le contenu suivant :

```css
/* ============================================================
   MODE SANCTUAIRE — HUD glassmorphism (même palette que drone)
   Variables héritées de drone-game.css via :root
   ============================================================ */

.sn-hud {
  position: fixed;
  inset: 0;
  z-index: 60;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity .3s;
}
.sn-hud button { pointer-events: auto; }
.sn-hud.is-on  { opacity: 1; visibility: visible; }

/* Ajustement iOS Safari (barre de nav visible) */
.sn-hud.sn-bar { bottom: auto; height: 100svh; }

/* ---------- Boussole (haut gauche) ---------- */
.sn-compass {
  position: absolute;
  top: 18px;
  left: 18px;
  width: 80px;
  height: 80px;
  background: rgba(85,65,93,.45);
  border: 1px solid rgba(249,213,139,.35);
  border-radius: 50%;
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.sn-compass-svg { width: 70px; height: 70px; }
.sn-compass-needle { transform-origin: 40px 40px; transition: transform .1s linear; }

/* ---------- Bouton quitter (haut droit) ---------- */
.sn-quit {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: 2px solid #c0392b;
  background: rgba(192,57,43,.25);
  color: #fff;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(6px);
  pointer-events: auto;
}
.sn-quit:hover { background: rgba(192,57,43,.65); }

/* ---------- Joystick unique (bas droit) ---------- */
.sn-stick {
  position: absolute;
  bottom: 24px;
  right: 24px;
  width: 150px;
  height: 150px;
  border-radius: 50%;
  background: rgba(85,65,93,.35);
  border: 1px solid rgba(249,213,139,.4);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  touch-action: none;
}
.sn-stick-knob {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  background: radial-gradient(circle at 38% 38%, rgba(249,213,139,.9), rgba(85,65,93,.8));
  border: 1px solid rgba(249,213,139,.6);
  pointer-events: none;
}

/* ---------- Barre d'actions (bas centre) ---------- */
.sn-toolbar {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 10px;
  background: rgba(85,65,93,.4);
  border: 1px solid rgba(249,213,139,.3);
  border-radius: 40px;
  padding: 8px 14px;
  backdrop-filter: blur(8px);
}
.sn-tool {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: 1px solid rgba(249,213,139,.5);
  background: rgba(85,65,93,.4);
  color: #f9d58b;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}
.sn-tool:hover    { background: rgba(249,213,139,.25); }
.sn-tool.is-active { background: #f9d58b; color: #55415d; }
```

- [ ] **Step 2 : Vérifier le style dans le navigateur**

Ouvrir DevTools → Console → taper :
```js
document.getElementById('sanctuaryHud').classList.add('is-on')
```
Le HUD doit apparaître avec la boussole en haut à gauche, le bouton ↩ en haut à droite, le joystick en bas à droite, et la barre d'actions en bas centre.

Retirer la classe après vérification :
```js
document.getElementById('sanctuaryHud').classList.remove('is-on')
```

- [ ] **Step 3 : Commit**

```bash
git add styles/sanctuary.css
git commit -m "feat(sanctuaire): CSS HUD glassmorphism"
```

---

## Task 3 : `sanctuary-mode.js` — squelette + window.SanctuaryMode

**Files:**
- Create: `app/sanctuary-mode.js`

- [ ] **Step 1 : Créer le module squelette**

Créer `app/sanctuary-mode.js` :

```js
/* ==========================================================
   MODE SANCTUAIRE — Visite intérieure FPS de la Mosquée de Djenné
   Dépend de window.MosqueScene exposé par mosque-viewer.js.
   ========================================================== */
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/* ---------- DOM ---------- */
const hud        = document.getElementById('sanctuaryHud');
const btnQuit    = document.getElementById('snQuit');
const compassNeedle = document.getElementById('snFan');
const btnLamp    = document.getElementById('snLamp');
const btnPhoto   = document.getElementById('snPhoto');
const joystick   = document.getElementById('snStick');

/* ---------- État global ---------- */
let active = false;
let M      = null;       // référence window.MosqueScene

/* ---------- Constantes de navigation ---------- */
const PLAYER_START   = new THREE.Vector3(-46.651, 1.7, 21.415);
const PLAYER_YAW0    = -Math.PI / 2;  // face vers -X (intérieur mosquée)

// Waypoints animation d'entrée — à ajuster visuellement si besoin
const DOOR_APPROACH  = new THREE.Vector3(-36, 8, 60);
const DOOR_LOOK_TGT  = new THREE.Vector3(-46, 3, 30);
const INTERIOR_LOOK  = new THREE.Vector3(-80, 1.7, 10);
const APPROACH_DUR   = 1.5;
const ENTER_DUR      = 1.0;

const WALK_SPEED     = 3.0;   // m/s
const LOOK_SENS      = 0.003; // rad/px
const MAX_PITCH      = Math.PI * 80 / 180;  // ±80°
const REALIGN_RATE   = 5;     // rad/s
const CAPSULE_R      = 0.3;   // rayon capsule joueur (m)
const EYE_HEIGHT     = 1.7;   // hauteur yeux (m)

/* ---------- États d'animation ---------- */
const S_IDLE     = 0;
const S_APPROACH = 1;
const S_ENTER    = 2;
const S_FPS      = 3;
let state = S_IDLE;
let animT = 0;
const animCamStart    = new THREE.Vector3();
const animLookStart   = new THREE.Vector3();

/* ---------- Position joueur + caméra FPS ---------- */
const playerPos   = new THREE.Vector3();
let playerYaw     = PLAYER_YAW0;
let playerPitch   = 0;

/* ---------- Entrées joystick ---------- */
const joyInput = { x: 0, y: 0 };  // x=strafe, y=fwd (-1=avant)

/* ---------- Entrées clavier ---------- */
const keys = { w: false, a: false, s: false, d: false };

/* ---------- Drag-to-look ---------- */
let _lookId = null, _lookX = 0, _lookY = 0;

/* ---------- Collisions ---------- */
let colliders = null;
const raycaster    = new THREE.Raycaster();
const _down        = new THREE.Vector3(0, -1, 0);
const _fwd         = new THREE.Vector3();
const _side        = new THREE.Vector3();
const _move        = new THREE.Vector3();
const _moveDir     = new THREE.Vector3();
const _wallNormal  = new THREE.Vector3();
const _tang        = new THREE.Vector3();
const _nMat        = new THREE.Matrix3();
const _rayOrigin   = new THREE.Vector3();
const _tmpA        = new THREE.Vector3();
const _tmpB        = new THREE.Vector3();

/* ---------- Éclairage ---------- */
let ambLight   = null;
let pointLight = null;
let lampOn     = true;

/* ---------- HUD ---------- */
let hudAccum = 0;
let _controlsInited = false;

/* --------------------------------------------------------- */

function isActive() { return active; }

function showHud() {
  hud.classList.add('is-on');
  hud.setAttribute('aria-hidden', 'false');
  // iOS bar
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  if (isIOS && !standalone) hud.classList.add('sn-bar');
}

function hideHud() {
  hud.classList.remove('is-on');
  hud.setAttribute('aria-hidden', 'true');
}

/* --------------------------------------------------------- */

function enter() {
  if (active) return;
  M = window.MosqueScene;
  if (!M) return;
  active = true;

  // Mémorise la position courante de la caméra pour l'animation d'approche
  animCamStart.copy(M.camera.position);
  animLookStart.copy(M.controls.target);
  animT  = 0;
  state  = S_APPROACH;

  // Désactive OrbitControls et masque l'UI principale
  M.controls.enabled = false;
  document.querySelector('.mq-ui')?.classList.add('dg-hidden');

  // Construit les colliders si pas encore fait
  if (!colliders) buildColliders();

  // Éclairage intérieur
  if (!ambLight) {
    ambLight   = new THREE.AmbientLight(0xffeedd, 0.4);
    pointLight = new THREE.PointLight(0xffeedd, 1.2, 20);
    M.scene.add(ambLight);
    M.scene.add(pointLight);
  }
  ambLight.visible   = true;
  pointLight.visible = lampOn;

  // Accroche la boucle de rendu
  M.setGameUpdate(update);
}

function exit() {
  if (!active) return;
  active = false;
  state  = S_IDLE;
  joyInput.x = joyInput.y = 0;
  keys.w = keys.a = keys.s = keys.d = false;
  _lookId = null;

  // Lumières
  if (ambLight)   ambLight.visible   = false;
  if (pointLight) pointLight.visible = false;

  hideHud();
  M.setGameUpdate(null);
  document.querySelector('.mq-ui')?.classList.remove('dg-hidden');

  M.controls.enabled = true;
  M.controls.maxPolarAngle = Math.PI * 0.495;
  M.camera.position.copy(M.viewOverview);
  M.controls.target.copy(M.viewTarget);
  M.controls.update();
}

/* --------------------------------------------------------- */

window.SanctuaryMode = { enter, exit, isActive };
```

- [ ] **Step 2 : Vérifier que le module charge sans erreur**

Recharger `http://localhost:8123`.
Console → taper `window.SanctuaryMode`.
Résultat attendu : `{ enter: ƒ, exit: ƒ, isActive: ƒ }`.
Pas d'erreur dans la console.

- [ ] **Step 3 : Commit**

```bash
git add app/sanctuary-mode.js
git commit -m "feat(sanctuaire): squelette module + window.SanctuaryMode"
```

---

## Task 4 : Brancher `btnInterior` dans `mosque-viewer.js`

**Files:**
- Modify: `app/mosque-viewer.js`

- [ ] **Step 1 : Trouver le handler btnInterior (ligne ~771)**

La ligne actuelle est :
```js
if (btnInterior) btnInterior.addEventListener('click', () => {
  if (!loaded) return;
  hideInfo();
  setGlow([]);
  setMode(btnInterior);
  controls.enabled = true;
  controls.maxPolarAngle = Math.PI * 0.495;          // rétablit la limite anti-sol
  flyTo(viewInterior, viewTarget, 1.8);              // approche de la mosquée
  window.dispatchEvent(new CustomEvent('mosque:action', { detail: 'interior' }));
});
```

Remplacer par :
```js
if (btnInterior) btnInterior.addEventListener('click', () => {
  if (!loaded) return;
  if (window.SanctuaryMode) {
    hideInfo();
    setGlow([]);
    setMode(btnInterior);
    window.SanctuaryMode.enter();
    return;
  }
  // Repli si sanctuary-mode.js absent
  hideInfo();
  setGlow([]);
  setMode(btnInterior);
  controls.enabled = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  flyTo(viewInterior, viewTarget, 1.8);
  window.dispatchEvent(new CustomEvent('mosque:action', { detail: 'interior' }));
});
```

- [ ] **Step 2 : Exposer `flyTo` dans window.MosqueScene (optionnel — pour animation en 2 temps)**

Trouver `window.MosqueScene = {` (ligne ~455), ajouter `flyTo` :
```js
window.MosqueScene = {
  scene, camera, renderer, controls,
  viewOverview, viewTarget,
  get domeRadius(){ return domeR; },
  flyTo,
  setGameUpdate(fn){ gameUpdate = (typeof fn === 'function') ? fn : null; },
};
```

- [ ] **Step 3 : Vérifier dans le navigateur**

Recharger. Cliquer sur le bouton SANCTUAIRE dans l'interface.
Résultat attendu :
- L'UI principale disparaît (`dg-hidden`)
- La console ne montre pas d'erreur
- `window.SanctuaryMode.isActive()` retourne `true`

- [ ] **Step 4 : Commit**

```bash
git add app/mosque-viewer.js
git commit -m "feat(sanctuaire): branchement btnInterior → SanctuaryMode.enter()"
```

---

## Task 5 : BVH — `buildColliders()`

**Files:**
- Modify: `app/sanctuary-mode.js`

- [ ] **Step 1 : Ajouter `buildColliders()` dans sanctuary-mode.js**

Insérer après la déclaration de `colliders = null` :

```js
function buildColliders() {
  colliders = [];
  M.scene.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.name || '';
    if (/Cloud|Sky|Sphere/i.test(n)) return;   // exclut ciel/nuages/dôme
    if (o.geometry && !o.geometry.boundsTree) {
      o.geometry.computeBoundsTree();           // BVH (O(log n) raycast)
    }
    colliders.push(o);
  });
}
```

Ajouter aussi les fonctions utilitaires de collision :

```js
/* Distance libre dans la direction `dir` depuis `playerPos`, sur CAPSULE_R de largeur.
   Renvoie Infinity si aucun obstacle. */
function clearDist(dir, maxLen) {
  const perp = _tmpA.set(-dir.z, 0, dir.x);
  if (perp.lengthSq() > 1e-9) perp.normalize();
  let min = Infinity;
  for (let i = -1; i <= 1; i++) {
    _rayOrigin.copy(playerPos).addScaledVector(perp, i * CAPSULE_R);
    raycaster.set(_rayOrigin, dir);
    raycaster.far = maxLen;
    const h = raycaster.intersectObjects(colliders, false);
    if (h.length && h[0].distance < min) min = h[0].distance;
  }
  return min;
}

/* Sol sous le joueur (raycast vers le bas depuis les yeux). Retourne y du sol ou -Infinity. */
function groundUnder() {
  _rayOrigin.copy(playerPos);
  raycaster.set(_rayOrigin, _down);
  raycaster.far = EYE_HEIGHT + 2;
  const h = raycaster.intersectObjects(colliders, false);
  return h.length ? h[0].point.y + EYE_HEIGHT : -Infinity;
}

/* Déplace playerPos en appliquant _move*dt avec glissement le long des murs. */
function movePlayer(dt) {
  const dist = _move.length() * dt;
  if (dist < 1e-4) return;
  _moveDir.copy(_move).normalize();

  const fwdDist = clearDist(_moveDir, dist + CAPSULE_R);
  const allowed = fwdDist === Infinity
    ? dist
    : Math.min(dist, Math.max(0, fwdDist - CAPSULE_R));
  playerPos.addScaledVector(_moveDir, allowed);

  const remain = dist - allowed;
  if (remain < 1e-3 || fwdDist === Infinity) return;

  // Normale du mur → tangente de glissement
  _rayOrigin.copy(playerPos);
  raycaster.set(_rayOrigin, _moveDir);
  raycaster.far = CAPSULE_R + remain + 1;
  const hits = raycaster.intersectObjects(colliders, false);
  if (!hits.length || !hits[0].face) return;

  _nMat.getNormalMatrix(hits[0].object.matrixWorld);
  _wallNormal.copy(hits[0].face.normal).applyMatrix3(_nMat);
  _wallNormal.y = 0;
  if (_wallNormal.lengthSq() < 1e-6) return;
  _wallNormal.normalize();

  _tang.copy(_moveDir).addScaledVector(_wallNormal, -_moveDir.dot(_wallNormal));
  _tang.y = 0;
  const tl = _tang.length();
  if (tl < 1e-4) return;
  _tang.multiplyScalar(1 / tl);

  const tangDist = clearDist(_tang, remain + CAPSULE_R);
  const slide    = tangDist === Infinity
    ? remain
    : Math.max(0, tangDist - CAPSULE_R);
  playerPos.addScaledVector(_tang, Math.min(remain, slide));
}
```

- [ ] **Step 2 : Vérifier que le build ne plante pas**

Ouvrir DevTools, cliquer SANCTUAIRE.
Dans la console : `window.SanctuaryMode.isActive()` → `true`.
Aucune erreur de type "buildColliders is not defined".

- [ ] **Step 3 : Commit**

```bash
git add app/sanctuary-mode.js
git commit -m "feat(sanctuaire): BVH colliders + movePlayer + groundUnder"
```

---

## Task 6 : Animation d'entrée (approach → enter → FPS)

**Files:**
- Modify: `app/sanctuary-mode.js`

- [ ] **Step 1 : Ajouter `easeInOut()` et `update()` dans sanctuary-mode.js**

Insérer après les fonctions de collision :

```js
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/* ---------- Boucle principale ---------- */
function update(dt) {
  dt = Math.min(dt, 0.05);
  if (dt <= 0) return;

  if (state === S_APPROACH) {
    animT += dt / APPROACH_DUR;
    if (animT >= 1) { animT = 0; state = S_ENTER; }
    const t = easeInOut(Math.min(animT, 1));
    M.camera.position.lerpVectors(animCamStart, DOOR_APPROACH, t);
    _tmpA.lerpVectors(animLookStart, DOOR_LOOK_TGT, t);
    M.camera.lookAt(_tmpA);
  }
  else if (state === S_ENTER) {
    animT += dt / ENTER_DUR;
    if (animT >= 1) {
      animT = 0;
      state = S_FPS;
      // Initialise le joueur à la position de départ
      playerPos.copy(PLAYER_START);
      playerYaw   = PLAYER_YAW0;
      playerPitch = 0;
      M.camera.rotation.order = 'YXZ';
      _initControls();
      showHud();
    }
    const t = easeInOut(Math.min(animT, 1));
    M.camera.position.lerpVectors(DOOR_APPROACH, PLAYER_START, t);
    _tmpA.lerpVectors(DOOR_LOOK_TGT, INTERIOR_LOOK, t);
    M.camera.lookAt(_tmpA);
  }
  else if (state === S_FPS) {
    tickFPS(dt);
  }

  M.renderer.render(M.scene, M.camera);
}

/* Espace réservé — tickFPS sera ajouté à la tâche suivante */
function tickFPS(dt) {
  M.camera.position.copy(playerPos);
  M.renderer.render(M.scene, M.camera);
}
```

- [ ] **Step 2 : Vérifier l'animation d'entrée dans le navigateur**

Recharger → cliquer SANCTUAIRE.
Résultat attendu :
- La caméra s'anime de sa position extérieure vers la position `DOOR_APPROACH` (~1.5s)
- Puis la caméra plonge vers l'intérieur de la mosquée (~1.0s)
- Le HUD Sanctuaire apparaît à la fin
- Pas de freeze/erreur dans la console

Si les waypoints `DOOR_APPROACH` / `DOOR_LOOK_TGT` ne sont pas bien positionnés, ajuster les valeurs `new THREE.Vector3(...)` dans les constantes jusqu'à ce que la caméra passe par la porte principale. Les valeurs initiales sont `(-36, 8, 60)` et `(-46, 3, 30)`.

- [ ] **Step 3 : Commit**

```bash
git add app/sanctuary-mode.js
git commit -m "feat(sanctuaire): animation d'entrée approach→enter→FPS"
```

---

## Task 7 : Contrôles FPS — joystick + drag-to-look + clavier

**Files:**
- Modify: `app/sanctuary-mode.js`

- [ ] **Step 1 : Ajouter `makeStick()` et `_initControls()`**

Insérer avant la fonction `enter()` :

```js
/* Joystick générique (knob + pointer capture) */
function makeStick(el, onMove) {
  const knob = el.querySelector('.sn-stick-knob');
  let id = null;
  const R = 48;
  const setVec = (cx, cy) => {
    const rect = el.getBoundingClientRect();
    let x = cx - (rect.left + rect.width  / 2);
    let y = cy - (rect.top  + rect.height / 2);
    const d = Math.hypot(x, y);
    if (d > R) { x = x / d * R; y = y / d * R; }
    knob.style.transform = `translate(${x}px,${y}px)`;
    onMove(x / R, y / R);
  };
  const reset = () => { knob.style.transform = 'translate(0,0)'; onMove(0, 0); };
  el.addEventListener('pointerdown',   (e) => { id = e.pointerId; el.setPointerCapture(id); setVec(e.clientX, e.clientY); });
  el.addEventListener('pointermove',   (e) => { if (e.pointerId === id) setVec(e.clientX, e.clientY); });
  el.addEventListener('pointerup',     (e) => { if (e.pointerId === id) { id = null; reset(); } });
  el.addEventListener('pointercancel', (e) => { if (e.pointerId === id) { id = null; reset(); } });
}

function _initControls() {
  if (_controlsInited) return;
  _controlsInited = true;

  const canvas = M.renderer.domElement;

  /* --- Drag-to-look (canvas) --- */
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== S_FPS) return;
    if (_lookId !== null) return;
    _lookId = e.pointerId;
    _lookX  = e.clientX;
    _lookY  = e.clientY;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== _lookId) return;
    const dx = e.clientX - _lookX;
    const dy = e.clientY - _lookY;
    _lookX = e.clientX;
    _lookY = e.clientY;
    playerYaw   -= dx * LOOK_SENS;
    playerPitch -= dy * LOOK_SENS;
    playerPitch  = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, playerPitch));
  });
  const relLook = (e) => { if (e.pointerId === _lookId) _lookId = null; };
  canvas.addEventListener('pointerup',     relLook);
  canvas.addEventListener('pointercancel', relLook);

  /* --- Clavier --- */
  window.addEventListener('keydown', (e) => {
    if (state !== S_FPS) return;
    const k = e.key.toLowerCase();
    if (k === 'z' || k === 'arrowup')    { keys.w = true; e.preventDefault(); }
    if (k === 's' || k === 'arrowdown')  { keys.s = true; e.preventDefault(); }
    if (k === 'q' || k === 'arrowleft')  { keys.a = true; e.preventDefault(); }
    if (k === 'd' || k === 'arrowright') { keys.d = true; e.preventDefault(); }
    if (k === 'escape') exit();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'z' || k === 'arrowup')    keys.w = false;
    if (k === 's' || k === 'arrowdown')  keys.s = false;
    if (k === 'q' || k === 'arrowleft')  keys.a = false;
    if (k === 'd' || k === 'arrowright') keys.d = false;
  });

  /* --- Joystick --- */
  makeStick(joystick, (x, y) => { joyInput.x = x; joyInput.y = y; });

  /* --- Boutons toolbar --- */
  btnQuit?.addEventListener('click', exit);

  btnLamp?.addEventListener('click', () => {
    lampOn = !lampOn;
    if (pointLight) pointLight.visible = lampOn;
    btnLamp.classList.toggle('is-active', lampOn);
  });

  btnPhoto?.addEventListener('click', () => {
    M.renderer.render(M.scene, M.camera);
    const url = M.renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `djenne-sanctuaire.png`;
    a.click();
  });
}
```

- [ ] **Step 2 : Vérifier joystick + drag-to-look**

Recharger → entrer en mode Sanctuaire → attendre la fin de l'animation.
- Glisser le doigt/la souris sur l'écran : la caméra tourne (yaw + pitch).
- Bouger le joystick : les valeurs dans `joyInput` changent (vérifier en console : `window._joy = window.SanctuaryMode` puis ouvrir le source pour confirmer).
- Toucher le joystick ne doit PAS faire tourner la caméra (drag-to-look ne se déclenche pas sur le joystick).
- `Echap` doit quitter le mode.

- [ ] **Step 3 : Commit**

```bash
git add app/sanctuary-mode.js
git commit -m "feat(sanctuaire): contrôles FPS — joystick + drag-to-look + clavier"
```

---

## Task 8 : Mouvement + collisions dans `tickFPS()`

**Files:**
- Modify: `app/sanctuary-mode.js`

- [ ] **Step 1 : Remplacer le stub `tickFPS()` par l'implémentation complète**

Remplacer la fonction stub :
```js
/* Espace réservé — tickFPS sera ajouté à la tâche suivante */
function tickFPS(dt) {
  M.camera.position.copy(playerPos);
  M.renderer.render(M.scene, M.camera);
}
```

Par :
```js
function tickFPS(dt) {
  /* 1. Vecteurs monde depuis le yaw du joueur (horizontal uniquement) */
  _fwd.set( Math.sin(playerYaw), 0, Math.cos(playerYaw));   // avant (−Z local → monde)
  _side.set(_fwd.z, 0, -_fwd.x);                            // droite

  /* 2. Cumul des entrées (joystick + clavier) */
  const mx = joyInput.x + (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  const mz = joyInput.y + (keys.s ? 1 : 0) - (keys.w ? -1 : 0);
  //   joyInput.y < 0 → avant ; keys.w → avant (−1 pour avancer)

  _move.set(0, 0, 0)
    .addScaledVector(_fwd,  -mz * WALK_SPEED)   // avance en face
    .addScaledVector(_side,  mx * WALK_SPEED);  // strafe
  _move.y = 0;

  /* 3. Réalignement auto du pitch quand on avance */
  if (mz < -0.4) {
    playerPitch += (0 - playerPitch) * Math.min(1, REALIGN_RATE * dt);
  }

  /* 4. Déplacement avec collisions */
  if (!colliders) buildColliders();
  if (_move.lengthSq() > 1e-6) movePlayer(dt);

  /* 5. Colle le joueur au sol */
  const floorY = groundUnder();
  if (floorY > -Infinity) {
    if (playerPos.y < floorY)                playerPos.y = floorY;
    if (playerPos.y - floorY < 0.5)         playerPos.y = floorY; // colle aux petites marches
  } else {
    // Hors maquette : plancher de secours
    const fallback = M.viewTarget.y + 1.7;
    if (playerPos.y < fallback) playerPos.y = fallback;
  }

  /* 6. Applique position + orientation caméra */
  M.camera.position.copy(playerPos);
  if (pointLight) pointLight.position.copy(playerPos);
  M.camera.rotation.order = 'YXZ';
  M.camera.rotation.y     = playerYaw;
  M.camera.rotation.x     = playerPitch;
  M.camera.rotation.z     = 0;

  /* 7. HUD boussole ~10x/s */
  hudAccum += dt;
  if (hudAccum > 0.1) {
    hudAccum = 0;
    if (compassNeedle) {
      const deg = ((THREE.MathUtils.radToDeg(-playerYaw) % 360) + 360) % 360;
      compassNeedle.style.transform = `rotate(${deg}deg)`;
    }
  }
}
```

- [ ] **Step 2 : Vérifier le déplacement dans le navigateur**

Entrer en mode Sanctuaire → fin de l'animation.
- Joystick vers l'avant : le joueur avance dans la direction où la caméra regarde.
- Joystick vers la gauche/droite : strafing.
- Le joueur reste sur le sol (ne flotte pas, ne passe pas sous le tapis).
- Marcher vers un mur doit stopper ou faire glisser le joueur le long du mur.
- En console : `window.SanctuaryMode.isActive()` → `true`.

Si le joueur flotte dans les airs : vérifier que `groundUnder()` retourne une valeur correcte en ajoutant temporairement `console.log(groundUnder())` dans `tickFPS`. Si aucun collider n'est trouvé sous le joueur, augmenter `raycaster.far` dans `groundUnder()` à `EYE_HEIGHT + 5`.

- [ ] **Step 3 : Commit**

```bash
git add app/sanctuary-mode.js
git commit -m "feat(sanctuaire): tickFPS — mouvement + collisions + sol"
```

---

## Task 9 : HUD — boussole + bouton retour + retour à la vue extérieure

**Files:**
- Modify: `app/sanctuary-mode.js`

Les boutons `btnQuit` et `btnLamp` sont déjà branchés dans `_initControls()` (Task 7). Cette tâche vérifie et finalise le comportement de sortie.

- [ ] **Step 1 : Vérifier que `exit()` ramène correctement à la vue extérieure**

Entrer en mode Sanctuaire → cliquer le bouton ↩.
Résultats attendus :
1. Le HUD Sanctuaire disparaît (`is-on` retiré).
2. L'UI principale réapparaît (`.mq-ui` sans `dg-hidden`).
3. La caméra revient à `viewOverview` (vue d'ensemble extérieure).
4. `OrbitControls` est réactivé (on peut orbiter autour de la mosquée).
5. `window.SanctuaryMode.isActive()` → `false`.

- [ ] **Step 2 : Vérifier la boussole pendant la marche**

En mode FPS, marcher en cercle. La flèche N de la boussole doit tourner dans le sens opposé à la rotation du joueur (si le joueur tourne à droite, la flèche N pivote vers la gauche).

Si la boussole ne tourne pas : vérifier que `compassNeedle = document.getElementById('snFan')` correspond bien à l'élément `<g id="snFan">` dans le SVG du HUD. Vérifier le `transform-origin` CSS du groupe SVG.

- [ ] **Step 3 : Vérifier la boussole CSS `transform-origin`**

Le groupe `<g id="snFan">` doit avoir son point de rotation au centre du SVG (40px, 40px). Ajouter dans `sanctuary.css` si absent :

```css
#snFan { transform-origin: 40px 40px; }
```

- [ ] **Step 4 : Commit**

```bash
git add app/sanctuary-mode.js styles/sanctuary.css
git commit -m "feat(sanctuaire): HUD boussole + retour vue extérieure validés"
```

---

## Task 10 : Éclairage intérieur + lampe + screenshot

**Files:**
- Modify: `app/sanctuary-mode.js`

L'éclairage et les boutons sont déjà dans les tâches précédentes. Cette tâche valide et affine les intensités.

- [ ] **Step 1 : Ajuster l'éclairage**

Les lumières sont créées dans `enter()`. Si l'intérieur est trop sombre, augmenter `ambLight` à `0.6`. Si trop clair, baisser à `0.3`. La `PointLight` est la lampe torche du HUD (toggle).

Les valeurs initiales dans `enter()` :
```js
ambLight   = new THREE.AmbientLight(0xffeedd, 0.4);
pointLight = new THREE.PointLight(0xffeedd, 1.2, 20);
```

Tester en entrant en mode Sanctuaire : l'intérieur doit être visible mais tamisé. La lampe (bouton 💡 activé) doit ajouter un cercle de lumière autour du joueur.

- [ ] **Step 2 : Vérifier la capture d'écran**

Cliquer le bouton 📷 en mode Sanctuaire.
Résultat attendu : un téléchargement de `djenne-sanctuaire.png` se déclenche.

Si le PNG est tout noir : le renderer utilise `preserveDrawingBuffer` non garanti. La ligne `M.renderer.render(M.scene, M.camera)` dans `btnPhoto` force un rendu frais avant `toDataURL()` — c'est déjà inclus dans `_initControls()`.

- [ ] **Step 3 : Tester le cycle enter/exit multiple fois**

Entrer en mode Sanctuaire → quitter → entrer de nouveau.
Résultat attendu :
- Pas de doublon de lumières dans la scène (guard `if (!ambLight)` dans `enter()`)
- Les contrôles sont toujours fonctionnels (guard `_controlsInited` dans `_initControls()`)
- Pas de fuite mémoire visible (pas d'accumulation d'event listeners)

- [ ] **Step 4 : Vérifier la compatibilité avec le mode GAME drone**

Entrer en mode GAME Drone → quitter → entrer en mode Sanctuaire → quitter.
Les deux modes ne doivent pas interférer. `setGameUpdate` ne peut avoir qu'un callback actif à la fois — `exit()` appelle `M.setGameUpdate(null)` avant de rendre le contrôle.

- [ ] **Step 5 : Commit final**

```bash
git add app/sanctuary-mode.js styles/sanctuary.css index.html app/mosque-viewer.js
git commit -m "feat(sanctuaire): mode FPS complet — éclairage + lampe + screenshot validés"
```

---

## Self-review

### Couverture de la spec

| Exigence spec | Tâche couverte |
|---|---|
| Nouveau module sanctuary-mode.js | Task 3 |
| Bouton SANCTUAIRE → enter() | Task 4 |
| Animation vol caméra par porte principale | Task 6 |
| BVH sur meshes intérieurs | Task 5 |
| Capsule joueur (rayon 0.3m, hauteur 1.7m) | Task 5 (movePlayer + groundUnder) |
| 1 joystick mobile (bas droite) | Task 7 |
| Drag-to-look (yaw + pitch) | Task 7 |
| Pitch ±80° | Task 7 (`MAX_PITCH`) |
| Réalignement pitch→0 quand avance | Task 8 (`REALIGN_RATE`) |
| Clavier ZQSD + flèches | Task 7 |
| Souris clic-drag | Task 7 (pointer events canvas) |
| Escape → exit | Task 7 |
| Boussole (yaw joueur) | Task 8 + Task 9 |
| Bouton retour ↩ → exit() | Task 7 + Task 9 |
| Barre d'actions (lampe, photo, etc.) | Task 7 |
| AmbientLight 0.4 + PointLight lampe | Task 10 |
| Position départ Three.js (-46.651, 1.7, 21.415) | Task 3 + Task 6 |
| Même style glassmorphism drone | Task 2 |

Toutes les exigences sont couvertes.

### Points de tuning visuel attendus

- Les waypoints `DOOR_APPROACH` et `DOOR_LOOK_TGT` sont des estimations à ajuster selon la position réelle de `Porte_Principale` dans la scène. Les modifier dans les constantes en haut de `sanctuary-mode.js` jusqu'à ce que la caméra entre naturellement par la porte.
- L'intensité des lumières (`0.4` / `1.2`) peut nécessiter un ajustement selon le mappage de textures du modèle.
