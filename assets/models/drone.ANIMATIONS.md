# Drone — fiche de passation des animations (`drone.glb`)

Fichier : `assets/models/drone.glb` — drone quadricoptère animé pour l'expérience Web AR.
Export : Blender 5.1 → glTF 2.0 (GLB), mode **NLA_TRACKS** (1 piste NLA = 1 clip glTF).

> 📦 **Fichier compressé (~356 Ko)** : textures **WebP** (`EXT_texture_webp`, géré
> nativement par `GLTFLoader` sur navigateur moderne) + géométrie **Draco**
> (`KHR_draco_mesh_compression`).
>
> ⚠️ Le **Draco** nécessite un `DRACOLoader` configuré, sinon le modèle n'apparaît pas :
> ```js
> import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
> const draco = new DRACOLoader();
> draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
> loader.setDRACOLoader(draco);
> ```

## Principe

Animations **« sur place »** : chaque clip ne fait QUE le visuel (inclinaison du corps +
rotation des hélices). **Le déplacement réel de la position du drone est géré par le code
du jeu/AR**, pas par l'animation. Exception : le yaw est une vraie rotation de l'objet.

Tous les clips sont **bouclables** (frame 0 == dernière frame, aucun saut).
- Durée : **120 frames @ 60 fps = 2 s** par boucle.
- Hélices : sens réaliste de quadricoptère (diagonales identiques, adjacentes opposées),
  vitesse **~25 tours/s** (idle/déplacements), **~28** (montée), **~20** (descente).

## Hiérarchie & noms des nœuds dans le GLB

> ⚠️ glTF **nettoie les noms** (supprime points/espaces). Noms réels une fois chargé dans Three.js :
> - corps : **`Meshy_Mesh10`** (et non `Meshy_Mesh1.0`)
> - hélices : **`HELICE_1`**, `HELICE_2`, `HELICE_3`, `HELICE_4` (underscore, pas d'espace)
> - disques : `PropDisc_HELICE_1..4`

- Le **corps** (`Meshy_Mesh10`) est le nœud racine. L'incliner incline tout le drone.
- Les hélices + disques sont **enfants** du corps (suivent le corps).
- Chaque clip définit **toujours** la rotation du corps (même les clips « à plat » ont un
  léger sway autour de 0°) → repasser en `Idle_Hover` **remet le drone à plat** automatiquement.

## Liste des clips (noms exacts dans le GLB)

| Clip | Bouton UI | Effet visuel | Boucle |
|---|---|---|---|
| `Idle_Hover` | aucun (défaut) | Vol stationnaire, hélices, léger bob vertical | oui |
| `Ascend_Up` | joystick G — UP | Corps se soulève + hélices **plus rapides** | tant que maintenu |
| `Descend_Down` | joystick G — DOWN | Corps s'affaisse + hélices **plus lentes** | tant que maintenu |
| `Yaw_RotateLeft` | joystick G — ↺ | Rotation sur axe Z (anti-horaire), sans déplacement | tant que maintenu |
| `Yaw_RotateRight` | joystick G — ↻ | Rotation sur axe Z (horaire), sans déplacement | tant que maintenu |
| `Move_Forward` | joystick D — ▲ | Pitch avant **−10°** (pique du nez) | tant que maintenu |
| `Move_Backward` | joystick D — ▼ | Pitch arrière **+10°** (cabre) | tant que maintenu |
| `Move_Left` | joystick D — ◀ | Roll **+10°** (axe Y) | tant que maintenu |
| `Move_Right` | joystick D — ▶ | Roll **−10°** (axe Y) | tant que maintenu |

## Conventions d'axes (corps, repère Blender d'origine)

- **Pitch** = rotation autour de **X** → `Move_Forward` (−10°) / `Move_Backward` (+10°).
- **Roll**  = rotation autour de **Y** → `Move_Left` (+10°) / `Move_Right` (−10°).
- **Yaw**   = rotation autour de **Z** → `Yaw_RotateLeft/Right`.

> Note : à l'export glTF, l'axe « up » devient **Y** (`+Yup`). Les valeurs ci-dessus sont
> exprimées dans le repère Blender d'origine ; si le mapping ressenti dans le moteur est
> inversé, il suffit d'échanger la paire de clips concernée (avant/arrière ou gauche/droite).
> Les inclinaisons tenues portent une micro-oscillation (±1,2°) volontaire = flottement réaliste.

## Utilisation type (Three.js)

```js
const mixer = new THREE.AnimationMixer(droneRoot);
const clips = Object.fromEntries(gltf.animations.map(c => [c.name, c]));

// état de base
let current = mixer.clipAction(clips["Idle_Hover"]);
current.play();

// au changement d'état (bouton pressé), cross-fade doux ~0.2 s :
function setState(name) {
  const next = mixer.clipAction(clips[name]);
  next.reset().play();
  current.crossFadeTo(next, 0.2, false);
  current = next;
}
// ex : bouton UP -> setState("Ascend_Up"); relâché -> setState("Idle_Hover");
// le DÉPLACEMENT de position (droneRoot.position / rotation Z monde) reste géré par le code.
```

Tous les clips bouclent : `action.setLoop(THREE.LoopRepeat)` (par défaut).
Le cross-fade gère l'entrée/sortie d'inclinaison automatiquement.
