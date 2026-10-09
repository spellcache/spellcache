// Les tuiles et cartes de l'onglet `Stats` d'un deck. Un fichier plutôt que
// deux : ce sont les deux moitiés du même onglet, elles n'ont pas d'autre
// appelant, et une carte titrée qui vivrait loin de ses tuiles finirait par
// diverger d'elles.
export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-card border border-border bg-surface-1 p-13">
      <div className="font-mono text-stat-tile-value font-extrabold text-accent-text">{value}</div>
      <div className="mt-3 text-stat-tile-label text-text-2">{label}</div>
    </div>
  )
}

export function StatCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-border bg-surface-1 p-17">
      <div className="mb-14 text-stat-card-title font-semibold uppercase tracking-section-label text-text-2">
        {title}
      </div>
      {children}
    </div>
  )
}
