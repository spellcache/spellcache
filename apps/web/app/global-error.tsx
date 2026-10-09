'use client'

// Remplace le layout racine quand c'est lui qui échoue : il porte donc ses
// propres `<html>`/`<body>` et la feuille de style.
import './globals.css'

import { ErrorScreen } from '@/components/ui/error-screen'

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body>
        <ErrorScreen error={error} />
      </body>
    </html>
  )
}
