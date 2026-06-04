import { logForDebugging } from './debug.js'
import { errorMessage } from './errors.js'

type CacheClearer = () => void

const cacheClearers = new Map<string, CacheClearer>()

export function registerCache(name: string, clear: CacheClearer): void {
  cacheClearers.set(name, clear)
}

export function clearAllCaches(): void {
  for (const [name, clear] of cacheClearers) {
    try {
      clear()
    } catch (error) {
      logForDebugging(`Failed to clear cache ${name}: ${errorMessage(error)}`, {
        level: 'error',
      })
    }
  }
}
