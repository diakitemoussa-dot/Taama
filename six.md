# ÉTAPE 6 — Vue 3D Mosquée + Ville holographique (RÉSERVE)

> **Fichier de réserve.** Cette partie a été **retirée** de l'expérience le 2026-06-17.
> L'expérience s'arrête désormais juste après la fin de la vidéo du décollage du drone.
> Tout le code de la partie supprimée est conservé ici pour pouvoir la réintégrer plus tard.

## Ce que c'était

Étape déclenchée **à la fin de la vidéo intro** : une scène Three.js plein écran affichant
le modèle `mosque.glb` au centre, entouré d'une **ville holographique filaire** (gratte-ciels
blancs en wireframe disposés en cercle, sol en grille radiale, faisceau lumineux central,
poussière dorée flottante) sur fond violet `#1a1330`.

Le déclencheur était **dans `mosque-viewer.js` lui-même** (écouteur `video 'ended'`), donc le
simple fait de retirer sa balise `<script>` suffit à arrêter l'expérience après la vidéo.

---

## 1. HTML — bloc à réinsérer dans `index.html`

À replacer dans `<main id="stage">`, juste après l'overlay vidéo (`#videoOverlay`) :

```html
    <!-- Vue 3D de la mosquée (étape 6 : démarre à la fin de la vidéo intro) -->
    <div id="mosqueOverlay" class="mosque-overlay" aria-hidden="true">
      <canvas id="mosqueCanvas"></canvas>
      <div id="mosqueLoader" class="mosque-loader">CHARGEMENT DE LA MOSQUÉE…</div>
    </div>
```

Et la balise de script (juste après `drone-viewer.js`, avant `</body>`) :

```html
  <script type="module" src="app/mosque-viewer.js"></script>
```

> `mosque-viewer.js` importe lui-même `city-environment.js` — donc une seule balise suffit.

---

## 2. CSS — règles à réinsérer dans `styles/main.css`

```css
/* ============= MOSQUE VIEWER (après vidéo intro) ============= */
.mosque-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: #0a0a0a;
  opacity: 0;
  pointer-events: none;
  transition: opacity .8s ease;
}

.mosque-overlay.on {
  opacity: 1;
  pointer-events: auto;
}

.mosque-overlay canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.mosque-loader {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  color: #f9d58b;
  font: 600 12px/1 system-ui, sans-serif;
  letter-spacing: .3em;
  padding: 14px 24px;
  border: 1px solid #f9d58b55;
  background: #0a0a0a99;
  backdrop-filter: blur(6px);
  transition: opacity .5s ease;
}

.mosque-loader.off {
  opacity: 0;
  pointer-events: none;
}
/* ===== Boutons Jour / Nuit (vue mosquée) ===== */
.tod-controls {
  position: absolute;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 10px;
  z-index: 30;
  pointer-events: auto;
}
.tod-btn {
  font-family: inherit;
  font-size: 13px;
  letter-spacing: 1.5px;
  font-weight: 600;
  color: #cfe9ff;
  background: rgba(8, 20, 40, 0.55);
  border: 1px solid rgba(120, 200, 255, 0.35);
  border-radius: 6px;
  padding: 8px 16px;
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition: all 0.25s ease;
  text-shadow: 0 0 6px rgba(120, 200, 255, 0.4);
}
.tod-btn:hover {
  border-color: rgba(150, 220, 255, 0.7);
  color: #fff;
}
.tod-btn.tod-on {
  color: #07101f;
  background: linear-gradient(180deg, #aef2ff, #4fc7ff);
  border-color: #aef2ff;
  box-shadow: 0 0 18px rgba(120, 220, 255, 0.6);
  text-shadow: none;
}
```

---

## 3. JS — `app/mosque-viewer.js`

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildCityEnvironment, tickCityEnvironment } from './city-environment.js';

const MOSQUE_URL = 'assets/models/mosque.glb';
const DRACO_DECODER = 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/libs/draco/';

let started = false;

