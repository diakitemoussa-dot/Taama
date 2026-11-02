# Mode GAME — Pilotage de drone en vol libre

Date : 2026-06-19
Projet : mosquee-djenne
Statut : design validé, prêt pour plan d'implémentation

## Objectif

Quand l'utilisateur clique sur le bouton **GAME** de la vue 3D extérieure, l'écran
bascule en mode paysage et affiche une interface de pilotage de drone (HUD type
capture fournie). L'utilisateur pilote librement un drone pour visiter la maquette
3D de la ville de Djenné. Le modèle 3D du drone (avec animations de déplacement)
sera fourni ultérieurement ; cette v1 construit toute l'expérience **sans le
modèle** (rig invisible prêt à recevoir le modèle).

## Contexte technique existant

- La scène 3D de la ville vit dans `app/mosque-viewer.js` : un `renderer`, une
  `scene`, une `camera` (PerspectiveCamera), des `OrbitControls`, et une boucle de
  rendu `tick()`. Le rendu cible le canvas `#mosqueCanvas` (plein écran).
- Le bouton GAME (`[data-action="game"]` dans `index.html`) fait actuellement voler
  la caméra vers une vue d'ensemble (`viewOverview`) et émet l'évènement
  `mosque:action` → `'game'` (personne ne l'écoute). Couplé au bouton INTÉRIEUR.
- Un modèle `assets/models/drone.glb` **avec animations** existe déjà, présenté par
  `app/drone-viewer.js` (drone décoratif qui tourne — séparé du mode jeu).
- Palette projet : `#55415d` (accents) + `#f9d58b` (fond). Style futuriste
  (glassmorphism, polices Orbitron/Rajdhani).

## Architecture

Nouveau module dédié **`app/drone-game.js`** (+ `styles/drone-game.css`), pour ne pas
alourdir `mosque-viewer.js`. Découpage des responsabilités :

- `mosque-viewer.js` (modifié) : expose à `drone-game.js` les objets partagés
  (`scene`, `camera`, `renderer`, `controls`) et un point d'accroche dans la boucle
  `tick()` pour mettre à jour le vol quand le mode jeu est actif. Branche le clic
  GAME pour entrer dans le mode jeu (au lieu du simple vol caméra).
- `drone-game.js` (nouveau) : machine d'état du mode jeu, gestion paysage/plein
  écran, HUD, joysticks, logique de vol (rig + caméra chase), outils (photo/vidéo/
  jour-nuit/POI/galerie).
- `index.html` (modifié) : markup du HUD + overlay « tournez le téléphone ».
- `styles/drone-game.css` (nouveau) : styles HUD, joysticks, overlay.

### Interface entre mosque-viewer.js et drone-game.js

`mosque-viewer.js` expose un objet global (ex. `window.MosqueScene`) avec :

- `scene`, `camera`, `renderer`, `controls` (références partagées)
- `setGameUpdate(fn | null)` : enregistre une fonction appelée chaque frame avec
  `dt` quand le mode jeu est actif (la boucle `tick()` l'appelle à la place de
  `controls.update()`).
- `viewOverview`, `viewTarget` : pour restaurer la caméra à la sortie.

`drone-game.js` consomme cette API. Aucune duplication de renderer/boucle.

## Entrée / sortie du mode jeu

### Entrée (clic GAME)
1. Tenter plein écran : `document.documentElement.requestFullscreen()`.
2. Verrouiller paysage : `screen.orientation.lock('landscape')` (Android/Chrome).
3. Si l'orientation reste portrait (iOS, ou lock indisponible) → afficher l'overlay
   **« Tournez votre téléphone 🔄 »** ; le HUD ne s'affiche qu'une fois en paysage
   (détection via `matchMedia('(orientation: landscape)')` / `resize`).
4. Masquer l'UI normale (boutons GAME/INTÉRIEUR/AR, menu radial).
5. Désactiver `controls` (`controls.enabled = false`).
6. Positionner le rig drone + la caméra chase, afficher le HUD.
7. `MosqueScene.setGameUpdate(updateFlight)`.

### Sortie (bouton ✕)
1. `MosqueScene.setGameUpdate(null)`.
2. Masquer le HUD, arrêter un éventuel enregistrement vidéo en cours.
3. `screen.orientation.unlock()`, sortir du plein écran (`document.exitFullscreen()`).
4. Réactiver `controls`, réafficher l'UI normale.
5. Ramener la caméra à `viewOverview` / `viewTarget`.

## Drone et caméra (sans modèle pour la v1)

- **Rig drone** : un `THREE.Object3D` vide ajouté à la scène, porteur de la position
  et de l'orientation (yaw) du drone. Invisible en v1 (option : petit repère de
  debug désactivable).
