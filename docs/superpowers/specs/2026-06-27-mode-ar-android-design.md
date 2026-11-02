# Mode AR Android — Mosquée de Djenné
**Date :** 2026-06-27  
**Statut :** Approuvé  

---

## Objectif

Le bouton AR (déjà présent dans l'UI, actuellement placeholder) lance une expérience de réalité augmentée Android via WebXR. L'utilisateur pose une maquette 3D de la mosquée de Djenné sur une surface réelle (table, sol, cour) et peut la contempler à 360°.

---

## Périmètre

- **Plateforme cible :** Android Chrome (WebXR `immersive-ar` + `hit-test`)
- **iOS :** hors scope pour cette itération (prévu : conversion USDZ + Quick Look)
- **Modèle 3D :** uniquement les 15 meshes enfants de l'empty `la mosque en globale` du fichier `djenne-ar.glb`

---

## Fichiers impactés

| Fichier | Action |
|---|---|
| `assets/models/djenne-mosque-only.glb` | Créer — GLB allégé (mosquée seule) |
| `tools/extract-ar-model.mjs` | Créer — script one-shot d'extraction via gltf-transform |
| `app/ar-mode.js` | Créer — module AR complet |
| `app/mosque-viewer.js` | Modifier — brancher `arMode.enter()` sur le clic AR |
| `index.html` | Modifier — ajouter l'overlay AR HTML |
| `styles/mosque.css` | Modifier — styles overlay AR |

---

## Extraction du GLB

Script `tools/extract-ar-model.mjs` utilisant `@gltf-transform/core` (déjà dans `node_modules`) :

- Charge `assets/models/djenne-ar.glb`
- Isole les 15 nodes enfants de `la mosque en globale`
- Supprime : `WEB_Sky`, `WEB_Cloud3D_4`, `home`, `land`, `arbre`
- Écrit `assets/models/djenne-mosque-only.glb`

Ce script est exécuté **une seule fois** (`node tools/extract-ar-model.mjs`), le GLB résultant est commité.

---

## Flow utilisateur

```
[Bouton AR]
    │
    ▼
Vérif navigator.xr?.isSessionSupported('immersive-ar')
    │
    ├─ Non supporté → toast "AR non disponible sur cet appareil"
    │
    └─ Supporté
        │
        ▼
    Masquer UI mosque (OrbitControls désactivés)
    Démarrer session immersive-ar + feature hit-test
        │
        ▼
    [Phase SCAN]
    Reticule (anneau doré) projeté sur la surface détectée
    Hint : "Appuyez pour poser la mosquée"
        │
        ▼ (tap)
    [Phase PLACÉE]
    Mosquée posée à la position du reticule
    Reticule masqué
    Hint : "Pincez pour redimensionner · Marchez autour pour explorer"
    Hint fade-out après 4 secondes
        │
        ▼ (bouton ✕)
    Session AR terminée
    Retour à la vue mosque normale
```

---

## Module `app/ar-mode.js`

Expose une seule fonction publique : `enter()`.

### Responsabilités internes

| Fonction | Rôle |
|---|---|
| `enter()` | Point d'entrée — vérifie support, charge le GLB, démarre la session |
| `_loadModel()` | Charge `djenne-mosque-only.glb` via GLTFLoader, scale initiale `0.08` |
| `_startSession()` | `navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'] })` |
| `_onXRFrame(t, frame)` | Boucle AR — hit-test → position reticule → render |
| `_onTap()` | Pose la mosquée à la position courante du reticule |
| `_setupGestures()` | Pinch → scale, un doigt → rotation Y |
| `_exit()` | Termine la session, restaure l'UI mosque |

### Reticule

`THREE.RingGeometry(0.1, 0.13, 32)` avec `MeshBasicMaterial` couleur `#f9d58b` (palette projet), orienté selon la normale de la surface hit-testée. Visible uniquement en phase SCAN.

### Scale

- Initiale : `0.08` (mosquée ~25 cm de large sur une table)
- Plage pinch : `[0.02, 0.5]` (min ~6cm, max ~1.5m)

### Gestes

- **Pinch (2 doigts)** : delta distance entre les deux touches → scale
- **Un doigt** : delta X → rotation Y de la mosquée (une fois posée)
- Implémenté avec les événements `pointerdown / pointermove / pointerup` natifs — aucune librairie externe

---

## Overlay HTML (dans `#mosqueStage`)

```html
<div id="arOverlay" class="ar-overlay" aria-hidden="true">
  <button id="arQuit" class="ar-quit" aria-label="Quitter AR">✕</button>
  <p id="arHint" class="ar-hint"></p>
</div>
```

Géré directement par `ar-mode.js` (show/hide, texte du hint).

---

## Styles (`styles/mosque.css`)

- `.ar-overlay` : position fixed, plein écran, pointer-events none (le canvas WebXR est dessus)
- `.ar-quit` : coin haut-droit, style cohérent avec `.dg-quit` (mode drone)
- `.ar-hint` : centré bas d'écran, fond glassmorphism `#08060c99`, police Rajdhani, couleur `#f9d58b`

---

## Gestion des erreurs

| Cas | Comportement |
|---|---|
| WebXR non supporté | Toast "AR non disponible sur cet appareil" |
| Hit-test non disponible | Toast "Surface non détectée — pointez vers un sol plat" |
| GLB non chargé | Toast "Erreur de chargement du modèle AR" |
| Session interrompue par le système | `_exit()` appelé automatiquement via `session.addEventListener('end', _exit)` |

---

## Hors scope

- iOS / USDZ (itération suivante)
- Éclairage AR adaptatif (WebXR light estimation)
- Occlusion des meshes
- Partage de capture AR
