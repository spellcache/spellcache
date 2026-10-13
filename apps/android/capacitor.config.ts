import type { CapacitorConfig } from '@capacitor/cli'

// Coque native : `www/` ne contient que l'écran de choix du serveur. L'app
// elle-même est servie par l'instance auto-hébergée, chargée dans la WebView.
// La navigation vers cette instance est autorisée à l'exécution par
// `ServerPlugin` (l'adresse n'est pas connue au build) : `allowNavigation`
// reste vide, tout autre domaine s'ouvre dans le navigateur.
const config: CapacitorConfig = {
  appId: 'io.github.spellcache',
  appName: 'spellcache',
  webDir: 'www',
  backgroundColor: '#0A090E',
  // Marqueurs lus par l'instance : `SpellcacheAndroid`
  // (`components/ui/use-back-to-close.ts`) — dans l'app, les feuilles ne
  // poussent plus d'entrée d'historique, le retour passe par `MainActivity` ;
  // `SpellcacheScanner` (`lib/scanner/pending.ts`) — la caméra du scanner de
  // cartes est disponible.
  appendUserAgent: 'SpellcacheAndroid SpellcacheScanner',
  android: {
    // Une instance en HTTP clair n'est pas prise en charge (cookies de
    // session `Secure`, service worker) : refusée dès l'écran de connexion.
    allowMixedContent: false,
  },
  plugins: {
    // La WebView gère elle-même les zones sûres (`env(safe-area-inset-*)`).
    // Laissé actif, SystemBars rétrécit la WebView de la hauteur du clavier :
    // toute la page, barre d'onglets comprise, remonterait au-dessus. Le
    // clavier recouvre la page, comme dans Chrome ; `MainActivity` publie sa
    // hauteur (`--keyboard-inset`).
    SystemBars: {
      insetsHandling: 'disable',
    },
  },
}

export default config
