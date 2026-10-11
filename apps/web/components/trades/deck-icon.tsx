// Icône de deck des écrans d'échange : la même pile de cartes que l'onglet
// Decks de la barre d'onglets.
export function DeckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2.6" y="8.4" width="11" height="13" rx="2" />
      <path d="M5.6 8.4V7.4a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-1" />
      <path d="M8.6 5.4V4.4a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-1" />
    </svg>
  )
}
