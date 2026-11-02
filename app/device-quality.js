/* ============================================================
   NIVEAU DE QUALITÉ SELON L'APPAREIL
   ------------------------------------------------------------
   'low'  : mobile d'entrée de gamme (peu de mémoire / de cœurs)
   'mid'  : mobile / tablette standard
   'high' : ordinateur ou mobile très puissant

   Forçable dans l'URL : ?q=low | ?q=mid | ?q=high
   Logique pure (les entrées sont passées en paramètre) pour rester testable.
   ============================================================ */

export const QUALITY_LEVELS = ['low', 'mid', 'high'];

/** Réglages par niveau. tiles = dossier du jeu de tuiles de la mosquée. */
export const QUALITY_PRESETS = {
  low:  { tilesDir: 'tiles-mobile', maxPixelRatio: 1,   shadows: false },
  mid:  { tilesDir: 'tiles-mobile', maxPixelRatio: 1.5, shadows: true },
  high: { tilesDir: 'tiles',        maxPixelRatio: 2,   shadows: true },
};

/**
 * @param {{ forced?: string|null, coarsePointer?: boolean, memoryGB?: number,
 *           cores?: number }} env
 */
export function pickQuality(env = {}) {
  const { forced = null, coarsePointer = false, memoryGB, cores } = env;
  if (forced && QUALITY_LEVELS.includes(forced)) return forced;
  if (!coarsePointer) return 'high';                       // ordinateur
  // iOS / Safari ne donnent pas deviceMemory (tous les iPhone récents sont puissants) :
  // on s'appuie alors sur les cœurs ; la baisse auto selon les FPS couvre le reste.
  const lowMem = typeof memoryGB === 'number' && memoryGB <= 3;
  const fewCores = typeof cores === 'number' && cores <= 4;
  if (lowMem || fewCores) return 'low';
  return 'mid';
}

/** Qualité choisie par le joueur dans Options › Affichage (« auto » = aucune valeur enregistrée). */
export function storedQuality(win = window) {
  try { return win.localStorage.getItem('taama.quality'); } catch (_) { return null; }
}

/** Lit l'environnement réel du navigateur. */
export function detectQuality(win = window) {
  const nav = win.navigator || {};
  const params = new URLSearchParams(win.location ? win.location.search : '');
  return pickQuality({
    forced: params.get('q') || storedQuality(win),
    coarsePointer: !!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches),
    memoryGB: nav.deviceMemory,
    cores: nav.hardwareConcurrency,
  });
}
