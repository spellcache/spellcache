// Test unitaire : lectures du scanner ramenées aux formes du catalogue
// (`lib/scanner/scan-text.ts`).
import { describe, expect, it } from 'vitest'

import {
  cleanScannedName,
  collectorNumberVariants,
  holdingLanguageOf,
  setCodeVariants,
} from '@/lib/scanner/scan-text'

describe('setCodeVariants', () => {
  it('tries the code as read first, in lower case', () => {
    expect(setCodeVariants('MKM')[0]).toBe('mkm')
  })

  it('adds the look-alike readings', () => {
    const variants = setCodeVariants('M2O')
    expect(variants[0]).toBe('m2o')
    expect(variants).toContain('m20')
    expect(new Set(variants).size).toBe(variants.length)
  })

  it('rejects text that cannot be a set code', () => {
    expect(setCodeVariants('')).toEqual([])
    expect(setCodeVariants('M•EN')).toEqual([])
    expect(setCodeVariants('ABCDEFGH')).toEqual([])
  })

  it('keeps only the reading when the variants would explode', () => {
    expect(setCodeVariants('0O1IL5')).toEqual(['0o1il5'])
  })
})

describe('collectorNumberVariants', () => {
  it('drops the leading zeros of the four-digit numbers, keeping the reading', () => {
    expect(collectorNumberVariants('0123')).toEqual(['123', '0123'])
    expect(collectorNumberVariants('7')).toEqual(['7'])
  })

  it('ignores the set total', () => {
    expect(collectorNumberVariants('123/280')).toEqual(['123'])
  })

  it('keeps a variant letter and reads an O as a zero', () => {
    expect(collectorNumberVariants('12A')).toEqual(['12a'])
    expect(collectorNumberVariants('O2O1')).toEqual(['201', '0201'])
  })

  it('rejects text that cannot be a collector number', () => {
    expect(collectorNumberVariants('R')).toEqual([])
    expect(collectorNumberVariants('12345')).toEqual([])
  })
})

describe('holdingLanguageOf', () => {
  it('maps the printed codes onto the holding languages', () => {
    expect(holdingLanguageOf('EN')).toBe('en')
    expect(holdingLanguageOf('FR')).toBe('fr')
    expect(holdingLanguageOf('JP')).toBe('ja')
    expect(holdingLanguageOf('SP')).toBe('es')
  })

  it('falls back to English', () => {
    expect(holdingLanguageOf('KO')).toBe('en')
    expect(holdingLanguageOf(null)).toBe('en')
  })
})

describe('cleanScannedName', () => {
  it('drops mana symbols read as noise around the name', () => {
    expect(cleanScannedName('Lightning Bolt ®')).toBe('Lightning Bolt')
    expect(cleanScannedName('  Gaea’s   Cradle ')).toBe('Gaea’s Cradle')
  })

  it('keeps commas, hyphens and apostrophes of real names', () => {
    expect(cleanScannedName("Urza's Saga")).toBe("Urza's Saga")
    expect(cleanScannedName('Nicol Bolas, the Ravager')).toBe('Nicol Bolas, the Ravager')
    expect(cleanScannedName('Kami of False Hope -')).toBe('Kami of False Hope')
    expect(cleanScannedName('Summon: G.F. Cerberus')).toBe('Summon: G.F. Cerberus')
    expect(cleanScannedName('Ach! Hans, Run!')).toBe('Ach! Hans, Run!')
  })
})
