# spellcache

**Your Magic: The Gathering collection, on your own server.**

spellcache is a self-hosted, mobile-first web app to manage a card collection:
inventory, binders, deck building and the life of a deck from plan to built,
collection value tracking, and a few table tools (life counter, first-player
pick, deck playtest). A collection can be shared between several accounts, and decks and
binders can be shared publicly by link.

Card data, images and prices come from a local mirror of
[Scryfall](https://scryfall.com)'s bulk data, refreshed every night. Your data
stays in your database; no Scryfall API call is made while you browse.

## Screenshots

<!-- Replace with real captures (docs/screenshots/*.png) before the first release. -->

| Collection | Deck builder | Life counter |
|---|---|---|
| _screenshot coming soon_ | _screenshot coming soon_ | _screenshot coming soon_ |

## Features

- **Collection**: every copy with its finish, condition and language; binders
  and lists; fast search and filters over the whole catalogue.
- **Decks**: build from your collection or from cards you don't own yet,
  legality per format, assemble a deck from owned copies, dismantle it back.
- **Tools**: a life counter for up to six players, and a playtest to draw
  opening hands from a deck, mulligan and play the first turns. Each tool is
  switched on in Settings.
- **Value**: daily prices (TCGplayer in $ or Cardmarket in €), per collection,
  binder and deck.
- **Sharing**: collections shared between accounts with owner, editor and
  viewer roles; public links for decks and binders.
- **Mobile first, desktop too**: installable as an app (PWA), with a sidebar and
  a preview pane on large screens.
- **Android app**: an APK attached to every
  [release](https://github.com/spellcache/spellcache/releases), which opens your
  own server.
- **Sign-in without passwords**: a one-time link or code by email.

## Quick start (self-hosting)

Requirements: a Linux server with Docker, a domain with an HTTPS reverse proxy, and a
[Resend](https://resend.com) account for sign-in emails.

```bash
git clone https://github.com/spellcache/spellcache.git && cd spellcache
cp .env.example .env        # fill in the Production section
docker compose -f docker-compose.example.yml up -d   # then put your HTTPS reverse proxy in front of 127.0.0.1:3000
docker compose -f docker-compose.example.yml exec -T worker node apps/worker/src/index.ts --run-now
```

The last command imports the card catalogue (twenty minutes to an hour). The
complete guide — reverse proxy, backups, restore, updates — is in
**[docs/self-hosting.md](docs/self-hosting.md)**.

## Documentation

- [Self-hosting](docs/self-hosting.md) — installation, email, reverse proxy,
  backup and restore, updates
- [Development](docs/development.md) — local setup, commands, monorepo layout,
  conventions
- Contributing, code of conduct and security policy: see the
  [spellcache organisation](https://github.com/spellcache) defaults

## Development

```bash
cp .env.example .env          # then set AUTH_SECRET (openssl rand -base64 32)
docker compose up -d postgres redis
pnpm install && pnpm db:migrate && pnpm import:bulk
pnpm dev
```

Details in [docs/development.md](docs/development.md). Code comments are
written in French; identifiers, the UI and the documentation are in English.

## License

The source code is released under the [MIT License](LICENSE).

## Legal

spellcache is unofficial Fan Content permitted under the
[Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy).
Not approved/endorsed by Wizards. Portions of the materials used are property
of Wizards of the Coast. ©Wizards of the Coast LLC.

Card data, images and prices are provided by [Scryfall](https://scryfall.com)
and are subject to Scryfall's terms; spellcache is not affiliated with Scryfall.
Mana and set symbols are not part of this repository: they are downloaded from
Scryfall at setup time.
