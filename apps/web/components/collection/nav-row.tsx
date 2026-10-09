// Ligne de navigation `All collection` / `Decks`. Le glyphe (icône Lucide ou
// `DecksIcon`) et la destination viennent de l'appelant : ce composant ne porte
// que la géométrie de ligne.
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

export function NavRow({
  href,
  icon,
  title,
  subtitle,
}: {
  href: string
  icon: ReactNode
  title: string
  subtitle: string
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-14 rounded-row border border-border bg-surface-1 p-12"
    >
      <div className="flex h-nav-icon w-nav-icon flex-shrink-0 items-center justify-center rounded-control">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-card-name font-bold text-text">{title}</div>
        <div className="mt-3 text-meta text-text-2">{subtitle}</div>
      </div>
      <ChevronRight width={18} height={18} strokeWidth={1.75} className="text-text-3" />
    </Link>
  )
}
