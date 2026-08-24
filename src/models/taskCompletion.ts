type TaskState = 'active' | 'done' | 'other'

interface Task {
  key: string
  state: TaskState
}

const TASK = /^[ \t]*(?:(?:>[ \t]*)+(?:[-+*]|\d+[.)])[ \t]+|(?:(?:[-+*]|\d+[.)])[ \t]+)?)\[([ xXoO*])\][ \t]+(.*)$/
const FENCE = /^ {0,3}(`{3,}|~{3,})/

/** Indexes in the new document's rendered task order whose unchanged task moved from an
 *  in-progress marker to done. Matching by task text lets unrelated edits move the line. */
export function completedTaskIndexes(before: string, after: string): number[] {
  const previous = new Map<string, TaskState[]>()
  for (const task of tasks(before)) {
    const states = previous.get(task.key) ?? []
    states.push(task.state)
    previous.set(task.key, states)
  }

  const seen = new Map<string, number>()
  const completed: number[] = []
  tasks(after).forEach((task, index) => {
    const occurrence = seen.get(task.key) ?? 0
    seen.set(task.key, occurrence + 1)
    if (previous.get(task.key)?.[occurrence] === 'active' && task.state === 'done') {
      completed.push(index)
    }
  })
  return completed
}

function tasks(source: string): Task[] {
  const found: Task[] = []
  let fence: string | null = null

  for (const line of source.split(/\r?\n/)) {
    const edge = FENCE.exec(line)
    if (edge) {
      const marker = edge[1][0]
      if (!fence) fence = marker
      else if (marker === fence) fence = null
      continue
    }
    if (fence) continue

    const match = TASK.exec(line)
    if (!match) continue
    found.push({ key: match[2].trim(), state: stateFor(match[1]) })
  }
  return found
}

function stateFor(marker: string): TaskState {
  if (marker === 'o' || marker === 'O' || marker === '*') return 'active'
  if (marker === 'x' || marker === 'X') return 'done'
  return 'other'
}
