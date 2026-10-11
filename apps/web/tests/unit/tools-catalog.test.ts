// Catalogue des outils (`lib/tools/tools.ts`) : chaque outil livré porte son
// écran, son drapeau et sa préférence, et les drapeaux se lisent depuis
// l'entrée du catalogue.
import { describe, expect, it } from 'vitest'

import {
  anyToolEnabled,
  isToolEnabled,
  NO_TOOLS,
  TOOLS,
  toolFlagsOf,
} from '@/lib/tools/tools'

describe('tool catalog', () => {
  it('ships the trading mode behind its own flag', () => {
    const trading = TOOLS.find((tool) => tool.key === 'trading_mode')
    expect(trading).toMatchObject({
      state: 'shipped',
      path: '/tools/trade',
      preference: 'toolTradingMode',
    })

    const flags = toolFlagsOf({ toolLifeTracker: false, toolTradingMode: true })
    expect(anyToolEnabled(flags)).toBe(true)
    expect(isToolEnabled('trading_mode', flags)).toBe(true)
    expect(isToolEnabled('life_tracker', flags)).toBe(false)
    expect(isToolEnabled('card_scanner', flags)).toBe(false)
    expect(anyToolEnabled(NO_TOOLS)).toBe(false)
  })

  it('gives every shipped tool a screen, a flag and a preference', () => {
    for (const tool of TOOLS.filter((entry) => entry.state === 'shipped')) {
      expect(tool.path).toBeDefined()
      expect(tool.flag).toBeDefined()
      expect(tool.preference).toBeDefined()
    }
  })
})
