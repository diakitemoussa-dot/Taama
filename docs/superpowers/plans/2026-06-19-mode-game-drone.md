# Mode GAME — Pilotage de drone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le clic sur le bouton GAME bascule l'écran en paysage et ouvre une interface de pilotage de drone (HUD) permettant de visiter librement la maquette 3D de Djenné en caméra 3e personne.

**Architecture:** Un nouveau module `app/drone-game.js` gère le mode jeu (machine d'état, paysage, HUD, joysticks, vol, outils). `app/mosque-viewer.js` expose sa scène/caméra/renderer/contrôles via `window.MosqueScene` et un point d'accroche `setGameUpdate(fn)` dans sa boucle de rendu. Le HUD est du DOM superposé au canvas. Un « rig » (objet 3D vide) tient lieu de drone en attendant le modèle `drone.glb`.

**Tech Stack:** Three.js 0.165 (ES modules via import map), JavaScript vanilla, CSS. Pas de build, pas de framework de test. Serveur local : `node _serve.cjs` (port 8123). Vérification dans le navigateur (manuelle ou via Playwright MCP).

**Convention de vérification :** Il n'y a pas de runner de tests. Chaque tâche se vérifie en lançant le serveur puis en observant le comportement dans le navigateur. Lancer le serveur une seule fois en arrière-plan :
```bash
cd "mosquee-djenne" && node _serve.cjs   # sert http://localhost:8123
```
Pour atteindre rapidement la vue 3D sans rejouer l'intro : ouvrir la console du navigateur et appeler `window.startMosqueScene()` après chargement (la maquette se charge alors directement).

---

### Task 1 : Exposer la scène partagée + point d'accroche de boucle dans mosque-viewer.js

**Files:**
- Modify: `app/mosque-viewer.js`

- [ ] **Step 1 : Déclarer la variable de hook de jeu**

Dans `app/mosque-viewer.js`, juste après la ligne `const clock = new THREE.Clock();` (vers la ligne 377), ajouter :

```js
let gameUpdate = null;   // fonction(dt) fournie par drone-game.js quand le mode jeu est actif
```

- [ ] **Step 2 : Brancher le hook dans la boucle tick()**

Dans `tick()`, remplacer le bloc conditionnel actuel :

```js
  if (loaded && introT < introDur) {
```

par :

```js
  if (gameUpdate) {
    gameUpdate(dt);
  } else if (loaded && introT < introDur) {
```

Le reste du bloc (`introT += dt; ... } else { controls.update(); }`) est inchangé. Quand le mode jeu est actif, c'est `drone-game.js` qui pilote la caméra ; ni l'intro ni les OrbitControls ne tournent.

- [ ] **Step 3 : Exposer l'API partagée**

Juste après la définition de `window.startMosqueScene = () => {...};` (vers la ligne 425), ajouter :

```js
/* ---------- API partagée pour le mode jeu (drone-game.js) ---------- */
window.MosqueScene = {
  scene, camera, renderer, controls,
  viewOverview, viewTarget,
  get domeRadius(){ return domeR; },
  setGameUpdate(fn){ gameUpdate = (typeof fn === 'function') ? fn : null; },
};
```

(`domeR` et `viewOverview`/`viewTarget`/`viewInterior` existent déjà dans le fichier — voir lignes ~198-307.)

- [ ] **Step 4 : Déléguer le clic GAME au mode jeu**

Remplacer le corps du handler `if (btnGame) btnGame.addEventListener('click', () => {...});` (lignes ~712-721) par :

```js
if (btnGame) btnGame.addEventListener('click', () => {
  if (!loaded) return;
  if (window.DroneGame) { window.DroneGame.enter(); return; }   // mode jeu drone
  // Repli (si drone-game.js absent) : ancienne vue d'ensemble
  hideInfo();
  setGlow([]);
  setMode(btnGame);
  controls.enabled = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  flyTo(viewOverview, viewTarget, 1.8);
  window.dispatchEvent(new CustomEvent('mosque:action', { detail: 'game' }));
});
```

- [ ] **Step 5 : Vérifier dans le navigateur**

Lancer `node _serve.cjs`, ouvrir http://localhost:8123, console : `window.startMosqueScene()`. Dans la console, vérifier :
```js
window.MosqueScene.scene && window.MosqueScene.camera && typeof window.MosqueScene.setGameUpdate
```
Attendu : la scène, la caméra existent et `setGameUpdate` est une `"function"`. La scène 3D s'affiche normalement, le bouton GAME ne provoque pas d'erreur console (il fait encore l'ancienne vue car `window.DroneGame` n'existe pas encore).

- [ ] **Step 6 : Commit**

```bash
git add app/mosque-viewer.js
git commit -m "feat(game): expose MosqueScene API + hook de boucle pour le mode jeu"
```

---

### Task 2 : Markup du HUD + overlay rotation + styles (coquille visuelle)

**Files:**
- Modify: `index.html`
- Create: `styles/drone-game.css`

- [ ] **Step 1 : Lier la feuille de style**

Dans `index.html`, dans le `<head>` à côté des autres `<link>` CSS (chercher `styles/mosque.css`), ajouter :

```html
  <link rel="stylesheet" href="styles/drone-game.css" />
```

- [ ] **Step 2 : Ajouter le markup du HUD**

Dans `index.html`, juste avant la fermeture `</main>` (ligne ~515) et après le bloc `#mosqueVideo`/`</div>` qui ferme `#mosqueStage`, insérer le HUD comme enfant direct de `#mosqueStage`. Concrètement, insérer ce bloc juste avant la ligne `</div>` qui ferme `#mosqueStage` (la ligne 513, juste après `#mosqueVideo`) :

```html
      <!-- ===== HUD du mode jeu drone (caché par défaut) ===== -->
      <div id="droneHud" class="dg-hud" aria-hidden="true">
        <!-- Coin haut-gauche : boussole / radar -->
        <div class="dg-compass">
          <span class="dg-compass-deg" id="dgHeading">0°</span>
          <span class="dg-compass-eye" aria-hidden="true">◉</span>
          <i class="dg-compass-fan" id="dgFan"></i>
        </div>

        <!-- Coin haut-droit : batterie + signal + quitter -->
        <div class="dg-status">
          <span class="dg-batt" id="dgBatt">100%</span>
          <span class="dg-signal" id="dgSignal">▮▮▮▮</span>
          <button type="button" class="dg-quit" id="dgQuit" aria-label="Quitter le mode jeu">✕</button>
        </div>

        <!-- Réticule central + télémétrie -->
        <div class="dg-reticle">
          <div class="dg-tele">
            <span id="dgAngle">0.0°</span>
            <span id="dgSpeed">0 MPH</span>
            <span id="dgAlt">H : 0M</span>
          </div>
        </div>

        <!-- Joystick gauche : altitude + yaw -->
        <div class="dg-stick dg-stick--left" id="dgStickL">
          <span class="dg-stick-up">UP</span>
          <span class="dg-stick-down">DOWN</span>
          <i class="dg-stick-knob"></i>
        </div>

        <!-- Joystick droit : avance + latéral -->
        <div class="dg-stick dg-stick--right" id="dgStickR">
          <i class="dg-stick-knob"></i>
        </div>

        <!-- Barre d'outils -->
        <div class="dg-toolbar">
          <button type="button" class="dg-tool" id="dgGallery" aria-label="Galerie">⭕</button>
          <button type="button" class="dg-tool" id="dgLight" aria-label="Jour / nuit">💡</button>
          <button type="button" class="dg-tool" id="dgPhoto" aria-label="Photo">📷</button>
          <button type="button" class="dg-tool" id="dgList" aria-label="Points d'intérêt">☰</button>
          <button type="button" class="dg-tool" id="dgVideo" aria-label="Enregistrer une vidéo">🎥</button>
        </div>

        <!-- Panneau points d'intérêt (caché) -->
        <div class="dg-poi" id="dgPoi" hidden></div>

        <!-- Galerie photos (cachée) -->
        <div class="dg-galleryPanel" id="dgGalleryPanel" hidden></div>
      </div>

      <!-- ===== Overlay « tournez votre téléphone » (caché par défaut) ===== -->
      <div id="droneRotate" class="dg-rotate" aria-hidden="true">
        <div class="dg-rotate-ico">🔄</div>
        <p>Tournez votre téléphone<br>en mode paysage</p>
      </div>
```

- [ ] **Step 3 : Charger le module drone-game.js**

Dans `index.html`, après la ligne `<script type="module" src="app/mosque-viewer.js"></script>` (ligne ~519), ajouter :

```html
  <script type="module" src="app/drone-game.js"></script>
```

- [ ] **Step 4 : Créer les styles**

Créer `styles/drone-game.css` :

```css
/* ===== Mode jeu drone — HUD ===== */
:root{
  --dg-accent:#55415d;
  --dg-gold:#f9d58b;
  --dg-line: rgba(249,213,139,.85);
}

.dg-hud{ position:fixed; inset:0; z-index:60; pointer-events:none;
  font-family:'Rajdhani','Orbitron',sans-serif; color:var(--dg-gold);
  opacity:0; visibility:hidden; transition:opacity .3s; }
.dg-hud.is-on{ opacity:1; visibility:visible; }
.dg-hud button{ pointer-events:auto; }

/* Boussole */
.dg-compass{ position:absolute; top:18px; left:18px; width:120px; height:120px;
  border:2px solid var(--dg-line); border-radius:50%;
  display:flex; align-items:center; justify-content:center;
  background:rgba(85,65,93,.25); backdrop-filter:blur(4px); }
.dg-compass-deg{ position:absolute; left:8px; top:50%; font-size:13px; }
.dg-compass-eye{ font-size:20px; color:var(--dg-line); }
.dg-compass-fan{ position:absolute; inset:0; border-radius:50%;
  background:conic-gradient(from 0deg, rgba(249,213,139,.35) 0 45deg, transparent 45deg 360deg);
  transform-origin:center; }

/* Statut + quitter */
.dg-status{ position:absolute; top:18px; right:18px; display:flex; gap:12px; align-items:center;
  font-size:14px; }
.dg-quit{ width:38px; height:38px; border-radius:50%; border:2px solid var(--dg-line);
  background:rgba(85,65,93,.4); color:var(--dg-gold); font-size:16px; cursor:pointer; }
.dg-quit:hover{ background:var(--dg-accent); }

/* Réticule + télémétrie */
.dg-reticle{ position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
  width:180px; height:120px; border:1px solid rgba(249,213,139,.4);
  display:flex; align-items:center; justify-content:center; }
.dg-tele{ display:flex; flex-direction:column; gap:2px; font-size:13px; text-align:center;
  text-shadow:0 0 6px rgba(0,0,0,.6); }

/* Joysticks */
.dg-stick{ position:absolute; bottom:24px; width:150px; height:150px; border-radius:50%;
  border:2px solid var(--dg-line); background:rgba(85,65,93,.25);
  pointer-events:auto; touch-action:none;
  display:flex; align-items:center; justify-content:center; }
.dg-stick--left{ left:24px; }
.dg-stick--right{ right:24px; }
.dg-stick-knob{ width:54px; height:54px; border-radius:50%;
  background:rgba(249,213,139,.8); box-shadow:0 0 14px rgba(249,213,139,.6);
  transition:transform .05s; }
.dg-stick-up{ position:absolute; top:8px; font-size:12px; }
.dg-stick-down{ position:absolute; bottom:8px; font-size:12px; }

/* Barre d'outils */
.dg-toolbar{ position:absolute; bottom:18px; left:50%; transform:translateX(-50%);
  display:flex; gap:14px; padding:8px 16px; border-radius:40px;
  background:rgba(85,65,93,.4); backdrop-filter:blur(6px); }
.dg-tool{ width:46px; height:46px; border-radius:50%; border:1px solid var(--dg-line);
  background:transparent; color:var(--dg-gold); font-size:18px; cursor:pointer; }
.dg-tool:hover{ background:var(--dg-accent); }
.dg-tool.is-active{ background:var(--dg-gold); color:var(--dg-accent); }

/* Panneaux POI / galerie */
.dg-poi, .dg-galleryPanel{ position:absolute; right:18px; bottom:80px; width:240px;
  max-height:50%; overflow:auto; padding:12px; border:1px solid var(--dg-line);
  border-radius:10px; background:rgba(40,30,46,.92); pointer-events:auto; }
.dg-poi button{ display:block; width:100%; text-align:left; padding:8px;
  background:transparent; border:0; border-bottom:1px solid rgba(249,213,139,.2);
  color:var(--dg-gold); cursor:pointer; }
.dg-galleryPanel img{ width:100%; margin-bottom:8px; border-radius:6px; }

/* Overlay rotation */
.dg-rotate{ position:fixed; inset:0; z-index:70; display:none;
  flex-direction:column; align-items:center; justify-content:center; gap:18px;
  background:#281e2e; color:var(--dg-gold); text-align:center;
  font-family:'Rajdhani',sans-serif; font-size:22px; }
.dg-rotate.is-on{ display:flex; }
.dg-rotate-ico{ font-size:64px; animation:dg-spin 2s ease-in-out infinite; }
@keyframes dg-spin{ 0%,100%{ transform:rotate(0); } 50%{ transform:rotate(90deg); } }
```

- [ ] **Step 5 : Vérifier dans le navigateur**

Lancer le serveur, ouvrir http://localhost:8123, console : `window.startMosqueScene()`. Puis forcer l'affichage du HUD pour contrôle visuel :
```js
document.getElementById('droneHud').classList.add('is-on');
```
Attendu : la boussole (haut-gauche), le statut + ✕ (haut-droit), le réticule central, les deux joysticks (bas), la barre d'outils (bas-centre) s'affichent par-dessus la scène, aux couleurs du projet. Retirer ensuite la classe : `document.getElementById('droneHud').classList.remove('is-on')`.

- [ ] **Step 6 : Commit**

```bash
git add index.html styles/drone-game.css
git commit -m "feat(game): markup HUD + overlay rotation + styles du mode jeu"
```

---

### Task 3 : Module drone-game.js — état entrée/sortie + paysage + quitter

**Files:**
- Create: `app/drone-game.js`

- [ ] **Step 1 : Créer le squelette du module avec entrée/sortie et paysage**

Créer `app/drone-game.js` :

```js
/* ==========================================================
   MODE JEU — Pilotage de drone (vol libre dans la maquette)
   Dépend de window.MosqueScene exposé par mosque-viewer.js.
   ========================================================== */
import * as THREE from 'three';

const hud      = document.getElementById('droneHud');
const rotateEl = document.getElementById('droneRotate');
const btnQuit  = document.getElementById('dgQuit');

let active = false;
let M = null;                 // référence vers window.MosqueScene

/* ---------- Orientation paysage ---------- */
function isLandscape(){
  return window.matchMedia('(orientation: landscape)').matches;
}

async function goLandscape(){
  // Plein écran (requis pour le lock d'orientation sur Android)
  try { await document.documentElement.requestFullscreen(); } catch(_){}
  // Lock paysage (Android/Chrome ; absent sur iOS -> exception ignorée)
  try { await screen.orientation.lock('landscape'); } catch(_){}
  syncOrientationUi();
}

function syncOrientationUi(){
  if (!active) return;
  if (isLandscape()){
    rotateEl.classList.remove('is-on');
    rotateEl.setAttribute('aria-hidden','true');
    hud.classList.add('is-on');
    hud.setAttribute('aria-hidden','false');
  } else {
    // iOS / portrait : on masque le HUD et on demande de tourner le téléphone
    hud.classList.remove('is-on');
    rotateEl.classList.add('is-on');
    rotateEl.setAttribute('aria-hidden','false');
  }
}
window.addEventListener('orientationchange', syncOrientationUi);
window.addEventListener('resize', syncOrientationUi);

/* ---------- Entrée / sortie ---------- */
function enter(){
  if (active) return;
  M = window.MosqueScene;
  if (!M) return;
  active = true;

  // Masquer l'UI normale, couper les OrbitControls
  document.querySelector('.mq-ui')?.classList.add('dg-hidden');
  M.controls.enabled = false;

  goLandscape();
  syncOrientationUi();

  // (Le vol et la caméra sont branchés dans une tâche ultérieure)
  M.setGameUpdate(update);
}

function exit(){
  if (!active) return;
  active = false;

  M.setGameUpdate(null);
  hud.classList.remove('is-on');
  hud.setAttribute('aria-hidden','true');
  rotateEl.classList.remove('is-on');

  try { screen.orientation.unlock(); } catch(_){}
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch(_){}

  document.querySelector('.mq-ui')?.classList.remove('dg-hidden');
  M.controls.enabled = true;

  // Retour à la vue d'ensemble
  M.camera.position.set(M.viewOverview.x, M.viewOverview.y, M.viewOverview.z);
  M.camera.lookAt(M.viewTarget);
}

/* ---------- Boucle de vol (placeholder rempli plus tard) ---------- */
function update(dt){
  M.renderer.render(M.scene, M.camera);
}

btnQuit?.addEventListener('click', exit);

window.DroneGame = { enter, exit };
```

- [ ] **Step 2 : Ajouter la règle CSS de masquage de l'UI normale**

Dans `styles/drone-game.css`, ajouter à la fin :

```css
.mq-ui.dg-hidden{ display:none !important; }
```

- [ ] **Step 3 : Vérifier l'entrée/sortie dans le navigateur (desktop)**

Lancer le serveur, ouvrir http://localhost:8123, console : `window.startMosqueScene()`. Sur desktop l'orientation est toujours « landscape ». Cliquer le bouton **GAME**.
Attendu : l'UI normale (GAME/SANCTUAIRE, menu) disparaît, le HUD s'affiche, la scène reste rendue. Cliquer le **✕** : le HUD disparaît, l'UI normale revient, la caméra revient à la vue d'ensemble. Aucune erreur console.

- [ ] **Step 4 : Vérifier le repli portrait (simulation)**

Dans les DevTools, activer le mode appareil mobile en orientation portrait, recharger, `window.startMosqueScene()`, cliquer GAME.
Attendu : l'overlay « Tournez votre téléphone 🔄 » s'affiche ; en repassant l'émulateur en paysage, l'overlay disparaît et le HUD apparaît.

- [ ] **Step 5 : Commit**

```bash
git add app/drone-game.js styles/drone-game.css
git commit -m "feat(game): module drone-game avec entree/sortie + bascule paysage"
```

---

### Task 4 : Rig drone + caméra 3e personne + logique de vol

**Files:**
- Modify: `app/drone-game.js`

- [ ] **Step 1 : Ajouter le rig, l'état de vol et les entrées**

Dans `app/drone-game.js`, après la ligne `let M = null;`, ajouter :

```js
const rig = new THREE.Object3D();        // position + orientation (yaw) du drone
let rigAdded = false;

// Entrées normalisées -1..1 (gauche: lx=yaw, ly=altitude ; droite: rx=strafe, ry=avance)
const input = { lx:0, ly:0, rx:0, ry:0 };

// Vitesses (amorties) en unités/s
const vel = { fwd:0, side:0, up:0, yaw:0 };

// Réglages de vol (unités de la scène ; la maquette fait ~plusieurs centaines d'u.)
const SPEED   = 60;     // vitesse linéaire max
const UPSPEED = 40;     // vitesse verticale max
const YAWRATE = 1.4;    // rad/s de rotation max
const DAMP    = 4;      // amortissement (plus grand = plus réactif)

const _fwd  = new THREE.Vector3();
const _side = new THREE.Vector3();
const _camPos = new THREE.Vector3();
```

- [ ] **Step 2 : Initialiser le rig à l'entrée du mode jeu**

Dans `enter()`, juste après `active = true;`, ajouter :

```js
  if (!rigAdded){ M.scene.add(rig); rigAdded = true; }
  // Position de départ : au-dessus de la cible (mosquée), reculé un peu
  rig.position.set(M.viewTarget.x, M.viewTarget.y + 40, M.viewTarget.z + 120);
  rig.rotation.set(0, 0, 0);
  vel.fwd = vel.side = vel.up = vel.yaw = 0;
```

- [ ] **Step 3 : Implémenter la logique de vol dans update()**

Remplacer la fonction `update(dt)` placeholder par :

```js
function update(dt){
  dt = Math.min(dt, 0.05);   // borne pour éviter les sauts

  // Cibles depuis les entrées
  const tYaw  = -input.lx * YAWRATE;
  const tUp   = -input.ly * UPSPEED;     // ly<0 (haut) -> monter
  const tFwd  = -input.ry * SPEED;       // ry<0 (haut) -> avancer
  const tSide =  input.rx * SPEED;

  // Amortissement vers les cibles
  const k = Math.min(1, DAMP * dt);
  vel.yaw  += (tYaw  - vel.yaw ) * k;
  vel.up   += (tUp   - vel.up  ) * k;
  vel.fwd  += (tFwd  - vel.fwd ) * k;
  vel.side += (tSide - vel.side) * k;

  // Appliquer rotation (yaw)
  rig.rotation.y += vel.yaw * dt;

  // Directions monde
  _fwd.set(Math.sin(rig.rotation.y), 0, Math.cos(rig.rotation.y));   // avant = +Z local tourné
  _side.set(_fwd.z, 0, -_fwd.x);                                     // perpendiculaire

  rig.position.addScaledVector(_fwd,  -vel.fwd * dt);   // avancer vers -Z écran
  rig.position.addScaledVector(_side,  vel.side * dt);
  rig.position.y += vel.up * dt;

  // Bornes de vol
  const groundY = M.viewTarget.y + 5;
  if (rig.position.y < groundY) rig.position.y = groundY;
  const ceil = M.viewTarget.y + 400;
  if (rig.position.y > ceil) rig.position.y = ceil;
  const maxR = (M.domeRadius || 600) * 0.78;
  const dx = rig.position.x - M.viewTarget.x;
  const dz = rig.position.z - M.viewTarget.z;
  const r = Math.hypot(dx, dz);
  if (r > maxR){ rig.position.x = M.viewTarget.x + dx/r*maxR; rig.position.z = M.viewTarget.z + dz/r*maxR; }

  // Caméra chase : derrière (+Z local) et au-dessus du rig
  _camPos.copy(rig.position).addScaledVector(_fwd, 28).add(new THREE.Vector3(0, 12, 0));
  M.camera.position.lerp(_camPos, Math.min(1, 6*dt));
  M.camera.lookAt(rig.position.x, rig.position.y + 4, rig.position.z);

  M.renderer.render(M.scene, M.camera);
}
```

- [ ] **Step 4 : Tester le vol au clavier (entrée temporaire)**

Pour vérifier le vol avant les joysticks, ajouter temporairement à la fin du module :

```js
// TEST CLAVIER (retiré en Task 5) — ZQSD + flèches
window.addEventListener('keydown', (e)=>{
  if(!active) return;
  if(e.key==='z') input.ry=-1; if(e.key==='s') input.ry=1;
  if(e.key==='q') input.rx=-1; if(e.key==='d') input.rx=1;
  if(e.key==='ArrowUp') input.ly=-1; if(e.key==='ArrowDown') input.ly=1;
  if(e.key==='ArrowLeft') input.lx=-1; if(e.key==='ArrowRight') input.lx=1;
});
window.addEventListener('keyup', (e)=>{
  if(['z','s'].includes(e.key)) input.ry=0;
  if(['q','d'].includes(e.key)) input.rx=0;
  if(['ArrowUp','ArrowDown'].includes(e.key)) input.ly=0;
  if(['ArrowLeft','ArrowRight'].includes(e.key)) input.lx=0;
});
```

- [ ] **Step 5 : Vérifier dans le navigateur**

Serveur lancé, `window.startMosqueScene()`, cliquer GAME, puis cliquer une fois dans la page (focus) et utiliser Z/S (avancer/reculer), Q/D (latéral), flèches haut/bas (altitude), flèches gauche/droite (pivoter).
Attendu : la caméra suit un point qui se déplace en vol libre, par l'arrière (3e personne), de façon fluide et amortie ; on ne passe pas sous le sol ni hors de la zone. Le ✕ quitte proprement.

- [ ] **Step 6 : Retirer l'entrée clavier de test**

Supprimer le bloc « TEST CLAVIER » ajouté au Step 4 (les joysticks le remplacent en Task 5).

- [ ] **Step 7 : Commit**

```bash
git add app/drone-game.js
git commit -m "feat(game): rig drone + camera 3e personne + logique de vol amortie"
```

---

### Task 5 : Joysticks tactiles + souris

**Files:**
- Modify: `app/drone-game.js`

- [ ] **Step 1 : Ajouter la fabrique de joystick**

Dans `app/drone-game.js`, avant `window.DroneGame = ...`, ajouter :

```js
/* ---------- Joysticks (tactile + souris) ---------- */
function makeStick(el, onMove){
  const knob = el.querySelector('.dg-stick-knob');
  let id = null;
  const R = 48;   // rayon de déplacement du knob (px)

  const setVec = (clientX, clientY)=>{
    const rect = el.getBoundingClientRect();
    let x = clientX - (rect.left + rect.width/2);
    let y = clientY - (rect.top  + rect.height/2);
    const d = Math.hypot(x,y);
    if (d > R){ x = x/d*R; y = y/d*R; }
    knob.style.transform = `translate(${x}px, ${y}px)`;
    onMove(x/R, y/R);   // -1..1
  };
  const reset = ()=>{ knob.style.transform = 'translate(0,0)'; onMove(0,0); };

  el.addEventListener('pointerdown', (e)=>{ id = e.pointerId; el.setPointerCapture(id); setVec(e.clientX,e.clientY); });
  el.addEventListener('pointermove', (e)=>{ if(e.pointerId===id) setVec(e.clientX,e.clientY); });
  const up = (e)=>{ if(e.pointerId===id){ id=null; reset(); } };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

makeStick(document.getElementById('dgStickL'), (x,y)=>{ input.lx=x; input.ly=y; });
makeStick(document.getElementById('dgStickR'), (x,y)=>{ input.rx=x; input.ry=y; });
```

- [ ] **Step 2 : Vérifier dans le navigateur (souris)**

Serveur lancé, `window.startMosqueScene()`, GAME. Glisser le knob du joystick **droit** vers le haut → le drone avance ; vers le bas → recule ; gauche/droite → translation. Joystick **gauche** : haut/bas → monte/descend ; gauche/droite → pivote. Relâcher → le knob revient au centre et le mouvement s'amortit jusqu'à l'arrêt.
Attendu : pilotage fluide à la souris. En mode appareil mobile (DevTools, tactile), le drag tactile fonctionne aussi.

- [ ] **Step 3 : Commit**

```bash
git add app/drone-game.js
git commit -m "feat(game): joysticks tactiles et souris pour le pilotage"
```

---

### Task 6 : HUD vivant — boussole, vitesse, altitude, batterie/signal

**Files:**
- Modify: `app/drone-game.js`

- [ ] **Step 1 : Référencer les nœuds HUD**

Dans `app/drone-game.js`, après `const btnQuit = ...`, ajouter :

```js
const elHeading = document.getElementById('dgHeading');
const elFan     = document.getElementById('dgFan');
const elAngle   = document.getElementById('dgAngle');
const elSpeed   = document.getElementById('dgSpeed');
const elAlt     = document.getElementById('dgAlt');
const elBatt    = document.getElementById('dgBatt');
const elSignal  = document.getElementById('dgSignal');

let battery = 100;
let hudAccum = 0;
const _prevPos = new THREE.Vector3();
```

- [ ] **Step 2 : Mettre à jour le HUD dans update()**

Dans `update(dt)`, juste avant la ligne finale `M.renderer.render(M.scene, M.camera);`, ajouter :

```js
  // --- HUD vivant ---
  // Vitesse = distance parcourue / dt, convertie en "MPH" décoratif
  const dist = rig.position.distanceTo(_prevPos);
  _prevPos.copy(rig.position);
  const speedMph = Math.round((dist / dt) * 0.18);

  hudAccum += dt;
  if (hudAccum > 0.1){          // rafraîchir le DOM ~10x/s (perf)
    hudAccum = 0;
    const headingDeg = ((THREE.MathUtils.radToDeg(rig.rotation.y) % 360) + 360) % 360;
    elHeading.textContent = Math.round(headingDeg) + '°';
    elFan.style.transform = `rotate(${headingDeg}deg)`;
    elAngle.textContent = (Math.abs(vel.fwd) * 0.25).toFixed(1) + '°';
    elSpeed.textContent = speedMph + ' MPH';
    elAlt.textContent   = 'H : ' + Math.round(rig.position.y - (M.viewTarget.y)) + 'M';

    battery = Math.max(0, battery - 0.01);
    elBatt.textContent = Math.round(battery) + '%';
    const bars = 1 + Math.round(Math.random()*3);
    elSignal.textContent = '▮'.repeat(bars) + '▯'.repeat(4-bars);
  }
```

- [ ] **Step 3 : Réinitialiser la batterie et la position précédente à l'entrée**

Dans `enter()`, après la ligne `vel.fwd = vel.side = vel.up = vel.yaw = 0;`, ajouter :

```js
  battery = 100;
  _prevPos.copy(rig.position);
```

- [ ] **Step 4 : Vérifier dans le navigateur**

Serveur lancé, GAME. Piloter avec les joysticks.
Attendu : le cap (°) de la boussole change quand on pivote et le « fan » tourne ; la vitesse (MPH) monte quand on avance ; l'altitude (H : ..M) change quand on monte/descend ; la batterie décroît lentement ; le signal scintille.

- [ ] **Step 5 : Commit**

```bash
git add app/drone-game.js
git commit -m "feat(game): HUD vivant (boussole, vitesse, altitude, batterie, signal)"
```

---

### Task 7 : Outils — Photo + Galerie

**Files:**
- Modify: `app/drone-game.js`

- [ ] **Step 1 : Référencer les boutons et l'état galerie**

Dans `app/drone-game.js`, après les nœuds HUD du Task 6, ajouter :

```js
const btnPhoto      = document.getElementById('dgPhoto');
const btnGallery    = document.getElementById('dgGallery');
const galleryPanel  = document.getElementById('dgGalleryPanel');
const photos = [];   // dataURL des captures de la session
```

- [ ] **Step 2 : Implémenter la capture photo**

Ajouter avant `window.DroneGame = ...` :

```js
function takePhoto(){
  // Rendre une frame fraîche puis lire le canvas (preserveDrawingBuffer non garanti)
  M.renderer.render(M.scene, M.camera);
  const url = M.renderer.domElement.toDataURL('image/png');
  photos.push(url);
  // Téléchargement immédiat
  const a = document.createElement('a');
  a.href = url; a.download = `djenne-drone-${photos.length}.png`;
  a.click();
}
btnPhoto?.addEventListener('click', takePhoto);
```

- [ ] **Step 3 : Implémenter l'ouverture de la galerie**

Ajouter :

```js
function toggleGallery(){
  if (!galleryPanel.hidden){ galleryPanel.hidden = true; return; }
  galleryPanel.innerHTML = photos.length
    ? photos.map(u => `<img src="${u}" alt="capture">`).join('')
    : '<p>Aucune photo pour le moment.</p>';
  galleryPanel.hidden = false;
}
btnGallery?.addEventListener('click', toggleGallery);
```

- [ ] **Step 4 : Vérifier dans le navigateur**

Serveur lancé, GAME, piloter un peu, cliquer 📷.
Attendu : un fichier `djenne-drone-1.png` est téléchargé (la vue du drone). Cliquer ⭕ : la galerie s'ouvre et montre la/les vignette(s). Re-cliquer ⭕ : elle se ferme.

- [ ] **Step 5 : Commit**

```bash
git add app/drone-game.js
git commit -m "feat(game): outil photo + galerie de captures"
```

---

### Task 8 : Outil — Enregistrement vidéo

**Files:**
- Modify: `app/drone-game.js`

- [ ] **Step 1 : Référencer le bouton et l'état d'enregistrement**

Dans `app/drone-game.js`, ajouter près des autres références d'outils :

```js
const btnVideo = document.getElementById('dgVideo');
let recorder = null, chunks = [];
```

- [ ] **Step 2 : Implémenter start/stop de l'enregistrement**

Ajouter avant `window.DroneGame = ...` :

```js
function toggleRecord(){
  if (recorder){   // stop
    recorder.stop();
    return;
  }
  if (typeof MediaRecorder === 'undefined' || !M.renderer.domElement.captureStream){
    alert('Enregistrement vidéo non disponible sur ce navigateur.');
    return;
  }
  const stream = M.renderer.domElement.captureStream(30);
  chunks = [];
  recorder = new MediaRecorder(stream, { mimeType:'video/webm' });
  recorder.ondataavailable = (e)=>{ if(e.data.size) chunks.push(e.data); };
  recorder.onstop = ()=>{
    const blob = new Blob(chunks, { type:'video/webm' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'djenne-drone.webm'; a.click();
    btnVideo.classList.remove('is-active');
    recorder = null;
  };
  recorder.start();
  btnVideo.classList.add('is-active');
}
btnVideo?.addEventListener('click', toggleRecord);
```

- [ ] **Step 3 : Stopper l'enregistrement à la sortie**

Dans `exit()`, juste après `active = false;`, ajouter :

```js
  if (recorder){ try { recorder.stop(); } catch(_){} }
```

- [ ] **Step 4 : Vérifier dans le navigateur**

Serveur lancé, GAME, cliquer 🎥 (le bouton s'allume), piloter quelques secondes, recliquer 🎥.
Attendu : un fichier `djenne-drone.webm` est téléchargé et lisible (montre le vol enregistré). Quitter avec ✕ pendant l'enregistrement stoppe aussi proprement.

- [ ] **Step 5 : Commit**

```bash
git add app/drone-game.js
git commit -m "feat(game): outil d'enregistrement video (MediaRecorder)"
```

---

### Task 9 : Outil — Bascule jour / nuit

**Files:**
- Modify: `app/drone-game.js`

- [ ] **Step 1 : Référencer le bouton et capturer le preset « jour »**

Dans `app/drone-game.js`, ajouter près des autres outils :

```js
const btnLight = document.getElementById('dgLight');
let night = false;
let dayBg = null, dayFog = null;   // sauvegarde du preset diurne
```

- [ ] **Step 2 : Implémenter la bascule**

Ajouter avant `window.DroneGame = ...` :

```js
function toggleNight(){
  if (dayBg === null){           // mémorise le jour à la 1re bascule
    dayBg  = M.scene.background ? M.scene.background.clone() : new THREE.Color(0x8fb8de);
    dayFog = M.scene.fog ? M.scene.fog.color.clone() : new THREE.Color(0xe9d8ae);
  }
  night = !night;
  btnLight.classList.toggle('is-active', night);
  if (night){
    M.scene.background = new THREE.Color(0x0b1026);
    if (M.scene.fog) M.scene.fog.color.set(0x1a2240);
  } else {
    M.scene.background = dayBg.clone();
    if (M.scene.fog) M.scene.fog.color.copy(dayFog);
  }
}
btnLight?.addEventListener('click', toggleNight);
```

- [ ] **Step 3 : Vérifier dans le navigateur**

Serveur lancé, GAME, cliquer 💡.
Attendu : le ciel et la brume passent en tons nuit (bleu nuit) ; le bouton s'allume. Re-cliquer : retour au jour. Le pilotage continue de fonctionner.

- [ ] **Step 4 : Commit**

```bash
git add app/drone-game.js
git commit -m "feat(game): bascule jour/nuit de la scene"
```

---

### Task 10 : Outil — Panneau points d'intérêt

**Files:**
- Modify: `app/drone-game.js`

- [ ] **Step 1 : Référencer le bouton, le panneau et définir les POI**

Dans `app/drone-game.js`, ajouter près des autres outils :

```js
const btnList = document.getElementById('dgList');
const poiPanel = document.getElementById('dgPoi');
const POIS = [
  { nom:'Grande Mosquée',  dy:30,  dz:60  },
  { nom:'Cour extérieure', dy:25,  dz:90  },
  { nom:'Minarets',        dy:55,  dz:50  },
  { nom:'Vue d\'ensemble', dy:80,  dz:160 },
];
```

- [ ] **Step 2 : Implémenter l'ouverture du panneau et le déplacement vers un POI**

Ajouter avant `window.DroneGame = ...` :

```js
function flyToPoi(p){
  rig.position.set(M.viewTarget.x, M.viewTarget.y + p.dy, M.viewTarget.z + p.dz);
  rig.rotation.y = 0;
  vel.fwd = vel.side = vel.up = vel.yaw = 0;
  poiPanel.hidden = true;
}
function toggleList(){
  if (!poiPanel.hidden){ poiPanel.hidden = true; return; }
  poiPanel.innerHTML = '';
  POIS.forEach((p)=>{
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = p.nom;
    b.addEventListener('click', ()=> flyToPoi(p));
    poiPanel.appendChild(b);
  });
  poiPanel.hidden = false;
}
btnList?.addEventListener('click', toggleList);
```

- [ ] **Step 3 : Vérifier dans le navigateur**

Serveur lancé, GAME, cliquer ☰.
Attendu : un panneau liste « Grande Mosquée / Cour extérieure / Minarets / Vue d'ensemble ». Cliquer un item : le drone est repositionné à ce point de vue et le panneau se ferme. On peut reprendre le pilotage ensuite.

- [ ] **Step 4 : Commit**

```bash
git add app/drone-game.js
git commit -m "feat(game): panneau points d'interet avec teleportation"
```

---

### Task 11 : Charger le modèle drone.glb sur le rig + animations

Le modèle `assets/models/drone.glb` contient 9 clips nommés : `Idle_Hover`, `Ascend_Up`, `Descend_Down`, `Yaw_RotateLeft`, `Yaw_RotateRight`, `Move_Forward`, `Move_Backward`, `Move_Left`, `Move_Right`. On attache le modèle au rig et on joue le clip correspondant à la commande dominante (crossfade), avec retour à `Idle_Hover` au repos.

**Files:**
- Modify: `app/drone-game.js`

- [ ] **Step 1 : Importer les loaders GLTF/DRACO**

En haut de `app/drone-game.js`, juste après `import * as THREE from 'three';`, ajouter :

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
```

- [ ] **Step 2 : Déclarer l'état modèle/animation**

Après la déclaration `const rig = new THREE.Object3D();`, ajouter :

```js
const DRONE_URL = 'assets/models/drone.glb';
const DRACO_DECODER = 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/libs/draco/';
let droneModel = null, droneMixer = null;
const actions = {};       // nom de clip -> AnimationAction
let currentClip = '';
let modelLoading = false, modelLoaded = false;
```

- [ ] **Step 3 : Charger le modèle (appelé à la 1re entrée)**

Ajouter avant `function enter(){` :

```js
function loadDrone(){
  if (modelLoading || modelLoaded) return;
  modelLoading = true;
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_DECODER);
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.load(DRONE_URL, (gltf)=>{
    droneModel = gltf.scene;
    // Normaliser la taille à ~12 unités (échelle de la maquette)
    const box = new THREE.Box3().setFromObject(droneModel);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    droneModel.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    droneModel.scale.setScalar(12 / maxDim);
    rig.add(droneModel);

    droneMixer = new THREE.AnimationMixer(droneModel);
    gltf.animations.forEach((clip)=>{
      const a = droneMixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      actions[clip.name] = a;
    });
    if (actions['Idle_Hover']){ actions['Idle_Hover'].play(); currentClip = 'Idle_Hover'; }
    modelLoaded = true; modelLoading = false;
  }, undefined, (err)=>{ console.error('Erreur chargement drone.glb :', err); modelLoading = false; });
}
```

- [ ] **Step 4 : Déclencher le chargement à l'entrée**

Dans `enter()`, juste après `if (!rigAdded){ M.scene.add(rig); rigAdded = true; }`, ajouter :

```js
  loadDrone();
```

- [ ] **Step 5 : Sélecteur de clip + crossfade**

Ajouter avant `function update(dt){` :

```js
function pickClip(){
  const ax = Math.abs(input.lx), ay = Math.abs(input.ly);
  const arx = Math.abs(input.rx), ary = Math.abs(input.ry);
  const max = Math.max(ax, ay, arx, ary);
  if (max < 0.15) return 'Idle_Hover';
  if (ary === max) return input.ry < 0 ? 'Move_Forward'   : 'Move_Backward';
  if (arx === max) return input.rx < 0 ? 'Move_Left'      : 'Move_Right';
  if (ay  === max) return input.ly < 0 ? 'Ascend_Up'      : 'Descend_Down';
  return input.lx < 0 ? 'Yaw_RotateLeft' : 'Yaw_RotateRight';
}

function setClip(name){
  if (name === currentClip || !actions[name]) return;
  const next = actions[name];
  const prev = actions[currentClip];
  next.reset().play();
  if (prev) prev.crossFadeTo(next, 0.25, false);
  else next.fadeIn(0.25);
  currentClip = name;
}
```

- [ ] **Step 6 : Mettre à jour le mixer et le clip dans update()**

Dans `update(dt)`, juste après la ligne `dt = Math.min(dt, 0.05);`, ajouter :

```js
  if (droneMixer){ droneMixer.update(dt); setClip(pickClip()); }
```

- [ ] **Step 7 : Aligner l'orientation du modèle (si besoin)**

Vérifier visuellement (Step 8) que le nez du drone pointe dans le sens de l'avance. Si le drone vole « en marche arrière », ajouter dans `loadDrone()` juste après `rig.add(droneModel);` :

```js
  droneModel.rotation.y = Math.PI;   // demi-tour pour aligner le nez sur l'avance
```

(Ne garder cette ligne que si la vérif le confirme.)

- [ ] **Step 8 : Vérifier dans le navigateur**

Serveur lancé, `window.startMosqueScene()`, GAME.
Attendu : le drone 3D apparaît devant la caméra (3e personne), hélices animées ; en avançant il joue `Move_Forward`, en pivotant `Yaw_Rotate*`, en montant `Ascend_Up`, etc. ; au repos il revient à `Idle_Hover`. Le nez pointe dans le sens du déplacement (sinon appliquer Step 7).

- [ ] **Step 9 : Commit**

```bash
git add app/drone-game.js
git commit -m "feat(game): chargement drone.glb sur le rig + animations selon le vol"
```

---

### Task 12 : Vérification d'intégration finale

**Files:** aucun (vérification)

- [ ] **Step 1 : Parcours complet desktop**

Serveur lancé, recharger, `window.startMosqueScene()`, GAME. Vérifier dans l'ordre :
1. L'UI normale disparaît, le HUD s'affiche, le drone 3D apparaît (hélices animées).
2. Pilotage joysticks (souris) : avance/recule/latéral/altitude/pivot, amorti, bornes respectées ; le drone joue l'animation correspondant au mouvement et revient à `Idle_Hover` au repos.
3. Boussole, vitesse, altitude, batterie, signal vivants.
4. 📷 télécharge une photo ; ⭕ montre la galerie.
5. 🎥 enregistre puis télécharge un .webm.
6. 💡 bascule jour/nuit.
7. ☰ liste les POI ; clic = repositionnement.
8. ✕ quitte : orientation/UI/caméra restaurées, aucune fuite (re-cliquer GAME refonctionne).

- [ ] **Step 2 : Parcours mobile émulé**

DevTools mode appareil, portrait : GAME → overlay rotation ; paysage → HUD ; joysticks tactiles OK ; ✕ OK.

- [ ] **Step 3 : Commit éventuel d'ajustements**

Si des retouches sont faites pendant la vérif :
```bash
git add -A
git commit -m "fix(game): ajustements d'integration du mode jeu"
```

---

## Note

Le modèle `drone.glb` est intégré dès la v1 (Task 11) : il contient les 9 clips de
déplacement nommés et s'attache au rig sans refonte du reste du mode jeu (le rig
reste la « poignée » qui porte le modèle et son orientation).
