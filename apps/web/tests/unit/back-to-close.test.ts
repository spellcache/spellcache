import { beforeEach, describe, expect, it, vi } from 'vitest'

// Historique simulé : `back()` est asynchrone dans un navigateur, d'où la
// file que `settle()` vide comme le ferait la boucle d'évènements.
function installFakeHistory() {
  const entries: { state: unknown; href: string }[] = [
    { state: { __NA: true }, href: '/a' },
  ]
  let index = 0
  let pendingBacks = 0
  const listeners: ((event: PopStateEvent) => void)[] = []

  const history = {
    get state() {
      return entries[index]!.state
    },
    pushState(state: unknown) {
      entries.splice(index + 1)
      entries.push({ state, href: entries[index]!.href })
      index += 1
    },
    replaceState(state: unknown) {
      entries[index] = { ...entries[index]!, state }
    },
    back() {
      pendingBacks += 1
    },
  }

  const window = {
    history,
    location: {
      get href() {
        return entries[index]!.href
      },
    },
    addEventListener(_type: string, listener: (event: PopStateEvent) => void) {
      listeners.push(listener)
    },
  }
  vi.stubGlobal('window', window)

  return {
    navigate(href: string) {
      entries.splice(index + 1)
      entries.push({ state: { __NA: true }, href })
      index += 1
    },
    pressBack() {
      pendingBacks += 1
      this.settle()
    },
    settle() {
      while (pendingBacks > 0) {
        pendingBacks -= 1
        if (index === 0) continue
        index -= 1
        const event = { state: entries[index]!.state } as PopStateEvent
        for (const listener of listeners) listener(event)
      }
    },
    get href() {
      return entries[index]!.href
    },
    get depth() {
      return index
    },
  }
}

describe('openLayer', () => {
  let openLayer: typeof import('@/components/ui/use-back-to-close').openLayer
  let history: ReturnType<typeof installFakeHistory>

  beforeEach(async () => {
    vi.resetModules()
    history = installFakeHistory()
    ;({ openLayer } = await import('@/components/ui/use-back-to-close'))
  })

  it('closes the open layer on Back without leaving the page', () => {
    const close = vi.fn()
    openLayer(close)
    history.pressBack()
    expect(close).toHaveBeenCalledOnce()
    expect(history.href).toBe('/a')
    expect(history.depth).toBe(0)
  })

  it('closes stacked layers one Back at a time', () => {
    const closeSheet = vi.fn()
    const closeZoom = vi.fn()
    openLayer(closeSheet)
    openLayer(closeZoom)
    history.pressBack()
    expect(closeZoom).toHaveBeenCalledOnce()
    expect(closeSheet).not.toHaveBeenCalled()
    history.pressBack()
    expect(closeSheet).toHaveBeenCalledOnce()
  })

  it('skips the entry of a layer closed from the interface', () => {
    history.navigate('/b')
    const release = openLayer(vi.fn())
    release()
    history.pressBack()
    expect(history.href).toBe('/a')
  })

  it('reuses the entry of a layer closed from the interface', () => {
    openLayer(vi.fn())()
    const close = vi.fn()
    openLayer(close)
    expect(history.depth).toBe(1)
    history.pressBack()
    expect(close).toHaveBeenCalledOnce()
    expect(history.depth).toBe(0)
  })

  it('closes the parent on Back after the child was closed from the interface', () => {
    const closeSheet = vi.fn()
    openLayer(closeSheet)
    openLayer(vi.fn())()
    history.pressBack()
    expect(closeSheet).toHaveBeenCalledOnce()
    expect(history.depth).toBe(0)
  })

  it('leaves a navigation started from a layer alone', () => {
    const release = openLayer(vi.fn())
    history.navigate('/b')
    release()
    history.settle()
    expect(history.href).toBe('/b')
    history.pressBack()
    expect(history.href).toBe('/a')
  })
})
