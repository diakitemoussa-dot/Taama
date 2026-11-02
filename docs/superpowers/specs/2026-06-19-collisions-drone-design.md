# Collisions drone (raycasting) + atterrissage au sol

Date : 2026-06-19
Projet : mosquee-djenne
Statut : design validé, prêt pour implémentation

## Objectif

Empêcher le drone du mode GAME de traverser les objets de la maquette (bâtiments,
mosquée, terrain) et lui permettre de descendre très bas pour se poser au sol ou
sur un toit. Les nuages et le ciel/dôme ne sont PAS des obstacles.

## Contexte existant

- Le mode jeu vit dans `app/drone-game.js`. Le drone est un `rig` (THREE.Object3D)
  déplacé par `update(dt)` ; une caméra chase le suit.
- La ville est un GLB unique (`djenne-ar.glb`) ajouté à `M.scene`. Meshes nommés :
  `Mosquee_Base`, `Minarets`, bâtiments, collines, etc. Le ciel/dôme matche
  `/Sky|Sphere/i`, les nuages `/Cloud/i`.
- `update()` borne aujourd'hui le vol avec un sol artificiel `groundY =
  M.viewTarget.y + 5`, un plafond `M.viewTarget.y + 400`, et un rayon max
  `(M.domeRadius) * 0.78`.
- `M` = `window.MosqueScene` expose `scene`, `camera`, `viewTarget`, `domeRadius`.

## Architecture

Tout dans `app/drone-game.js`, nouvelle section « Collisions » :

- Un `THREE.Raycaster` unique réutilisé (pas d'allocation par frame).
- Un tableau `colliders` (meshes solides) construit **une seule fois**, paresseusement,
  à la première frame de vol où il est vide.
- Deux fonctions appelées depuis `update()` :
  - `groundUnder()` → altitude minimale sous le drone (atterrissage).
  - `blockHorizontal(dt)` → annule/glisse le déplacement horizontal s'il entre dans un mur.

### Construction des colliders

Parcourir `M.scene`. Retenir chaque `o.isMesh` SAUF si :
- son nom matche `/Cloud/i` (nuages), ou
- son nom matche `/Sky|Sphere/i` (ciel/dôme), ou
- il est un descendant du `rig` (le drone lui-même : `Meshy_Mesh*`, `HELICE*`).

Test « descendant du rig » : remonter `o.parent` jusqu'à la racine ; si on croise
`rig`, exclure. La ville étant statique, la liste est construite une fois puis réutilisée.

## Atterrissage (rayon vertical)

Chaque frame, APRÈS application du déplacement vertical :
1. Origine = `rig.position` décalée vers le haut d'une marge (ex. `+30`), direction `(0,-1,0)`.
2. `raycaster.far` = grande (ex. `1000`). `intersectObjects(colliders, true)`.
3. Si touche : `minY = hit.point.y + 1.5` (garde au sol). Si `rig.position.y < minY`,
   forcer `rig.position.y = minY` (et annuler une vitesse verticale descendante résiduelle).
4. Si aucune touche : plancher de secours `rig.position.y = max(rig.position.y,
   M.viewTarget.y - 50)` (évite la chute infinie hors maquette).

Ceci REMPLACE le sol artificiel `M.viewTarget.y + 5`. Le plafond et le rayon max du
dôme sont conservés tels quels.

## Anti-traversée horizontale (rayon dans le sens du mouvement)

Chaque frame, AVANT d'appliquer le déplacement horizontal (ou en corrigeant après) :
1. Vecteur de déplacement horizontal voulu `move = _fwd*(-vel.fwd*dt) + _side*(vel.side*dt)`
   (composantes x/z uniquement). Distance `d = move.length()`. Si `d < 1e-4`, ne rien faire.
2. Rayon : origine `rig.position`, direction `move/d`, `far = d + RADIUS` (RADIUS ≈ 8,
   rayon du drone).
3. Si touche dans `far` :
   - Avancer seulement jusqu'à `(hit.distance - RADIUS)` le long de `move` (jamais négatif).
   - **Glissement** : projeter le reste du mouvement sur le plan du mur via la normale
     monde de la face touchée (`hit.face.normal` transformée par `hit.object.matrixWorld`),
     composantes horizontales, et l'appliquer (atténué) pour longer le mur au lieu de coller.
4. Sinon : appliquer `move` normalement.

## Performance

- Un seul `Raycaster`, **2 rayons/frame** (vertical + horizontal).
- `colliders` construit une fois. `far` borné. Pas d'allocation de vecteurs dans la
  boucle (réutiliser des temporaires module-level).

## Hors périmètre

- Collision verticale vers le haut (plafonds/surplombs) : non gérée (la maquette est
  surtout plate ; YAGNI). Le glissement latéral + le sol couvrent les cas réels.
- three-mesh-bvh : non utilisé (raycasting suffit). L'interface (`groundUnder`,
  `blockHorizontal`) permettrait d'y passer plus tard sans changer `update()`.

## Critères de réussite

1. Le drone ne traverse plus les bâtiments / la mosquée : en avançant vers un mur, il
   s'arrête devant (et glisse le long).
2. Le drone peut descendre jusqu'à ~1,5 u du sol (sable) et s'y poser ; au-dessus d'un
   toit, il se pose sur le toit.
3. Les nuages et le ciel ne bloquent jamais le drone.
4. Plafond et rayon max du dôme toujours respectés.
5. Pas de chute de framerate notable (2 rayons/frame).
