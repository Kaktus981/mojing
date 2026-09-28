import type { AssistantGuideDomain } from '../../../../../../packages/contracts/src'

export const FREE_CREATION_MODE = '自由创作'
export const GUIDE_CREATION_MODE = '引导构建'

export type AssistantGuideUiMode = typeof FREE_CREATION_MODE | typeof GUIDE_CREATION_MODE

type PreferenceScope = {
  projectId: string
  domain: AssistantGuideDomain
  scopeKey: string
}

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const PREFIX = 'mojing:assistant-mode'

function browserStorage(): PreferenceStorage | null {
  try {
    const storage = globalThis.window?.localStorage ?? globalThis.localStorage
    return storage ?? null
  } catch {
    return null
  }
}

function normalizeMode(value: string | null | undefined): AssistantGuideUiMode {
  if (value === GUIDE_CREATION_MODE) return GUIDE_CREATION_MODE
  return FREE_CREATION_MODE
}

export function assistantModePreferenceKey(scope: PreferenceScope): string {
  return `${PREFIX}:${scope.projectId}:${scope.domain}:${scope.scopeKey}`
}

export function createAssistantModePreferenceStore(storage: PreferenceStorage | null = browserStorage()): {
  load(key: string): AssistantGuideUiMode
  save(key: string, mode: AssistantGuideUiMode): void
} {
  const fallback = new Map<string, AssistantGuideUiMode>()
  return {
    load(key) {
      if (fallback.has(key)) return fallback.get(key)!
      try {
        return normalizeMode(storage?.getItem(key))
      } catch {
        return fallback.get(key) ?? FREE_CREATION_MODE
      }
    },
    save(key, mode) {
      fallback.set(key, mode)
      try {
        storage?.setItem(key, mode)
      } catch {
        // Disabled storage and quota failures degrade to the in-memory value above.
      }
    }
  }
}
