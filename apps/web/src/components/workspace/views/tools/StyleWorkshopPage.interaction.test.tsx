import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import type { NovelProject, StyleProfile, StyleSample, StyleSamplePreview } from '../../../../../../../packages/contracts/src'
import { mojingClient } from '../../../../api/mojingClient'

vi.mock('../../../../api/mojingClient', () => ({
  mojingClient: {
    styleSamples: { list: vi.fn(), create: vi.fn(), preview: vi.fn(), previewFile: vi.fn(), createFile: vi.fn() },
    styleProfiles: { list: vi.fn(), usage: vi.fn(), analyze: vi.fn(), bind: vi.fn(), unbind: vi.fn() }
  }
}))

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState<T>(initial: T | (() => T)) {
      const index = hooks.cursor++
      if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? (initial as () => T)() : initial
      return [hooks.values[index] as T, (next: T | ((current: T) => T)) => {
        hooks.values[index] = typeof next === 'function' ? (next as (current: T) => T)(hooks.values[index] as T) : next
      }] as const
    },
    useEffect() {}
  }
})

const { StyleWorkshopPage } = await import('./StyleWorkshopPage')
const project = { id: 'project-a', settings: {}, chapters: [] } as unknown as NovelProject

function render(): ReactElement {
  hooks.cursor = 0
  return StyleWorkshopPage({ project })
}

function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement(node)) return []
  return [node, ...elements((node.props as { children?: ReactNode }).children)]
}

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(content).join('')
  return isValidElement(node) ? content((node.props as { children?: ReactNode }).children) : ''
}

function byTestId(root: ReactElement, id: string): ReactElement {
  const match = elements(root).find((item) => (item.props as { 'data-testid'?: string })['data-testid'] === id)
  if (!match) throw new Error(`Missing ${id}`)
  return match
}

function byText(root: ReactElement, label: string): ReactElement {
  const match = elements(root).find((item) => typeof (item.props as { onClick?: unknown }).onClick === 'function' && content((item.props as { children?: ReactNode }).children) === label)
  if (!match) throw new Error(`Missing button ${label}`)
  return match
}

function sample(id: string, text: string): StyleSample {
  return {
    id, name: id, kind: 'TXT', text, digest: `digest-${id}`,
    segments: [{ id: 'seg-1', label: '第 1 段', start: 0, end: text.length, characterCount: text.length, excerpt: text }],
    createdAt: '2026-09-25T00:00:00.000Z'
  }
}

function preview(value: StyleSample): StyleSamplePreview {
  return {
    name: value.name, kind: value.kind, digest: value.digest,
    characterCount: value.text.length, segments: value.segments, warnings: []
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  hooks.values = []
  hooks.cursor = 0
  vi.restoreAllMocks()
})