export function startMosqueView() {
  if (started) return;
  started = true;

  const overlay = document.getElementById('mosqueOverlay');
  const canvas = document.getElementById('mosqueCanvas');
  const loader = document.getElementById('mosqueLoader');
  if (!overlay || !canvas) return;

  overlay.classList.add('on');
  overlay.setAttribute('aria-hidden', 'false');

  // ===== RENDERER =====
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  // ===== SCÈNE =====
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1330); // violet sombre (charte, assorti à la ville croquis)

  // ===== ÉCLAIRAGE NEUTRE (base) =====
  // Lumière ambiante + hémisphérique : suffisent à rendre la mosquée visible
  // sans soleil directionnel ni projecteurs de monument.
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambientLight);

  const fillLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
  scene.add(fillLight);

  // ===== CAMÉRA =====
  const camera = new THREE.PerspectiveCamera(
    40, window.innerWidth / window.innerHeight, 0.1, 1000
  );
  camera.position.set(5, 2, 8);

  // ===== CONTROLS =====
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.5, 0);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.update();

  // ===== CHARGEMENT MOSQUÉE =====
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_DECODER);
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(draco);

  gltfLoader.load(MOSQUE_URL, async (gltf) => {
    const model = gltf.scene;

    // Centrer + poser au sol Y=0 (matériaux GLB d'origine conservés)
    const box = new THREE.Box3().setFromObject(model);
    const center = new THREE.Vector3(); box.getCenter(center);
    const size = new THREE.Vector3(); box.getSize(size);
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;

    await renderer.compileAsync(model, camera, scene);
    scene.add(model);

    // ===== VILLE DE DJENNÉ — maquette holographique =====
    const cityGroup = buildCityEnvironment(scene, size);

    // ===== POSITION INITIALE DE LA CAMÉRA =====
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const fitDist = (maxDim / 2) / Math.tan(fov / 2) * 1.5;

    const dir = new THREE.Vector3(0.4, 0.55, 1).normalize();
    const targetY = size.y * 0.35;
    controls.target.set(0, targetY, 0);
    camera.position.copy(dir.clone().multiplyScalar(fitDist)).add(controls.target);

    camera.near = fitDist / 100;
    camera.far = fitDist * 100;
    camera.updateProjectionMatrix();

    // ===== LIMITES ET COLLISIONS =====
    controls.minDistance = fitDist * 0.25;
    controls.maxDistance = fitDist * 8;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minPolarAngle = Math.PI * 0.02;
    controls.update();

    const collisionMeshes = [];
    model.traverse(c => { if (c.isMesh) collisionMeshes.push(c); });

    const collisionRaycaster = new THREE.Raycaster();
    const CAMERA_MARGIN = 0.3;

    function enforceCollision() {
      const target = controls.target.clone();
      const camPos = camera.position.clone();
      const dirToCam = camPos.sub(target);
      const distance = dirToCam.length();
      const dirNorm = dirToCam.normalize();

      collisionRaycaster.set(target, dirNorm);
      collisionRaycaster.far = distance + 1;
      const hits = collisionRaycaster.intersectObjects(collisionMeshes, false);

      if (hits.length > 0) {
        const closestHit = hits[0];
        if (closestHit.distance < distance) {
          const safeDist = closestHit.distance - CAMERA_MARGIN;
          if (safeDist > controls.minDistance * 0.5) {
            camera.position.copy(target.clone().add(dirNorm.multiplyScalar(safeDist)));
          }
        }
      }
      if (camera.position.y < 0.2) camera.position.y = 0.2;
    }

    // exposer pour la boucle d'animation
    startMosqueView._enforceCollision = enforceCollision;
    startMosqueView._cityGroup = cityGroup;

    if (loader) loader.classList.add('off');
  },
    undefined,
    (err) => {
      console.error('Erreur mosque.glb :', err);
      if (loader) loader.textContent = 'Erreur de chargement';
    });

  // ===== RESIZE =====
  window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  // ===== BOUCLE =====
  const _clock = new THREE.Clock();
  function tick() {
    controls.update();
    if (typeof startMosqueView._enforceCollision === 'function') startMosqueView._enforceCollision();

    const t = _clock.getElapsedTime();
    if (startMosqueView._cityGroup) tickCityEnvironment(startMosqueView._cityGroup, t);

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();
}

