// Une barre de la courbe de mana de l'écran `Planning deck`,
// posée sous le bandeau de couverture. Ne pas inventer d'autre présentation.
export function ManaCurveBar({ label, count, pct }: { label: string; count: number; pct: number }) {
  return (
    <div className="flex items-center gap-10">
      <span className="w-bar-label flex-shrink-0 font-mono text-mana-bar-label text-text-2">{label}</span>
      <div className="h-bar-track flex-1 overflow-hidden rounded-bar bg-bar-track-bg">
        <div className="h-full rounded-bar bg-gradient-mana-bar" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-bar-count flex-shrink-0 text-right text-mana-bar-label text-text">{count}</span>
    </div>
  )
}
