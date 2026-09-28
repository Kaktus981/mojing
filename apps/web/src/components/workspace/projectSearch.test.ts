import { describe, expect, it } from 'vitest'

import type { NovelProject } from '../../../../../packages/contracts/src'
import { snippetOf, searchProject, PROJECT_SEARCH_KINDS } from './projectSearch'

/**
 * G-17 · 项目内全局搜索（六域）纯函数测试。
 *
 * 覆盖：
 *   1. 空查询返回 []（不返回全量）；
 *   2. 没有任何域命中时返回 []；
 *   3. 同一关键词落入六个域各命中一次；
 *   4. snippetOf 的截断与省略号规则（中间命中→两侧省略号、开头命中→无前缀、
 *      超长无命中→硬截断加省略号）。
 */

// 六个域分别含一个唯一关键词「潮汐」，便于精确断言「每个域各命中一条」。
const project = {
  chapters: [
    { chapterNumber: 1, title: '钟起', id: 'ch-1', blocks: [{ text: '潮汐在旧城地底回响。' }, { text: '普通段落。' }] }
  ],
  outline: {
    volumes: [
      { chapters: [
        { chapterNumber: 1, title: '潮汐之章', id: 'oc-1', objective: '潮汐推动调查', conflict: '', turningPoint: '', reveal: '', endingHook: '' }
      ] }
    ]
  },
  worldBible: {
    status: '草稿',
    summary: '潮汐塑造了这座城。',
    premise: '核心前提',
    geography: '地理',
    historySummary: '历史',
    rules: ['规则一'],
    entries: [{ id: 'e-1', name: '其他词条', locked: false, relations: [] }]
  },
  worldConstraints: [{ id: 'c-1', term: '术语甲', definition: '定义甲', status: '待确认', notDefinition: '', entityType: '', allowedUsages: [], unresolvedQuestions: [], forbiddenUsages: [], facts: [], createdAt: '', updatedAt: '', source: { fieldPath: '', excerpt: '' } }],
  memories: [
    { chapterId: 'm-1', chapterNumber: 1, summary: '潮汐记忆留存', keyEvents: [], objectStates: [], timelineEvents: [], styleSignals: [], facts: [], characterStates: [] }
  ],
  plotThreads: [{ id: 'pt-1', title: '潮汐预言', detail: '', setupMethod: '', resolutionMethod: '' }],
  storylines: [{ id: 'sl-1', title: '潮汐调查线', whyNecessary: '', openingState: '', finalGoal: '', endCondition: '', keyNodes: [] }]
} as unknown as NovelProject

describe('项目内全局搜索', () => {
  it('空查询返回空数组（不返回全量）', () => {
    expect(searchProject(project, '   ')).toEqual([])
    expect(searchProject(project, '')).toEqual([])
  })

  it('没有任何域命中时返回空数组', () => {
    expect(searchProject(project, '不存在的关键词zzz')).toEqual([])
  })

  it('关键词「潮汐」落入六个域、各命中一次', () => {
    const hits = searchProject(project, '潮汐')
    // 每个域恰好一条
    expect(hits).toHaveLength(6)
    const kinds = hits.map((hit) => hit.kind).sort()
    expect(kinds).toEqual([...PROJECT_SEARCH_KINDS].sort())

    // 各域落点 target 与 focusId 符合实现约定
    const hitOf = (kind: string) => hits.find((hit) => hit.kind === kind)!
    expect(hitOf('正文').target).toEqual({ stageId: 'writing', subnavId: 'prose-editor' })
    expect(hitOf('正文').focusId).toBe('ch-1') // 正文可精确定位到章节
    expect(hitOf('章纲').target).toEqual({ stageId: 'outline', subnavId: 'chapter-beats' })
    expect(hitOf('章纲').focusId).toBe('oc-1')
    expect(hitOf('世界观').target).toEqual({ stageId: 'world', subnavId: 'world-overview' })
    expect(hitOf('世界观').focusId).toBe('') // 总览只能跳页，不精确定位
    expect(hitOf('记忆').target).toEqual({ stageId: 'memory', subnavId: 'memory-ledger' })
    expect(hitOf('记忆').focusId).toBe('m-1')
    expect(hitOf('伏笔').target).toEqual({ stageId: 'memory', subnavId: 'foreshadowing' })
    expect(hitOf('伏笔').focusId).toBe('pt-1')
    expect(hitOf('故事线').target).toEqual({ stageId: 'outline', subnavId: 'storylines' })
    expect(hitOf('故事线').focusId).toBe('sl-1') // 故事线可经 focusId 精确选中
  })

  it('大小写不敏感：英文正文小写查询也能命中', () => {
    // NovelProject 的 chapters / memories / plotThreads / branches / reviews 是必填数组，
    // 夹具必须给全，否则搜到「记忆」域时就是拿 undefined 去遍历。
    const noCaseProject = {
      chapters: [{ chapterNumber: 1, title: 'T', id: 'x', blocks: [{ text: 'HelloWorld' }] }],
      memories: [],
      plotThreads: [],
      branches: [],
      reviews: []
    } as unknown as NovelProject
    const noCase = searchProject(noCaseProject, 'helloworld')
    expect(noCase).toHaveLength(1)
    expect(noCase[0]!.title).toContain('第1章')
  })

  it('数据里存在缺数组的对象时也不打崩（只少命中，不抛异常）', () => {
    // 这个搜索框挂在工作区常驻工具条上，每敲一个字就跑一次全量遍历。
    // 本项目已发生过两次「对象缺数组 → 整页白屏」事故，所以这里必须能降级而不是抛错。
    const brokenProject = {
      chapters: [{ chapterNumber: 1, title: '钟起', id: 'ch-1', blocks: [{ text: '潮汐在旧城地底回响。' }] }],
      // 记忆对象缺失 keyEvents / objectStates / timelineEvents / styleSignals / facts / characterStates
      memories: [{ chapterId: 'm-1', chapterNumber: 1, summary: '潮汐记忆留存' }],
      plotThreads: [],
      branches: [],
      reviews: []
    } as unknown as NovelProject

    const hits = searchProject(brokenProject, '潮汐')
    const kinds = hits.map((hit) => hit.kind).sort()
    // 正文与记忆都命中「潮汐」；缺数组的记忆不算命中，但绝不抛异常。
    expect(kinds).toEqual(['记忆', '正文'].sort())
    expect(hits.find((hit) => hit.kind === '正文')!.title).toContain('第1章')
  })
})

describe('snippetOf 截断规则', () => {
  const longText = '前'.repeat(60) + '潮汐之钟' + '后'.repeat(60)

  it('命中在中间：两侧都加省略号', () => {
    const s = snippetOf(longText, '潮汐之钟')
    expect(s.startsWith('…')).toBe(true)
    expect(s.endsWith('…')).toBe(true)
    expect(s).toContain('潮汐之钟')
    // 不会把整段原文都吐出来
    expect(s.length).toBeLessThan(longText.length)
  })

  it('命中在开头：不加前缀省略号', () => {
    const s = snippetOf('潮汐之钟在城底', '潮汐之钟')
    expect(s.startsWith('…')).toBe(false)
    expect(s).toContain('潮汐之钟')
  })

  it('未命中且超长：硬截断到 80 字并加省略号', () => {
    const s = snippetOf('甲'.repeat(200), 'zzz')
    expect(s.endsWith('…')).toBe(true)
    expect(s.length).toBe(81) // 80 + 省略号
  })

  it('未命中且不超长：原样返回', () => {
    expect(snippetOf('短文本', 'zzz')).toBe('短文本')
  })
})
