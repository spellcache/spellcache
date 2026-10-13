'use client'

// Revue des cartes scannées. La caméra est celle de l'app Android : le
// bouton `Scan cards` y ouvre l'activité native, qui rend en se refermant les
// cartes reconnues (`window.__spellcacheScanned`). Elles s'ajoutent à la pile
// de l'onglet ; finition, état, langue et destination se choisissent ici,
// puis tout entre dans la collection en une écriture. Les cartes s'affichent
// en lignes compactes, comme un binder ; une ligne s'édite dans sa feuille.
import { FolderOpen, ScanLine, Settings } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import { CompactRow } from '@/components/cards/compact-row'
import { EditionButton, PrintingPickerSheet } from '@/components/cards/printing-picker-sheet'
import { CardImage } from '@/components/ui/card-image'
import { Chip } from '@/components/ui/chip'
import { PickerSheet } from '@/components/ui/picker-sheet'
import { Screen } from '@/components/ui/screen'
import { ScreenHeader } from '@/components/ui/screen-header'
import { Sheet } from '@/components/ui/sheet'
import {
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
  SheetGroup,
  SheetRow,
} from '@/components/ui/sheet-controls'
import { thumbUrl } from '@spellcache/core/images'
import type { Condition, Finish } from '@spellcache/db/schema'
import { formatMoney, type Currency } from '@/lib/format/money'
import {
  loadPending,
  lineKey,
  mergePending,
  parseScanPayload,
  savePending,
  SCANNER_SHELL_MARKER,
  SCANNER_URL,
  type PendingLine,
} from '@/lib/scanner/pending'
import { languageLabel, SCAN_LANGUAGES } from '@/lib/scanner/languages'
import type { ScanDestination, ScannedCard } from '@/lib/scanner/review'
import type { ScannerSettings } from '@/lib/scanner/settings'

import { getScannedCardsAction, saveScannedCardsAction } from './actions'
import { ScanSettingsSheet, scanOptionsOf, type ScanOptions } from './scan-settings-sheet'

declare global {
  interface Window {
    __spellcacheScanned?: (payload: unknown) => boolean
  }
}

const CONDITIONS: Condition[] = ['nm', 'lp', 'mp', 'hp', 'dmg']

// Codes de set montrés dans le récapitulatif avant « +N ».
const RECAP_SETS = 2