// Démarre à la fin de la vidéo intro
const video = document.getElementById('introVideo');
if (video) {
  video.addEventListener('ended', () => setTimeout(startMosqueView, 50));
}
```

---

## 4. JS — `app/city-environment.js`

```js
import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
//  DJENNÉ — VILLE HOLOGRAPHIQUE FUTURISTE
//  Skyline filaire bleu : tours en arêtes lumineuses + faces
//  translucides à dégradé vertical, sol en grille radiale rayonnante,
//  faisceau central. La mosquée (chargée ailleurs) reste réelle au centre.
// ─────────────────────────────────────────────────────────────

let _s = 42;
function rng() { _s = (_s * 16807) % 2147483647; return (_s - 1) / 2147483646; }

// ── Matériaux hologramme partagés ────────────────────────────
let _faceMat = null;     // faces translucides (dégradé vertical + fresnel)
let _edgeMat = null;     // arêtes lumineuses (bright cyan, > 1 pour le bloom)
let _gridMat = null;     // grille du sol
const HOLO_MAXH = { value: 10 }; // hauteur de référence pour le dégradé vertical

const EDGE_COLOR = new THREE.Color(0xffffff); // lignes blanches façon croquis
const RIM_COLOR  = new THREE.Color(0xffffff);
const CITY_BG    = new THREE.Color(0x1a1330); // violet sombre (charte) : fond + remplissage des faces

