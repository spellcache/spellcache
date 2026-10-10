// Ligne inerte du groupe Tools de Settings : le groupe Tools n'expose un
// interrupteur que pour les outils livrés (`Life tracker`, `Playtest`) ; les
// trois autres lignes sont grisées
// (`opacity: 0.6`) et sans contrôle actif.
//
// Le design validé dessine `Trading mode` avec un interrupteur inactif et sans
// voile, mais `docs/development.md` range les trois fonctions `Planned`/`Soon`
// parmi les « lignes grisées sans écran » : une ligne sans contrôle. C'est le
// même traitement que celui déjà retenu pour toute affordance sans flux cible :
// rendue, inerte. Aucun `<button>`, aucun `role="switch"` n'est monté ici — un
// interrupteur désactivé resterait un contrôle.
//
// Sans sous-titre et badge uniforme « PLANNED » : les trois fonctions prévues
// se lisent toutes de la même façon.
//
// Composant serveur : rien d'interactif, donc rien à hydrater.
import { SettingRow } from '@/components/settings/setting-row'

export function PlannedToolRow({
  icon,
  label,
}: {
  icon: React.ReactNode
  label: string
}) {
  return (
    <div className="opacity-60">
      <SettingRow
        icon={icon}
        label={label}
        control={
          <span className="flex-shrink-0 rounded-pill bg-surface-2 px-9 py-4 text-tool-badge font-bold tracking-badge-foil text-text-2">
            PLANNED
          </span>
        }
      />
    </div>
  )
}
