// Paires de commandants (règle 702.124 et ses variantes). Pure — aucun accès
// base, même contrainte que `lib/decks/legality.ts`. Le catalogue ne stocke
// pas les `keywords` Scryfall : l'aptitude se lit dans `oracle_text`, ligne
// par ligne, texte de rappel retiré.

export interface CommanderCard {
  name: string
  typeLine: string
  oracleText: string | null | undefined
}

interface PairingAbilities {
  partner: boolean
  partnerWith: string | null
  // « Partner—Survivors », « Partner—Father & son »… : ne s'associe qu'à la
  // même variante, jamais à un « Partner » nu.
  partnerVariant: string | null
  friendsForever: boolean
  chooseBackground: boolean
  doctorsCompanion: boolean
}

function abilitiesOf(oracleText: string | null | undefined): PairingAbilities {
  const abilities: PairingAbilities = {
    partner: false,
    partnerWith: null,
    partnerVariant: null,
    friendsForever: false,
    chooseBackground: false,
    doctorsCompanion: false,
  }

  for (const rawLine of (oracleText ?? '').split('\n')) {
    const line = rawLine.replace(/\([^)]*\)/g, '').replace(/’/g, "'").trim()
    if (!line) continue

    // Le nom désigné peut contenir une virgule (« Partner with Pir,
    // Imaginative Rascal ») : la ligne entière est le nom, pas une liste.
    const partnerWith = /^partner with (.+)$/i.exec(line)
    if (partnerWith) {
      abilities.partnerWith = partnerWith[1]!.trim()
      continue
    }
    const variant = /^partner\s*[—–-]\s*(.+)$/i.exec(line)
    if (variant) {
      abilities.partnerVariant = variant[1]!.trim().toLowerCase()
      continue
    }

    for (const keyword of line.split(',').map((part) => part.trim().toLowerCase())) {
      if (keyword === 'partner') abilities.partner = true
      else if (keyword === 'friends forever') abilities.friendsForever = true
      else if (keyword === 'choose a background') abilities.chooseBackground = true
      else if (keyword === "doctor's companion") abilities.doctorsCompanion = true
    }
  }

  return abilities
}

function subtypes(typeLine: string): string {
  const [, sub = ''] = typeLine.split('—')
  return ` ${sub.trim()} `
}

function isBackground(card: CommanderCard): boolean {
  return subtypes(card.typeLine).includes(' Background ')
}

function isTimeLordDoctor(card: CommanderCard): boolean {
  const sub = subtypes(card.typeLine)
  return sub.includes(' Time Lord ') && sub.includes(' Doctor ')
}

// Une carte double face porte « Recto // Verso » : « Partner with » désigne
// toujours le recto.
function sameName(designated: string | null, name: string): boolean {
  if (!designated) return false
  const front = name.split(' // ')[0]!
  return designated.toLowerCase() === front.toLowerCase()
}

export function canPairCommanders(a: CommanderCard, b: CommanderCard): boolean {
  const first = abilitiesOf(a.oracleText)
  const second = abilitiesOf(b.oracleText)

  if (first.partner && second.partner) return true
  if (sameName(first.partnerWith, b.name) && sameName(second.partnerWith, a.name)) return true
  if (first.partnerVariant !== null && first.partnerVariant === second.partnerVariant) return true
  if (first.friendsForever && second.friendsForever) return true
  if ((first.chooseBackground && isBackground(b)) || (second.chooseBackground && isBackground(a))) return true
  if ((first.doctorsCompanion && isTimeLordDoctor(b)) || (second.doctorsCompanion && isTimeLordDoctor(a))) {
    return true
  }
  return false
}

// Un ou deux commandants, et deux seulement s'ils forment une paire légale.
export function isLegalCommanderSet(commanders: CommanderCard[]): boolean {
  if (commanders.length <= 1) return true
  if (commanders.length > 2) return false
  return canPairCommanders(commanders[0]!, commanders[1]!)
}
