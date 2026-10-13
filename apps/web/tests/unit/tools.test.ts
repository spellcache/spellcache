// Test unitaire : la règle des drapeaux d'outils (`lib/tools/tools.ts`),
// dérivée de la seule table `TOOL_PREFERENCE`.
import { describe, expect, it } from 'vitest'

import {
  anyToolEnabled,
  isToolEnabled,
  NO_TOOLS,
  TOOL_PREFERENCE,
  TOOLS,
  toolFlagsOf,
  toolPreferenceOf,
} from '@/lib/tools/tools'

describe('tool flags', () => {
  it('enables nothing for NO_TOOLS', () => {
    expect(anyToolEnabled(NO_TOOLS)).toBe(false)
    for (const tool of TOOLS) expect(isToolEnabled(tool.key, NO_TOOLS)).toBe(false)
  })

  it('maps every preference column onto its tool flag', () => {
    const flags = toolFlagsOf({ toolLifeTracker: true, toolPlaytest: false, toolTradingMode: false, toolCardScanner: false })
    expect(flags).toEqual({ life_tracker: true, playtest: false, trading_mode: false, card_scanner: false })
    expect(anyToolEnabled(flags)).toBe(true)
    expect(isToolEnabled('life_tracker', flags)).toBe(true)
    expect(isToolEnabled('playtest', flags)).toBe(false)
  })

  it('enables the trading mode on its own flag', () => {
    const flags = toolFlagsOf({ toolLifeTracker: false, toolPlaytest: false, toolTradingMode: true, toolCardScanner: false })
    expect(anyToolEnabled(flags)).toBe(true)
    expect(isToolEnabled('trading_mode', flags)).toBe(true)
    expect(toolPreferenceOf('trading_mode')).toBe('toolTradingMode')
  })

  it('enables the card scanner on its own flag', () => {
    const flags = toolFlagsOf({
      toolLifeTracker: false,
      toolPlaytest: false,
      toolTradingMode: false,
      toolCardScanner: true,
    })
    expect(anyToolEnabled(flags)).toBe(true)
    expect(isToolEnabled('card_scanner', flags)).toBe(true)
    expect(toolPreferenceOf('card_scanner')).toBe('toolCardScanner')
  })

  it('shows the Tools tab when any single tool is on', () => {
    expect(anyToolEnabled(toolFlagsOf({ toolLifeTracker: false, toolPlaytest: true, toolTradingMode: false, toolCardScanner: false }))).toBe(true)
  })

  it('never enables a planned tool', () => {
    const flags = toolFlagsOf({ toolLifeTracker: true, toolPlaytest: true, toolTradingMode: true, toolCardScanner: true })
    for (const tool of TOOLS.filter((entry) => entry.state === 'planned')) {
      expect(isToolEnabled(tool.key, flags)).toBe(false)
      expect(toolPreferenceOf(tool.key)).toBeNull()
    }
  })

  // Un outil livré sans colonne n'aurait ni bascule dans Settings ni
  // drapeau : le catalogue et la table doivent concorder.
  it('gives every shipped tool a preference column and a screen', () => {
    const shipped = TOOLS.filter((entry) => entry.state === 'shipped')
    expect(shipped.map((entry) => entry.key).sort()).toEqual(Object.keys(TOOL_PREFERENCE).sort())
    for (const tool of shipped) {
      expect(toolPreferenceOf(tool.key)).not.toBeNull()
      expect(tool.path).toBeDefined()
    }
  })
})