function makeFaceMaterial() {
  // Faces OPAQUES remplies de la couleur du fond (teal) : l'occlusion entre
  // immeubles reste correcte (pas d'artefacts de transparence), et seules les
  // lignes blanches dessinent les volumes → exactement l'aspect croquis de l'image.
  return new THREE.MeshBasicMaterial({
    color: CITY_BG,
    toneMapped: false,
    side: THREE.FrontSide,
    polygonOffset: true,        // recule légèrement les faces pour que les arêtes ressortent net
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

function makeEdgeMaterial() {
  return new THREE.LineBasicMaterial({
    color: EDGE_COLOR,
    transparent: true,
    opacity: 0.9,
    toneMapped: false,
    depthWrite: false,
  });
}

function makeGridMaterial() {
  return new THREE.LineBasicMaterial({
    color: new THREE.Color(0xffffff),
    transparent: true,
    opacity: 0.18,
    toneMapped: false,
    depthWrite: false,
  });
}

// ─────────────────────────────────────────────────────────────
//  TOWER — boîte filaire (face translucide + arêtes lumineuses)
// ─────────────────────────────────────────────────────────────
// Lignes d'un immeuble façon croquis : arêtes verticales + bandes d'étages
// (rectangles horizontaux) + quelques meneaux verticaux → détail de fenêtres.
function boxLineGeometry(w, h, d) {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const pts = [];
  const seg = (ax, ay, az, bx, by, bz) => pts.push(ax, ay, az, bx, by, bz);

  // 4 arêtes verticales d'angle
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  for (const [cx, cz] of corners) seg(cx, -hh, cz, cx, hh, cz);

  // bandes d'étages (rectangles horizontaux, y compris haut et bas)
  const floors = Math.max(2, Math.min(20, Math.round(h / Math.max(0.0001, (w + d) * 0.16))));
  for (let f = 0; f <= floors; f++) {
    const y = -hh + h * (f / floors);
    seg(-hw, y, -hd, hw, y, -hd);
    seg(hw, y, -hd, hw, y, hd);
    seg(hw, y, hd, -hw, y, hd);
    seg(-hw, y, hd, -hw, y, -hd);
  }

  // meneaux verticaux (divisent les façades en fenêtres)
  const mull = 2;
  for (let m = 1; m <= mull; m++) {
    const fx = -hw + w * (m / (mull + 1));
    const fz = -hd + d * (m / (mull + 1));
    seg(fx, -hh, -hd, fx, hh, -hd); // façade avant
    seg(fx, -hh, hd, fx, hh, hd);   // façade arrière
    seg(-hw, -hh, fz, -hw, hh, fz); // façade gauche
    seg(hw, -hh, fz, hw, hh, fz);   // façade droite
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

function addBox(parent, w, h, d, baseY) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const face = new THREE.Mesh(geo, _faceMat);
  face.position.y = baseY + h * 0.5;
  parent.add(face);
  const lines = new THREE.LineSegments(boxLineGeometry(w, h, d), _edgeMat);
  lines.position.y = baseY + h * 0.5;
  parent.add(lines);
}

function makeTower(w, h, d) {
  const g = new THREE.Group();

  // corps principal
  addBox(g, w, h, d, 0);

  // retrait (setback) au sommet — gratte-ciel étagé
  let topY = h;
  if (rng() > 0.4) {
    const h2 = h * (0.18 + rng() * 0.32);
    const w2 = w * (0.55 + rng() * 0.25);
    const d2 = d * (0.55 + rng() * 0.25);
    addBox(g, w2, h2, d2, h);
    topY = h + h2;
    // 2e étage encore plus haut (tours majeures)
    if (rng() > 0.6) {
      const h3 = h2 * (0.4 + rng() * 0.5);
      addBox(g, w2 * 0.6, h3, d2 * 0.6, topY);
      topY += h3;
    }
  }

  // antenne / flèche (tours hautes)
  if (h > HOLO_MAXH.value * 0.45 && rng() > 0.45) {
    const sh = h * (0.12 + rng() * 0.28);
    const pts = new Float32Array([0, topY, 0, 0, topY + sh, 0]);
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(ag, _edgeMat));
  }

  return g;
}

// ─────────────────────────────────────────────────────────────
//  ORGANIC STREET MASK — avenues laissées libres entre les tours
// ─────────────────────────────────────────────────────────────
function buildStreetMask(platformR) {
  const streets = [];
  const branchCount = 7;
  for (let i = 0; i < branchCount; i++) {
    const baseAngle = (i / branchCount) * Math.PI * 2 + (rng() - 0.5) * 0.4;
    const points = [];
    let angle = baseAngle;
    let r = platformR * 0.05;
    while (r < platformR * 0.92) {
      points.push({ x: Math.cos(angle) * r, z: Math.sin(angle) * r });
      angle += (rng() - 0.48) * 0.3;
      r += platformR * 0.06 + rng() * platformR * 0.04;
    }
    streets.push({ points, width: platformR * 0.04 });
  }
  for (let ring = 0; ring < 3; ring++) {
    const ringR = platformR * (0.25 + ring * 0.22);
    const pts = [];
    for (let a = 0; a < Math.PI * 2; a += 0.15 + rng() * 0.1) {
      const ja = a + (rng() - 0.5) * 0.08;
      const jr = ringR + (rng() - 0.5) * platformR * 0.08;
      pts.push({ x: Math.cos(ja) * jr, z: Math.sin(ja) * jr });
    }
    streets.push({ points: pts, width: platformR * 0.028 });
  }
  return function isStreet(px, pz) {
    for (const st of streets) {
      for (let i = 0; i < st.points.length - 1; i++) {
        const a = st.points[i], b = st.points[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z;
        const len2 = dx * dx + dz * dz;
        if (len2 < 0.001) continue;
        let t = ((px - a.x) * dx + (pz - a.z) * dz) / len2;
        t = Math.max(0, Math.min(1, t));
        const cx = a.x + t * dx, cz = a.z + t * dz;
        const dist = Math.sqrt((px - cx) ** 2 + (pz - cz) ** 2);
        if (dist < st.width) return true;
      }
    }
    return false;
  };
}

// ─────────────────────────────────────────────────────────────
//  GRID FLOOR — sol en grille radiale rayonnante (rayons + anneaux)
// ─────────────────────────────────────────────────────────────
function makeGridFloor(radius) {
  const g = new THREE.Group();
  g.name = 'HoloPlatform';
  const outer = radius * 1.5;

  // disque sombre OPAQUE sous la grille (sol réel : écrit la profondeur,
  // donc plus de "panneau noir" qui se trie devant les tours au dézoom)
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(outer, 96),
    new THREE.MeshBasicMaterial({ color: CITY_BG, toneMapped: false })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -0.05;
  g.add(disc);

  // lignes : rayons + anneaux concentriques (une seule géométrie)
  const pts = [];
  const spokes = 72;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const r0 = radius * 0.05, r1 = outer;
    pts.push(Math.cos(a) * r0, 0, Math.sin(a) * r0, Math.cos(a) * r1, 0, Math.sin(a) * r1);
  }
  const rings = 16;
  for (let j = 1; j <= rings; j++) {
    const rr = outer * (j / rings);
    const segs = 100;
    for (let k = 0; k < segs; k++) {
      const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1) / segs) * Math.PI * 2;
      pts.push(Math.cos(a0) * rr, 0, Math.sin(a0) * rr, Math.cos(a1) * rr, 0, Math.sin(a1) * rr);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const grid = new THREE.LineSegments(geo, _gridMat);
  grid.position.y = 0.0;
  g.add(grid);

  // anneau brillant au bord de la plateforme
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius, radius * 0.005, 6, 180),
    new THREE.MeshBasicMaterial({ color: RIM_COLOR, transparent: true, opacity: 0.95, toneMapped: false, blending: THREE.NormalBlending })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.01;
  rim.name = 'PlatformEdge';
  g.add(rim);

  return g;
}

// ─────────────────────────────────────────────────────────────
//  BEAM — faisceau lumineux descendant sur la cité
// ─────────────────────────────────────────────────────────────
function makeBeam(height, baseRadius) {
  const coneH = height * 1.6;
  const geo = new THREE.CylinderGeometry(baseRadius * 0.04, baseRadius, coneH, 36, 1, true);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(0xffffff) }, uOpacity: { value: 0.05 } },
    vertexShader: /* glsl */`
      varying float vy;
      void main(){ vy = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uOpacity; varying float vy;
      void main(){ float a = pow(vy, 2.2) * uOpacity; gl_FragColor = vec4(uColor, a); }`,
  });
  const cone = new THREE.Mesh(geo, mat);
  cone.position.y = coneH * 0.5;
  cone.name = 'HoloBeam';
  cone.userData.beamMat = mat;
  return cone;
}

