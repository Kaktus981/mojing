import { describe, expect, it } from 'vitest'
import type { AssistantTarget } from '../../../../../../packages/contracts/src'
import {
  assistantDockPreferenceKey,
  chooseDockMode,
  guideDomainForStage,
  INITIAL_DOCK_STATE,
  readAssistantModePreference,
  resetDockModeForScope,
  resolveAssistantDockView,
  shouldResetDockModeForScope,
  writeDockInput
} from './assistantDockModel'

const chapter: AssistantTarget = { kind: 'chapter', projectId: 'project-a', objectId: 'chapter-1' }

describe('guideDomainForStage —— 沿用工作区现有的栏目到领域映射', () => {
  it('idea 与 outline 都归到 outline，其余栏目各自归位', () => {
    expect(guideDomainForStage('idea')).toBe('outline')
    expect(guideDomainForStage('outline')).toBe('outline')
    expect(guideDomainForStage('world')).toBe('world')
    expect(guideDomainForStage('writing')).toBe('writing')
    expect(guideDomainForStage('memory')).toBe('memory')
    expect(guideDomainForStage('delivery')).toBe('delivery')
  })
})

describe('resolveAssistantDockView —— 右栏该显示什么', () => {
  it('有精确目标、但该作用域没选过模式时，显示首次使用的两项选择', () => {
    expect(
      resolveAssistantDockView({ stage: 'outline', target: chapter, storedMode: null, sessionMode: null })
    ).toEqual({ kind: 'chooser' })
  })

  it('已经存过偏好的作用域直接进入对应模式，不再显示选择器', () => {
    expect(
      resolveAssistantDockView({
        stage: 'world',
        target: { kind: 'world', projectId: 'project-a' },
        storedMode: '自由创作',
        sessionMode: null
      })
    ).toEqual({ kind: 'free' })
    expect(
      resolveAssistantDockView({ stage: 'outline', target: chapter, storedMode: '引导构建', sessionMode: null })
    ).toEqual({ kind: 'guide', domain: 'outline', target: chapter, scopeKey: 'outline:project-a:chapter:chapter-1' })
  })

  it('本次会话选过引导后，换到没有目标的作用域会如实说明本页没有可引导目标，而不是凭空造一个目标', () => {
    expect(
      resolveAssistantDockView({ stage: 'writing', target: undefined, storedMode: null, sessionMode: '引导构建' })
    ).toEqual({ kind: 'guide-no-target' })
  })

  it('没有目标且尚未选择时也显示模式入口，不默认进入自由创作', () => {
    expect(
      resolveAssistantDockView({ stage: 'writing', target: undefined, storedMode: null, sessionMode: null })
    ).toEqual({ kind: 'chooser' })
    expect(
      resolveAssistantDockView({ stage: 'memory', target: undefined, storedMode: null, sessionMode: '自由创作' })
    ).toEqual({ kind: 'free' })
  })

  it('同一作用域内，本会话显式选择优先于该作用域已存的旧偏好', () => {
    // stored=引导构建 且 session=自由创作 → 自由创作（按钮不会被陈旧偏好压住）。
    expect(
      resolveAssistantDockView({ stage: 'outline', target: chapter, storedMode: '引导构建', sessionMode: '自由创作' })
    ).toEqual({ kind: 'free' })
    // stored=自由创作 且 session=引导构建 → 引导构建。
    expect(
      resolveAssistantDockView({ stage: 'outline', target: chapter, storedMode: '自由创作', sessionMode: '引导构建' })
    ).toEqual({ kind: 'guide', domain: 'outline', target: chapter, scopeKey: 'outline:project-a:chapter:chapter-1' })
  })

  it('本会话还没选过时，按该作用域已存的偏好恢复模式', () => {
    expect(
      resolveAssistantDockView({ stage: 'outline', target: chapter, storedMode: '引导构建', sessionMode: null })
    ).toEqual({ kind: 'guide', domain: 'outline', target: chapter, scopeKey: 'outline:project-a:chapter:chapter-1' })
    expect(
      resolveAssistantDockView({ stage: 'outline', target: chapter, storedMode: '自由创作', sessionMode: null })
    ).toEqual({ kind: 'free' })
  })
})

