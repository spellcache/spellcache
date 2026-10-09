// Écran de choix de l'instance. Au démarrage à froid, une instance déjà
// enregistrée est ouverte directement ; revenir ici (bouton retour depuis
// l'instance) affiche le formulaire, pour en changer.
;(() => {
  const Server = window.Capacitor.registerPlugin('Server')

  const form = document.getElementById('server-form')
  const input = document.getElementById('server')
  const error = document.getElementById('error')
  const button = document.getElementById('connect')
  const opening = document.getElementById('opening')
  const openingHost = document.getElementById('opening-host')

  // Marqueur de session : posé avant d'ouvrir l'instance, il distingue un
  // lancement de l'app d'un retour arrière vers cet écran.
  const OPENED_KEY = 'spellcache:opened'
  const HEALTH_TIMEOUT_MS = 8000
  const LOOPBACK_HOSTS = ['localhost', '127.0.0.1']

  // Build debug seulement (ServerPlugin) : `pnpm dev` joint en HTTP sur la
  // boucle locale via adb reverse.
  let allowLocalhost = false

  function showForm(origin) {
    opening.hidden = true
    form.hidden = false
    if (origin && !input.value) input.value = origin
  }

  function open(origin) {
    sessionStorage.setItem(OPENED_KEY, '1')
    openingHost.textContent = new URL(origin).host
    form.hidden = true
    opening.hidden = false
    window.location.assign(`${origin}/`)
  }

  function showError(message) {
    error.textContent = message
    error.hidden = false
  }

  // Origine seule (schéma, hôte, port) : l'app est servie à la racine.
  // `https://` est ajouté quand l'utilisateur l'omet ; HTTP clair refusé,
  // sauf la boucle locale du build debug (`http://` ajouté pour elle).
  function parseOrigin(value) {
    const raw = value.trim()
    if (!raw) return { error: 'Enter the address of your server.' }
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    const defaultScheme =
      allowLocalhost && LOOPBACK_HOSTS.includes(raw.split(/[:/]/)[0].toLowerCase())
        ? 'http'
        : 'https'
    let url
    try {
      url = new URL(hasScheme ? raw : `${defaultScheme}://${raw}`)
    } catch {
      return { error: 'This is not a valid address.' }
    }
    const loopbackHttp =
      allowLocalhost && url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname)
    if (url.protocol !== 'https:' && !loopbackHttp) {
      return { error: 'The server must be reachable over https://.' }
    }
    return { origin: url.origin }
  }

  // Requête `no-cors` : réponse opaque, mais une erreur réseau (hôte
  // inconnu, certificat refusé, serveur éteint) la fait échouer.
  async function isReachable(origin) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
    try {
      await fetch(`${origin}/api/health`, {
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller.signal,
      })
      return true
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    error.hidden = true

    const parsed = parseOrigin(input.value)
    if (parsed.error) {
      showError(parsed.error)
      return
    }

    button.disabled = true
    button.textContent = 'Connecting…'
    try {
      if (!(await isReachable(parsed.origin))) {
        showError(
          `Can't reach ${new URL(parsed.origin).host}. Check the address and your connection.`,
        )
        return
      }
      await Server.setOrigin({ origin: parsed.origin })
      open(parsed.origin)
    } catch {
      showError('Something went wrong. Try again.')
    } finally {
      button.disabled = false
      button.textContent = 'Connect'
    }
  })

  // Page restaurée depuis le cache de navigation (retour arrière) : le
  // script ne se relance pas, on réaffiche le formulaire.
  window.addEventListener('pageshow', async (event) => {
    if (event.persisted) showForm((await Server.getOrigin()).origin)
  })

  Server.getOrigin().then(({ origin, allowLocalhost: allowed }) => {
    allowLocalhost = allowed === true
    if (origin && !sessionStorage.getItem(OPENED_KEY)) open(origin)
    else showForm(origin)
  })
})()
