/**
 * 右栏模式分派的纯模型。
 *
 * 这里只回答两件事：
 *   1. 当前页面该显示哪一种右栏视图（首次选择 / 自由创作 / 引导构建 / 本页没有可引导目标）；
 *   2. 切换模式时，作者还没发送的自由创作输入必须原样保留。
 *
 * 它本身**不发起任何请求**：引导请求归属 `useAssistantGuide`，自由创作的聊天请求归属
 * `FreeCreationPanel` 里原有的发送链路。
 */
import {
  assistantGuideScopeKey,
  type AssistantGuideDomain,
  type AssistantTarget,
  type CreativeChatStage
} from '../../../../../../packages/contracts/src'
import {
  assistantModePreferenceKey,
  FREE_CREATION_MODE,
  GUIDE_CREATION_MODE,
  type AssistantGuideUiMode
} from './assistantModePreference'

/** 首次使用选择器里两项的先后：引导构建在上，自由创作在下。 */
export const ASSISTANT_MODE_ORDER: readonly AssistantGuideUiMode[] = [GUIDE_CREATION_MODE, FREE_CREATION_MODE]

/**
 * 栏目 → 引导领域。
 *
 * 沿用工作区现有映射：创作起点与小说大纲同属 `outline` 领域，其余栏目各自归位。
 * 不新增页面目前不产生的目标。
 */
export function guideDomainForStage(stage: CreativeChatStage): AssistantGuideDomain {
  switch (stage) {
    case 'idea':
    case 'outline':
      return 'outline'
    case 'world':
      return 'world'
    case 'writing':
      return 'writing'
    case 'memory':
      return 'memory'
    case 'delivery':
      return 'delivery'
  }
}

export type AssistantDockView =
  | { kind: 'chooser' }
  | { kind: 'free' }
  | { kind: 'guide'; domain: AssistantGuideDomain; target: AssistantTarget; scopeKey: string }
  | { kind: 'guide-no-target' }

export type AssistantDockState = {
  /** 作者本次会话显式选过的模式；`null` 表示还没选过（据此判断是不是首次进入）。 */
  chosenMode: AssistantGuideUiMode | null
  /** 自由创作里作者还没发送的输入：切换模式必须原样保留。 */
  freeInput: string
}

export const INITIAL_DOCK_STATE: AssistantDockState = { chosenMode: null, freeInput: '' }

/** 记住这次选择的模式。只改模式，**不碰**还没发送的输入。 */
export function chooseDockMode(state: AssistantDockState, mode: AssistantGuideUiMode): AssistantDockState {
  return { ...state, chosenMode: mode }
}

/**
 * 作用域（项目 / 领域 / 精确目标）变化时丢弃**本会话**的显式选择。
 *
 * 这样上一个作用域里临时选的模式不会泄漏到新作用域：
 * 新作用域重新按它自己已存的偏好恢复，没存过就回到首次选择。
 * 只清模式，作者还没发送的输入与其它状态原样保留。
 */
export function resetDockModeForScope(state: AssistantDockState): AssistantDockState {
  if (state.chosenMode === null) return state
  return { ...state, chosenMode: null }
}

/**
 * 作用域变化时**要不要**丢弃本会话的显式模式选择。
 *
 * 规则是收紧过的：既要挡住「上一个作用域的选择泄漏到新作用域」，又不能把作者刚表达的意图误删。
 *
 * - 有值 A → 不同的有值 B：重置（换了一个不同的精确作用域）；A → 同一个 A：不重置。
 * - `undefined` → 有值：**只有栏目没变才保留**。作者在一个「本页还没有可引导目标」的页面上
 *   选了引导，随后同一栏目里选到章节时，目标刚出现、意图应当延续；栏目变了照常重置。
 * - 有值 → `undefined`（取消选择 / 打开项目工具）：重置。
 * - 两边都没有值：栏目没变不动，栏目变了重置（页面换了栏目，不保留本会话选择）。
 */
export function shouldResetDockModeForScope(input: {
  previousKey: string | undefined
  nextKey: string | undefined
  previousDomain: AssistantGuideDomain
  nextDomain: AssistantGuideDomain
}): boolean {
  const { previousKey, nextKey, previousDomain, nextDomain } = input
  if (previousKey === undefined) return previousDomain !== nextDomain
  if (nextKey === undefined) return true
  return previousKey !== nextKey
}

/** 记录自由创作输入框里的内容。 */
export function writeDockInput(state: AssistantDockState, freeInput: string): AssistantDockState {
  return { ...state, freeInput }
}

/** 「项目 + 栏目 + 精确作用域」的模式偏好键（与 Task 6 的模式偏好共用同一套键）。 */
export function assistantDockPreferenceKey(projectId: string, domain: AssistantGuideDomain, scopeKey: string): string {
  return assistantModePreferenceKey({ projectId, domain, scopeKey })
}

/**
 * 读取这个作用域是否已经选过模式；**没选过返回 `null`**（与「选了自由创作」区分开）。
 * 存储不可用时同样返回 `null`，绝不抛错。
 */
export function readAssistantModePreference(
  key: string,
  storage: Pick<Storage, 'getItem'> | null = browserStorage()
): AssistantGuideUiMode | null {
  try {
    const raw = storage?.getItem(key)
    if (raw === GUIDE_CREATION_MODE) return GUIDE_CREATION_MODE
    if (raw === FREE_CREATION_MODE) return FREE_CREATION_MODE
    return null
  } catch {
    return null
  }
}

function browserStorage(): Pick<Storage, 'getItem'> | null {
  try {
    return globalThis.window?.localStorage ?? globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** 统一把请求错误压成一句作者能读懂的话。 */
export function dockErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return '请求失败。'
}

/**
 * 决定右栏显示什么。
 *
 * - 没有精确目标时**不造目标**：尚未选择模式时仍显示两项入口；只有作者选了引导，
 *   才显示「本页没有可引导目标」，选了自由创作才进入对话。
 * - 有目标、但这个作用域没存过偏好、本次会话也没选过 → 显示首次使用的两项选择。
 * - **本会话的显式选择优先于该作用域已存的旧偏好**（`sessionMode ?? storedMode`）：
 *   作者点「切到自由创作 / 切到引导构建」后立刻换过去，不会被旧偏好压住。
 * - 本会话还没选过（`sessionMode === null`）时按该作用域已存的偏好恢复模式；
 *   换作用域时上层会先 `resetDockModeForScope` 清掉本会话选择，避免泄漏。
 */
export function resolveAssistantDockView(input: {
  stage: CreativeChatStage
  target?: AssistantTarget
  storedMode: AssistantGuideUiMode | null
  sessionMode: AssistantGuideUiMode | null
}): AssistantDockView {
  const mode = input.sessionMode ?? input.storedMode
  if (!input.target) {
    if (mode === null) return { kind: 'chooser' }
    return mode === GUIDE_CREATION_MODE ? { kind: 'guide-no-target' } : { kind: 'free' }
  }
  if (mode === null) return { kind: 'chooser' }
  if (mode === GUIDE_CREATION_MODE) {
    const domain = guideDomainForStage(input.stage)
    return { kind: 'guide', domain, target: input.target, scopeKey: assistantGuideScopeKey(domain, input.target) }
  }
  return { kind: 'free' }
}