// Récapitulatif des réglages appliqués aux cartes reçues : état, langue,
// foil s'il est activé, filtre de sets s'il y en a un. Ouvre les réglages.
function ScanRecap({ options, onOpen }: { options: ScanOptions; onOpen: () => void }) {
  const badges = [
    options.condition.toUpperCase(),
    options.language === 'auto' ? 'Language detected' : languageLabel(options.language),
  ]
  if (options.foilDefault) badges.push('Foil')
  if (options.sets.length > 0) {
    const shown = options.sets.slice(0, RECAP_SETS).map((code) => code.toUpperCase()).join(', ')
    const more = options.sets.length - RECAP_SETS
    badges.push(`Sets: ${shown}${more > 0 ? ` +${more}` : ''}`)
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Scan settings: ${badges.join(', ')}`}
      className="flex flex-wrap gap-6 text-left"
    >
      {badges.map((badge) => (
        <span
          key={badge}
          className={`rounded-pill border px-10 py-4 text-meta font-semibold ${
            badge === 'Foil' || badge.startsWith('Sets:')
              ? 'border-border-accent bg-accent-bg text-accent-text'
              : 'border-border bg-surface-2 text-text-2'
          }`}
        >
          {badge}
        </span>
      ))}
    </button>
  )
}

const KIND_LABEL: Record<ScanDestination['kind'], string> = {
  collection: 'Collection',
  binder: 'Binder',
  list: 'List',
}

function hasScannerShell(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes(SCANNER_SHELL_MARKER)
}

// Une impression sans version non-foil (promo foil seulement) part en foil.
function defaultFinish(card: ScannedCard): Finish {
  return card.finishes.includes('nonfoil') ? 'nonfoil' : (card.finishes[0] ?? 'nonfoil')
}

// Boutons − / + de la feuille d'ajout (`add-card-sheet.tsx`).
function QuantityControl({ qty, onChange }: { qty: number; onChange: (next: number) => void }) {
  const button = (label: string, symbol: string, next: number, disabled: boolean) => (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(next)}
      className="flex h-touch-target w-touch-target items-center justify-center"
    >
      <span
        className={`flex h-qty-button w-qty-button items-center justify-center rounded-full bg-surface-2 text-body font-bold ${
          disabled ? 'text-text-3' : 'text-text'
        }`}
      >
        {symbol}
      </span>
    </button>
  )
  return (
    <div className="flex items-center gap-12">
      {button('Decrease quantity', '−', qty - 1, qty <= 1)}
      <span className="min-w-qty-value text-center font-mono text-body font-bold text-text">{qty}</span>
      {button('Increase quantity', '+', qty + 1, false)}
    </div>
  )
}

// Une carte scannée : impression, exemplaires, finition, retrait de la pile.
function ScannedLineSheet({
  line,
  card,
  currency,
  open,
  onClose,
  onChange,
  onRemove,
  onEdition,
}: {
  line: PendingLine
  card: ScannedCard | undefined
  currency: Currency
  open: boolean
  onClose: () => void
  onChange: (patch: Partial<PendingLine>) => void
  onRemove: () => void
  onEdition: () => void
}) {
  const canFoil = card ? card.finishes.includes('foil') && card.finishes.includes('nonfoil') : false
  const finishClass = (selected: boolean) =>
    selected
      ? 'flex-1 rounded-control border border-border-accent bg-accent-bg py-9 text-body font-bold text-accent-text'
      : 'flex-1 rounded-control border border-border bg-surface-2 py-9 text-body font-bold text-text-2'

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()} title={card?.name ?? 'Scanned card'}>
      <div className="flex flex-col gap-14">
        {card && <CardImage src={card.imageUrl} alt={card.name} />}
        <div className="flex items-baseline justify-between gap-12">
          <div className="min-w-0 truncate text-row-value font-bold text-text">{card?.name}</div>
          <div className="whitespace-nowrap font-mono text-price-detail font-extrabold text-accent-text">
            {card?.price == null ? '—' : formatMoney(Math.round(card.price * 100), currency)}
          </div>
        </div>

        {!line.exact && (
          <p className="text-meta text-warning">
            Found by its name: check that this is your printing, or pick the right one.
          </p>
        )}
        {card && (
          <EditionButton
            setName={card.setName}
            setCode={card.setCode}
            setIconUri={card.setIconUri}
            collectorNumber={card.collectorNumber}
            onClick={onEdition}
          />
        )}

        <div>
          <SectionLabel>Quantity</SectionLabel>
          <QuantityControl qty={line.qty} onChange={(qty) => onChange({ qty })} />
        </div>

        {canFoil && (
          <div>
            <SectionLabel>Finish</SectionLabel>
            <div className="flex gap-8">
              <button
                type="button"
                onClick={() => onChange({ finish: 'nonfoil' })}
                className={finishClass(line.finish !== 'foil')}
              >
                Non-foil
              </button>
              <button
                type="button"
                onClick={() => onChange({ finish: 'foil' })}
                className={finishClass(line.finish === 'foil')}
              >
                Foil
              </button>
            </div>
          </div>
        )}

        <div>
          <SectionLabel>Condition</SectionLabel>
          <div className="flex flex-wrap gap-6">
            {CONDITIONS.map((condition) => (
              <Chip
                key={condition}
                label={condition.toUpperCase()}
                selected={line.condition === condition}
                onClick={() => onChange({ condition })}
              />
            ))}
          </div>
        </div>

        <div>
          <SectionLabel>Language</SectionLabel>
          <div className="flex flex-wrap gap-6">
            {SCAN_LANGUAGES.map((language) => (
              <Chip
                key={language.value}
                label={language.label}
                selected={line.language === language.value}
                onClick={() => onChange({ language: language.value })}
              />
            ))}
          </div>
        </div>

        <SecondaryButton onClick={onRemove}>Remove from this scan</SecondaryButton>
      </div>
    </Sheet>
  )
}

export function ScannerView({
  destinations,
  defaultDestinationId,
  canEdit,
  initialSettings,
}: {
  destinations: ScanDestination[]
  defaultDestinationId: string
  canEdit: boolean
  initialSettings: ScannerSettings
}) {
  const [options, setOptions] = useState(() => scanOptionsOf(initialSettings))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { foilDefault, condition: defaultCondition, language: defaultLanguage } = options
  const [lines, setLines] = useState<PendingLine[]>([])
  const [cards, setCards] = useState<Map<string, ScannedCard>>(new Map())
  const [currency, setCurrency] = useState<Currency>('eur')
  const [canScan, setCanScan] = useState(false)
  const [destinationId, setDestinationId] = useState(defaultDestinationId)
  const [destinationOpen, setDestinationOpen] = useState(false)
  // Lignes ouvertes, par `lineKey`.
  const [editionFor, setEditionFor] = useState<string | null>(null)
  const [openLine, setOpenLine] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<{ count: number; destination: ScanDestination } | null>(null)

  // Lus après l'hydratation : ni le user agent ni `sessionStorage` n'existent
  // au rendu serveur.
  useEffect(() => {
    setCanScan(hasScannerShell())
    setLines(loadPending())
  }, [])

  useEffect(() => {
    window.__spellcacheScanned = (payload) => {
      // État, langue et foil par défaut des réglages de scan ; le foil est
      // corrigé en non-foil au chargement des cartes qui n'existent pas en
      // foil (`defaultFinish`).
      const incoming = parseScanPayload(payload, {
        condition: defaultCondition,
        language: defaultLanguage,
        foil: foilDefault,
      })
      if (incoming.length > 0) {
        setAdded(null)
        setLines((current) => {
          const next = mergePending(current, incoming)
          savePending(next)
          return next
        })
      }
      return true
    }
    return () => {
      delete window.__spellcacheScanned
    }
  }, [foilDefault, defaultCondition, defaultLanguage])

  // Détails des cartes pas encore chargées (nom, image, finitions, prix).
  const missing = useMemo(
    () => [...new Set(lines.map((line) => line.cardId))].filter((id) => !cards.has(id)),
    [lines, cards],
  )
  useEffect(() => {
    if (missing.length === 0) return
    let cancelled = false
    getScannedCardsAction(missing)
      .then((result) => {
        if (cancelled) return
        setCurrency(result.currency)
        setCards((current) => {
          const next = new Map(current)
          for (const card of result.cards) next.set(card.id, card)
          return next
        })
        // Finition par défaut à la première lecture de la carte ; deux
        // lignes devenues identiques n'en font qu'une.
        setLines((current) =>
          mergePending(
            [],
            current.map((line) => {
              const card = result.cards.find((candidate) => candidate.id === line.cardId)
              return card && !card.finishes.includes(line.finish) ? { ...line, finish: defaultFinish(card) } : line
            }),
          ),
        )
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the scanned cards.')
      })
    return () => {
      cancelled = true
    }
  }, [missing])

  function update(next: PendingLine[]) {
    setLines(next)
    savePending(next)
  }

  // Modifiée à l'identique d'une autre ligne, elle s'y ajoute (à la place
  // de la première) ; renvoie sa nouvelle clé, que suit la feuille ouverte.
  function patchLine(key: string, patch: Partial<PendingLine>): string | null {
    const line = lines.find((candidate) => lineKey(candidate) === key)
    if (!line) return null
    const patched = { ...line, ...patch }
    update(mergePending([], lines.map((candidate) => (candidate === line ? patched : candidate))))
    return lineKey(patched)
  }

  // Une autre impression remplace la ligne à sa place (non-foil, la seule
  // finition sûre) ; déjà en attente, elle s'y ajoute.
  function replacePrinting(key: string, printing: { id: string }): string | null {
    const line = lines.find((candidate) => lineKey(candidate) === key)
    if (!line) return null
    // La même impression choisie : confirmée telle quelle.
    if (printing.id === line.cardId) return patchLine(key, { exact: true })
    return patchLine(key, { cardId: printing.id, exact: true, finish: 'nonfoil' })
  }

  const destination = destinations.find((candidate) => candidate.id === destinationId) ?? destinations[0]
  const total = lines.reduce((sum, line) => sum + line.qty, 0)
  const toCheck = lines.filter((line) => !line.exact).length
  const editionLine = editionFor ? lines.find((line) => lineKey(line) === editionFor) : undefined
  const editionCard = editionLine ? cards.get(editionLine.cardId) : undefined
  const openLineData = openLine ? lines.find((line) => lineKey(line) === openLine) : undefined

  async function handleSave() {
    if (!destination || lines.length === 0) return
    setSaving(true)
    setError(null)
    const result = await saveScannedCardsAction({
      containerId: destination.id,
      lines: lines.map(({ cardId, finish, condition, language, qty }) => ({ cardId, finish, condition, language, qty })),
    }).catch(() => null)
    setSaving(false)
    if (!result?.ok) {
      setError('Could not add these cards. Please try again.')
      return
    }
    setAdded({ count: result.added, destination })
    update([])
  }

  return (
    <Screen
      header={
        <ScreenHeader
          title="Card scanner"
          breadcrumb="Tools"
          backHref="/tools"
          actions={[{ icon: Settings, label: 'Scan settings', onClick: () => setSettingsOpen(true) }]}
        />
      }
    >
      <div className="flex flex-col gap-18">
        <ScanRecap options={options} onOpen={() => setSettingsOpen(true)} />

        {canScan ? (
          <PrimaryButton onClick={() => window.location.assign(SCANNER_URL)} disabled={!canEdit || saving}>
            {lines.length > 0 ? 'Scan more cards' : 'Scan cards'}
          </PrimaryButton>
        ) : (
          <div className="flex flex-col items-center gap-10 px-20 py-28 text-center">
            <ScanLine width={28} height={28} strokeWidth={1.5} className="text-text-3" />
            <p className="text-row-value text-text-2">
              Scanning uses the camera of the spellcache Android app. Open this page in the app to
              scan cards.
            </p>
          </div>
        )}

        {!canEdit && (
          <p className="px-2 text-meta text-text-2">
            You can view this collection but not add cards to it.
          </p>
        )}

        {added && (
          <p className="px-2 text-meta text-text-2">
            Added {added.count} {added.count === 1 ? 'card' : 'cards'} to{' '}
            <Link href={`/container/${added.destination.id}`} className="font-semibold text-accent-text">
              {added.destination.name}
            </Link>
            .
          </p>
        )}

        {lines.length === 0 && !added && canScan && (
          <p className="px-2 text-meta text-text-2">
            Hold each card flat in the frame: the set code and number at the bottom left are read
            first, the name at the top otherwise.
          </p>
        )}

        {lines.length > 0 && (
          <>
            <div>
              <SectionLabel>
                {total} {total === 1 ? 'card' : 'cards'}
                {toCheck > 0 ? ` · ${toCheck} to check` : ''}
              </SectionLabel>
              <div className="flex flex-col gap-6">
                {lines.map((line) => {
                  const card = cards.get(line.cardId)
                  return (
                    <CompactRow
                      key={lineKey(line)}
                      thumbUrl={thumbUrl(line.cardId, 'small')}
                      name={card?.name ?? 'Loading...'}
                      manaCost={card?.manaCost ?? null}
                      setCode={card?.setCode ?? ''}
                      setIconUri={card?.setIconUri}
                      collectorNumber={card?.collectorNumber ?? ''}
                      condition={line.condition}
                      isFoil={line.finish === 'foil'}
                      qty={line.qty}
                      priceLabel={card?.price == null ? '—' : formatMoney(Math.round(card.price * 100), currency)}
                      notice={line.exact ? undefined : 'TO CHECK'}
                      onOpen={() => !saving && setOpenLine(lineKey(line))}
                    />
                  )
                })}
              </div>
            </div>

            <div>
              <SectionLabel>Add to</SectionLabel>
              <SheetGroup>
                <SheetRow
                  icon={FolderOpen}
                  label={destination?.name ?? 'Collection'}
                  hint={destination ? KIND_LABEL[destination.kind] : undefined}
                  value="Change"
                  onClick={() => setDestinationOpen(true)}
                />
              </SheetGroup>
            </div>

            {error && <p className="px-2 text-meta text-danger">{error}</p>}

            <div className="flex flex-col gap-8">
              <PrimaryButton onClick={() => void handleSave()} disabled={!canEdit || saving || !destination}>
                {saving ? 'Adding...' : `Add ${total} ${total === 1 ? 'card' : 'cards'}`}
              </PrimaryButton>
              <SecondaryButton onClick={() => update([])} disabled={saving}>
                Clear
              </SecondaryButton>
            </div>
          </>
        )}
      </div>

      <ScanSettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        options={options}
        onChange={setOptions}
      />

      <PickerSheet
        open={destinationOpen}
        onClose={() => setDestinationOpen(false)}
        title="Add to"
        options={destinations.map((option) => ({
          value: option.id,
          label: option.name,
          hint: `${KIND_LABEL[option.kind]} · ${option.cardCount} ${option.cardCount === 1 ? 'card' : 'cards'}`,
        }))}
        value={destination?.id}
        onPick={setDestinationId}
      />

      {openLineData && (
        <ScannedLineSheet
          line={openLineData}
          card={cards.get(openLineData.cardId)}
          currency={currency}
          open={editionFor === null}
          onClose={() => setOpenLine(null)}
          onChange={(patch) => setOpenLine(patchLine(lineKey(openLineData), patch))}
          onRemove={() => {
            setOpenLine(null)
            update(lines.filter((candidate) => candidate !== openLineData))
          }}
          onEdition={() => setEditionFor(lineKey(openLineData))}
        />
      )}

      {editionLine && editionCard && (
        <PrintingPickerSheet
          open={editionFor !== null}
          onClose={() => setEditionFor(null)}
          card={editionCard}
          currentCardId={editionCard.id}
          onPick={(printing) => {
            const key = replacePrinting(lineKey(editionLine), printing)
            // La feuille ouverte suit la nouvelle impression.
            if (openLine === lineKey(editionLine)) setOpenLine(key)
            setEditionFor(null)
          }}
        />
      )}
    </Screen>
  )
}
