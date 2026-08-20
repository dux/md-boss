// The central state the menu bar, the sidebar and the panes all reach: which folders are
// listed, which file is open, what it says. A singleton on purpose - menu commands live
// outside the component tree and cannot read view state.

import { native } from '../native/bridge'
import { AnnotationStore, FALLBACK_FILE_NAME } from './annotationStore'
import { DirectoryWatcher } from './directoryWatcher'
import { OpenDocument } from './document'
import { FileTreeModel } from './fileTreeModel'
import { LineIndex } from './lineIndex'
import { type Note, suggestedTitle } from './notes'
import type { Edit } from './noteShift'
import { dirname } from './paths'
import { Prompts } from './prompts'
import { RootFolders } from './rootFolders'
import { ScrollMemory } from './scrollMemory'
import { ScrollSync } from './scrollSync'
import { canChangeFontSize, defaultSettings, FONT_SETTINGS, fontDefault, type FontSetting, fontSize, type Pane, resetFontSizes, setFontSize, showPane, togglePane, visiblePanes, ZOOMABLE, fontSetting } from './settings'
import { SettingsStore } from './settingsStore'
import { flippedTheme, selectingTheme, type Theme, type ThemeChoice, type ThemeID, themeChoice, themeNamed } from '../theme/theme'

export class Manager {
  readonly tree: FileTreeModel
  readonly settings: SettingsStore
  readonly folders: RootFolders
  readonly home: string
  /** Raw and preview following each other. Here rather than in a pane, because a move is
   *  dropped unless both are up, and the settings know that. */
  readonly scrollSync: ScrollSync
  readonly scrollMemory = new ScrollMemory()
  /** Every loaded `.md-boss`. Its own change event - the pane and the gutter listen. */
  readonly notes: AnnotationStore
  readonly prompts = new Prompts()
  /** Caret position in the raw pane, 1-based, plus the text of that line. Notes anchor to
   *  it, and the pane uses it to highlight the entry you are on. */
  currentLine = 1
  currentLineText = ''
  /** A request for the raw pane to scroll to a line. Carries an id so asking for the same
   *  line twice still moves the view. */
  scrollRequest: { line: number; id: number } | null = null
  /** The line a note jump landed on. Painted as a band in the raw pane and highlighted in
   *  the preview, until the caret moves off it - so "where did I land" outlives the scroll. */
  highlightedLine: number | null = null
  private scrollRequestCount = 0
  document: OpenDocument | null = null
  error: string | null = null
  /** One-line notices - "Saved x", "Reloaded x" - until the toast overlay (P9) draws them. */
  notice: string | null = null
  /** The documents opened before this one, oldest first. The Back button walks it from the
   *  end. Paths rather than documents: a buffer per visited file would hold every file you
   *  have ever looked at in memory, and where you were is what ScrollMemory keeps. */
  history: string[] = []
  /** How many documents back the button can walk. Deep enough to cover a session's worth
   *  of following links, shallow enough that the list is never worth thinking about. */
  static readonly historyLimit = 50
  /** The file waiting for a "Move Here" (P8). Cleared by Escape in the sidebar and by the move. */
  cutFile: string | null = null
  private readonly listeners = new Set<() => void>()
  /** The open file's folder, so a save from another editor shows up on tab-back. */
  private readonly documentWatcher = new DirectoryWatcher((_, changed) => void this.documentChangedOnDisk(changed))
  private poll: ReturnType<typeof setInterval> | null = null
  private documentPoll: ReturnType<typeof setInterval> | null = null
  /** How often the open file is stat'd when the watcher has nothing to say. */
  static readonly documentPollMs = 2_000

  /** Long, because this is a backstop and not the mechanism: the watcher answers a local
   *  change in milliseconds, and anything this catches has been wrong for a while already.
   *  It covers what a watcher cannot see - a network volume, a file synced in by Dropbox. */
  static readonly pollIntervalMs = 30_000

  /** `configDir` is where the fallback store for files outside every root lives. */
  constructor(settings: SettingsStore, folders: RootFolders, home: string, configDir = `${home}/.config/md-boss`) {
    this.settings = settings
    this.folders = folders
    this.home = home
    this.notes = new AnnotationStore(folders, `${configDir}/${FALLBACK_FILE_NAME}`, home)
    void this.notes.reload()
    this.tree = new FileTreeModel(settings.data.expandedPaths)
    this.scrollSync = new ScrollSync(() => {
      const panes = visiblePanes(this.settings.data)
      return panes.includes('raw') && panes.includes('preview')
    })
    this.folders.onChange(() => this.rootsChanged())
    this.rootsChanged()
  }

