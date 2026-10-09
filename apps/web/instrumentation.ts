// Appelé une fois au démarrage du serveur Next.js. Ouvre la connexion Redis
// dès le boot : créé à la première requête, le client recevait ses premières
// commandes pendant la poignée de main et les refusait (« Stream isn't
// writeable »), le limiteur de débit retombant alors sur son repli en mémoire.
// Import dans la branche `nodejs` seulement : Next compile aussi ce fichier
// pour le runtime Edge, où ioredis n'existe pas.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getRedisClient } = await import('./lib/redis')
    getRedisClient()
  }
}
