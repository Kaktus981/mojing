import { useEffect, useState } from 'react'

/**
 * P3 第一阶段：**异步状态语义层**（只定义语义，不画任何新东西）。
 *
 * 这里**不是**第二套任务状态机，也不接管任何业务状态。它只做三件事：
 *   1. 给「异步动作当前处在什么语义阶段」一个稳定枚举 `AsyncState`，
 *      让 CSS 与测试可以依赖 `data-state`，而不是依赖中文展示文案；
 *   2. 把该枚举映射成既有的语义色 tone（`stateTone`），复用现成的 Banner / Status；
 *   3. 提供「超过 1 秒才显示等待态」的计时器（`useDelayedFlag`），
 *      避免短任务制造闪烁。
 *
 * 业务状态一律照旧：`saveState` / `busy` / `progress` / `GuidedPhase` / `run.status`
 * 都不在本层改写，本层只做**投影**。
 */

/** 异步动作的五种语义阶段。 */
export type AsyncState = 'idle' | 'busy' | 'success' | 'error' | 'empty'

/** 枚举全集：供测试与 `data-state` 合法性校验使用，顺序即书写顺序。 */
export const ASYNC_STATES: readonly AsyncState[] = ['idle', 'busy', 'success', 'error', 'empty']

/** 等待态阈值：短于它的动作不显示 spinner / skeleton，避免闪烁。 */
export const DEFAULT_ASYNC_DELAY_MS = 1000

/**
 * 语义阶段 → 既有的语义色 tone。
 *
 * 返回值沿用 `Banner` 的 tone 词表，不新增任何颜色令牌：
 * `busy` 借 AI 色、`success` 用 ok、`error` 用 danger、`empty` 用 warn（提示「还没有内容」而非出错），
 * `idle` 不表达任何强调。
 */
export function stateTone(state: AsyncState): 'ok' | 'warn' | 'danger' | 'ai' {
  switch (state) {
    case 'busy':
      return 'ai'
    case 'success':
      return 'ok'
    case 'error':
      return 'danger'
    case 'empty':
      return 'warn'
    default:
      return 'ok'
  }
}

/**
 * 与框架无关的延迟计时器。
 *
 * 单独抽出来是为了**可在 fake timers 下稳定测试**：全部时序逻辑都在这里，
 * `useDelayedFlag` 只是把它接到 React 状态上的一个薄壳，因此单测不需要浏览器环境。
 */
export type DelayedFlagController = {
  /** 当前是否应该显示等待态。 */
  readonly visible: boolean
  /** 切换「动作是否在进行中」；从变为 true 的那一刻重新计时。 */
  setActive(active: boolean): void
  setDelay(delayMs: number): void
  subscribe(listener: () => void): () => void
  dispose(): void
}

export function createDelayedFlagController(delayMs: number = DEFAULT_ASYNC_DELAY_MS): DelayedFlagController {
  let delay = delayMs
  let active = false
  let visible = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()

  function emit(): void {
    for (const listener of listeners) listener()
  }

  function clear(): void {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }

  function setVisible(next: boolean): void {
    if (visible === next) return
    visible = next
    emit()
  }

  /**
   * `delay <= 0` 视为「不延迟」，直接可见 —— 这样把阈值调成 0 的调用点语义是明确的，
   * 而不是靠 `setTimeout(..., 0)` 的调度时机碰运气。
   */
  function schedule(): void {
    clear()
    if (!active) return
    if (delay <= 0) {
      setVisible(true)
      return
    }
    timer = setTimeout(() => {
      timer = undefined
      setVisible(true)
    }, delay)
  }

  return {
    get visible() {
      return visible
    },
    setActive(next: boolean): void {
      if (active === next) return
      active = next
      // 重新计时：每次「开始」都从这一刻起算，不继承上一次已经等过的时间。
      setVisible(false)
      if (!next) {
        clear()
        return
      }
      schedule()
    },
    setDelay(next: number): void {
      if (delay === next) return
      delay = next
      schedule()
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose(): void {
      clear()
      listeners.clear()
    }
  }
}

/**
 * 「超过 1 秒才显示等待态」。
 *
 * 用法：`const showSpinner = useDelayedFlag(busy)` —— `busy` 一变 true 并不立刻显示，
 * 满 `DEFAULT_ASYNC_DELAY_MS` 后才显示；若动作在阈值内结束，作者完全看不到等待态。
 */
export function useDelayedFlag(active: boolean, delayMs: number = DEFAULT_ASYNC_DELAY_MS): boolean {
  const [controller] = useState(() => createDelayedFlagController(delayMs))
  const [visible, setVisible] = useState(() => controller.visible)

  useEffect(() => controller.subscribe(() => setVisible(controller.visible)), [controller])
  useEffect(() => {
    controller.setDelay(delayMs)
  }, [controller, delayMs])
  useEffect(() => {
    controller.setActive(active)
  }, [controller, active])
  useEffect(() => () => controller.dispose(), [controller])

  return visible
}