describe('文笔工坊学习抽屉', () => {
  it('新样文预览后先导入新样文，再只用新样文生成画像', async () => {
    const first = sample('sample-a', '旧样文内容')
    const second = sample('sample-b', '新样文内容')
    const saved = [first]
    vi.spyOn(mojingClient.styleSamples, 'list').mockImplementation(async () => [...saved])
    vi.spyOn(mojingClient.styleProfiles, 'list').mockResolvedValue([])
    vi.spyOn(mojingClient.styleProfiles, 'usage').mockResolvedValue([])
    const create = vi.spyOn(mojingClient.styleSamples, 'create').mockImplementation(async (input) => {
      const result = input.content === first.text ? first : second
      saved.push(result)
      return result
    })
    vi.spyOn(mojingClient.styleSamples, 'preview').mockResolvedValue(preview(second))
    const analyze = vi.spyOn(mojingClient.styleProfiles, 'analyze').mockResolvedValue({
      profile: {} as never, evidence: [], sentCharacterCount: second.text.length
    })

    let page = render()
    ;(byTestId(page, 'style-learn-new').props as { onClick: () => void }).onClick()
    page = render()
    ;(elements(page).find((item) => (item.props as { 'aria-label'?: string })['aria-label'] === '样文正文')!.props as { onChange: (event: { target: { value: string } }) => void }).onChange({ target: { value: first.text } })
    page = render()
    ;(byTestId(page, 'style-import').props as { onClick: () => void }).onClick()
    await settle()

    page = render()
    ;(byTestId(page, 'style-learn-new').props as { onClick: () => void }).onClick()
    page = render()
    ;(elements(page).find((item) => (item.props as { 'aria-label'?: string })['aria-label'] === '样文正文')!.props as { onChange: (event: { target: { value: string } }) => void }).onChange({ target: { value: second.text } })
    page = render()
    ;(byTestId(page, 'style-preview').props as { onClick: () => void }).onClick()
    await settle()
    page = render()
    ;(elements(byTestId(page, 'style-segment-step')).find((item) => item.type === 'input' && (item.props as { type?: string }).type === 'checkbox')!.props as { onChange: (event: { target: { checked: boolean } }) => void }).onChange({ target: { checked: true } })
    page = render()
    ;(byText(page, '导入样文并继续').props as { onClick: () => void }).onClick()
    await settle()
    expect(create).toHaveBeenLastCalledWith({ name: '样文', kind: 'TXT', content: second.text })
    page = render()
    ;(byTestId(page, 'style-analyze').props as { onClick: () => void }).onClick()
    await settle()
    expect(analyze).toHaveBeenCalledWith({ sampleId: second.id, segmentIds: ['seg-1'], profileName: '样文画像' })
  })

  it('点击步骤栏的添加样文会返回添加页面', async () => {
    const next = sample('sample-b', '新样文内容')
    vi.spyOn(mojingClient.styleSamples, 'preview').mockResolvedValue(preview(next))
    let page = render()
    ;(byTestId(page, 'style-learn-new').props as { onClick: () => void }).onClick()
    page = render()
    ;(elements(page).find((item) => (item.props as { 'aria-label'?: string })['aria-label'] === '样文正文')!.props as { onChange: (event: { target: { value: string } }) => void }).onChange({ target: { value: next.text } })
    page = render()
    ;(byTestId(page, 'style-preview').props as { onClick: () => void }).onClick()
    await settle()
    page = render()
    ;(byText(page, '1添加样文').props as { onClick: () => void }).onClick()
    expect(elements(render()).some((item) => (item.props as { 'data-testid'?: string })['data-testid'] === 'style-file-input')).toBe(true)
  })
})

describe('文风画像详情', () => {
  it('先展示少数已记录特征与正文操作，完整八项和建议默认收起且可展开', () => {
    const profile: StyleProfile = {
      id: 'profile-a', name: '潮声', description: '克制的近距离叙述', sourceKind: '用户创建',
      sourceName: '作者样文', sourceDigest: '', sourceCharacterCount: 1200,
      createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z',
      traits: {
        sentenceRhythm: '短句交替', narrativeDistance: '贴近人物', dialogueStyle: '留白对白',
        descriptionStyle: '节制描写', pacing: '稳步推进', diction: '朴素用词',
        paragraphPattern: '短段落', rhetoric: '少量比喻'
      },
      guidelines: ['先写动作', '再写情绪'], avoidPatterns: ['避免重复比喻', '避免解释情绪']
    }
    hooks.values[1] = [profile]

    let page = render()
    ;(byTestId(page, 'style-profile').props as { onClick: () => void }).onClick()
    page = render()

    const glance = byTestId(page, 'style-profile-glance')
    const full = byTestId(page, 'style-profile-full')
    expect(content(glance)).toContain('短句交替')
    expect(content(glance)).toContain('贴近人物')
    expect(content(glance)).not.toContain('少量比喻')
    expect(elements(glance).filter((item) => (item.props as { className?: string }).className === 'style-workshop-trait-row')).toHaveLength(3)
    expect(full.type).toBe('details')
    expect((full.props as { open?: boolean }).open).toBeUndefined()
    expect(content(full)).toContain('查看完整画像')
    expect(elements(full).filter((item) => (item.props as { className?: string }).className === 'style-workshop-trait-row')).toHaveLength(8)
    expect(content(full)).toContain('再写情绪')
    expect(content(full)).toContain('避免解释情绪')
    expect(content(page)).toContain('克制的近距离叙述')
    expect(byText(page, '用于正文')).toBeTruthy()
  })
})
