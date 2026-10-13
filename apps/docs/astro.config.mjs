import { fileURLToPath } from 'node:url'

import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'

const repo = 'https://github.com/spellcache/spellcache'
const projectDir = fileURLToPath(new URL('.', import.meta.url))
const docsDir = fileURLToPath(new URL('../../docs/', import.meta.url))

// Les pages MDX de docs/ importent des paquets (`@astrojs/starlight/components`)
// que pnpm n'installe que dans apps/docs/node_modules : depuis docs/, la
// résolution Node ne les trouve pas. On les résout comme si l'import venait
// d'ici.
const resolveFromDocsProject = {
  name: 'spellcache:resolve-from-docs-project',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    const bare = !source.startsWith('.') && !source.startsWith('/') && !source.includes(':')
    if (!bare || !importer || !importer.replaceAll('\\', '/').startsWith(docsDir.replaceAll('\\', '/'))) return null
    return this.resolve(source, `${projectDir}astro.config.mjs`, { ...options, skipSelf: true })
  },
}

// Site de projet GitHub Pages : servi sous /spellcache/, pas à la racine du
// domaine. `base` doit suivre si le site passe sur un domaine personnalisé.
export default defineConfig({
  site: 'https://spellcache.github.io',
  base: '/spellcache',
  trailingSlash: 'always',
  vite: { plugins: [resolveFromDocsProject] },
  integrations: [
    starlight({
      title: 'spellcache',
      description:
        'Self-hosted, mobile-first Magic: The Gathering collection manager: inventory, binders, decks, prices and trades.',
      logo: { src: '../../design/assets/icon/spellcache-icon.svg', alt: 'spellcache' },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: repo }],
      // Les sources vivent dans docs/ à la racine du dépôt (content.config.ts) :
      // `entry.filePath` est donc relatif à apps/docs/ et commence par
      // ../../docs/, que le navigateur résout dans l'URL.
      editLink: { baseUrl: `${repo}/edit/main/apps/docs/` },
      lastUpdated: true,
      // Polices de l'app, servies par le site lui-même (aucun appel à un CDN
      // de polices depuis la page).
      customCss: [
        '@fontsource-variable/inter',
        '@fontsource/geist-mono/400.css',
        '@fontsource/geist-mono/500.css',
        './src/styles/theme.css',
      ],
      components: { PageTitle: './src/components/PageTitle.astro' },
      // Blocs de code toujours sombres, sur l'encre de l'app, dans les deux
      // thèmes.
      expressiveCode: {
        themes: ['github-dark-default'],
        styleOverrides: {
          borderRadius: '10px',
          borderColor: 'rgba(255, 255, 255, 0.12)',
          codeBackground: '#16141f',
          codeFontFamily: "'Geist Mono', ui-monospace, monospace",
          codeFontSize: '0.825rem',
          frames: {
            editorBackground: '#16141f',
            terminalBackground: '#16141f',
            editorTabBarBackground: '#100f15',
            editorActiveTabBackground: '#16141f',
            terminalTitlebarBackground: '#100f15',
            frameBoxShadowCssValue: 'none',
          },
        },
      },
      sidebar: [
        {
          label: 'Start here',
          items: [{ slug: 'quick-start' }],
        },
        {
          label: 'Self-hosting',
          items: [
            { slug: 'self-hosting/installation' },
            { slug: 'self-hosting/email' },
            { slug: 'self-hosting/reverse-proxy' },
            { slug: 'self-hosting/scheduled-tasks' },
            { slug: 'self-hosting/updating' },
            { slug: 'self-hosting/backup' },
            { slug: 'self-hosting/restore' },
            { slug: 'self-hosting/troubleshooting' },
          ],
        },
        {
          label: 'Using spellcache',
          items: [
            { slug: 'guide/collection' },
            { slug: 'guide/importing' },
            { slug: 'guide/decks' },
            { slug: 'guide/trading' },
            { slug: 'guide/sharing' },
            { slug: 'guide/table-tools' },
            { slug: 'guide/mobile' },
            { slug: 'guide/administration' },
          ],
        },
        {
          label: 'Reference',
          items: [{ slug: 'reference/configuration' }, { slug: 'reference/faq' }, { slug: 'reference/changelog' }],
        },
        {
          label: 'Contributing',
          items: [{ slug: 'development' }, { slug: 'contributing/architecture' }],
        },
      ],
    }),
  ],
})
