import { homedir, tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'

export function home(): string {
  return homedir()
}

/** ~/.config/md-boss on every OS - plain text, meant to be edited by hand. */
export function config(): string {
  return pathJoin(homedir(), '.config', 'md-boss')
}

/** <os tmpdir>/md-boss - for what the OS may clear without anyone losing work. */
export function temp(): string {
  return pathJoin(tmpdir(), 'md-boss')
}

export function join(...parts: string[]): string {
  return pathJoin(...parts)
}
