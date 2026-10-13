import { docsSchema } from '@astrojs/starlight/schema'
import { glob } from 'astro/loaders'
import { defineCollection } from 'astro:content'

// Les pages restent dans docs/ à la racine du dépôt, lisibles sur GitHub et
// citées par les commentaires du code (docs/development.md) : ce projet ne
// fait que les publier.
export const collections = {
  docs: defineCollection({
    loader: glob({ base: '../../docs', pattern: '**/[^_]*.{md,mdx}' }),
    schema: docsSchema(),
  }),
}