  /** Re-lists what is on screen every 30 seconds, whether or not anything said to. Silent
   *  when nothing changed: refresh merges and rows are only published when they differ. */
  startPolling(): void {
    if (this.poll) return
    this.poll = setInterval(() => void this.tree.refreshAll(), Manager.pollIntervalMs)
    this.documentPoll = setInterval(() => void this.syncDocumentWithDisk(), Manager.documentPollMs)
  }

  stopPolling(): void {
    if (this.poll) clearInterval(this.poll)
    if (this.documentPoll) clearInterval(this.documentPoll)
    this.poll = null
    this.documentPoll = null
  }

  /** The event kind is deliberately ignored: a vanish is what an atomic rewrite looks like,
   *  so only the filesystem can say whether the file is really gone. */
  private async documentChangedOnDisk(changed: string[]): Promise<void> {
    const doc = this.document
    if (!doc || !changed.includes(doc.path)) return
    await this.syncDocumentWithDisk()
  }

  /** One document at a time: a second sync while the first is reading would race the
   *  reload against itself. */
  private syncing = false

  async syncDocumentWithDisk(): Promise<void> {
    const doc = this.document
    if (!doc || this.syncing) return
    this.syncing = true
    try {
      const before = doc.externalChange
      const outcome = await doc.syncWithDisk()
      if (doc !== this.document) return
      if (outcome === 'reloaded') this.notice = `Reloaded ${doc.name}`
      if (outcome !== 'unchanged' || before !== doc.externalChange) this.emit()
    } catch {
      // unreadable for the moment - the next poll tries again
    } finally {
      this.syncing = false
    }
  }

  /** The banner's "Reload from Disk". */
  async reloadFromDisk(): Promise<void> {
    const doc = this.document
    if (!doc) return
    await doc.reloadFromDisk()
    this.notice = `Reloaded ${doc.name}`
    this.emit()
  }

  /** The banner's "Keep My Version" and "Dismiss". */
  async keepMine(): Promise<void> {
    const doc = this.document
    if (!doc) return
    await doc.keepMine()
    this.emit()
  }

  get isDirty(): boolean {
    return this.document?.isDirty ?? false
  }

  /** The editor reporting what it holds. Only the dirty flag can change here, so listeners
   *  hear about it only when that flips - a keystroke is not an app-wide event. `edit` is
   *  the replacement that got from the old text to this one, in old-text offsets, so notes
   *  can follow the lines they were put on; asked only when the document has any. */
  setDocumentText(text: string, edit: Edit | null = null): void {
    const doc = this.document
    if (!doc || doc.text === text) return
    const wasDirty = doc.isDirty
    const before = doc.text
    doc.text = text
    if (edit && this.notes.hasNotes(doc.path)) {
      void this.notes.shift(doc.path, new LineIndex(before), new LineIndex(text), edit)
    }
    if (doc.isDirty !== wasDirty) this.emit()
  }

  // MARK: Cursor and jumps

  /** Reported by the editor on every selection change. `navigated: false` for a whole-text
   *  swap - a file arriving in the pane is not the reader moving off the line a note just
   *  pointed at. Not an app-wide event either: the notes pane listens for it by itself. */
  reportCursor(line: number, text: string, navigated = true): void {
    this.currentLineText = text
    const moved = line !== this.currentLine
    this.currentLine = line
    let cleared = false
    if (navigated && this.highlightedLine !== null && this.highlightedLine !== line) {
      this.highlightedLine = null
      cleared = true
    }
    if (moved || cleared) for (const l of this.cursorListeners) l()
  }

  /** Reported by the preview when a block is right-clicked: it knows the source line from
   *  the block's data-line but only holds rendered HTML, so the line's text is looked up here. */
  reportCursorLine(line: number): void {
    const lines = this.document?.text.split('\n') ?? []
    this.reportCursor(line, line >= 1 && line <= lines.length ? lines[line - 1] : '')
  }

  private readonly cursorListeners = new Set<() => void>()

