// Aller-retour du curseur opaque.
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { decodeCursor, encodeCursor, InvalidCursorError } from '@/lib/search/cursor'

describe('lib/search/cursor', () => {
  it('round-trips rank, name and cardId through encode/decode', () => {
    const cursor = {
      rank: 0.734,
      name: 'Lightning Bolt',
      cardId: randomUUID(),
    }

    const encoded = encodeCursor(cursor)
    expect(typeof encoded).toBe('string')
    expect(decodeCursor(encoded)).toEqual(cursor)
  })

  it('produces an opaque, URL-safe token', () => {
    const encoded = encodeCursor({
      rank: 1,
      name: 'Ærathi Berserker',
      cardId: randomUUID(),
    })

    expect(encoded).not.toMatch(/[+/=]/)
  })

  it('throws InvalidCursorError on garbage input', () => {
    expect(() => decodeCursor('nimportequoi')).toThrow(InvalidCursorError)
  })

  it('throws InvalidCursorError when the decoded payload has the wrong shape', () => {
    const badPayload = Buffer.from(JSON.stringify({ rank: 'not-a-number' }), 'utf8').toString(
      'base64url',
    )
    expect(() => decodeCursor(badPayload)).toThrow(InvalidCursorError)
  })

  it('throws InvalidCursorError when cardId is not a uuid', () => {
    const badPayload = Buffer.from(
      JSON.stringify({ rank: 1, name: 'x', cardId: 'not-a-uuid' }),
      'utf8',
    ).toString('base64url')
    expect(() => decodeCursor(badPayload)).toThrow(InvalidCursorError)
  })

  it('throws InvalidCursorError when the token is not valid base64url JSON', () => {
    expect(() => decodeCursor('%%%not-base64%%%')).toThrow(InvalidCursorError)
  })
})
