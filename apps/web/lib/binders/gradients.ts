// Palette de dégradés nommés pour l'apparence d'un binder. La ligne de binder
// de l'accueil en dépend (`BinderSummary.coverGradient` est une clé de dégradé
// de la palette des pips), et la feuille `Binder look` réutilise exactement ce
// module plutôt que d'en recréer un second. L'un des deux seuls fichiers
// autorisés à porter des valeurs hex littérales avec `app/globals.css`
// (docs/development.md) — toute teinte dérivée d'un binder (fond de ligne,
// pastille de la feuille d'apparence) passe par lui, jamais recopiée dans un
// composant.
export type GradientKey = 'blue' | 'green' | 'red' | 'grey' | 'gold' | 'purple'

export const BINDER_GRADIENTS: Record<GradientKey, string> = {
  blue: 'linear-gradient(160deg,#2b4bd6,#4f8cff)',
  green: 'linear-gradient(160deg,#1f7a5a,#34d399)',
  red: 'linear-gradient(160deg,#7a3f2f,#d05a44)',
  grey: 'linear-gradient(160deg,#4a4550,#9aa0ac)',
  gold: 'linear-gradient(160deg,#6b5a1f,#efe9cf)',
  purple: 'linear-gradient(160deg,#4a2f6b,#8b5cf6)',
}

// `containers.cover_gradient` est un `text` libre (packages/db/src/schema.ts) : une valeur
// périmée ou corrompue ne doit jamais rendre une ligne cassée (trois
// variantes explicites, pas une bordure ou un fond approximatif) —
// `getCollectionHome` s'en sert pour retomber sur `null`
// (surface nue) plutôt que de propager une clé inconnue.
export function isGradientKey(value: string): value is GradientKey {
  return Object.prototype.hasOwnProperty.call(BINDER_GRADIENTS, value)
}

const HEX_COLOR_PATTERN = /#[0-9a-f]{6}/gi

// Surface standard `#12151c` (`--color-surface-1`, app/globals.css) — l'un des
// deux anchors mesurés de `binderRowBackground` ci-dessous : c'est la couleur
// exacte que la variante nue affiche, donc celle que `intensity = 0` doit
// reproduire au pixel (`intensity = 0` rend le binder visuellement identique
// au mode None). Recopiée ici en triplet
// numérique pour nourrir `stopTowardSurface` ci-dessous.
const SURFACE_HEX = '#12151c'
const SURFACE_CHANNELS = hexToChannels(SURFACE_HEX)

// Un palier `rgba()` qui, une fois composé par le navigateur sur le fond
// d'écran `#08090c` (jamais sur une surface opaque interposée :
// `binder-row.tsx` ne pose **aucun** `bg-surface-1` sous la variante
// Colour), redonne un résultat composé égal à
// l'interpolation linéaire entre les deux anchors mesurés de
// `binderRowBackground` :
//   - `intensity = 1` → le palier tel quel (`rgba(hex, baseAlpha)`),
//     reproduisant au pixel le design validé
//     (dx=10 `rgb(22,74,58)`, dx=180 `rgb(11,28,25)`, terminal
//     `rgb(18,22,28)` sur l'apparence `green`) ;
//   - `intensity = 0` → `SURFACE_HEX` opaque, la même surface que la
//     variante nue.
// `intensity` ne multiplie donc pas l'alpha d'un palier tenu constant (à
// `intensity = 0` les trois paliers deviendraient transparents, laissant voir
// le fond d'écran `#08090c` — une ligne « trouée » — au lieu de la surface
// `#12151c`) : c'est le **résultat
// composé** qui glisse linéairement d'un anchor à l'autre, en résolvant pour
// chaque palier le triplet rgba() qui produit ce résultat une fois composé.
// Le palier terminal (`baseAlpha = 1`, `hex = SURFACE_HEX`) retombe alors
// naturellement sur `rgba(SURFACE, 1)` à toute intensité — son traitement ne
// dépend que de ce que vaut `intensity = 0`, jamais d'un scaling séparé
// (alpha-scaler ce palier ne changerait rien à `intensity = 1`).
function stopTowardSurface(hex: string, baseAlpha: number, intensity: number): string {
  const [r, g, b] = hexToChannels(hex)
  const [sr, sg, sb] = SURFACE_CHANNELS
  const alpha = 1 - intensity * (1 - baseAlpha)
  const mix = (channel: number, surfaceChannel: number) =>
    (intensity * baseAlpha * channel + (1 - intensity) * surfaceChannel) / alpha
  const round = (n: number) => Math.round(n)
  return `rgba(${round(mix(r, sr))}, ${round(mix(g, sg))}, ${round(mix(b, sb))}, ${Number(alpha.toFixed(4))})`
}