describe('换作用域时不把上一个作用域的会话内选择带过去', () => {
  it('作用域变化后重置本会话选择，回到由已存偏好或首次选择决定', () => {
    const chosenFree = chooseDockMode(INITIAL_DOCK_STATE, '自由创作')
    expect(chosenFree.chosenMode).toBe('自由创作')
    const afterScopeChange = resetDockModeForScope(chosenFree)
    expect(afterScopeChange.chosenMode).toBeNull()
    // 换到没有已存偏好的新作用域：回到首次选择，而不是继承旧作用域的自由创作。
    expect(
      resolveAssistantDockView({
        stage: 'world',
        target: { kind: 'world', projectId: 'project-b' },
        storedMode: null,
        sessionMode: afterScopeChange.chosenMode
      })
    ).toEqual({ kind: 'chooser' })
  })

  it('重置只清掉模式选择，不动作者还没发送的自由创作输入', () => {
    const typed = writeDockInput(INITIAL_DOCK_STATE, '作者还没发送的半句话')
    const chosen = chooseDockMode(typed, '自由创作')
    const reset = resetDockModeForScope(chosen)
    expect(reset.chosenMode).toBeNull()
    expect(reset.freeInput).toBe('作者还没发送的半句话')
  })
})

describe('shouldResetDockModeForScope —— 什么时候才真的重置', () => {
  it('有值 A → 不同的有值 B：重置（换了一个不同的精确作用域）', () => {
    expect(shouldResetDockModeForScope({
      previousKey: 'key-a', nextKey: 'key-b', previousDomain: 'outline', nextDomain: 'outline'
    })).toBe(true)
  })

  it('有值 A → 同一个有值 A：不重置（同一作用域内选模式不该被清掉）', () => {
    expect(shouldResetDockModeForScope({
      previousKey: 'key-a', nextKey: 'key-a', previousDomain: 'outline', nextDomain: 'outline'
    })).toBe(false)
  })

  it('undefined → 有值且栏目没变：保留（本页刚拿到目标，作者刚表达的意图不该被丢）', () => {
    expect(shouldResetDockModeForScope({
      previousKey: undefined, nextKey: 'key-b', previousDomain: 'writing', nextDomain: 'writing'
    })).toBe(false)
  })

  it('undefined → 有值但栏目变了：重置', () => {
    expect(shouldResetDockModeForScope({
      previousKey: undefined, nextKey: 'key-b', previousDomain: 'writing', nextDomain: 'memory'
    })).toBe(true)
  })

  it('有值 → undefined（取消选择 / 打开项目工具）：重置', () => {
    expect(shouldResetDockModeForScope({
      previousKey: 'key-a', nextKey: undefined, previousDomain: 'outline', nextDomain: 'outline'
    })).toBe(true)
  })

  it('都没有值且栏目没变：不重置；都没有值但栏目变了：重置', () => {
    expect(shouldResetDockModeForScope({
      previousKey: undefined, nextKey: undefined, previousDomain: 'writing', nextDomain: 'writing'
    })).toBe(false)
    expect(shouldResetDockModeForScope({
      previousKey: undefined, nextKey: undefined, previousDomain: 'writing', nextDomain: 'memory'
    })).toBe(true)
  })
})

describe('模式切换必须保留作者还没发送的自由创作输入', () => {
  it('选模式只改模式，输入原样保留（来回切换都不丢）', () => {
    const typing = writeDockInput(INITIAL_DOCK_STATE, '作者还没发送的半句话')
    const toGuide = chooseDockMode(typing, '引导构建')
    expect(toGuide.chosenMode).toBe('引导构建')
    expect(toGuide.freeInput).toBe('作者还没发送的半句话')

    const backToFree = chooseDockMode(toGuide, '自由创作')
    expect(backToFree.chosenMode).toBe('自由创作')
    expect(backToFree.freeInput).toBe('作者还没发送的半句话')
  })
})

describe('readAssistantModePreference —— 只在真正存过时才报告已选', () => {
  const storageOf = (values: Map<string, string>) => ({ getItem: (key: string): string | null => values.get(key) ?? null })

  it('没存过返回 null；存过才返回保存的模式', () => {
    const values = new Map<string, string>()
    const key = assistantDockPreferenceKey('project-a', 'outline', 'outline:project-a:chapter:chapter-1')
    expect(readAssistantModePreference(key, storageOf(values))).toBeNull()
    values.set(key, '引导构建')
    expect(readAssistantModePreference(key, storageOf(values))).toBe('引导构建')
  })

  it('存储不可用时不抛错，按「还没选过」处理', () => {
    const broken = {
      getItem: (): string | null => {
        throw new Error('storage disabled')
      }
    }
    expect(readAssistantModePreference('any-key', broken)).toBeNull()
  })
})
