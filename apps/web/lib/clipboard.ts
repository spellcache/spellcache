// Copie et téléchargement côté navigateur, partagés par les feuilles
// d'export et de partage.

// `navigator.clipboard` n'existe qu'en contexte sécurisé (HTTPS ou
// localhost) et peut refuser (permission, document sans focus) : repli sur
// `execCommand`, encore pris en charge par Chrome Android. `false` si rien
// n'a marché, pour que l'écran le dise au lieu d'afficher « Copied ».
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Repli ci-dessous.
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

// Le gestionnaire de téléchargements de Chrome Android lit le blob après
// coup : révoquer l'URL aussitôt après `click()` fait échouer le
// téléchargement (« Échec du téléchargement »).
const REVOKE_AFTER_MS = 60_000

export function downloadText(
  content: string,
  filename: string,
  mimeType = 'text/plain',
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS)
}
