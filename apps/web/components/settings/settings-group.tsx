// Carte de groupe de Settings : fond `#12151c`, rayon 18, une bordure
// `rgba(255,255,255,0.05)` entre chaque ligne — jamais sur la première.
// Composant serveur, comme le reste de `page.tsx` (ne pas rendre toute la
// page côté client) ; les seuls îlots interactifs sont les contrôles passés en
// enfants (`Switch`, `StylePicker`…), pas ce conteneur.
import { Children } from 'react'

// `hint` : texte d'aide sous la carte (par exemple « With everything off the
// Tools tab disappears… »). Il change la marge basse de la carte
// (10px au lieu de 22px), c'est pourquoi il passe
// par ce conteneur plutôt que d'être posé après lui par la page.
export function SettingsGroup({
  label,
  hint,
  children,
}: {
  label?: string
  hint?: string
  children: React.ReactNode
}) {
  const items = Children.toArray(children)

  return (
    <>
      {label && (
        <div className="mb-10 ml-4 text-section-label font-semibold uppercase tracking-section-label text-text-2">
          {label}
        </div>
      )}
      <div
        className={`overflow-hidden rounded-row border border-border bg-surface-1 ${
          hint ? 'mb-10' : 'mb-22'
        }`}
      >
        {/* Une ligne marquée `data-phone-hidden` disparaît sous la tablette
            avec son enveloppe : masquer la ligne seule laisserait sa bordure
            haute doubler celle de la suivante. Pur CSS, pas de saut au
            premier rendu. Même geste pour `data-dark-only` (fond noir pur)
            en thème clair : `data-scheme` sur `<html>` change dès le clic
            dans Settings, la ligne suit sans état partagé. */}
        {items.map((item, index) => (
          <div
            key={index}
            className={`max-tablet:has-[[data-phone-hidden]]:hidden in-data-[scheme=light]:has-[[data-dark-only]]:hidden ${
              index === 0 ? '' : 'border-t border-border'
            }`}
          >
            {item}
          </div>
        ))}
      </div>
      {hint && <p className="mx-4 mb-22 text-look-hint leading-normal text-text-3">{hint}</p>}
    </>
  )
}
