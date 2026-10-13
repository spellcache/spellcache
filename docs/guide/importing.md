---
title: Importing and exporting
description: Bring a collection or a decklist in from another tool, and take your data out.
---

## Import into the collection

Open **Import** on the Collection home, or **Import / Export** in a `···` menu.
Paste a list or choose a file (`.csv`, `.txt`, `.tsv`). The format is detected
automatically.

| Source | Format |
|---|---|
| Moxfield, Archidekt, MTGO, Arena | Decklist text |
| ManaBox, Deckbox, Moxfield, Delver Lens, Dragon Shield | CSV export |

Then choose:

- **Import into**: the collection (no binder), an existing binder or list, or a
  new binder or list created on the spot;
- **Condition when the source doesn't say**, and **Treat as foil by default**.

**Import** reports how many cards were imported and lists the lines it skipped.
When a line names a card without its printing, the cheapest printing in your
currency is used; edit the card afterwards to change it.

### Text lists

```
4 Lightning Bolt
4x Counterspell (MH2) 267
1 Sol Ring (CMM) 410

Sideboard
2 Pyroblast
```

One card per line, starting with a quantity (`4` or `4x`), optionally followed
by `(SET) collector-number`. Section headers such as `Deck`, `Mainboard`,
`Sideboard` or `Commander` are recognised. Lines that don't start with a
quantity are ignored.

### CSV

The first row must name the columns, with at least a card name and a quantity.
spellcache recognises the usual column names for set code, collector number,
finish or foil, condition and language. Commas, semicolons and tabs all work.

## Import a deck

**Decks** › `···` › **Import a deck** creates a new deck from a Scryfall,
Moxfield, Archidekt or Arena list: give it a name, an optional format, paste the
list, and tap **Import deck**.

Inside an existing deck, `···` › **Import a list** adds cards to it. A
**Preview** shows what was recognised and lets you pick a printing or skip each
ambiguous or unknown line. A built deck must be moved back to Assemble first.

## Export

**Import & export** › **Export** downloads the whole collection, a binder or a
list:

| Format | Content |
|---|---|
| **CSV** | `name, set, collector_number, qty, finish, condition, language, price` |
| **JSON** | The same fields, for scripts |
| **Text** | A plain decklist (`4 Lightning Bolt`) other apps can re-import |

For a quick copy, a binder's or a deck's `···` › **Export list** copies the list
to the clipboard, with or without set and number. Missing cards of a deck can be
exported to shops from the Assemble sheet (see [Decks](../decks/#assemble)), and
trades from the trade screen (see [Trading](../trading/#export-a-trade)).

:::tip
Exports are also your safety net: the server's [backup](../../self-hosting/backup/)
covers everyone, an export is yours to keep.
:::
