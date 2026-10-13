// Langues d'un ajout scanné : les sept de la feuille d'ajout et de l'édition
// groupée (`bulk-edit-sheet.tsx`).
export const SCAN_LANGUAGES: Array<{ value: string; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ja', label: 'Japanese' },
]

export function languageLabel(value: string): string {
  return SCAN_LANGUAGES.find((language) => language.value === value)?.label ?? value.toUpperCase()
}