// ─────────────────────────────────────────────────────────────
//  DUST — fines particules lumineuses
// ─────────────────────────────────────────────────────────────
function addDust(parent, spread, maxH) {
  const N = 400;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * spread;
    pos[i * 3]     = Math.cos(a) * r;
    pos[i * 3 + 1] = rng() * maxH * 2;
    pos[i * 3 + 2] = Math.sin(a) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  parent.add(new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.06, transparent: true,
    opacity: 0.22, sizeAttenuation: true, depthWrite: false, toneMapped: false,
    blending: THREE.AdditiveBlending,
  })));
  parent.userData._dustGeo = geo;
  parent.userData._dustN = N;
  parent.userData._dustH = maxH;
}

// ─────────────────────────────────────────────────────────────
//  MAIN EXPORT
// ─────────────────────────────────────────────────────────────
export function buildCityEnvironment(scene, mosqueSize) {
  _s = 42;

  // matériaux hologramme partagés
  _faceMat = makeFaceMaterial();
  _edgeMat = makeEdgeMaterial();
  _gridMat = makeGridMaterial();

  const city = new THREE.Group();
  city.name = 'DjenneCity';

  const mW = mosqueSize.x;
  const mD = mosqueSize.z;
  const mH = mosqueSize.y;
  const mR = Math.max(mW, mD) * 0.5;

  const platformR = mR * 4.5;

  // Facteur global de hauteur des tours (réduction douce autour de la mosquée)
  const TOWER_HEIGHT_SCALE = 0.75;

  // hauteur de référence (gratte-ciels) pour le dégradé vertical des faces
  HOLO_MAXH.value = mR * 6.0 * TOWER_HEIGHT_SCALE;

  // ── Sol en grille radiale ─────────────────────────────────
  city.add(makeGridFloor(platformR));

  // ── Avenues ───────────────────────────────────────────────
  const isStreet = buildStreetMask(platformR);

  // ── Grille dense de tours ─────────────────────────────────
  const cellSize = mR * 0.38;
  const mosqueMargin = 1.25;
  const mHalfW = mW * 0.5 * mosqueMargin;
  const mHalfD = mD * 0.5 * mosqueMargin;
  const gridExtent = platformR * 0.92;
  const unit = mR * 0.12;

  let towerCount = 0;
  for (let gx = -gridExtent; gx < gridExtent; gx += cellSize) {
    for (let gz = -gridExtent; gz < gridExtent; gz += cellSize) {
      const px = gx + (rng() - 0.5) * cellSize * 0.55;
      const pz = gz + (rng() - 0.5) * cellSize * 0.55;

      const dist = Math.sqrt(px * px + pz * pz);
      if (dist > platformR * 0.92) continue;
      if (Math.abs(px) < mHalfW && Math.abs(pz) < mHalfD) continue;  // espace mosquée
      if (isStreet(px, pz)) continue;                                // avenues
      const edgeFactor = dist / platformR;
      if (rng() < edgeFactor * 0.12) continue;

      // gratte-ciels : plus hauts vers le centre, élancés
      const proximity = Math.max(0, 1 - (dist - mR) / (platformR * 0.55));
      const baseH = unit * (3.5 + rng() * 7.0) * (0.45 + proximity * 1.15) * TOWER_HEIGHT_SCALE;
      const isHero = proximity > 0.7 && rng() > 0.6;
      const h = Math.max(unit * 2.0 * TOWER_HEIGHT_SCALE, isHero ? baseH * 1.6 : baseH);
      const w = cellSize * (0.34 + rng() * 0.32);
      const d = cellSize * (0.34 + rng() * 0.32);

      const tower = makeTower(w, h, d);
      tower.position.set(px, 0, pz);
      tower.rotation.y = (Math.floor(rng() * 4)) * Math.PI * 0.5; // alignées (style urbain)
      city.add(tower);
      towerCount++;
    }
  }

  console.log(`[DjenneCity] Skyline holographique : ${towerCount} tours, platformR=${platformR.toFixed(1)}`);

  // ── Faisceau central sur la cité ──────────────────────────
  const beam = makeBeam(HOLO_MAXH.value, platformR * 0.5);
  city.add(beam);

  // ── Poussière lumineuse ───────────────────────────────────
  addDust(city, platformR * 0.85, mH * 1.5);

  // Le brouillard est géré par le cycle jour/nuit dans mosque-viewer.js.
  scene.add(city);
  return city;
}

