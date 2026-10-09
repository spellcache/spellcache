import type { Metadata, Viewport } from 'next'

import './globals.css'

import { colorSchemeFor, themeColorsFor } from '@/lib/pwa'
import { getThemeAttributes } from '@/lib/theme'

import { KeyboardInset } from '@/components/ui/keyboard-inset'

import { Providers } from './providers'
import { RegisterServiceWorker } from './register-service-worker'

export const metadata: Metadata = {
  title: 'spellcache',
  description: 'Your card collection, binders and decks.',
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/icons/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/spellcache-icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/spellcache-icon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    // Plein cadre : iOS arrondit lui-même et peindrait en noir les coins
    // transparents de l'icône standard.
    apple: [{ url: '/icons/spellcache-apple-touch-icon-180.png', sizes: '180x180' }],
  },
}

export async function generateViewport(): Promise<Viewport> {
  const scheme = (await getThemeAttributes())['data-scheme'] ?? 'dark'
  return {
    themeColor: themeColorsFor(scheme),
    // Déclaré dès le `<head>` : pas de flash blanc avant la feuille de style,
    // et le mode sombre forcé (Chrome, Samsung Internet) laisse la page
    // tranquille.
    colorScheme: colorSchemeFor(scheme),
    // `viewport-fit=cover` : sans lui, les `env(safe-area-inset-*)` valent 0 sur
    // iOS et la barre d'onglets se glisse sous l'indicateur d'accueil.
    viewportFit: 'cover',
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await getThemeAttributes()

  return (
    <html lang="en" {...theme}>
      <body>
        <Providers>{children}</Providers>
        <KeyboardInset />
        <RegisterServiceWorker />
      </body>
    </html>
  )
}