  onCursorChange(listener: () => void): () => void {
    this.cursorListeners.add(listener)
    return () => this.cursorListeners.delete(listener)
  }

  /** Asks the raw pane to scroll, and marks the line both panes are heading for. One
   *  mutation point, so the band and the scroll can never disagree about where you landed. */
  requestScroll(line: number): void {
    this.highlightedLine = line
    this.scrollRequest = { line, id: ++this.scrollRequestCount }
    this.emit()
  }

  /** The raw pane is only forced open when neither it nor the preview is up - both can show
   *  the line and mark it, and a line anchor is meaningless in a window showing nothing but
   *  the notes column. */
  goToLine(line: number): void {
    const panes = visiblePanes(this.settings.data)
    if (!panes.includes('raw') && !panes.includes('preview')) this.settings.set(showPane(this.settings.data, 'raw'))
    this.requestScroll(line)
  }

  /** Opens the note's file and scrolls to its line; for a note in another folder the
   *  sidebar switches to that folder on the way. */
  async goToNote(note: Note): Promise<void> {
    const path = this.notes.expand(note.path)
    await this.open(path)
    if (this.document?.path !== path) return
    await this.reveal(path)
    this.goToLine(note.line)
  }

  /** Puts the sidebar on a file: its root becomes active, its folders open, the cursor
   *  lands on it. */
  async reveal(path: string): Promise<void> {
    const root = this.folders.rootContaining(path)
    if (root && root !== this.folders.active) this.folders.select(root)
    await this.tree.reveal(path)
  }

  // MARK: Notes

  get hasNoteAtCursor(): boolean {
    return this.document !== null && this.notes.noteAt(this.document.path, this.currentLine) !== null
  }

  /** Cmd-Shift-K: adds or edits the note on the line the caret is on. One field, for the
   *  body. The title is taken from the source line rather than typed: it exists so the pane
   *  can be read without opening every file, and a line that already says what it is does
   *  not need naming twice. An existing title is kept, so one edited by hand survives. */
  async addNoteAtCursor(): Promise<void> {
    const doc = this.document
    if (!doc) return
    const line = this.currentLine
    const existing = this.notes.noteAt(doc.path, line)
    const body = await this.prompts.text({
      title: existing ? 'Edit Note' : 'Add Note',
      message: `${this.notes.key(doc.path)}:${line}`,
      value: existing?.body ?? '',
      multiline: true,
      confirm: existing ? 'Save' : 'Add',
    })
    if (body === null) return
    const title = existing?.title ?? suggestedTitle(this.currentLineText)
    await this.notes.setNote(doc.path, line, title, body)
    this.notice = `Note saved on line ${line}`
    this.emit()
  }

  async editNote(note: Note): Promise<void> {
    const body = await this.prompts.text({ title: 'Edit Note', message: `${note.path}:${note.line}`, value: note.body, multiline: true })
    if (body === null) return
    await this.notes.setNote(this.notes.expand(note.path), note.line, note.title, body)
    this.notice = `Note saved on line ${note.line}`
    this.emit()
  }

  /** The title is not typed when a note is made, but one that was can still be changed -
   *  including every title carried over from a bookmark. */
  async renameNote(note: Note): Promise<void> {
    const title = await this.prompts.text({ title: 'Rename Note', message: `${note.path}:${note.line}`, value: note.title, placeholder: 'Title' })
    if (title === null) return
    await this.notes.setNote(this.notes.expand(note.path), note.line, title, note.body)
    this.notice = 'Note renamed'
    this.emit()
  }

  /** Cmd-Shift-Backspace. Deleting is explicit: clearing the body used to remove a comment,
   *  but that would leave no way to make a note with only a title. */
  async deleteNoteAtCursor(): Promise<void> {
    const doc = this.document
    const note = doc ? this.notes.noteAt(doc.path, this.currentLine) : null
    if (!note) return
    await this.notes.remove(note)
    this.notice = 'Note removed'
    this.emit()
  }

  async copyText(text: string, label = 'Copied'): Promise<void> {
    await native().clipboard.writeText(text)
    this.notice = label
    this.emit()
  }

  /** Cmd-S and the Save button. */
  async saveDocument(): Promise<void> {
    const doc = this.document
    if (!doc) return
    try {
      if (await doc.save()) {
        this.error = null
        this.notice = `Saved ${doc.name}`
      }
    } catch (err) {
      this.error = `Could not save: ${String(err)}`
    }
    this.emit()
  }

