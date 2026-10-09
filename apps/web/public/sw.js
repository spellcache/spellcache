// Service worker de spellcache : minimal, limité à la coquille applicative.
//
// Ce qu'il met en cache : les fichiers statiques de la coquille — le JS et le
// CSS hachés par le build, les icônes, les symboles de mana, le manifest.
//
// Ce qu'il ne met JAMAIS en cache, et c'est la règle qui compte :
//   - aucune navigation, donc aucun HTML — une page authentifiée porte les
//     données du compte dans sa charge RSC, et `docs/development.md` est catégorique :
//     « Ne PAS mettre en cache hors ligne les données utilisateur » ;
//   - aucune réponse de Server Action (ce sont des POST, écartés d'emblée) ;
//   - aucune route de données (`/api/*`, requêtes RSC `?_rsc=`) ;
//   - rien qui vienne d'une autre origine.
//
// Stratégie de navigation : réseau, toujours (un service worker trop zélé
// sert une version périmée de l'app après déploiement). Comme rien
// n'est stocké pour les navigations, il n'existe aucun repli périmé à servir :
// l'application est toujours en ligne, le hors-ligne n'est pas une exigence.
//
// Le nom du cache est versionné : au déploiement suivant, bumper
// `CACHE_VERSION` fait table rase à l'activation. À bumper aussi si une icône
// ou un symbole de mana change de contenu sans changer de nom — eux seuls ne
// sont pas hachés par le build.

const CACHE_VERSION = 'spellcache-shell-v1'

// Préfixes de chemins servis tels quels par Next depuis `public/` ou depuis le
// build. `/_next/static/` porte un hachage de contenu dans chaque nom de
// fichier : un déploiement change les noms, jamais le contenu d'un nom déjà vu.
const SHELL_PREFIXES = ['/_next/static/', '/icons/', '/mana/']
const SHELL_FILES = ['/site.webmanifest', '/favicon.ico']

function isShellAsset(url) {
  // Une chaîne de requête signale une ressource paramétrée (`?_rsc=`, image
  // optimisée…) : jamais de la coquille.
  if (url.search) return false
  if (url.pathname.startsWith('/api/')) return false
  if (SHELL_FILES.includes(url.pathname)) return true
  return SHELL_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
}

self.addEventListener('install', () => {
  // Aucun préchargement : la coquille se remplit à l'usage. Précharger une
  // liste figée de fichiers hachés obligerait à la régénérer à chaque build.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name)))
      await self.clients.claim()
    })(),
  )
})

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION)
  const hit = await cache.match(request)
  if (hit) return hit

  const response = await fetch(request)
  // `basic` : même origine, réponse complète. On ne stocke ni les réponses
  // opaques, ni les erreurs, ni les redirections.
  if (response.ok && response.status === 200 && response.type === 'basic') {
    cache.put(request, response.clone())
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const request = event.request

  // Les Server Actions sont des POST : elles ne passent jamais par ici.
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    // Réseau d'abord, et rien d'autre : aucune écriture en cache, donc aucune
    // page périmée possible après un déploiement.
    event.respondWith(fetch(request))
    return
  }

  if (!isShellAsset(url)) return

  event.respondWith(cacheFirst(request))
})
