// Ligne générique de Settings, au pixel du design validé — icône 30px,
// libellé, sous-titre optionnel, contrôle à droite (forme à sous-titre et
// forme sans).
//
// Props : `value` (texte de droite quand `control` est absent), `href`
// (rangée-lien Next `<Link>` au lieu d'un `<button onClick>`), `onClick`
// (rangée-bouton, pour un îlot client comme `MembersGroup`/`LogoutRow`),
// `danger` (texte en `text-danger`), `chevron` (par défaut affiché dès que la
// ligne est cliquable), `pending` (opacité 0.6 + rangée désactivée). `icon`
// est optionnel : sans lui, aucune boîte de 30px vide n'est rendue (pas de
// boîte d'icône vide pour les éditeurs).
//
// Composant serveur : ni `href` ni `danger`/`chevron` n'exigent
// d'hydratation ; seul un `onClick` fourni par un appelant client rend cette
// ligne interactive, et dans ce cas c'est l'appelant qui porte `'use
// client'`, jamais ce fichier lui-même.
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'

export function SettingRow({
  icon,
  label,
  labelSuffix,
  subtitle,
  value,
  control,
  href,
  onClick,
  danger = false,
  chevron,
  pending = false,
  iconColor,
}: {
  icon?: React.ReactNode
  label: string
  // Mention courte après le libellé, en texte secondaire (« · Current »).
  labelSuffix?: string
  subtitle?: string
  value?: React.ReactNode
  control?: React.ReactNode
  href?: string
  onClick?: () => void
  danger?: boolean
  chevron?: boolean
  pending?: boolean
  iconColor?: string
}) {
  const clickable = Boolean(href) || Boolean(onClick)
  const showChevron = chevron ?? clickable
  const labelClassName = `block text-row-label font-semibold ${danger ? 'text-danger' : 'text-text'}`
  const resolvedIconColor = iconColor ?? (danger ? 'text-danger' : 'text-text-2')

  const content = (
    <>
      {icon && (
        <span
          className={`flex h-row-icon w-row-icon flex-shrink-0 items-center justify-center rounded-row-icon ${resolvedIconColor}`}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={labelClassName}>
          {label}
          {labelSuffix && <span className="font-normal text-text-2"> · {labelSuffix}</span>}
        </span>
        {subtitle && <span className="mt-2 block text-row-subtitle text-text-2">{subtitle}</span>}
      </span>
      {control}
      {control === undefined && value !== undefined && (
        <span className="flex-shrink-0 text-row-value font-semibold text-text-2">{value}</span>
      )}
      {showChevron && (
        <ChevronRight width={16} height={16} strokeWidth={1.75} className="flex-shrink-0 text-text-3" />
      )}
    </>
  )

  const sharedClassName = `flex w-full items-center gap-12 px-14 py-13 text-left ${
    pending ? 'opacity-60' : ''
  }`

  if (href) {
    return (
      <Link href={href} className={sharedClassName} aria-disabled={pending}>
        {content}
      </Link>
    )
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={pending} className={sharedClassName}>
        {content}
      </button>
    )
  }

  return <div className={sharedClassName}>{content}</div>
}
