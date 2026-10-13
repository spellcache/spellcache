---
title: Email (sign-in links)
description: Configure Resend so spellcache can send sign-in links and codes.
---

spellcache has no passwords: users sign in with a one-time link or code sent by
email. Emails go through **Resend**.

1. Create a [Resend](https://resend.com) account and verify your sending domain
   (DNS records shown by Resend).
2. Create an API key and set it in `.env`:

   ```bash
   RESEND_API_KEY=re_…
   RESEND_FROM_EMAIL="spellcache <signin@your-domain.example>"
   ```

3. Restart `web`: `docker compose -f docker-compose.example.yml up -d web`.

`RESEND_FROM_EMAIL` must be an address on a domain verified in Resend. Without
it, Resend's test sender is used, which only delivers to your own Resend
account address.

In production the `web` container refuses to send sign-in emails without a
Resend key: a missing key would otherwise print valid sign-in links in the logs.

## SMTP

Plain SMTP is **not supported** today. Auth.js (the authentication library) can
send through SMTP with its Nodemailer provider, so adding it is possible but
requires a code change; contributions are welcome.
