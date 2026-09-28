/**
 * 本地草稿容灾缓存（IndexedDB）。
 *
 * 定位（与交接文档第 4 节一致）：这是**恢复缓存**，不是第二份正式项目数据库。
 *   - 只存作者尚未持久化的草稿，按项目 ID 隔离，每个项目保留最近一条；
 *   - 记录写入时的 `baseRevision` 与编辑序号，用于判断它对应哪一次未保存的输入；
 *   - 不存任何密钥、不自动覆盖服务端项目；
 *   - 服务端确认对应序号保存成功后由调用方清理对应缓存。
 *
 * 环境守卫：没有 IndexedDB（如单测 / 服务端渲染）时全部降级为空操作，
 * 不抛异常，也不影响正式保存链路。
 */

const DATABASE_NAME = 'mojing-draft-recovery'
const STORE_NAME = 'drafts'
/** 非章节作用的草稿（如世界观总览的四个正文片段）走独立 object store，避免覆盖章节草稿。 */
const SCOPED_STORE_NAME = 'scoped-drafts'
const DATABASE_VERSION = 2

export type DraftSnapshot = {
  projectId: string
  /** 写入时的项目 revision，用于判断草稿是否落后于服务端。 */
  baseRevision: number
  /** 组件内单调递增的编辑序号；服务端确认该序号保存成功后即可清理。 */
  editSequence: number
  chapterId: string
  blocks: Array<{ id: string; text: string }>
  /** 记录时间（ISO），用于界面如实展示草稿新旧。 */
  savedAt: string
}

/**
 * 通用作用域草稿。与章节草稿共用同一套「恢复缓存」纪律：
 * 只记未确认落盘的本机输入，不覆盖服务端内容，保存确认后由调用方清理。
 *
 * `key` 必须自带项目 ID（约定 `<作用域>:<projectId>`），保证不同项目、不同页面互不覆盖。
 */
export type ScopedDraftSnapshot<TPayload> = {
  key: string
  projectId: string
  /** 写入时的项目 revision，用于恢复时提示「草稿落后于服务端」。 */
  baseRevision: number
  savedAt: string
  payload: TPayload
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null
}

function openDatabase(): Promise<IDBDatabase | undefined> {
  if (!hasIndexedDb()) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'projectId' })
      if (!database.objectStoreNames.contains(SCOPED_STORE_NAME)) database.createObjectStore(SCOPED_STORE_NAME, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    // 隐私模式或存储被禁用时静默降级，不阻塞写作
    request.onerror = () => resolve(undefined)
    request.onblocked = () => resolve(undefined)
  })
}

function runTransaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return runStoreTransaction(STORE_NAME, mode, work)
}

function runStoreTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | undefined> {
  return openDatabase().then((database) => {
    if (!database) return undefined
    return new Promise<T | undefined>((resolve) => {
      try {
        const transaction = database.transaction(storeName, mode)
        const request = work(transaction.objectStore(storeName))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => resolve(undefined)
        transaction.oncomplete = () => database.close()
        transaction.onerror = () => resolve(undefined)
      } catch {
        resolve(undefined)
      }
    })
  })
}

/** 写入（覆盖）该项目最近的未保存草稿。 */
export async function saveDraft(snapshot: DraftSnapshot): Promise<void> {
  await runTransaction('readwrite', (store) => store.put(snapshot))
}

export async function loadDraft(projectId: string): Promise<DraftSnapshot | undefined> {
  const result = await runTransaction<DraftSnapshot | undefined>('readonly', (store) => store.get(projectId))
  return result ?? undefined
}

/** 服务端已确认保存（或作者明确放弃）后清理该项目缓存。 */
export async function clearDraft(projectId: string): Promise<void> {
  await runTransaction('readwrite', (store) => store.delete(projectId))
}

/** 写入（覆盖）某个作用域最近的未确认输入。 */
export async function saveScopedDraft<TPayload>(snapshot: ScopedDraftSnapshot<TPayload>): Promise<void> {
  await runStoreTransaction(SCOPED_STORE_NAME, 'readwrite', (store) => store.put(snapshot))
}

export async function loadScopedDraft<TPayload>(key: string): Promise<ScopedDraftSnapshot<TPayload> | undefined> {
  const result = await runStoreTransaction<ScopedDraftSnapshot<TPayload> | undefined>(
    SCOPED_STORE_NAME, 'readonly', (store) => store.get(key)
  )
  return result ?? undefined
}

/** 服务端已确认保存（或作者明确放弃）后清理该作用域缓存。 */
export async function clearScopedDraft(key: string): Promise<void> {
  await runStoreTransaction(SCOPED_STORE_NAME, 'readwrite', (store) => store.delete(key))
}

/**
 * 在同一个 readwrite transaction 里先读后按 payload 条件删除。
 *
 * 用于「服务端确认了某一次编辑序号」这类场景：如果同 key 下已经有更新的本地输入，
 * 这里必须保留新输入，不能用单独的 load + delete 两个事务制造误删窗口。
 */
export async function clearScopedDraftIf<TPayload>(
  key: string,
  shouldClear: (payload: TPayload) => boolean
): Promise<boolean> {
  const database = await openDatabase()
  if (!database) return false
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      try { database.close() } catch { /* ignore close failures */ }
      resolve(value)
    }
    try {
      const transaction = database.transaction(SCOPED_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(SCOPED_STORE_NAME)
      const request = store.get(key)
      request.onsuccess = () => {
        const snapshot = request.result as ScopedDraftSnapshot<TPayload> | undefined
        if (!snapshot || !shouldClear(snapshot.payload)) {
          finish(false)
          return
        }
        const deleteRequest = store.delete(key)
        deleteRequest.onsuccess = () => finish(true)
        deleteRequest.onerror = () => finish(false)
      }
      request.onerror = () => finish(false)
      transaction.onerror = () => finish(false)
    } catch {
      finish(false)
    }
  })
}
