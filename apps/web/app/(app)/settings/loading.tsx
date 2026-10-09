// Squelette de l'écran `Settings` — voir `app/(app)/decks/loading.tsx` pour
// la raison d'être de ces fichiers.
const SETTINGS_SKELETON_SECTIONS = [3, 4, 3]

export default function SettingsLoading() {
  return (
    <div className="h-full overflow-y-auto px-16 pt-20 pb-28 desktop:px-20 desktop:pt-30 desktop:pb-40" role="status" aria-label="Loading">
      <div className="mb-18 h-title-skeleton w-title-skeleton animate-pulse rounded-control bg-surface-1" />

      <div className="mb-18 h-profile-skeleton animate-pulse rounded-card bg-surface-1" />

      <div className="flex flex-col gap-18">
        {SETTINGS_SKELETON_SECTIONS.map((rows, section) => (
          <div key={section}>
            <div className="mb-10 h-label-skeleton w-label-skeleton animate-pulse rounded-control bg-surface-1" />
            <div className="flex flex-col gap-8">
              {Array.from({ length: rows }, (_, index) => (
                <div key={index} className="h-row-setting-skeleton animate-pulse rounded-row bg-surface-1" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
