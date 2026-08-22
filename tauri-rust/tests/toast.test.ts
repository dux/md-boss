import { describe, expect, test } from 'bun:test'
import { Toast, TOAST_MS, type ToastMessage, type ToastTimers } from '../src/models/toast'

/** A clock run by hand: `advance(ms)` fires what is due, in order. */
function clock() {
  let now = 0
  let seq = 0
  const due = new Map<number, { at: number; fn: () => void }>()
  const timers: ToastTimers = {
    set: (fn, ms) => {
      const id = ++seq
      due.set(id, { at: now + ms, fn })
      return id
    },
    clear: (handle) => {
      due.delete(handle as number)
    },
  }
  const advance = (ms: number) => {
    now += ms
    for (const [id, t] of [...due].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at > now) break
      due.delete(id)
      t.fn()
    }
  }
  return { timers, advance, pending: () => due.size }
}

describe('Toast', () => {
  test('info and success stay three seconds, an error six', () => {
    const { timers, advance } = clock()
    const toast = new Toast(timers)
    toast.info('Copied')
    expect(toast.current).toEqual({ id: 1, text: 'Copied', kind: 'info' })
    advance(TOAST_MS.info - 1)
    expect(toast.text).toBe('Copied')
    advance(1)
    expect(toast.current).toBeNull()

    toast.success('Saved a.md')
    advance(TOAST_MS.success)
    expect(toast.current).toBeNull()

    toast.error('Not found: b.md')
    advance(TOAST_MS.info)
    expect(toast.text).toBe('Not found: b.md')
    advance(TOAST_MS.error - TOAST_MS.info)
    expect(toast.current).toBeNull()
  })

  test('a new message replaces the one up and the old timer cannot take it down', () => {
    const { timers, advance, pending } = clock()
    const toast = new Toast(timers)
    toast.info('first')
    advance(2_000)
    toast.info('second')
    expect(pending()).toBe(1)
    // Where the first would have ended: the second is still up.
    advance(1_000)
    expect(toast.text).toBe('second')
    advance(2_000)
    expect(toast.current).toBeNull()
  })

  test('the same text twice is two messages', () => {
    const { timers } = clock()
    const toast = new Toast(timers)
    toast.info('Copied')
    const first = toast.current!.id
    toast.info('Copied')
    expect(toast.current!.id).not.toBe(first)
  })

  test('dismiss clears now and cancels the timer; dismissing nothing says nothing', () => {
    const { timers, advance, pending } = clock()
    const toast = new Toast(timers)
    const seen: (ToastMessage | null)[] = []
    toast.onChange((m) => seen.push(m))
    toast.dismiss()
    expect(seen).toEqual([])
    toast.error('oops')
    toast.dismiss()
    expect(toast.current).toBeNull()
    expect(pending()).toBe(0)
    advance(10_000)
    expect(seen.map((m) => m?.text ?? null)).toEqual(['oops', null])
  })

  test('a message with an action has no timer: it waits for the click or the next message', () => {
    const { timers, advance, pending } = clock()
    const toast = new Toast(timers)
    let ran = 0
    toast.success('Update 2.0.0 is ready', { label: 'Restart to update', run: () => ran++ })
    expect(pending()).toBe(0)
    advance(60_000)
    expect(toast.text).toBe('Update 2.0.0 is ready')
    expect(toast.current!.action!.label).toBe('Restart to update')
    toast.current!.action!.run()
    expect(ran).toBe(1)
    toast.info('Copied')
    expect(toast.current!.action).toBeUndefined()
    expect(pending()).toBe(1)
  })

  test('listeners hear every change and can leave', () => {
    const { timers, advance } = clock()
    const toast = new Toast(timers)
    const seen: string[] = []
    const off = toast.onChange((m) => seen.push(m ? `${m.kind}:${m.text}` : '-'))
    toast.success('Note removed')
    advance(TOAST_MS.success)
    off()
    toast.info('unheard')
    expect(seen).toEqual(['success:Note removed', '-'])
  })
})
