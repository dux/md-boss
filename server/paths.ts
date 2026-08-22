import { homedir } from 'node:os'
import { join as pathJoin } from 'node:path'

export function home(): string {
  return homedir()
}

/** ~/.config/md-boss on every OS - plain text, meant to be edited by hand. */
export function config(): string {
  return pathJoin(homedir(), '.config', 'md-boss')
}

export function join(...parts: string[]): string {
  return pathJoin(...parts)
}
