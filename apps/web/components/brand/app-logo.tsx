// Marque spellcache — géométrie canonique 512×512 de
// `design/assets/icon/spellcache-icon.svg` (concept A4·R3, « Ghost back »),
// portée à l'identique. Couleurs de l'illustration elle-même : exemptées de la
// règle « pas de hex en dur » (cf. docs/development.md).
export function AppLogo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      role="img"
      aria-label="spellcache"
      className={className}
    >
      <rect width={512} height={512} rx={116} fill="#16141F" />
      <g transform="translate(81.4 72.4) scale(3.6)">
        <path
          d="M44.5 10.5 H73.5 V73 L59 62 L44.5 73 Z"
          fill="none"
          stroke="#E8B44A"
          strokeWidth={5}
          strokeLinejoin="round"
        />
        <path
          d="M24 22 H58 V92 L41 79 L24 92 Z"
          fill="#16141F"
          stroke="#16141F"
          strokeWidth={7}
          strokeLinejoin="round"
        />
        <path d="M24 22 H58 V92 L41 79 L24 92 Z" fill="#E8B44A" />
        <path
          d="M41 35 Q43.6 45.4 54 48 Q43.6 50.6 41 61 Q38.4 50.6 28 48 Q38.4 45.4 41 35 Z"
          fill="#16141F"
        />
      </g>
    </svg>
  )
}
