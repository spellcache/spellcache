// Texte reconnu par le scanner Android, ramené aux formes du catalogue. Pur
// (aucun accès base) : la reconnaissance se trompe sur des caractères qui se
// ressemblent, le serveur essaie donc les lectures plausibles plutôt que de
// faire confiance au premier caractère lu.

// Confusions courantes de la reconnaissance sur le code de set imprimé
// (police condensée, petits caractères).
const LOOKALIKES: Record<string, string[]> = {
  '0': ['o'],
  o: ['0'],
  '1': ['i', 'l'],
  i: ['1', 'l'],
  l: ['1', 'i'],
  '5': ['s'],
  s: ['5'],
  '8': ['b'],
  b: ['8'],
  '2': ['z'],
  z: ['2'],
}

// Au-delà, le code lu est trop abîmé pour être deviné.
const MAX_SET_CODE_VARIANTS = 32

const SET_CODE_PATTERN = /^[a-z0-9]{2,6}$/

// Lecture d'abord, puis chaque variante plausible, sans doublon. Les codes
// Scryfall sont en minuscules.
export function setCodeVariants(raw: string): string[] {
  const code = raw.trim().toLowerCase()
  if (!SET_CODE_PATTERN.test(code)) return []

  let variants = ['']
  for (const char of code) {
    const options = [char, ...(LOOKALIKES[char] ?? [])]
    variants = variants.flatMap((prefix) => options.map((option) => prefix + option))
    if (variants.length > MAX_SET_CODE_VARIANTS) return [code]
  }
  return [code, ...variants.filter((variant) => variant !== code)]
}

const COLLECTOR_NUMBER_PATTERN = /^[0-9]{1,4}[a-z★]?$/

// Numéro imprimé sur 4 chiffres depuis 2023 (`0123`), sans zéros de tête
// chez Scryfall (`123`) ; quelques promos les gardent, la forme lue reste
// donc candidate. Le total du set (`123/280`) est ignoré.
export function collectorNumberVariants(raw: string): string[] {
  const number = raw.trim().toLowerCase().split('/')[0]!.replace(/o/g, '0')
  if (!COLLECTOR_NUMBER_PATTERN.test(number)) return []
  const stripped = number.replace(/^0+(?=[0-9])/, '')
  return stripped === number ? [number] : [stripped, number]
}

// Codes de langue imprimés sous le numéro (`EN`, `FR`, `JP`…) vers les
// langues d'un holding — les sept de la feuille d'ajout, `en` sinon.
const PRINTED_LANGUAGES: Record<string, string> = {
  en: 'en',
  fr: 'fr',
  de: 'de',
  es: 'es',
  sp: 'es',
  it: 'it',
  pt: 'pt',
  ja: 'ja',
  jp: 'ja',
}

export function holdingLanguageOf(printed: string | null | undefined): string {
  return (printed && PRINTED_LANGUAGES[printed.trim().toLowerCase()]) || 'en'
}

// Ligne du haut d'une carte, lue avec ce qui l'entoure : symboles de mana
// pris pour des lettres ou de la ponctuation en fin de ligne.
export function cleanScannedName(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N}'’ ,.:!?&+"\-/]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s,\-/]+$/, '')
}
