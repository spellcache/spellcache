'use client'

// Les contrôles dont toutes les feuilles de l'app sont faites. Réunis dans un
// seul fichier pour qu'une puce de la feuille de filtres et une puce de la
// feuille d'édition groupée ne puissent pas diverger.
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

// Légende en capitales au-dessus d'un groupe.
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-10 ml-2 text-section-label font-semibold uppercase tracking-section-label text-text-2">
      {children}
    </div>
  )
}

// Carte groupée qui réunit des `SheetRow`. C'est elle qui porte le rayon et
// le fond ; les lignes ne portent aucun filet — leur propre espacement les
// sépare déjà (choix produit, 2026-09-01 : les séparateurs hairline de la
// référence ont été essayés puis retirés).
export function SheetGroup({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-sheet-group bg-surface-2">{children}</div>
  )
}

// Une ligne de cette carte : icône · libellé (+ conséquence) · valeur.
//
// `hint` dit ce que l'action fait au reste de l'app, pas ce qu'elle est. Une
// ligne destructrice n'est pas teintée pour autant — c'est la feuille de
// confirmation qui porte ce poids ; un menu rouge le porterait en permanence,
// pour une action qu'on n'a pas encore choisie.
export function SheetRow({
  icon: Icon,
  label,
  hint,
  value,
  onClick,
  danger = false,
  disabled = false,
}: {
  icon?: LucideIcon
  label: string
  hint?: string
  value?: ReactNode
  onClick?: () => void
  // Ligne destructrice (référence `SheetRow`) : libellé et icône en danger.
  danger?: boolean
  disabled?: boolean
}) {
  const content = (
    <>
      {Icon && (
        <Icon
          width={17}
          height={17}
          strokeWidth={1.75}
          className={`flex-shrink-0 ${danger ? 'text-danger' : 'text-text-2'}`}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className={`text-sheet-row-label font-semibold ${danger ? 'text-danger' : 'text-text'}`}>
          {label}
        </div>
        {hint && <div className="mt-2 text-sheet-row-hint text-text-2">{hint}</div>}
      </div>
      {value != null && (
        <div className="text-row-value font-semibold text-text-2">{value}</div>
      )}
    </>
  )

  const className = `flex w-full items-center gap-12 px-14 py-13 text-left ${disabled ? 'opacity-60' : ''}`

  if (!onClick) return <div className={className}>{content}</div>
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {content}
    </button>
  )
}

// Le bouton pleine largeur qui valide une feuille.
export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
  tone = 'accent',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
  tone?: 'accent' | 'danger'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-control py-14 text-button-primary font-extrabold ${
        disabled
          ? 'bg-surface-2 text-text-3'
          : tone === 'danger'
            ? 'bg-danger text-on-accent'
            : 'bg-accent text-on-accent'
      }`}
    >
      {children}
    </button>
  )
}

// Sa contrepartie discrète — une action qui n'est pas le propos de la feuille.
export function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-control border border-border bg-surface-2 py-13 text-button-secondary font-bold ${
        disabled ? 'text-text-3' : 'text-text'
      }`}
    >
      {children}
    </button>
  )
}
