import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ASYNC_STATES,
  createDelayedFlagController,
  DEFAULT_ASYNC_DELAY_MS,
  stateTone
} from './asyncState'

/**
 * P3 第一阶段：延迟等待态的时序契约。
 *
 * 全部用 fake timers，**不用真实 sleep、不依赖浏览器环境**：
 * 时序逻辑都在 `createDelayedFlagController` 里，`useDelayedFlag` 只是接到 React 状态的薄壳。
 */
describe('createDelayedFlagController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('小于 1000ms 不显示 delayed busy', () => {
    const controller = createDelayedFlagController()
    controller.setActive(true)
    vi.advanceTimersByTime(DEFAULT_ASYNC_DELAY_MS - 1)
    expect(controller.visible, '差 1ms 不到阈值时不能显示等待态').toBe(false)
    controller.dispose()
  })

  it('达到 1000ms 后显示 delayed busy', () => {
    const controller = createDelayedFlagController()
    controller.setActive(true)
    vi.advanceTimersByTime(DEFAULT_ASYNC_DELAY_MS)
    expect(controller.visible).toBe(true)
    controller.dispose()
  })

  it('在 1000ms 前结束时不出现 busy 闪烁', () => {
    const controller = createDelayedFlagController()
    const seen: boolean[] = []
    controller.subscribe(() => seen.push(controller.visible))

    controller.setActive(true)
    vi.advanceTimersByTime(DEFAULT_ASYNC_DELAY_MS - 1)
    controller.setActive(false)
    // 动作已经结束了，此后再等多久都不该补一次等待态。
    vi.advanceTimersByTime(DEFAULT_ASYNC_DELAY_MS * 5)

    expect(controller.visible).toBe(false)
    expect(seen, '整个过程中一次都没通知过「可见」').not.toContain(true)
    controller.dispose()
  })

  it('重置后可以再次计时', () => {
    const controller = createDelayedFlagController()

    controller.setActive(true)
    vi.advanceTimersByTime(DEFAULT_ASYNC_DELAY_MS)
    expect(controller.visible, '第一轮到阈值后可见').toBe(true)

    controller.setActive(false)
    expect(controller.visible, '结束后立刻回到不可见').toBe(false)

    // 第二轮必须从头计时，不能继承第一轮已经等满的时间。
    controller.setActive(true)
    vi.advanceTimersByTime(DEFAULT_ASYNC_DELAY_MS - 1)
    expect(controller.visible, '第二轮未满阈值时不可见').toBe(false)
    vi.advanceTimersByTime(1)
    expect(controller.visible, '第二轮满阈值后可见').toBe(true)
    controller.dispose()
  })

  it('不依赖真实 sleep：整个过程不消耗真实时间', () => {
    const controller = createDelayedFlagController()
    controller.setActive(true)
    // 一次性推进「一小时」；若这里依赖真实等待，用例会真的挂住。
    vi.advanceTimersByTime(3_600_000)
    expect(controller.visible).toBe(true)
    expect(vi.getTimerCount(), '没有残留的待触发定时器').toBe(0)
    controller.dispose()
  })

  it('不依赖浏览器环境：node 环境下也能跑', () => {
    expect(typeof globalThis.document).toBe('undefined')
    expect(typeof globalThis.window).toBe('undefined')
    const controller = createDelayedFlagController()
    controller.setActive(true)
    vi.advanceTimersByTime(DEFAULT_ASYNC_DELAY_MS)
    expect(controller.visible).toBe(true)
    controller.dispose()
  })
})

describe('stateTone', () => {
  it('五种语义阶段都有 tone，且不引入新词', () => {
    expect(ASYNC_STATES).toHaveLength(5)
    for (const state of ASYNC_STATES) {
      expect(['ok', 'warn', 'danger', 'ai'], `state=${state} 必须落在既有 tone 词表内`).toContain(stateTone(state))
    }
  })

  it('忙碌用 AI 色、成功用 ok、失败用 danger、空态用 warn', () => {
    expect(stateTone('busy')).toBe('ai')
    expect(stateTone('success')).toBe('ok')
    expect(stateTone('error')).toBe('danger')
    expect(stateTone('empty')).toBe('warn')
    expect(stateTone('idle')).toBe('ok')
  })
})
