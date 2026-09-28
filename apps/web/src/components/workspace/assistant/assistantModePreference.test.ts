import { describe, expect, it } from 'vitest'
import {
  FREE_CREATION_MODE,
  GUIDE_CREATION_MODE,
  assistantModePreferenceKey,
  createAssistantModePreferenceStore
} from './assistantModePreference'

describe('assistant mode preference', () => {
  it('uses project, domain and exact scope in the preference key', () => {
    const outlineStoryCore = assistantModePreferenceKey({
      projectId: 'project-a',
      domain: 'outline',
      scopeKey: 'outline:project-a:story-core:'
    })
    const outlineChapter = assistantModePreferenceKey({
      projectId: 'project-a',
      domain: 'outline',
      scopeKey: 'outline:project-a:chapter:chapter-1'
    })
    const worldStoryCore = assistantModePreferenceKey({
      projectId: 'project-a',
      domain: 'world',
      scopeKey: 'world:project-a:story-core:'
    })
    const otherProject = assistantModePreferenceKey({
      projectId: 'project-b',
      domain: 'outline',
      scopeKey: 'outline:project-b:story-core:'
    })

    expect(new Set([outlineStoryCore, outlineChapter, worldStoryCore, otherProject]).size).toBe(4)
    expect(outlineStoryCore).toContain('project-a')
    expect(outlineStoryCore).toContain('outline')
    expect(outlineStoryCore).toContain('outline:project-a:story-core:')
  })

  it('persists the visible free creation label without using the legacy discussion label', () => {
    const store = createAssistantModePreferenceStore(null)
    const key = assistantModePreferenceKey({
      projectId: 'project-a',
      domain: 'outline',
      scopeKey: 'outline:project-a:story-core:'
    })

    expect(store.load(key)).toBe(FREE_CREATION_MODE)
    store.save(key, GUIDE_CREATION_MODE)
    expect(store.load(key)).toBe(GUIDE_CREATION_MODE)
    store.save(key, FREE_CREATION_MODE)
    expect(store.load(key)).toBe('自由创作')
    expect(store.load(key)).not.toBe('自由讨论')
  })

  it('falls back to in-memory behavior when browser storage is unavailable or throws', () => {
    const brokenStorage = {
      getItem: () => { throw new Error('disabled') },
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('disabled') }
    }
    const store = createAssistantModePreferenceStore(brokenStorage)
    const key = assistantModePreferenceKey({
      projectId: 'project-a',
      domain: 'delivery',
      scopeKey: 'delivery:project-a:chapter:chapter-9'
    })

    store.save(key, GUIDE_CREATION_MODE)
    expect(store.load(key)).toBe(GUIDE_CREATION_MODE)
  })
})
