// Un deck monté, atteint depuis `Collection › Decks`. Le même écran que
// `/decks/<id>` : un deck n'a qu'une vue, seul son `deckState` en change le
// fil d'ariane, les actions et le pied. Les deux adresses existent pour que
// la zone d'où l'on vient reste lisible dans l'URL et dans la navigation —
// c'est aussi pourquoi monter un deck redirige ici (`deck-view.tsx`).
import DeckPage from '@/app/(app)/decks/[id]/page'

export default DeckPage
