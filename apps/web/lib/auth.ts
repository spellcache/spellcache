// Configuration Auth.js v5 (API v5 — `handlers`, `auth`, `signIn`,
// `signOut` — jamais le style v4 `getServerSession`).
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { and, eq, sql } from 'drizzle-orm'
import NextAuth, { type DefaultSession } from 'next-auth'
import ResendProvider from 'next-auth/providers/resend'

import { accounts, sessions, users, verificationTokens, type UserRole } from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { canSendLoginCode, generateLoginCode, LOGIN_CODE_TTL_SECONDS } from '@/lib/auth-codes/login-code'
import { sendMagicLinkEmail } from '@/lib/mail/resend'
import { rateLimit } from '@/lib/redis'
import { canRequestMagicLink, getAdminEmail } from '@/lib/site-settings'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      username: string | null
      displayName: string | null
      role: UserRole
    } & DefaultSession['user']
  }
}

// Premier compte créé sur une base vide => `admin`. Avec `ADMIN_EMAIL`,
// c'est le compte de cet email qui le devient,
// quel que soit son rang. Exportée séparément pour rester testable sans
// passer par le cycle complet du provider Email.
export async function promoteFirstUserToAdmin(userId: string): Promise<void> {
  const adminEmail = getAdminEmail()
  if (adminEmail !== null) {
    await db
      .update(users)
      .set({ role: 'admin' })
      .where(and(eq(users.id, userId), sql`lower(${users.email}) = ${adminEmail}`))
    return
  }
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(users)
  if (total === 1) {
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, userId))
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: 'database' },
  pages: { signIn: '/login', error: '/login' },
  providers: [
    ResendProvider({
      from: process.env.RESEND_FROM_EMAIL ?? 'spellcache <onboarding@resend.dev>',
      // Transport propre : `lib/mail/resend.ts`
      // décide seul entre l'envoi réel et la console de développement,
      // jamais le `fetch` par défaut du provider `Resend` d'Auth.js.
      // Lien OU code (lib/auth-codes/login-code.ts) : le jeton est un code
      // à 6 chiffres, valable 10 minutes au lieu des 24 h par défaut.
      generateVerificationToken: generateLoginCode,
      maxAge: LOGIN_CODE_TTL_SECONDS,
      sendVerificationRequest: async ({ identifier, url, token }) => {
        await sendMagicLinkEmail({ to: identifier, url, code: token })
      },
    }),
  ],
  callbacks: {
    // Inscriptions sur invitation (réglage d'Administration › Users) : la
    // demande de lien magique est refusée pour un email inconnu. Garde de
    // dernier recours pour les appels directs à `/api/auth/signin/resend` —
    // l'écran de connexion filtre en amont sans rien révéler
    // (app/(public)/login/actions.ts).
    // Plafond par email, toutes origines confondues (connexion, invitations,
    // appel direct) : empêche d'inonder une boîte et d'épuiser le quota
    // Resend.
    async signIn({ user, email }) {
      if (!email?.verificationRequest) return true
      if (!user.email) return false
      const normalized = user.email.trim().toLowerCase()
      if (!(await rateLimit(`ratelimit:magic-link:${normalized}`, 10, 900))) return false
      // Plafond de codes actifs par email (lib/auth-codes/login-code.ts).
      return (await canRequestMagicLink(normalized)) && (await canSendLoginCode(normalized))
    },
    // Stratégie `database` (sessions en base) : `user`
    // est la ligne `users` complète renvoyée par l'adapter. Le `username`
    // reste tel quel (potentiellement `null`) — ne jamais en fabriquer un
    // par défaut ici, c'est au garde serveur de rediriger.
    async session({ session, user }) {
      const row = user as typeof users.$inferSelect
      session.user.id = row.id
      session.user.email = row.email
      session.user.username = row.username
      session.user.displayName = row.displayName
      session.user.role = row.role
      return session
    },
  },
  events: {
    async createUser({ user }) {
      if (user.id) await promoteFirstUserToAdmin(user.id)
    },
  },
})