  get activeRoot(): string | null {
    return this.folders.active
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const l of this.listeners) l()
  }

  private rootsChanged(): void {
    this.tree.setRoot(this.folders.active, this.settings.data.skipFolders)
    this.emit()
  }

  // MARK: Theme

  get theme(): Theme {
    return themeNamed(this.settings.data.themeID)
  }

  /** The three stored ids as the one value that carries the rules. See ThemeChoice. */
  get themeChoice(): ThemeChoice {
    const { themeID, lightThemeID, darkThemeID } = this.settings.data
    return themeChoice(themeID, lightThemeID, darkThemeID)
  }

  /** The only two ways the theme changes: the settings grid / theme menu, and Cmd-Shift-D,
   *  which stays a light/dark switch with eight themes installed. */
  setTheme(id: ThemeID): void {
    this.applyTheme(selectingTheme(this.themeChoice, id))
  }

  toggleLightDark(): void {
    this.applyTheme(flippedTheme(this.themeChoice))
  }

  private applyTheme(choice: ThemeChoice): void {
    this.settings.patch({ themeID: choice.active, lightThemeID: choice.light, darkThemeID: choice.dark })
    this.notice = `${themeNamed(choice.active).title} theme`
    this.emit()
  }

  // MARK: Text size

  fontSize(setting: FontSetting): number {
    return fontSize(this.settings.data, setting)
  }

  canChangeFontSize(setting: FontSetting, delta: number): boolean {
    return canChangeFontSize(this.settings.data, setting, delta)
  }

  changeFontSize(setting: FontSetting, delta: number): void {
    this.settings.set(setFontSize(this.settings.data, setting, this.fontSize(setting) + delta))
  }

  /** Cmd-+/- is a document zoom, so it leaves the chrome alone. The settings panel is
   *  where the sidebar and button sizes are changed. */
  zoom(delta: number): void {
    let data = this.settings.data
    for (const id of ZOOMABLE) {
      const setting = fontSetting(id)
      data = setFontSize(data, setting, fontSize(data, setting) + delta)
    }
    this.settings.set(data)
  }

  /** One step is 2em, about 5% of the default measure. */
  static readonly measureStep = 2

  changeMeasure(delta: number): void {
    const measure = Math.min(96, Math.max(26, this.settings.data.previewMeasure + delta))
    this.settings.patch({ previewMeasure: measure })
  }

  /** Alt-Cmd-0: the document back to its actual size and column width. */
  resetZoom(): void {
    let data = this.settings.data
    for (const id of ZOOMABLE) {
      const setting = fontSetting(id)
      data = setFontSize(data, setting, fontDefault(setting))
    }
    this.settings.set({ ...data, previewMeasure: defaultSettings().previewMeasure })
  }

  /** The settings panel's "Reset to defaults" - all four sizes. */
  resetFontSizes(): void {
    this.settings.set(resetFontSizes(this.settings.data))
  }

  get fontSizesAreDefault(): boolean {
    return FONT_SETTINGS.every((s) => this.fontSize(s) === fontDefault(s))
  }

  /** Alt-Cmd-R / V / N and the toggle bar. */
  togglePane(pane: Pane): void {
    this.settings.set(togglePane(this.settings.data, pane))
  }

  /** Cmd-\ puts preview and raw side by side, or drops back to preview alone. */
  toggleSideBySide(): void {
    const panes = visiblePanes(this.settings.data)
    if (panes.includes('raw') && panes.includes('preview')) {
      this.togglePane('raw')
    } else {
      this.settings.set(showPane(showPane(this.settings.data, 'raw'), 'preview'))
    }
  }

  /** Cmd-0. */
  toggleSidebar(): void {
    this.settings.patch({ showSidebar: !this.settings.data.showSidebar })
  }

  /** Escape in the sidebar. Returns whether there was anything to cancel, so the key stays
   *  available to whatever else wants it when there was not. */
  cancelCut(): boolean {
    if (this.cutFile === null) return false
    this.cutFile = null
    this.emit()
    return true
  }

  /** `/Users/me/dev` reads as `~/dev` - the home prefix is noise in a sidebar this narrow. */
  abbreviateHome(path: string): string {
    if (path === this.home || path.startsWith(this.home + '/')) return '~' + path.slice(this.home.length)
    return path
  }

  /** Cmd-O. Several at once; each lands at the top, so the last one picked is active. */
  async addFolders(): Promise<void> {
    const picked = await native().dialog.openFolders(this.settings.data.lastOpenedFolder)
    for (const folder of picked) this.addRoot(folder)
  }

  addRoot(root: string): void {
    this.settings.patch({ lastOpenedFolder: root })
    this.folders.add(root, true)
  }

  selectRoot(root: string): void {
    this.folders.select(root)
  }

  removeRoot(root: string): void {
    this.folders.remove(root)
  }

  /** Cmd-Shift-O. One file; its folder is added to the sidebar when no listed root holds it. */
  async openFilePanel(): Promise<void> {
    const picked = await native().dialog.openFile(this.settings.data.lastOpenedFolder)
    if (picked === null) return
    this.settings.patch({ lastOpenedFolder: dirname(picked) })
    await this.open(picked)
  }

  /** Restores the last session's file once the roots are known. A file that is gone is
   *  forgotten rather than reported - a launch should not open with an error about a file
   *  you deleted on purpose. */
  async restoreSession(): Promise<void> {
    const path = this.settings.data.lastOpenedFile
    if (!path) return
    if (!(await native().fs.exists(path))) {
      this.settings.patch({ lastOpenedFile: null })
      return
    }
    await this.open(path)
  }

  /** `pushingHistory` is false for exactly one caller - `goBack` - so walking back does not
   *  leave the file you just came from sitting on the stack you are walking. */
  async open(path: string, pushingHistory = true): Promise<void> {
    if (this.document?.path === path) return
    if (!(await this.confirmDiscardingChanges())) return
    // After the guard: a switch the user cancelled never happened, and pushing here would
    // have Back returning to a file that was never left.
    const leaving = this.document?.path ?? null
    try {
      this.document = await OpenDocument.load(path)
      if (pushingHistory && leaving !== null) this.push(leaving)
      this.error = null
      this.notice = null
      this.scrollSync.reset()
      this.highlightedLine = null
      this.scrollRequest = null
      this.settings.patch({ lastOpenedFile: path })
      this.documentWatcher.sync(new Set([dirname(path)]))
      if (this.folders.rootContaining(path) === null) this.addRoot(dirname(path))
    } catch (err) {
      this.error = String(err)
    }
    this.emit()
  }

  /** Save is explicit in md-boss, so switching away from unsaved work has to ask. Two
   *  answers for now - Save, or Don't Save - through the native question dialog; the
   *  in-window three-way prompt with Cancel is its own task. */
  async confirmDiscardingChanges(): Promise<boolean> {
    const doc = this.document
    if (!doc || !doc.isDirty) return true
    const save = await native().dialog.confirm(`Save changes to ${doc.name}?`, 'Save', "Don't Save")
    if (!save) return true
    await this.saveDocument()
    return !doc.isDirty
  }

  // MARK: History

  get canGoBack(): boolean {
    return this.history.length > 0
  }

  /** What the Back button would return to, for its tooltip. */
  get backTarget(): string | null {
    return this.history[this.history.length - 1] ?? null
  }

  /** Back to the document you were reading before this one. Entries that are no longer on
   *  disk are stepped over rather than opened into an empty buffer: a file that was trashed
   *  or moved outside the app is not a place to go back to, and the next one down the stack
   *  is what "back" meant anyway. */
  async goBack(): Promise<void> {
    while (this.history.length) {
      const previous = this.history.pop()!
      if (!(await native().fs.exists(previous))) continue
      await this.open(previous, false)
      this.emit()
      return
    }
  }

  private push(path: string): void {
    // Consecutive duplicates would make Back a no-op that still consumed a press.
    if (this.backTarget === path) return
    this.history.push(path)
    if (this.history.length > Manager.historyLimit) this.history.splice(0, this.history.length - Manager.historyLimit)
  }

  /** A file that moved is the same document one path later, so the history and the place
   *  it was left in both follow it. */
  followMove(from: string, to: string): void {
    this.history = this.history.map((p) => (p === from ? to : p))
    this.scrollMemory.relocate(from, to)
  }

  /** A file that went to the Trash leaves both. */
  forgetFile(path: string): void {
    this.history = this.history.filter((p) => p !== path)
    this.scrollMemory.forget(path)
  }
}
