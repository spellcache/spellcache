// Pied d'une étape du parcours, épinglé en bas de l'écran : ce que l'étape
// a réuni jusqu'ici (cartes, valeur) et l'action qui mène à la suite.
import Link from 'next/link'

export function StepFooter({
  title,
  subtitle,
  nextLabel,
  nextHref,
  onNext,
  disabled = false,
}: {
  title: string
  subtitle?: string
  nextLabel: string
  nextHref?: string
  onNext?: () => void
  disabled?: boolean
}) {
  const className = `flex-shrink-0 rounded-control px-22 py-13 text-button-primary font-extrabold ${
    disabled ? 'bg-surface-2 text-text-3' : 'bg-accent text-on-accent'
  }`
  return (
    <div
      className="sticky bottom-0 z-10 mt-22 flex items-center gap-12 border-t border-surface-2 bg-bg pb-16 pt-12"
      data-testid="trade-step-footer"
    >
      <div className="min-w-0 flex-1">
        <div className="text-row-label font-extrabold text-text">{title}</div>
        {subtitle && (
          <div className="font-mono text-row-price font-bold text-accent-text">
            {subtitle}
          </div>
        )}
      </div>
      {nextHref && !disabled ? (
        <Link href={nextHref} className={className}>
          {nextLabel}
        </Link>
      ) : (
        <button type="button" onClick={onNext} disabled={disabled} className={className}>
          {nextLabel}
        </button>
      )}
    </div>
  )
}
