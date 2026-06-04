import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'

type TaskEvictionHook = (taskId: string) => void

const taskEvictionHooks = new Set<TaskEvictionHook>()

export function registerTaskEvictionHook(hook: TaskEvictionHook): () => void {
  taskEvictionHooks.add(hook)
  return () => taskEvictionHooks.delete(hook)
}

export function notifyTaskEvicted(taskId: string): void {
  for (const hook of taskEvictionHooks) {
    try {
      hook(taskId)
    } catch (error) {
      logForDebugging(
        `Task eviction hook failed for ${taskId}: ${errorMessage(error)}`,
        { level: 'error' },
      )
    }
  }
}
