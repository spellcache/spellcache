'use client'

// Un seul en-tête pour tous les écrans : retour · fil d'ariane + titre +
// méta · actions rondes · ⋯ · + accent. Plutôt que des boutons ad hoc par
// écran, tout passe ici, un seul geste primaire par écran.
//
// `overArt` remplace les cercles plats par des cercles sombres translucides
// et pose une ombre sur le titre (en-têtes posés sur un fond d'art).
// `layout="stacked"` met les contrôles sur leur propre rangée au-dessus du
// titre, avec 130px d'air — la forme des écrans illustrés.
//
// `HEADER_ROW_HEIGHT`/`HEADER_ROW_GAP` sont exportés : l'en-tête de
// sélection remplace cette rangée pendant une sélection et doit en avoir
// exactement la hauteur, sinon toute la liste saute au long-press.
import { ChevronLeft, Ellipsis, Plus, type LucideIcon } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

export const HEADER_ROW_HEIGHT = 46
export const HEADER_ROW_GAP = 18

export type ScreenHeaderAction = {
  icon: LucideIcon
  label: string
  onClick: () => void
}

function CircleButton({
  icon: Icon,
  label,
  onClick,
  size = 36,
  iconSize = 18,
  accent = false,
  overArt = false,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  size?: number
  iconSize?: number
  accent?: boolean
  overArt?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex flex-shrink-0 items-center justify-center rounded-full ${
        // Cercle voilé sur l'illustration : icône claire même en thème clair
        // (`scheme-dark`).
        accent ? 'bg-accent text-on-accent' : overArt ? 'bg-header-icon-veil text-text scheme-dark' : 'bg-surface-1 text-text'
      }`}
      style={{ width: size, height: size }}
    >
      <Icon size={iconSize} strokeWidth={1.75} />
    </button>
  )
}

export function ScreenHeader({
  title,
  breadcrumb,
  meta,
  onBack,
  actions = [],
  onOverflow,
  onAdd,
  addLabel = 'Add',
  overArt = false,
  layout = 'inline',
  className = '',
}: {
  title: string
  breadcrumb?: string
  meta?: ReactNode
  onBack?: () => void
  actions?: ScreenHeaderAction[]
  onOverflow?: () => void
  onAdd?: () => void
  addLabel?: string
  overArt?: boolean
  layout?: 'inline' | 'stacked'
  className?: string
}) {
  const titleClass = overArt ? 'text-title-binder' : onBack ? 'text-title-subscreen' : 'text-title-screen'
  const shadowStyle: CSSProperties | undefined = overArt
    ? { textShadow: 'var(--text-shadow-binder-title)' }
    : undefined

  const controls = (
    <>
      {actions.map((action) => (
        <CircleButton
          key={action.label}
          icon={action.icon}
          label={action.label}
          onClick={action.onClick}
          overArt={overArt}
        />
      ))}
      {onOverflow && (
        <CircleButton
          icon={Ellipsis}
          label="More"
          onClick={onOverflow}
          size={overArt ? 36 : 38}
          overArt={overArt}
        />
      )}
      {onAdd && (
        <CircleButton
          icon={Plus}
          label={addLabel}
          onClick={onAdd}
          size={overArt ? 40 : 42}
          iconSize={overArt ? 20 : 21}
          accent
        />
      )}
    </>
  )

  const titleBlock = (
    <div className="min-w-0 flex-1">
      {breadcrumb && (
        <div
          className={`mb-2 text-breadcrumb-container font-bold uppercase tracking-section-label ${
            overArt ? 'text-text-art' : 'text-text-3'
          }`}
          style={shadowStyle}
        >
          {breadcrumb}
        </div>
      )}
      <h1
        className={`m-0 truncate font-extrabold tracking-title-screen ${titleClass}`}
        style={shadowStyle}
      >
        {title}
      </h1>
      {meta && (
        <div
          className={`mt-4 text-header-meta ${overArt ? 'text-text-art' : 'text-text-2'}`}
          style={shadowStyle}
        >
          {meta}
        </div>
      )}
    </div>
  )

  if (layout === 'stacked') {
    return (
      <div className={`mb-18 ${className}`}>
        <div className="mb-header-stacked flex items-center gap-8">
          {onBack && (
            <CircleButton icon={ChevronLeft} label="Back" onClick={onBack} iconSize={20} overArt={overArt} />
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-8">{controls}</div>
        </div>
        {titleBlock}
      </div>
    )
  }

  return (
    <div className={`mb-18 flex min-h-header-row items-center gap-10 ${className}`}>
      {onBack && (
        <CircleButton icon={ChevronLeft} label="Back" onClick={onBack} iconSize={20} overArt={overArt} />
      )}
      {titleBlock}
      <div className="flex flex-shrink-0 items-center gap-8">{controls}</div>
    </div>
  )
}
