// Forme canonique d'un nom de carte, partagée mot pour mot entre le
// JavaScript et le SQL : les noms avec accents, apostrophes typographiques ou
// double face (`//`) cassent une comparaison naïve, on normalise donc (casse,
// accents, apostrophes) et on compare sur le nom normalisé.
//
// Les deux normalisations doivent produire **exactement** la même chaîne,
// sinon `resolveList` classerait `unknown` un nom pourtant présent au
// catalogue. Elles ne sont donc pas écrites deux fois : `NAME_TRANSLATE_FROM`
// et `NAME_TRANSLATE_TO` ci-dessous sont les seules tables de correspondance,
// consommées par `normalizeCardName` (JS, `String`) et par
// `normalizedNameExpr` (SQL, `translate()`) — un caractère ajouté ici change
// les deux côtés du même coup.
//
// `translate()` est du Postgres de base : aucune extension (`unaccent`,
// installée nulle part dans `packages/db/migrations/`) n'est requise, et la
// correspondance reste inspectable dans ce fichier plutôt que dans le
// dictionnaire d'une extension.
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'

// Les majuscules accentuées figurent dans la table **avant** tout `lower()` :
// sous une collation `C`, `lower('É')` laisse `É` intact, ce qui ferait
// diverger les deux implémentations selon la locale de la base. Elles sont
// donc traduites directement vers leur équivalent ASCII minuscule, et
// `lower()`/`toLowerCase()` n'a plus que de l'ASCII à replier.
const UPPER_FROM = 'ÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝÑÇØÐ'
const UPPER_TO = 'aaaaaaeeeeiiiiooooouuuuyncod'
const LOWER_FROM = 'àáâãäåèéêëìíîïòóôõöùúûüýÿñçøð'
const LOWER_TO = 'aaaaaaeeeeiiiiooooouuuuyyncod'
// Supprimées, pas remplacées : `translate()` efface les caractères de `from`
// qui n'ont pas de position correspondante dans `to`. Les cinq formes
// d'apostrophe (droite, typographique ouvrante/fermante, accent aigu,
// accent grave) disparaissent donc toutes, si bien que `Gaea's Cradle`,
// `Gaea’s Cradle` et `Gaeas Cradle` se comparent égaux.
const DROPPED = "'’‘´`"

export const NAME_TRANSLATE_FROM = UPPER_FROM + LOWER_FROM + DROPPED
export const NAME_TRANSLATE_TO = UPPER_TO + LOWER_TO

// Digrammes que `translate()` ne sait pas rendre (une position de `from` ne
// peut produire qu'un caractère) : traités par `replace()` avant, dans les
// deux implémentations et dans le même ordre. `Æther Vial`, `Æthersnipe`.
const DIGRAPHS: Array<[string, string]> = [
  ['Æ', 'ae'],
  ['æ', 'ae'],
  ['Œ', 'oe'],
  ['œ', 'oe'],
  ['ß', 'ss'],
]

const TRANSLATE_MAP = new Map<string, string>()
for (let i = 0; i < NAME_TRANSLATE_FROM.length; i += 1) {
  TRANSLATE_MAP.set(NAME_TRANSLATE_FROM[i]!, NAME_TRANSLATE_TO[i] ?? '')
}

export function normalizeCardName(name: string): string {
  let out = name
  for (const [from, to] of DIGRAPHS) out = out.split(from).join(to)
  out = Array.from(out)
    .map((char) => TRANSLATE_MAP.get(char) ?? char)
    .join('')
  return out.toLowerCase().replace(/\s+/g, ' ').trim()
}

// Face avant d'un nom déjà normalisé. Une carte double face porte son nom
// complet au catalogue (`Nicol Bolas, the Ravager // Nicol Bolas, the
// Arisen`) alors qu'une liste collée n'en cite souvent que la face avant :
// la résolution compare les deux formes (voir `lib/lists/resolve-list.ts`).
// `split` sur `//` sans espace autour, puisque la normalisation a déjà
// replié les espaces — `A // B` comme `A//B` donnent la même face avant.
export function frontFaceOf(normalizedName: string): string {
  const index = normalizedName.indexOf('//')
  return index === -1 ? normalizedName : normalizedName.slice(0, index).trim()
}

// Même chaîne d'opérations qu'en JavaScript, dans le même ordre : digrammes,
// `translate`, `lower`, repli des espaces, `trim`. Consommée par
// `lib/lists/resolve-list.ts` sur `cards.name`.
// La classe POSIX `[[:space:]]` plutôt que `\s` : le motif voyage dans un
// littéral gabarit **étiqueté** (`sql`…``), où `\s` est une séquence
// d'échappement non reconnue que JavaScript replie en `s` — le motif serait
// arrivé à Postgres sous la forme `'s+'` et aurait remplacé les suites de la
// lettre `s`. Aucun antislash ici, donc aucune divergence possible entre le
// source et ce que la base reçoit.
export function normalizedNameExpr(column: SQLWrapper): SQL {
  let expr = sql`${column}`
  for (const [from, to] of DIGRAPHS) {
    expr = sql`replace(${expr}, ${from}, ${to})`
  }
  return sql`btrim(regexp_replace(lower(translate(${expr}, ${NAME_TRANSLATE_FROM}, ${NAME_TRANSLATE_TO})), '[[:space:]]+', ' ', 'g'))`
}

// Face avant côté SQL, appliquée à une expression **déjà normalisée** —
// pendant exact de `frontFaceOf` ci-dessus.
export function frontFaceExpr(normalized: SQLWrapper): SQL {
  return sql`btrim(split_part(${normalized}, '//', 1))`
}
