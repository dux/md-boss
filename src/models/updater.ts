// Self-update: the flow over Native.updater, which reads the GitHub release's latest.json
// and applies a signed package. The Swift app had no update path, so this is the whole of
// it: a silent check at launch that says something only when there is a newer build, the
// package downloaded right away, and a "Restart to update" on the toast and in the Help
// menu that puts it in place and relaunches. Pure apart from the bridge and the toast, so
// the memory twin drives it in tests.

import type { AvailableUpdate, NativeUpdater } from '../native/bridge'
import type { Toast } from './toast'

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'downloading'; version: string }
  /** Downloaded and verified; install and relaunch wait for the user. */
  | { kind: 'ready'; version: string }
  | { kind: 'installing'; version: string }

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export class Updater {
  state: UpdateState = { kind: 'idle' }
  private update: AvailableUpdate | null = null
  private readonly listeners = new Set<() => void>()

  /** `prepareRestart` is what quit does before exiting - the unsaved-edits prompt and the
   *  settings flush; false keeps the app up, as it does for Cmd-Q. */
  constructor(
    private readonly updater: NativeUpdater,
    private readonly toast: Toast,
    private readonly prepareRestart: () => Promise<boolean>,
  ) {}

  /** False where nothing signed can be checked - the Help item is disabled then. */
  get enabled(): boolean {
    return this.updater.enabled
  }

  /** An update is downloaded and a restart would run it: the Help item says so. */
  get ready(): boolean {
    return this.state.kind === 'ready'
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** At launch, off the critical path. Quiet unless there is something to download: an
   *  unreachable endpoint is the network's business, not a message on every offline start. */
  async checkOnLaunch(): Promise<void> {
    if (!this.enabled) return
    await this.check(false)
  }

  /** The Help item: "Check for Updates…", or "Restart to Update" once one is ready. */
  async fromMenu(): Promise<void> {
    if (!this.enabled) return
    switch (this.state.kind) {
      case 'ready':
        return this.restart()
      case 'checking':
        return this.toast.info('Checking for updates…')
      case 'downloading':
        return this.toast.info(`Update ${this.state.version} available - downloading…`)
      case 'installing':
        return this.toast.info(`Installing update ${this.state.version}…`)
      case 'idle':
        return this.check(true)
    }
  }

  /** The toast's button and the Help item once ready: the same guard as quit, then the
   *  package goes in place and the process is replaced. A cancelled prompt leaves the
   *  download where it is, so the next click does not fetch it again. */
  async restart(): Promise<void> {
    if (this.state.kind !== 'ready' || !this.update) return
    const { version } = this.state
    if (!(await this.prepareRestart())) return
    this.setState({ kind: 'installing', version })
    try {
      await this.update.install()
    } catch (err) {
      this.setState({ kind: 'ready', version })
      this.toast.error(`Update ${version} could not be installed: ${errorText(err)}`)
      return
    }
    try {
      await this.updater.relaunch()
    } catch (err) {
      // Installed all the same: the next launch is the new version.
      this.setState({ kind: 'ready', version })
      this.toast.error(`Restart failed: ${errorText(err)} - quit and reopen to finish the update`)
    }
  }

  private async check(interactive: boolean): Promise<void> {
    this.setState({ kind: 'checking' })
    let update: AvailableUpdate | null
    try {
      update = await this.updater.check()
    } catch (err) {
      this.setState({ kind: 'idle' })
      if (interactive) this.toast.error(`Could not check for updates: ${errorText(err)}`)
      else console.warn('update check failed:', err)
      return
    }
    if (!update) {
      this.setState({ kind: 'idle' })
      if (interactive) this.toast.info('md-boss is up to date')
      return
    }
    const { version } = update
    this.setState({ kind: 'downloading', version })
    this.toast.info(`Update ${version} available - downloading…`)
    try {
      await update.download()
    } catch (err) {
      this.setState({ kind: 'idle' })
      this.toast.error(`Update ${version} could not be downloaded: ${errorText(err)}`)
      return
    }
    this.update = update
    this.setState({ kind: 'ready', version })
    this.toast.success(`Update ${version} is ready`, { label: 'Restart to update', run: () => void this.restart() })
  }

  private setState(state: UpdateState): void {
    this.state = state
    for (const listener of this.listeners) listener()
  }
}