- **Caméra 3e personne** : positionnée derrière et légèrement au-dessus du rig,
  regardant le rig (chase cam avec léger lissage de suivi).
- **Évolution** : à la livraison de `drone.glb`, on attache le modèle au rig et on
  pilote ses animations (`AnimationMixer`) selon l'état de vol (avance, rotation,
  montée). Aucune autre refonte nécessaire.

## Pilotage

Mapping « Mode 2 » (caméra chase à la 3e personne) :

- **Joystick gauche** : axe Y = monter / descendre (altitude) ; axe X = pivoter
  (yaw gauche/droite).
- **Joystick droit** : axe Y = avancer / reculer ; axe X = translation latérale
  (strafe gauche/droite).

Détails :
- Entrées **tactiles** (drag dans la zone circulaire du joystick, position du pouce
  → vecteur normalisé -1..1) **et souris** (pour tester sur PC).
- Mouvement **amorti** (inertie / accélération-décélération) pour un ressenti drone.
- **Bornes de vol** : altitude minimale au-dessus du sol (pas sous le sol),
  distance max dans le dôme de ciel (réutiliser `controls.maxDistance` /
  `domeRadius` déjà calculés), pour rester dans la maquette.

## HUD vivant

Markup DOM superposé au canvas (pas dans le canvas), stylé glassmorphism palette
projet. Éléments :

- **Boussole / radar** (haut-gauche) : indique le cap réel (yaw) du drone, mis à
  jour chaque frame.
- **Télémétrie centrale** (réticule) : vitesse (MPH dérivée de la vitesse du rig),
  altitude (H, en m), angle. Valeurs réelles.
- **Batterie + signal** (haut-droite) : animés (décor vivant ; la batterie peut
  décroître lentement comme dans `main.js`).
- **Barre d'outils** (bas-centre), boutons **fonctionnels** :
  - 📷 **Photo** → `renderer.domElement.toDataURL('image/png')` → téléchargement +
    ajout à la galerie (miniature).
  - 🎥 **Vidéo** → `canvas.captureStream()` + `MediaRecorder` (start/stop, témoin
    d'enregistrement, téléchargement du `.webm` à l'arrêt).
  - 💡 **Ampoule** → bascule **jour / nuit** (ajuste lumières, `scene.background`,
    `scene.fog` ; deux presets).
  - ☰ **Liste** → panneau de **points d'intérêt** (monuments de la ville). v1 :
    liste statique (clic → libellé / recadrage doux optionnel).
  - ⭕ **Miniature** (bas-gauche) → ouvre la **galerie** des photos prises.
- **Bouton ✕** (coin haut-droit) → quitte le mode jeu.

## Compatibilité / dégradation

- **Android Chrome** : plein écran + lock paysage natif.
- **iOS Safari** : pas de lock d'orientation → overlay « tournez le téléphone ».
- **Desktop** : pas de lock ; le HUD s'affiche directement, pilotage à la souris ;
  fonctionne pour le développement et la démo PC.
- `MediaRecorder` indisponible (vieux navigateur) → le bouton 🎥 affiche un toast
  « non disponible » au lieu de planter.

## Hors périmètre (v1)

- Le **modèle 3D du drone** et le branchement de ses animations (livré plus tard).
- Mode FPS première personne (on a retenu la 3e personne).
- Parcours guidé / waypoints (vol libre uniquement).
- Sauvegarde persistante de la galerie (les photos vivent le temps de la session).
- Son spécifique du mode jeu (réutilise l'audio existant si pertinent, sinon nil).

## Critères de réussite

1. Clic GAME → bascule paysage (ou overlay rotation sur iOS) + HUD affiché.
2. Les deux joysticks pilotent un drone (rig) en vol libre dans la maquette, caméra
   chase à la 3e personne, avec bornes de vol respectées.
3. Boussole, vitesse, altitude se mettent à jour réellement.
4. Les 5 outils fonctionnent (photo, vidéo, jour/nuit, liste POI, galerie).
5. Bouton ✕ → retour propre à la vue 3D normale (orientation, UI, caméra restaurées).
6. Le rig est prêt à accueillir `drone.glb` sans refonte.
