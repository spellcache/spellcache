// Rendu d'un coût de mana en SVG depuis `public/mana/`. Un symbole par paire
// d'accolades (`{1}{R}{R}`), jamais une
// découpe caractère par caractère.
//
// Les 75 symboles que Scryfall marque `represents_mana` sont vendorisés
// (génériques 0-20/100/1000000, hybrides, phyrexians, neige, moitiés, ∞…). Un
// symbole sans asset (un symbole d'oracle comme `{T}`, ou un symbole imprimé
// après le vendoring) retombe sur une pastille lettrée aux couleurs des pips :
// un coût rend toujours, plutôt que de perdre silencieusement un symbole.
const MANA_SYMBOL_PATTERN = /\{([^}]+)\}/g

// Clé = texte entre accolades (`{W/U}` → `W/U`), valeur = nom de fichier dans
// `public/mana/`.
const SYMBOL_FILES: Record<string, string> = {
  X: 'X.svg',
  Y: 'Y.svg',
  Z: 'Z.svg',
  '0': '0.svg',
  '½': 'HALF.svg',
  '1': '1.svg',
  '2': '2.svg',
  '3': '3.svg',
  '4': '4.svg',
  '5': '5.svg',
  '6': '6.svg',
  '7': '7.svg',
  '8': '8.svg',
  '9': '9.svg',
  '10': '10.svg',
  '11': '11.svg',
  '12': '12.svg',
  '13': '13.svg',
  '14': '14.svg',
  '15': '15.svg',
  '16': '16.svg',
  '17': '17.svg',
  '18': '18.svg',
  '19': '19.svg',
  '20': '20.svg',
  '100': '100.svg',
  '1000000': '1000000.svg',
  '∞': 'INFINITY.svg',
  'W/U': 'WU.svg',
  'W/B': 'WB.svg',
  'B/R': 'BR.svg',
  'B/G': 'BG.svg',
  'U/B': 'UB.svg',
  'U/R': 'UR.svg',
  'R/G': 'RG.svg',
  'R/W': 'RW.svg',
  'G/W': 'GW.svg',
  'G/U': 'GU.svg',
  'B/G/P': 'BGP.svg',
  'B/R/P': 'BRP.svg',
  'G/U/P': 'GUP.svg',
  'G/W/P': 'GWP.svg',
  'R/G/P': 'RGP.svg',
  'R/W/P': 'RWP.svg',
  'U/B/P': 'UBP.svg',
  'U/R/P': 'URP.svg',
  'W/B/P': 'WBP.svg',
  'W/U/P': 'WUP.svg',
  'C/W': 'CW.svg',
  'C/U': 'CU.svg',
  'C/B': 'CB.svg',
  'C/R': 'CR.svg',
  'C/G': 'CG.svg',
  '2/W': '2W.svg',
  '2/U': '2U.svg',
  '2/B': '2B.svg',
  '2/R': '2R.svg',
  '2/G': '2G.svg',
  H: 'H.svg',
  'W/P': 'WP.svg',
  'U/P': 'UP.svg',
  'B/P': 'BP.svg',
  'R/P': 'RP.svg',
  'G/P': 'GP.svg',
  'C/P': 'CP.svg',
  HW: 'HW.svg',
  HR: 'HR.svg',
  W: 'W.svg',
  U: 'U.svg',
  B: 'B.svg',
  R: 'R.svg',
  G: 'G.svg',
  C: 'C.svg',
  S: 'S.svg',
  L: 'L.svg',
}

// L'URL de l'asset d'un symbole, ou `null` pour un symbole non vendorisé —
// l'appelant retombe alors sur la pastille lettrée.
export function manaSymbolUrl(symbol: string): string | null {
  const file = SYMBOL_FILES[symbol.toUpperCase()]
  return file ? `/mana/${file}` : null
}

// Exportée séparément du composant pour rester testable sans moteur de rendu
// React (`tests/unit/mana-cost.test.tsx`, environnement Vitest `node`).
// Renvoie tous les symboles du coût, en majuscules — le repli lettré du
// composant garantit qu'aucun n'est perdu au rendu.
export function parseManaSymbols(manaCost: string | null): string[] {
  if (!manaCost) return []
  return [...manaCost.matchAll(MANA_SYMBOL_PATTERN)].map((match) => match[1]!.toUpperCase())
}

// Les six couleurs de la palette des pips.
const PIP_CLASSES: Record<string, string> = {
  W: 'bg-pip-w-bg text-pip-w-fg',
  U: 'bg-pip-u-bg text-pip-u-fg',
  B: 'bg-pip-b-bg text-pip-b-fg',
  R: 'bg-pip-r-bg text-pip-r-fg',
  G: 'bg-pip-g-bg text-pip-g-fg',
  C: 'bg-pip-c-bg text-pip-c-fg',
}

// Repli pour un symbole sans SVG : pastille ronde à la palette des pips
// (incolore par défaut), texte mono à 68 % de la taille, anneau
// `--color-pip-outline`.
function LetterPip({ symbol, size }: { symbol: string; size: number }) {
  const palette = PIP_CLASSES[symbol] ?? PIP_CLASSES.C
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full px-3 font-mono font-bold shadow-pip-outline ${palette}`}
      style={{ minWidth: size, height: size, fontSize: size * 0.68 }}
    >
      {symbol}
    </span>
  )
}

// `gap` distingue les deux gabarits portés (`gap:1px` pour `CompactRow`,
// `gap:2px` pour `CardRow`).
export function ManaCost({ cost, size, gap = 2 }: { cost: string | null; size: number; gap?: 1 | 2 }) {
  const symbols = parseManaSymbols(cost)
  if (symbols.length === 0) return null

  return (
    <span className={`inline-flex flex-shrink-0 items-center ${gap === 1 ? 'gap-1' : 'gap-2'}`}>
      {symbols.map((symbol, index) => {
        const url = manaSymbolUrl(symbol)
        if (!url) return <LetterPip key={index} symbol={symbol} size={size} />
        return (
          // eslint-disable-next-line @next/next/no-img-element -- asset SVG statique de public/mana/
          <img key={index} src={url} width={size} height={size} alt="" title={`{${symbol}}`} />
        )
      })}
    </span>
  )
}
