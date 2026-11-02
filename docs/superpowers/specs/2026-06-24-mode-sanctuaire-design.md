# Mode Sanctuaire — Spec de design
**Date :** 2026-06-24
**Projet :** mosquee-djenne (Three.js)

---

## 1. Résumé

Nouveau mode "Sanctuaire" : visite intérieure de la Mosquée de Djenné en vue FPS (caméra = yeux du visiteur). L'utilisateur se déplace librement dans toute la mosquée (salle de prière + cour + portes) avec un joystick mobile et un drag-to-look, sans pouvoir traverser les murs.

---

## 2. Architecture

### Nouveau fichier
`app/sanctuary-mode.js` — même patron que `drone-game.js`.

**API exposée :**
```js
initSanctuary(MosqueScene)   // → { enter(), exit(), isActive() }
```

### Intégration dans `mosque-viewer.js`
- Le bouton "Sanctuaire" (UI existante) appelle `sanctuary.enter()`
- `MosqueScene` (renderer, scene, camera, controls) est passé en entrée
- `OrbitControls` est désactivé pendant le mode, réactivé à la sortie
- `gameUpdate(dt)` existant sert de seam : `mosque-viewer.js` appellera `sanctuaryUpdate(dt)` dans sa boucle `tick()` via `setGameUpdate(fn)`

### Séquence d'activation
1. Clic "Sanctuaire" → BVH construit si pas encore fait (async, spinner sur le bouton)
2. Travelling caméra extérieure → devant `Porte_Principale` (via système travelling existant)
3. Animation caméra : vol d'entrée par la porte principale vers la position de départ intérieure
4. Bascule FPS : caméra à hauteur yeux (1.7 m), OrbitControls off, HUD Sanctuaire affiché
5. Clic retour → fondu noir → caméra vue extérieure → OrbitControls réactivé → HUD retiré

---

## 3. Position de départ

Coordonnées Blender du point de départ intérieur :
- Blender : `X: -46.651, Y: -21.415, Z: 6.7586`
- Three.js : `x: -46.651, y: 1.7, z: 21.415` (hauteur forcée à 1.7 m = yeux)

Direction initiale : yaw ≈ `-π/2` (face vers -X en Three.js, soit vers le centre de la salle de prière — déduit de la rotation Blender `Z: -89.98°`). Pitch initial : 0° (horizontal).

---

## 4. Collisions

### Meshes collidables
Depuis `djenne-ar.glb` (groupe `la mosque en globale`) :
- `Mosquee_Base`
- `Piliers`
- `Poteaux`
- `Mosquee_Cloture`
- `Porte_Principale`
- `Porte_Cour`
- `Portes_Exterieures`
- `Torons_Internes`
- `Torons_Externes`

### Technique
- **BVH** (`three-mesh-bvh`, déjà installé) construit en `async` au premier `enter()`
- **Capsule joueur** : rayon 0.3 m, hauteur 1.7 m
- **Sol** : raycast vers le bas (longueur 2 m) — maintient le joueur collé au sol
- **Murs** : 6 raycasts horizontaux (avant, arrière, gauche, droite, 2 diagonales), repousse si distance < 0.3 m
- Construction BVH unique (mémorisée) — pas de rebuild à chaque `enter()`

---

## 5. Contrôles

### Mobile
| Action | Geste |
|--------|-------|
| Se déplacer | Joystick unique (bas droite) |
| Regarder (yaw + pitch libre) | Drag n'importe où sur l'écran (hors joystick) |
| Réalignement auto | Joystick poussé vers l'avant → yaw interpolé (lerp 5°/frame) face à la direction de marche |
| Quitter | Bouton retour (haut droite) |

### Desktop
| Action | Touche / geste |
|--------|----------------|
| Avancer / reculer | `Z` / `S` ou `↑` / `↓` |
| Strafe gauche / droite | `Q` / `D` ou `←` / `→` |
| Regarder | Clic gauche maintenu + drag souris |
| Quitter | `Échap` ou bouton retour |

### Vitesse de marche
- Normale : 3 m/s
- Le joueur ne peut pas sauter
- Pitch limité à ±80° (évite le flip caméra en regardant tout droit en haut/bas)

---

## 6. HUD

Même charte glassmorphism / Orbitron que le mode drone.

| Élément | Position | Détail |
|---------|----------|--------|
| Boussole | Haut centre | Flèche N orientée selon yaw joueur |
| Bouton retour | Haut droite | Cercle rouge, icône ↩ — même style mode drone |
| Joystick | Bas droite | Cercle fingerprint glassmorphism |
| Barre d'actions | Bas centre | 5 icônes : avatar, lampe (toggle éclairage), appareil photo (screenshot), menu, vidéo |

### Barre d'actions — détail fonctionnel
- **Avatar** : décoratif (futur : sélection personnage)
- **Lampe** : toggle une `PointLight` portée par la caméra pour éclairer l'intérieur
- **Appareil photo** : `renderer.domElement.toDataURL()` → téléchargement PNG
- **Menu** : pause + affiche panneau d'info (futur)
- **Vidéo** : décoratif (futur)

---

## 7. Éclairage intérieur

L'intérieur de la mosquée est sombre. On ajoute :
- 1 `AmbientLight` faible (intensité 0.4) active uniquement en mode Sanctuaire
- 1 `PointLight` attachée à la caméra (intensité 1.2, portée 20 m) — activée/désactivée par le bouton lampe du HUD

---

## 8. Ce qui est hors scope

- Sélection de personnage (avatar décoratif seulement)
- Collision avec les objets mobiliers (Tapis_Priere, Oeufs_Autruche, Tombeaux) — le joueur passe par-dessus
- Mode multijoueur
- Audio ambiant intérieur
