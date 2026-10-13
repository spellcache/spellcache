---
title: FAQ
description: Short answers to common questions about spellcache.
---

## Is there a public instance I can use?

No. spellcache is meant to run on your own server, for you and the people you
invite. See [Installation](../../self-hosting/installation/).

## Why no passwords? Why no Google or Discord sign-in?

Sign-in uses a one-time link or 6-digit code sent by email. There is no
password to leak, reuse or reset, and no account depends on a third-party
identity provider. Password and OAuth sign-in are deliberately out of scope.

## Does it work offline?

No. spellcache always needs a connection to your server. The installed app
caches its own static files to start faster, never your collection.

## Does it call Scryfall while I browse?

No. The worker downloads Scryfall's bulk files every night into your database,
and the app reads from there. Two server-side exceptions exist, rate-limited:
a set released today, and a card missing from the local catalogue. Your browser
never talks to Scryfall's API.

## How often do prices change?

Once a day, after the nightly import. Prices come from Scryfall's bulk data:
TCGplayer market in US dollars, or Cardmarket trend in euros, depending on the
account's [price source](../../guide/collection/#prices-and-value).

## Can I see my collection in both dollars and euros?

No. The currency follows the price source, and spellcache never converts
between currencies: a TCGplayer price in dollars and a Cardmarket price in
euros are two different markets, not one price in two currencies.

## Can several playgroups share one server?

Yes. Each account has its own collection, and a collection is shared only with
the members its owner adds. One person can also belong to several collections
and switch between them in **Settings**. See [Sharing](../../guide/sharing/).

## Can I run it on a Raspberry Pi or a NAS?

Images are published for `linux/arm64` as well as `linux/amd64`. Plan for
4 GB of RAM: the memory limits of the four containers add up to 2.8 GB, and the
nightly import is the heaviest moment.

## Is there an iPhone app?

There is no native iOS app. On iPhone and iPad, add spellcache to the home
screen from Safari. See [Android app and PWA](../../guide/mobile/).

## Do I need HTTPS?

For any real use, yes. The Android app refuses servers without a valid HTTPS
certificate, and sign-in links are built from `AUTH_URL`, the public address
of your instance.

## Can I send sign-in emails through my own SMTP server?

Not yet: only Resend is supported. See [Email](../../self-hosting/email/#smtp).

## What is backed up?

Only user data: accounts, collections, binders, decks, trades and settings. The
card catalogue is re-imported in one command. See
[Backup](../../self-hosting/backup/).

## Is spellcache affiliated with Wizards of the Coast or Scryfall?

No. spellcache is unofficial Fan Content permitted under the
[Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not
approved/endorsed by Wizards. Portions of the materials used are property of
Wizards of the Coast. ©Wizards of the Coast LLC. Card data, images and prices
are provided by [Scryfall](https://scryfall.com) and are subject to Scryfall's
terms; spellcache is not affiliated with Scryfall.
