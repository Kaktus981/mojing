import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearScopedDraftIf, loadScopedDraft, saveScopedDraft } from './draftCache'

type FakeRequest<T = unknown> = {
  result?: T
  error?: unknown
  onsuccess?: () => void
  onerror?: () => void
  onupgradeneeded?: () => void
  onblocked?: () => void
}

class FakeObjectStore {
  constructor(private readonly values: Map<string, unknown>) {}
  get(key: string): FakeRequest<unknown> {
    const request: FakeRequest<unknown> = {}
    queueMicrotask(() => {
      request.result = this.values.get(key)
      request.onsuccess?.()
    })
    return request
  }
  put(value: { key: string }): FakeRequest<unknown> {
    const request: FakeRequest<unknown> = {}
    queueMicrotask(() => {
      this.values.set(value.key, value)
      request.result = value
      request.onsuccess?.()
    })
    return request
  }
  delete(key: string): FakeRequest<undefined> {
    const request: FakeRequest<undefined> = {}
    queueMicrotask(() => {
      this.values.delete(key)
      request.onsuccess?.()
    })
    return request
  }
}

class FakeTransaction {
  oncomplete?: () => void
  onerror?: () => void
  constructor(private readonly values: Map<string, unknown>) {}
  objectStore(): FakeObjectStore {
    return new FakeObjectStore(this.values)
  }
  complete(): void {
    queueMicrotask(() => this.oncomplete?.())
  }
}

class FakeDatabase {
  readonly values = new Map<string, unknown>()
  readonly objectStoreNames = { contains: () => true }
  createObjectStore(): void {}
  transaction(): FakeTransaction {
    const transaction = new FakeTransaction(this.values)
    transaction.complete()
    return transaction
  }
  close(): void {}
}

describe('scoped draft cache compare-and-delete', () => {
  let originalIndexedDb: IDBFactory | undefined
  let database: FakeDatabase

  beforeEach(() => {
    originalIndexedDb = globalThis.indexedDB
    database = new FakeDatabase()
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: {
        open: () => {
          const request: FakeRequest<FakeDatabase> = {}
          queueMicrotask(() => {
            request.result = database
            request.onsuccess?.()
          })
          return request
        }
      }
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: originalIndexedDb })
  })

  it('preserves a newer same-key edit when the expected edit sequence no longer matches', async () => {
    const key = 'assistant-guide-answer:project-a:outline:scope:session-a:v1:question-1'
    await saveScopedDraft({ key, projectId: 'project-a', baseRevision: 1, savedAt: '2026-09-17T00:00:00.000Z', payload: { text: 'newer', editSequence: 2 } })

    const cleared = await clearScopedDraftIf<{ text: string; editSequence: number }>(
      key,
      (payload) => payload.editSequence === 1
    )

    expect(cleared).toBe(false)
    expect((await loadScopedDraft<{ text: string; editSequence: number }>(key))?.payload).toEqual({ text: 'newer', editSequence: 2 })
  })
})
