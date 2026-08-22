import { describe, expect, test } from 'bun:test'
import { Toast, type ToastMessage, type ToastTimers } from '../src/models/toast'
import { Updater } from '../src/models/updater'
import { memoryNative } from '../src/native/memory'
import type { MemoryUpdater } from '../src/native/memory'

/** Timers that never fire: what the toast showed is read, not waited out. */
const frozen: ToastTimers = { set: () => 0, clear: () => {} }

function setup(over: { enabled?: boolean; prepare?: () => Promise<boolean> } = {}) {
  const nat = memoryNative({}).updater as MemoryUpdater
  nat.enabled = over.enabled ?? true
  const toast = new Toast(frozen)
  const shown: string[] = []
  toast.onChange((m: ToastMessage | null) => shown.push(m ? `${m.kind}:${m.text}${m.action ? ` [${m.action.label}]` : ''}` : '-'))
  let prepared = 0
  const updater = new Updater(nat, toast, over.prepare ?? (async () => { prepared++; return true }))
  const states: string[] = []
  updater.onChange(() => states.push(updater.state.kind))
  return { nat, toast, shown, updater, states, prepared: () => prepared }
}

describe('Updater', () => {
  test('launch: nothing to say when up to date, and an unreachable endpoint is logged, not shown', async () => {
    const { nat, updater, shown, states } = setup()
    await updater.checkOnLaunch()
    expect(shown).toEqual([])
    expect(states).toEqual(['checking', 'idle'])
    nat.failing = new Error('offline')
    const warn = console.warn
    const warned: unknown[][] = []
    console.warn = (...args: unknown[]) => void warned.push(args)
    try {
      await updater.checkOnLaunch()
    } finally {
      console.warn = warn
    }
    expect(shown).toEqual([])
    expect(warned.length).toBe(1)
    expect(updater.state.kind).toBe('idle')
  })

  test('launch: a newer build is downloaded at once and offered as a restart', async () => {
    const { nat, updater, shown, states } = setup()
    nat.offer('1.2.0')
    await updater.checkOnLaunch()
    expect(shown).toEqual(['info:Update 1.2.0 available - downloading…', 'success:Update 1.2.0 is ready [Restart to update]'])
    expect(states).toEqual(['checking', 'downloading', 'ready'])
    expect(nat.downloaded).toEqual(['1.2.0'])
    expect(nat.installed).toEqual([])
    expect(updater.ready).toBe(true)
  })

  test('the toast button: the quit guard, the install, the relaunch', async () => {
    const { nat, toast, updater, states, prepared } = setup()
    nat.offer('1.2.0')
    await updater.checkOnLaunch()
    toast.current!.action!.run()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(prepared()).toBe(1)
    expect(nat.installed).toEqual(['1.2.0'])
    expect(nat.relaunches).toBe(1)
    expect(states.slice(-1)).toEqual(['installing'])
  })

  test('a cancelled guard keeps the download and the app; nothing is installed', async () => {
    const { nat, updater } = setup({ prepare: async () => false })
    nat.offer('1.2.0')
    await updater.checkOnLaunch()
    await updater.restart()
    expect(nat.installed).toEqual([])
    expect(nat.relaunches).toBe(0)
    expect(updater.state).toEqual({ kind: 'ready', version: '1.2.0' })
    // Restart is a no-op before anything is ready.
    const fresh = setup()
    await fresh.updater.restart()
    expect(fresh.nat.relaunches).toBe(0)
  })

  test('the Help item answers either way: up to date, a failed check, a restart once ready', async () => {
    const { nat, updater, shown } = setup()
    await updater.fromMenu()
    expect(shown.at(-1)).toBe('info:md-boss is up to date')
    nat.failing = new Error('offline')
    await updater.fromMenu()
    expect(shown.at(-1)).toBe('error:Could not check for updates: offline')
    expect(updater.state.kind).toBe('idle')
    nat.failing = null
    nat.offer('1.3.0')
    await updater.fromMenu()
    expect(updater.ready).toBe(true)
    await updater.fromMenu()
    expect(nat.installed).toEqual(['1.3.0'])
    expect(nat.relaunches).toBe(1)
  })

  test('while a download runs the Help item only repeats where things stand', async () => {
    const { nat, updater, shown } = setup()
    let release!: () => void
    nat.offer('1.4.0', { download: () => new Promise<void>((r) => { release = r }) })
    const launch = updater.checkOnLaunch()
    await Promise.resolve()
    await Promise.resolve()
    expect(updater.state).toEqual({ kind: 'downloading', version: '1.4.0' })
    await updater.fromMenu()
    expect(shown.filter((s) => s === 'info:Update 1.4.0 available - downloading…').length).toBe(2)
    expect(nat.downloaded).toEqual([])
    release()
    await launch
    expect(updater.ready).toBe(true)
  })

  test('a download or install that fails is said, and the state goes back', async () => {
    const { nat, updater, shown } = setup()
    nat.offer('1.5.0', { download: async () => { throw new Error('bad signature') } })
    await updater.checkOnLaunch()
    expect(shown.at(-1)).toBe('error:Update 1.5.0 could not be downloaded: bad signature')
    expect(updater.state.kind).toBe('idle')

    nat.offer('1.5.0', { install: async () => { throw new Error('read-only volume') } })
    await updater.fromMenu()
    await updater.restart()
    expect(shown.at(-1)).toBe('error:Update 1.5.0 could not be installed: read-only volume')
    expect(updater.state).toEqual({ kind: 'ready', version: '1.5.0' })
    expect(nat.relaunches).toBe(0)
  })

  test('disabled (dev, browser): no check at launch, the Help item does nothing', async () => {
    const { nat, updater, shown, states } = setup({ enabled: false })
    nat.offer('2.0.0')
    await updater.checkOnLaunch()
    await updater.fromMenu()
    expect(shown).toEqual([])
    expect(states).toEqual([])
    expect(updater.enabled).toBe(false)
  })
})
