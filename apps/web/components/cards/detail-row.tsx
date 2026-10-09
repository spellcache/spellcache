// Composant de ligne du design, au même titre que
// `CompactRow`/`CardRow`/`GridTile`. Une ligne libellé/valeur générique avec
// bordure basse, sans site d'usage à ce jour (le panneau d'aperçu desktop qui
// pourrait la consommer compose « In your collection »/« Other printings » avec
// un patron différent, pas des lignes libellé/valeur). Porté pour rester
// disponible tel quel plutôt qu'inventé dans un écran qui ne le montre pas
// (voir les anti-patterns de docs/development.md : aucun langage visuel absent
// du design).
export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-12 border-b border-border py-9">
      <span className="flex-shrink-0 text-body font-semibold text-text-2">{label}</span>
      <span className="min-w-0 text-right text-row-value font-semibold text-text">{value}</span>
    </div>
  )
}
