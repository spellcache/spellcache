'use client'

// Ligne `Legal` de Settings › About : une seule entrée qui ouvre une feuille
// avec les deux mentions obligatoires — l'attribution exigée par les
// conditions de Scryfall et la note de la Fan Content Policy de Wizards of
// the Coast. Îlot client minimal (même patron que `LogoutRow`) : la page
// reste un composant serveur.
import { Scale } from 'lucide-react'
import { useState } from 'react'

import { SettingRow } from '@/components/settings/setting-row'
import { Sheet } from '@/components/ui/sheet'
import { SectionLabel, SheetGroup } from '@/components/ui/sheet-controls'

export function LegalRow() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <SettingRow
        icon={<Scale width={18} height={18} strokeWidth={1.75} />}
        label="Legal"
        onClick={() => setOpen(true)}
      />
      <Sheet open={open} onOpenChange={setOpen} title="Legal">
        <SectionLabel>Data</SectionLabel>
        <SheetGroup>
          <p className="px-14 py-13 text-meta leading-normal text-text-2">
            Card data, images and prices provided by Scryfall.
          </p>
        </SheetGroup>
        <div className="mt-22">
          <SectionLabel>Fan Content Policy</SectionLabel>
          <SheetGroup>
            {/* Texte imposé par la Fan Content Policy, mot pour mot. */}
            <p className="px-14 py-13 text-meta leading-normal text-text-2">
              spellcache is unofficial Fan Content permitted under the Fan Content Policy. Not
              approved/endorsed by Wizards. Portions of the materials used are property of Wizards
              of the Coast. ©Wizards of the Coast LLC.
            </p>
          </SheetGroup>
        </div>
      </Sheet>
    </>
  )
}