// Fond de ligne de binder pour l'apparence « Colour », dérivé des deux teintes
// de `BINDER_GRADIENTS[key]` — jamais un second dégradé recopié à la main. La
// teinte claire domine à 0 % (là où le texte s'assoit), la teinte sombre
// s'efface à 46 %, puis la ligne se résout sur la surface standard `#12151c`
// avant la colonne de valeur — reproduit au pixel le design validé (« Trade
// binder », apparence `green`) quand `intensity = 1`, et la surface nue
// (`#12151c` opaque, sur les trois paliers à la fois) quand `intensity = 0` —
// les deux anchors mesurés que `stopTowardSurface` tient simultanément. Le
// composant qui consomme cette chaîne ne pose donc **aucun** `bg-surface-1`
// sous elle : les paliers translucides continuent de se composer directement
// sur `#08090c` (le fond de l'écran), jamais sur `#12151c`, à toute intensité.
export function binderRowBackground(key: GradientKey, intensity = 1): string {
  const [dark, light] = BINDER_GRADIENTS[key].match(HEX_COLOR_PATTERN) ?? []
  if (!dark || !light) {
    throw new Error(`Malformed gradient for key "${key}".`)
  }
  const lightStop = stopTowardSurface(light, 0.34, intensity)
  const darkStop = stopTowardSurface(dark, 0.16, intensity)
  const terminalStop = stopTowardSurface(SURFACE_HEX, 1, intensity)
  return `linear-gradient(100deg, ${lightStop} 0%, ${darkStop} 46%, ${terminalStop} 100%)`
}

// Fond de l'en-tête de binder illustré en mode `Colour` (écran
// `Binder look sheet`) : la teinte foncée de `BINDER_GRADIENTS[key]`
// (l'« accent » du design) qui s'efface jusqu'au fond plein de l'app avant
// que le titre ne s'y assoie — reproduit au pixel le design validé
// (prévisualisation de la feuille sur le fond `Colour`). `#08090c` reprend `--color-bg`
// (app/globals.css) : gradients.ts est l'un des deux seuls fichiers
// autorisés à porter une valeur hex littérale (docs/development.md), ce module reste
// donc la seule source de la formule plutôt que de la recopier dans
// `binder-header.tsx`.
export function binderBackdropGradient(key: GradientKey): string {
  const [dark, light] = BINDER_GRADIENTS[key].match(HEX_COLOR_PATTERN) ?? []
  if (!dark || !light) {
    throw new Error(`Malformed gradient for key "${key}".`)
  }
  return `linear-gradient(180deg, ${dark}, ${light})`
}

// Les deux calques qui font disparaître ce fond, et l'ordre dans lequel ils
// agissent. C'est le point qui distingue un fond qui s'éteint d'un fond qui
// s'arrête net — le précédent `dark 0% → #08090c 45%` résolvait la teinte à
// mi-bande puis peignait un aplat, et la coupure se voyait comme une barre.
//
// Le masque est ce qui dissout réellement le fond, et il lui faut presque
// toute la hauteur de la bande pour le faire progressivement. Le voile, lui,
// est là pour la lisibilité : il culmine autour du titre puis se relâche.
// Dans l'autre sens — un voile presque opaque en bas — la teinte serait déjà
// masquée avant que le masque n'ait commencé, et le fond paraîtrait s'arrêter
// d'un coup alors même qu'il s'efface. Les deux atteignent zéro au même bord,
// c'est ce qui évite une ligne droite là où le fond finit.
//
// Les paliers sont adoucis plutôt que linéaires : une rampe droite vers la
// transparence se voit elle-même comme une bande, la luminosité perçue ne
// suivant pas l'alpha linéairement.
const BACKDROP_FADE_STOPS: Array<{ at: number; alpha: number }> = [
  { at: 0, alpha: 1 },
  { at: 0.26, alpha: 1 },
  { at: 0.44, alpha: 0.82 },
  { at: 0.62, alpha: 0.5 },
  { at: 0.79, alpha: 0.22 },
  { at: 0.9, alpha: 0.06 },
  { at: 1, alpha: 0 },
]

