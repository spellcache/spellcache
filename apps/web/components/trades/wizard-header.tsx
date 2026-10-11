// En-tête d'une étape du parcours : retour, « New trade · Step 2 of 4 »,
// titre de l'étape et barre de progression segmentée.
import { ChevronLeft, X } from 'lucide-react'
import Link from 'next/link'

export function WizardHeader({
  step,
  total,
  title,
  backHref,
  closeHref,
  label = 'New trade',
  action,
}: {
  step: number
  total: number
  title: string
  backHref?: string
  closeHref?: string
  label?: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-16">
      <div className="mb-14 flex items-center gap-10">
        <Link
          href={backHref ?? closeHref ?? '/tools/trade'}
          aria-label={backHref ? 'Back' : 'Close'}
          className="flex h-back-button w-back-button flex-shrink-0 items-center justify-center rounded-full bg-surface-1 text-text"
        >
          {backHref ? (
            <ChevronLeft width={20} height={20} strokeWidth={1.75} />
          ) : (
            <X width={18} height={18} strokeWidth={1.75} />
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="text-breadcrumb-container font-bold uppercase tracking-section-label text-text-3">
            {label} · Step {step} of {total}
          </div>
          <h1 className="m-0 truncate text-title-subscreen font-extrabold tracking-title-screen">
            {title}
          </h1>
        </div>
        {action}
      </div>
      <div className="flex gap-4" aria-hidden>
        {Array.from({ length: total }, (_, index) => (
          <div
            key={index}
            className={`h-4 flex-1 rounded-full ${index < step ? 'bg-accent' : 'bg-surface-2'}`}
          />
        ))}
      </div>
    </div>
  )
}
