---
title: Architecture
description: How the web app, the worker, PostgreSQL, Valkey and the Scryfall mirror fit together.
---

spellcache is four containers and one external data source. The rules behind
these choices, and the anti-patterns they rule out, are in
[Development](../../development/#architecture-decisions).

<figure class="architecture">
<svg viewBox="0 0 760 420" role="img" aria-labelledby="arch-title" xmlns="http://www.w3.org/2000/svg">
  <title id="arch-title">Data flow between Scryfall, the worker, PostgreSQL, Valkey, the web app and the browser</title>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="var(--sl-color-gray-3)" />
    </marker>
  </defs>
  <g stroke="var(--sl-color-gray-3)" stroke-width="1.5" fill="none" marker-end="url(#arrow)">
    <path d="M190 65 H296" />
    <path d="M385 100 V186" />
    <path d="M570 65 H474" />
    <path d="M655 190 V104" />
    <path d="M570 225 H474" />
    <path d="M655 330 V264" />
    <path d="M105 100 V365 H566" stroke-dasharray="5 4" />
  </g>
  <g font-family="var(--sl-font)" font-size="11.5" fill="var(--sl-color-gray-3)">
    <text x="243" y="56" text-anchor="middle">bulk data</text>
    <text x="393" y="148">upserts</text>
    <text x="522" y="56" text-anchor="middle">jobs</text>
    <text x="663" y="148">enqueue · cache</text>
    <text x="522" y="216" text-anchor="middle">queries</text>
    <text x="663" y="302">HTTPS</text>
    <text x="330" y="357" text-anchor="middle">large images</text>
  </g>
  <g font-family="var(--sl-font)" font-size="13" fill="var(--sl-color-white)">
    <rect x="20" y="30" width="170" height="70" rx="8" fill="var(--sl-color-gray-6)" stroke="var(--sl-color-gray-4)" stroke-dasharray="5 4" />
    <text x="105" y="60" text-anchor="middle" font-weight="600">Scryfall</text>
    <text x="105" y="80" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="12">bulk files · image CDN</text>
    <rect x="300" y="30" width="170" height="70" rx="8" fill="var(--sl-color-gray-6)" stroke="var(--sl-color-gray-4)" />
    <text x="385" y="60" text-anchor="middle" font-weight="600">worker</text>
    <text x="385" y="80" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="12">nightly import · revaluation</text>
    <rect x="570" y="30" width="170" height="70" rx="8" fill="var(--sl-color-gray-6)" stroke="var(--sl-color-gray-4)" />
    <text x="655" y="60" text-anchor="middle" font-weight="600">Valkey</text>
    <text x="655" y="80" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="12">job queue · locks · cache</text>
    <rect x="300" y="190" width="170" height="70" rx="8" fill="var(--sl-color-gray-6)" stroke="var(--sl-color-gray-4)" />
    <text x="385" y="220" text-anchor="middle" font-weight="600">PostgreSQL 17</text>
    <text x="385" y="240" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="12">catalogue · user data</text>
    <rect x="570" y="190" width="170" height="70" rx="8" fill="var(--sl-color-accent-low)" stroke="var(--sl-color-accent)" />
    <text x="655" y="220" text-anchor="middle" font-weight="600">web</text>
    <text x="655" y="240" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="12">Next.js · thumbnail proxy</text>
    <rect x="570" y="330" width="170" height="70" rx="8" fill="var(--sl-color-gray-6)" stroke="var(--sl-color-gray-4)" />
    <text x="655" y="360" text-anchor="middle" font-weight="600">Browser / Android</text>
    <text x="655" y="380" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="12">through your proxy</text>
  </g>
</svg>
</figure>

## Components

| Component | Role |
|---|---|
| `web` (`apps/web`) | Next.js app: pages, Server Actions, sign-in, public share pages, thumbnail proxy. Applies the database migrations at start-up. |
| `worker` (`apps/worker`) | Downloads Scryfall's bulk files every night, upserts the catalogue and prices, then revalues every container. Consumes jobs queued by `web` (**Settings › Administration › Jobs**). |
| `postgres` | One database: the rebuildable catalogue (`cards`, `sets`, `card_prices`, `import_runs`) and the irreplaceable user data. |
| `redis` (Valkey) | Job queue between `web` and `worker`, the nightly lock, search cache and sign-in rate limits. |
| `packages/core` | Scryfall client and schemas, image URLs, job queue contract. No Next.js dependency. |
| `packages/db` | Drizzle schema, migrations, PostgreSQL client, shared test database. |

## Card data and images

- The catalogue is a local mirror: no Scryfall API call is made during a user
  request, except two rate-limited server-side cases (a set released today, a
  card missing from the catalogue).
- Small images and art crops go through the `web` thumbnail proxy, which
  stores them on the `thumbnails` volume on first request. Large images are
  loaded from Scryfall's image CDN by the browser.
- Image URLs come from the bulk data, never built by hand.

## Data model

```
collections ─┬─ collection_members (user, role: owner | editor | viewer)
             └─ containers (kind: collection | binder | deck | list)
                   ├─ holdings (card, finish, condition, language, quantity, deck zone)
                   └─ container_stats (precomputed value)
```

- A **collection** is a shared space, not an account's property. Access always
  goes through `collection_members`; containers never point to a user.
- **Containers** hold everything: the collection root, binders, decks and
  lists. A deck is a container whose holdings carry a zone (`main`, `side`,
  `commander`) and whose state moves through `plan`, `assemble`, `built` and
  `dismantled`.
- **container_stats** stores each container's value, recomputed by the worker
  after the nightly import, so a value banner reads one row.
- Trades live in `trades` and `trade_lines`, and only touch holdings when they
  are applied.

## Nightly run

1. The worker's scheduler (or the host's cron entry) takes the
   `spellcache:worker:lock:nightly` lock in Valkey, so a night never runs twice.
2. The bulk import downloads the latest files and upserts cards, sets and
   prices, recording the run in `import_runs`.
3. The revaluation recomputes `container_stats` for every container from the
   new prices.

See [Scheduled tasks](../../self-hosting/scheduled-tasks/) for the host side.