const BACKDROP_SCRIM_STOPS: Array<{ at: number; alpha: number }> = [
  { at: 0, alpha: 0.06 },
  { at: 0.3, alpha: 0.34 },
  { at: 0.52, alpha: 0.52 },
  { at: 0.72, alpha: 0.42 },
  { at: 0.88, alpha: 0.16 },
  { at: 1, alpha: 0 },
]

function stopsToGradient(
  stops: Array<{ at: number; alpha: number }>,
  channels: string,
): string {
  const parts = stops.map((stop) => `rgba(${channels}, ${stop.alpha}) ${Math.round(stop.at * 100)}%`)
  return `linear-gradient(180deg, ${parts.join(', ')})`
}

// Masque de dissolution du fond (`mask-image`), et voile de lisibilité posé
// par-dessus. Consommés en style inline par les trois écrans qui peignent un
// fond de container (binder, deck, page publique de partage) : ce module est
// l'un des deux seuls autorisés à porter des valeurs littérales, et les
// mêmes paliers nourrissent `worstCaseTitleContrast` ci-dessous — une
// seconde copie en CSS les ferait diverger sans bruit.
export const BACKDROP_FADE_MASK = stopsToGradient(BACKDROP_FADE_STOPS, '0, 0, 0')
export const BACKDROP_SCRIM = stopsToGradient(BACKDROP_SCRIM_STOPS, '8, 9, 12')

// Couleur du voile de l'en-tête illustré en mode `Card art`
// (`--gradient-binder-backdrop-art`, app/globals.css) — recopiée ici en tant
// que constante uniquement pour que `worstCaseTitleContrast` ci-dessous
// puisse la faire entrer dans le même calcul que `binderBackdropGradient`,
// jamais consommée telle quelle par un composant (qui reste sur la classe
// utilitaire `.bg-gradient-binder-backdrop-art`).
const BACKDROP_VEIL_HEX = '#08090c'

// Couleur du texte de titre (`--color-text`, app/globals.css) — recopiée ici
// pour la même raison que `BACKDROP_VEIL_HEX` ci-dessus.
const TITLE_TEXT_HEX = '#eef1f6'

// Position verticale du titre dans la bande de 460px de l'en-tête illustré
// — recopiée des tokens réellement consommés
// par `binder-header.tsx` (`pt-20`, la rangée de boutons qui se dimensionne
// sur le bouton accent `+` — `flex items-center` avec
// `--height-header-add-binder: 40px`, pas sur les boutons ronds 36px qui
// l'entourent —, `--spacing-binder-title-gap: 130px`, app/globals.css),
// jamais mesurée à la main dans ce fichier : additionner les trois donne la
// même boîte que le DOM réel. Le titre s'assoit à 190px sur 460 (41.3 %),
// donc **avant** le palier 52 % du dégradé : le vrai plancher est calculé
// ci-dessous par interpolation plutôt que supposé. Mesure de contrôle :
// `h1.getBoundingClientRect().top` = 190px (rangée de boutons de 40px, pas
// 36px).
const HEADER_PADDING_TOP_PX = 20
const HEADER_BUTTON_ROW_HEIGHT_PX = 40
const HEADER_TITLE_GAP_PX = 130
const BACKDROP_HEIGHT_PX = 460 // --height-binder-backdrop
const TITLE_TOP_FRACTION =
  (HEADER_PADDING_TOP_PX + HEADER_BUTTON_ROW_HEIGHT_PX + HEADER_TITLE_GAP_PX) / BACKDROP_HEIGHT_PX

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// Paliers de `--gradient-binder-backdrop-art` (app/globals.css), valeurs du
// design validé (`0% → 0.15, 52% → 0.72, 100% → 1`, `#08090c` opaque) — la
// seule source de ces trois points, jamais recopiés séparément dans `worstCaseTitleContrast`.
const ART_VEIL_STOPS: Array<{ at: number; alpha: number }> = [
  { at: 0, alpha: 0.15 },
  { at: 0.52, alpha: 0.72 },
  { at: 1, alpha: 1 },
]

function alphaAtFraction(fraction: number, stops: Array<{ at: number; alpha: number }>): number {
  for (let i = 1; i < stops.length; i += 1) {
    const next = stops[i]!
    if (fraction <= next.at) {
      const prev = stops[i - 1]!
      const span = next.at - prev.at
      const t = span === 0 ? 0 : (fraction - prev.at) / span
      return lerp(prev.alpha, next.alpha, t)
    }
  }
  return stops[stops.length - 1]!.alpha
}

function hexToChannels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

