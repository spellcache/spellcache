// Squelette de l'écran `Settings › Users` — mêmes tokens que
// `app/(app)/settings/loading.tsx`, cohérent avec le reste des sous-écrans.
const ACCOUNT_ROWS = 4

export default function UsersLoading() {
  return (
    <div
      className="h-full overflow-y-auto px-16 pt-20 pb-28 desktop:px-20 desktop:pt-30 desktop:pb-40"
      role="status"
      aria-label="Loading"
    >
      <div className="mb-18 h-title-skeleton w-title-skeleton animate-pulse rounded-control bg-surface-1" />

      <div className="mb-10 h-label-skeleton w-label-skeleton animate-pulse rounded-control bg-surface-1" />
      <div className="mb-22 h-row-setting-skeleton animate-pulse rounded-row bg-surface-1" />

      <div className="flex flex-col gap-11">
        {Array.from({ length: ACCOUNT_ROWS }, (_, index) => (
          <div key={index} className="h-row-setting-skeleton animate-pulse rounded-card bg-surface-1" />
        ))}
      </div>
    </div>
  )
}
