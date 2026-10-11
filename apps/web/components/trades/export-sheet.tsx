'use client'

// Export d'un échange pour l'autre partie : un résumé lisible, une liste de
// cartes réimportable ou un CSV, à copier ou à partager (téléchargé quand le
// navigateur ne sait pas partager).
import { Copy, Share2 } from 'lucide-react'
import { useState } from 'react'

import { Segmented } from '@/components/ui/segmented'
import { Sheet } from '@/components/ui/sheet'
import {
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
} from '@/components/ui/sheet-controls'
import { copyText, downloadText } from '@/lib/clipboard'
import { exportFileName, exportTrade, type TradeExportFormat } from '@/lib/trades/export'
import type { TradeView } from '@/lib/trades/trades'

const HINT: Record<TradeExportFormat, string> = {
  summary: 'Both sides, cash and notes. Readable by anyone.',
  list: 'Imports into Moxfield, Archidekt, Arena or spellcache.',
  csv: 'Every card with giver, set, number, finish, condition, language and price.',
}

export function ExportSheet({
  open,
  onClose,
  trade,
}: {
  open: boolean
  onClose: () => void
  trade: TradeView
}) {
  const [format, setFormat] = useState<TradeExportFormat>('summary')
  const [copied, setCopied] = useState(false)
  const text = exportTrade(trade, format)

  async function share() {
    const file = exportFileName(trade, format)
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: file, text })
        return
      } catch {
        // Partage refusé ou annulé : le téléchargement reste disponible.
      }
    }
    downloadText(text, file, format === 'csv' ? 'text/csv' : 'text/plain')
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setCopied(false)
          onClose()
        }
      }}
      title="Export the trade"
    >
      <div className="flex flex-col gap-14">
        <div>
          <SectionLabel>Format</SectionLabel>
          <Segmented
            options={[
              { value: 'summary', label: 'Summary' },
              { value: 'list', label: 'Card list' },
              { value: 'csv', label: 'CSV' },
            ]}
            value={format}
            onChange={(value) => {
              setFormat(value)
              setCopied(false)
            }}
          />
          <p className="mt-8 ml-2 text-meta text-text-3">{HINT[format]}</p>
        </div>
        <div>
          <SectionLabel>Preview</SectionLabel>
          <pre
            data-testid="trade-export-preview"
            className="m-0 max-h-export-preview overflow-auto whitespace-pre-wrap rounded-control border border-border bg-surface-1 p-12 font-mono text-meta-mono leading-normal text-text"
          >
            {text}
          </pre>
        </div>
        <div className="grid grid-cols-2 gap-8">
          <SecondaryButton
            onClick={() => {
              void copyText(text).then(setCopied)
            }}
          >
            <span className="flex items-center justify-center gap-6">
              <Copy width={16} height={16} strokeWidth={1.75} />
              {copied ? 'Copied' : 'Copy'}
            </span>
          </SecondaryButton>
          <PrimaryButton onClick={() => void share()}>
            <span className="flex items-center justify-center gap-6">
              <Share2 width={16} height={16} strokeWidth={1.75} />
              Share
            </span>
          </PrimaryButton>
        </div>
      </div>
    </Sheet>
  )
}