// ─────────────────────────────────────────────────────────────
//  ANIMATION TICK
// ─────────────────────────────────────────────────────────────
export function tickCityEnvironment(city, t) {
  if (!city) return;

  // (les faces n'ont plus de shader animé : matériau plat couleur du fond)

  // léger scintillement des arêtes (vie de l'hologramme)
  if (_edgeMat) _edgeMat.opacity = 0.82 + Math.sin(t * 2.0) * 0.12;
  if (_gridMat) _gridMat.opacity = 0.34 + Math.sin(t * 0.8) * 0.08;

  // drift de la poussière
  const geo = city.userData._dustGeo;
  const N = city.userData._dustN;
  const maxH = city.userData._dustH;
  if (geo && N) {
    const p = geo.attributes.position.array;
    for (let i = 0; i < N; i++) {
      p[i * 3]     += Math.sin(t * 0.12 + i) * 0.003;
      p[i * 3 + 2] += Math.cos(t * 0.10 + i * 0.7) * 0.002;
      p[i * 3 + 1] += 0.002;
      if (p[i * 3 + 1] > maxH * 3) p[i * 3 + 1] = 0;
    }
    geo.attributes.position.needsUpdate = true;
  }

  // pulse du bord de plateforme + faisceau
  city.traverse(child => {
    if (child.name === 'PlatformEdge' && child.material) {
      child.material.opacity = 0.85 + Math.sin(t * 0.8) * 0.12;
    }
    if (child.name === 'HoloBeam' && child.userData.beamMat) {
      child.userData.beamMat.uniforms.uOpacity.value = 0.09 + Math.sin(t * 1.3) * 0.03;
    }
  });
}
```

---

## 5. Comment réintégrer cette partie plus tard

1. Recréer `app/mosque-viewer.js` (§3) et `app/city-environment.js` (§4).
2. Réinsérer le bloc HTML `#mosqueOverlay` et la balise `<script>` dans `index.html` (§1).
3. Réinsérer les règles CSS dans `styles/main.css` (§2).
4. L'asset `assets/models/mosque.glb` doit être présent.

> Dépendance : `mosque.glb` au chemin `assets/models/mosque.glb`. La vue se déclenche
> automatiquement à l'événement `ended` de `#introVideo`.
