// Jour de prix des cartes de test. Les parcours E2E écrivent dans la base de
// développement, où `max(day)` de `card_prices` est le jour de référence de
// toutes les valorisations (`lib/containers/stats.ts`) : une ligne datée
// `current_date` alors que le dernier import est plus ancien créerait un jour
// de référence ne contenant que les cartes de test, et toute la collection
// réelle recalculée ensuite vaudrait zéro. Catalogue vide (CI) : aujourd'hui.
import { sql } from 'drizzle-orm'

export const testPriceDay = sql`coalesce((select max(day) from card_prices), current_date)`