// Luminance relative WCAG (sRGB → linéaire), utilisée uniquement par
// `contrastRatio`/`worstCaseTitleContrast` ci-dessous — jamais par un
// composant (sert au test automatisé de contraste).
function srgbChannelToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToChannels(hex)
  return 0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b)
}

// Ratio de contraste WCAG entre deux couleurs pleines (formule standard
// `(L1 + 0.05) / (L2 + 0.05)`, L1 ≥ L2).
export function contrastRatio(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(hexA)
  const l2 = relativeLuminance(hexB)
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (lighter + 0.05) / (darker + 0.05)
}

// Compose `hex` (le voile, opaque) à `alpha` par-dessus un blanc pur — le pire
// cas d'« une illustration claire » sous le voile, jamais une couleur de carte
// réelle (impossible à connaître statiquement).
function blendOverWhite(hex: string, alpha: number): string {
  const [r, g, b] = hexToChannels(hex)
  const blend = (channel: number) => Math.round(channel * alpha + 255 * (1 - alpha))
  return `#${[blend(r), blend(g), blend(b)].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

// Interpole deux couleurs pleines — utilisé pour reproduire le mode Colour
// (`binderBackdropGradient`) à la fraction réelle où le titre s'assoit,
// jamais une opacité (ce dégradé n'en porte pas, il interpole deux couleurs
// opaques).
function hexLerp(fromHex: string, toHex: string, t: number): string {
  const [r1, g1, b1] = hexToChannels(fromHex)
  const [r2, g2, b2] = hexToChannels(toHex)
  const mix = (a: number, b: number) => Math.round(lerp(a, b, t))
  return `#${[mix(r1, r2), mix(g1, g2), mix(b1, b2)].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

// Pire cas de contraste titre/fond de l'en-tête de binder illustré, tous
// modes confondus (mesuré au pire cas des six dégradés et d'une illustration
// claire) — à `intensity = 1`, le plafond que la feuille `Binder look`
// autorise (`Intensity` plafonne l'habillage). Une intensité plus faible ne fait que révéler
// `--color-bg` (quasi noir) sous le voile, ce qui ne peut qu'améliorer ce
// contraste, jamais le dégrader — `intensity = 1` est donc bien le pire cas,
// pas une approximation. Les deux dégradés sont évalués à la fraction réelle
// où le titre s'assoit (`TITLE_TOP_FRACTION`), par interpolation de leurs
// propres paliers — jamais en supposant le titre après un palier donné
// (cette hypothèse serait fausse pour le mode `Card art`).
export function worstCaseTitleContrast(): number {
  const artAlpha = alphaAtFraction(TITLE_TOP_FRACTION, ART_VEIL_STOPS)
  const artWorstCase = contrastRatio(TITLE_TEXT_HEX, blendOverWhite(BACKDROP_VEIL_HEX, artAlpha))

  // Mode Colour : la bande porte le dégradé complet de la clé, dissous par
  // `BACKDROP_FADE_MASK` puis recouvert de `BACKDROP_SCRIM`. Les trois
  // couches sont recomposées ici dans l'ordre où le navigateur les compose,
  // à la fraction réelle où le titre s'assoit (190/460 = 41.3 %) — le voile
  // compte, sans lui les teintes claires (`gold`) passent sous 4.5:1.
  const fadeAlpha = alphaAtFraction(TITLE_TOP_FRACTION, BACKDROP_FADE_STOPS)
  const scrimAlpha = alphaAtFraction(TITLE_TOP_FRACTION, BACKDROP_SCRIM_STOPS)
  const colourContrasts = (Object.keys(BINDER_GRADIENTS) as GradientKey[]).map((key) => {
    const [dark, light] = BINDER_GRADIENTS[key].match(HEX_COLOR_PATTERN) ?? []
    if (!dark || !light) {
      throw new Error(`Malformed gradient for key "${key}".`)
    }
    // La teinte du dégradé à cette hauteur, posée à l'alpha du masque sur le
    // fond d'écran, puis assombrie par le voile.
    const hue = hexLerp(dark, light, TITLE_TOP_FRACTION)
    const masked = hexLerp(BACKDROP_VEIL_HEX, hue, fadeAlpha)
    const veiled = hexLerp(masked, BACKDROP_VEIL_HEX, scrimAlpha)
    return contrastRatio(TITLE_TEXT_HEX, veiled)
  })
  const colourWorstCase = Math.min(...colourContrasts)

  return Math.min(artWorstCase, colourWorstCase)
}
