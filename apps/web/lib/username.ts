// Règle du username, dans son propre module :
// `app/(app)/settings/actions.ts` porte `'use server'`, qui interdit à un
// fichier serveur d'exporter autre chose qu'une fonction async (contrainte de
// build Next.js — `next build` échoue sinon sur `/settings`, voir
// https://nextjs.org/docs/messages/invalid-use-server-value) : `usernameSchema`
// ne peut donc pas vivre dans ce fichier-là.
// Importée à la fois par la Server Action et par le formulaire d'onboarding.
import { z } from 'zod'

export const usernameSchema = z.string().regex(/^[a-z0-9_-]{3,20}$/)
