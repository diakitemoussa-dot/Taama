/* ==========================================================
   DRONE SKIN — Kabakoo dark blue / violet style vidéo
   Importé par drone-viewer.js et drone-game.js
   ========================================================== */
import * as THREE from 'three';

function makeKLogoTexture() {
  const cvs = document.createElement('canvas');
  cvs.width = 512; cvs.height = 512;
  const ctx = cvs.getContext('2d');

  // Fond bleu nuit
  ctx.fillStyle = '#131a3a';
  ctx.fillRect(0, 0, 512, 512);

  // Halo violet centré
  const grd = ctx.createRadialGradient(256, 256, 30, 256, 256, 260);
  grd.addColorStop(0,   'rgba(110, 60, 180, 0.85)');
  grd.addColorStop(0.5, 'rgba(60,  35, 130, 0.45)');
  grd.addColorStop(1,   'rgba(20,  10,  50, 0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 512, 512);

  // Lettre K blanche
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.font = 'bold 230px "Arial Black", Arial, sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('K', 256, 256);

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function applyKabakooSkin(root) {
  const kTex = makeKLogoTexture();

  /* Trouver le mesh le plus grand (panneau supérieur du corps) */
  let bodyMesh = null;
  let maxVol   = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const box  = new THREE.Box3().setFromObject(o);
    const size = new THREE.Vector3();
    box.getSize(size);
    const vol = size.x * size.y * size.z;
    if (vol > maxVol) { maxVol = vol; bodyMesh = o; }
  });

  root.traverse((o) => {
    if (!o.isMesh) return;
    const name = (o.name || '').toLowerCase();

    const isProp = /prop|blade|helice|rotor|fan/i.test(name);
    const isArm  = /arm|leg|bras|strut/i.test(name);
    const isAccent = /accent|stripe|band|led|light|ring/i.test(name);
    const isBody = o === bodyMesh || /body|hull|corps|top|cover|carapace/i.test(name);

    if (isProp) {
      o.material = new THREE.MeshStandardMaterial({
        color:     new THREE.Color(0xd8dae0),
        metalness: 0.15,
        roughness: 0.55,
      });
    } else if (isAccent) {
      o.material = new THREE.MeshStandardMaterial({
        color:             new THREE.Color(0x6a35c8),
        metalness:         0.75,
        roughness:         0.2,
        emissive:          new THREE.Color(0x3a1880),
        emissiveIntensity: 0.5,
      });
    } else if (isBody) {
      o.material = new THREE.MeshStandardMaterial({
        color:     new THREE.Color(0x1a2248),
        map:       kTex,
        metalness: 0.6,
        roughness: 0.35,
      });
    } else if (isArm) {
      o.material = new THREE.MeshStandardMaterial({
        color:     new THREE.Color(0x1c2860),
        metalness: 0.7,
        roughness: 0.3,
      });
    } else {
      /* Tout le reste : bleu nuit sombre */
      o.material = new THREE.MeshStandardMaterial({
        color:     new THREE.Color(0x1e2a5c),
        metalness: 0.65,
        roughness: 0.4,
      });
    }
  });
}
