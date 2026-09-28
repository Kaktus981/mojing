import { describe, expect, it } from 'vitest'
import type { NovelProject } from '../../../../packages/contracts/src'
import { buildStageChatGuidance } from './stageChatGuidance'

describe('创作对话阶段指引', () => {
  it('问题分析只显示有本地依据的问题，不把普通创作状态误报为问题', () => {
    const project = makeNovel(1)
    project.settings.contentLimits = ''
    project.worldBible!.status = '草稿'
    project.outline!.status = '草稿'
    project.chapters[0]!.blocks = []
    const idea = buildStageChatGuidance(project, 'idea', '问题分析')
    const world = buildStageChatGuidance(project, 'world', '问题分析')
    const writing = buildStageChatGuidance(project, 'writing', '问题分析', project.chapters[0]!.id)

    expect(idea.issues.map((item) => item.title).join('、')).not.toContain('内容边界')
    expect(world.issues.map((item) => item.title).join('、')).not.toContain('草稿')
    expect(writing.issues.map((item) => item.title).join('、')).not.toContain('还没有正文')
    expect(writing.issues.some((item) => item.title.includes('剧情步骤'))).toBe(true)
  })

  it('逐条显示世界观审校证据，并为问题生成可编辑的 AI 询问预设', () => {
    const project = makeNovel(1)
    project.worldQualityFindings.push({
      id: 'finding-1', type: '术语误用', severity: '高', confidence: 0.98,
      evidence: { fieldPath: '/historySummary', excerpt: '异骨出生率下降' }, constraintIds: ['constraint-1'],
      explanation: '“异骨”是生灵可能自带的结构，不能作为出生主体。', baseFieldDigest: 'digest', status: '待处理', source: '本地规则', createdAt: project.createdAt
    })
    const guidance = buildStageChatGuidance(project, 'world', '问题分析')
    const issue = guidance.issues.find((item) => item.title.includes('异骨出生率下降'))
    expect(issue).toMatchObject({ severity: '高', source: '世界观审校', certainty: '本地可确认' })
    expect(issue?.prompt).toContain('最小修改方向')
  })

  it('普通开放伏笔不算问题，逾期或缺少证据的伏笔才进入当前问题', () => {
    const project = makeNovel(3)
    expect(buildStageChatGuidance(project, 'memory', '问题分析').issues.some((item) => item.title.includes('伏笔存在'))).toBe(false)
    project.plotThreads[0]!.targetPayoffChapter = undefined
    expect(buildStageChatGuidance(project, 'memory', '问题分析').issues.some((item) => item.title.includes('证据缺口'))).toBe(true)
  })

  it('三个栏目分别返回使用步骤、探索方向、当前问题和生成清单', () => {
    const project = makeNovel(1)
    const idea = buildStageChatGuidance(project, 'outline', '灵感讨论', project.chapters[0]!.id)
    const issues = buildStageChatGuidance(project, 'outline', '问题分析', project.chapters[0]!.id)
    const readiness = buildStageChatGuidance(project, 'outline', '生成准备', project.chapters[0]!.id)
    expect(idea.steps).toHaveLength(3)
    expect(idea.dimensions.length).toBeGreaterThanOrEqual(3)
    expect(issues.issues.some((item) => item.title.includes('剧情步骤'))).toBe(true)
    expect(readiness.readiness.some((item) => item.label === '目标章剧情步骤' && !item.complete)).toBe(true)
  })

  it('问题卡统一按高、中、提示排序，优先展示高风险证据', () => {
    const project = makeNovel(1)
    project.worldBible!.rules = []
    project.worldQualityFindings.push({
      id: 'high-finding', type: '设定冲突', severity: '高', confidence: 1,
      evidence: { fieldPath: '/historySummary', excerpt: '锁定事实发生冲突' }, constraintIds: [], explanation: '与作者锁定事实矛盾。',
      baseFieldDigest: 'digest', status: '待处理', source: '本地规则', createdAt: project.createdAt
    })
    const issues = buildStageChatGuidance(project, 'world', '问题分析').issues
    expect(issues[0]?.severity).toBe('高')
    expect(issues.at(-1)?.severity).toBe('提示')
  })
})

function makeNovel(chapterCount = 1): NovelProject {
  const now = '2026-08-27T00:00:00.000Z'
  const chapters: NovelProject['chapters'] = Array.from({ length: chapterCount }, (_, index) => ({
    id: `chapter-${index + 1}`,
    volumeNumber: 1,
    chapterNumber: index + 1,
    title: `第 ${index + 1} 章`,
    blocks: [{ id: `block-${index + 1}`, text: `林砚继续追查古钟，第 ${index + 1} 章。` }],
    status: '草稿',
    sourceDigest: `digest-${index + 1}`,
    updatedAt: now
  }))
  return {
    schemaVersion: 7,
    id: 'project-1',
    title: '星纹古钟',
    seed: '少年发现改变世界秩序的古钟。',
    status: '创作中',
    revision: 0,
    settings: {
      genreTemplate: '玄幻修仙', targetWords: 100_000, plannedVolumes: 1, plannedChapters: chapterCount,
      pointOfView: '第三人称限知', tense: '过去时', audience: '', style: '', contentLimits: '', language: '简体中文', rhetoricIntensity: 1
    },
    worldBible: {
      status: '定稿', summary: '群国争夺星辉资源。', premise: '力量必有代价。', themes: ['选择'],
      rules: ['能力使用会消耗记忆'], geography: '', historySummary: '', entries: [], timeline: [], updatedAt: now
    },
    outline: {
      status: '定稿', synopsis: '林砚追查古钟。', themes: ['选择'], mainConflict: '真相与秩序冲突。', endingDirection: '林砚作出选择。',
      volumes: [{
        id: 'volume-1', volumeNumber: 1, title: '旧城', goal: '', climax: '', resolution: '',
        chapters: chapters.map((chapter) => ({
          id: chapter.id, volumeNumber: 1, chapterNumber: chapter.chapterNumber, title: chapter.title,
          pov: '林砚', objective: '追查线索', conflict: '线索被阻断', turningPoint: '古钟再次鸣响', reveal: '', endingHook: '',
          characterIds: [], setupThreadIds: chapter.chapterNumber === 1 ? ['thread-clock'] : [], payoffThreadIds: [],
          beats: [], beatStatus: '未生成', beatFindings: [], status: '已规划'
        }))
      }],
      updatedAt: now
    },
    chapters,
    memories: [],
    plotThreads: [{
      id: 'thread-clock', title: '古钟星纹', detail: '第一章出现的古钟', characterIds: [], status: '推进中',
      setupChapterId: chapters[0]?.id, setupMethod: '视觉细节',
      setupEvidence: chapters[0] ? { chapterId: chapters[0].id, blockId: chapters[0].blocks[0]!.id, excerpt: '刻有星纹的古钟' } : undefined,
      targetPayoffChapter: chapterCount, resolutionMethod: '', progress: [], updatedAt: now
    }],
    branches: [], reviews: [], worldConstraints: [], worldQualityFindings: [], createdAt: now, updatedAt: now
  }
}
