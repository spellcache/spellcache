'use client'

import { ErrorScreen } from '@/components/ui/error-screen'

export default function AppError({ error }: { error: Error & { digest?: string } }) {
  return <ErrorScreen error={error} />
}
