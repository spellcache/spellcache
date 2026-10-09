// Formatage monétaire. La devise vient toujours d'un paramètre explicite
// (`users.price_source`, résolu par l'appelant côté serveur) — jamais devinée
// depuis la locale du navigateur (docs/development.md).
export type Currency = 'usd' | 'eur'

// Montants stockés en entier de centimes (`container_stats.value_*_minor`),
// jamais un flottant, pour éviter l'accumulation d'erreurs
// d'arrondi sur des milliers de lignes.
// Une seule locale pour les deux devises : `en-US`, symbole en tête et
// groupement anglo-saxon (`$1,234.50`, `€1,234.50`), plutôt que la locale du
// navigateur : le montant est souvent rendu par le serveur, et une locale
// implicite ferait diverger le
// rendu serveur (Node) du rendu client (navigateur) — l'écart d'hydratation
// classique. `narrowSymbol` garde le symbole court plutôt que la forme
// désambiguïsée (`US$`).
export function formatMoney(amountMinor: number, currency: Currency): string {
  const amount = amountMinor / 100
  const iso = currency === 'usd' ? 'USD' : 'EUR'
  // Triple repli : `narrowSymbol`
  // lève sur les moteurs qui ne le connaissent pas, la forme par défaut peut
  // lever sur un code inattendu — un prix rend toujours quelque chose.
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: iso,
      currencyDisplay: 'narrowSymbol',
    }).format(amount)
  } catch {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: iso }).format(amount)
    } catch {
      return `${amount.toFixed(2)} ${iso}`
    }
  }
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}
