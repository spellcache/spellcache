// Test unitaire : paires de commandants (`lib/decks/partners.ts`). Oracle
// texts tels que Scryfall les livre, texte de rappel compris.
import { describe, expect, it } from 'vitest'

import { canPairCommanders, isLegalCommanderSet, type CommanderCard } from '@/lib/decks/partners'

function legend(name: string, oracleText: string | null, typeLine = 'Legendary Creature — Human'): CommanderCard {
  return { name, typeLine, oracleText }
}

const PARTNER = 'Partner (You can have two commanders if both have partner.)'

const thrasios = legend('Thrasios, Triton Hero', `{4}: Scry 1.\n${PARTNER}`)
const tymna = legend('Tymna the Weaver', `Lifelink\n${PARTNER}`)
const atraxa = legend('Atraxa, Praetors’ Voice', 'Flying, vigilance, deathtouch, lifelink\nAt the beginning of your end step, proliferate.')

describe('lib/decks/partners — canPairCommanders', () => {
  it('pairs two cards with Partner', () => {
    expect(canPairCommanders(thrasios, tymna)).toBe(true)
  })

  it('reads Partner inside a comma-separated keyword line', () => {
    expect(canPairCommanders(legend('A', 'Flying, partner'), tymna)).toBe(true)
  })

  it('refuses a commander without a pairing ability', () => {
    expect(canPairCommanders(thrasios, atraxa)).toBe(false)
    expect(canPairCommanders(atraxa, thrasios)).toBe(false)
  })

  it('pairs "Partner with" only with the named card, both ways', () => {
    const pir = legend(
      'Pir, Imaginative Rascal',
      'Partner with Toothy, Imaginary Friend (When this creature enters, target player may put Toothy into their hand from their library, then shuffle.)',
    )
    const toothy = legend('Toothy, Imaginary Friend', 'Partner with Pir, Imaginative Rascal (When this creature enters, ...)')
    expect(canPairCommanders(pir, toothy)).toBe(true)
    expect(canPairCommanders(pir, tymna)).toBe(false)
    expect(canPairCommanders(tymna, toothy)).toBe(false)
  })

  it('pairs Friends forever with Friends forever only', () => {
    const friends = 'Friends forever (You can have two commanders if both have friends forever.)'
    const eleven = legend('Eleven, the Mage', friends)
    const will = legend('Will the Wise', `Vigilance\n${friends}`)
    expect(canPairCommanders(eleven, will)).toBe(true)
    expect(canPairCommanders(eleven, thrasios)).toBe(false)
  })

  it('pairs a matching Partner variant but not plain Partner', () => {
    const survivorA = legend('A', 'Partner—Survivors (You can have two commanders if both have this ability.)')
    const survivorB = legend('B', 'Partner—Survivors (You can have two commanders if both have this ability.)')
    const other = legend('C', 'Partner—Father & son (You can have two commanders if both have this ability.)')
    expect(canPairCommanders(survivorA, survivorB)).toBe(true)
    expect(canPairCommanders(survivorA, other)).toBe(false)
    expect(canPairCommanders(survivorA, thrasios)).toBe(false)
  })

  it('pairs Choose a Background with a Background, in either order', () => {
    const wilson = legend('Wilson, Refined Grizzly', 'Choose a Background (You can have a Background as a second commander.)\nReach, trample')
    const background = legend('Raised by Giants', 'Commander creatures you own are Giants.', 'Legendary Enchantment — Background')
    expect(canPairCommanders(wilson, background)).toBe(true)
    expect(canPairCommanders(background, wilson)).toBe(true)
    expect(canPairCommanders(thrasios, background)).toBe(false)
  })

  it("pairs Doctor's companion with a Time Lord Doctor", () => {
    const companion = legend('Rose Tyler', "Doctor’s companion (You can have two commanders if the other is the Doctor.)")
    const doctor = legend('The Tenth Doctor', 'Allons-y!', 'Legendary Creature — Time Lord Doctor')
    expect(canPairCommanders(companion, doctor)).toBe(true)
    expect(canPairCommanders(companion, thrasios)).toBe(false)
  })

  it('tolerates a missing oracle text', () => {
    expect(canPairCommanders(legend('A', null), tymna)).toBe(false)
  })
})

describe('lib/decks/partners — isLegalCommanderSet', () => {
  it('accepts zero or one commander', () => {
    expect(isLegalCommanderSet([])).toBe(true)
    expect(isLegalCommanderSet([atraxa])).toBe(true)
  })

  it('accepts a legal pair and refuses an illegal one', () => {
    expect(isLegalCommanderSet([thrasios, tymna])).toBe(true)
    expect(isLegalCommanderSet([thrasios, atraxa])).toBe(false)
  })

  it('never accepts three commanders', () => {
    expect(isLegalCommanderSet([thrasios, tymna, legend('Kraum', PARTNER)])).toBe(false)
  })
})
