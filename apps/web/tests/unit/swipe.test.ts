import { describe, expect, it } from 'vitest'

import { swipeDirection } from '@/components/ui/use-swipe'

describe('swipeDirection', () => {
  it('moves to the next card when the finger goes left, the previous one when it goes right', () => {
    expect(swipeDirection(-120, 10)).toBe('next')
    expect(swipeDirection(120, -10)).toBe('previous')
  })

  it('ignores a tap or a short drift', () => {
    expect(swipeDirection(-30, 0)).toBeNull()
  })

  it('leaves a mostly vertical gesture to scrolling', () => {
    expect(swipeDirection(-80, 70)).toBeNull()
    expect(swipeDirection(-150, 90)).toBe('next')
  })
})
