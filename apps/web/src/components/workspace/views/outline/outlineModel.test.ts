import { describe, expect, it } from 'vitest'
import { NovelProjectSchema, type NovelProject } from '../../../../../../../packages/contracts/src'
import {
  OUTLINE_PAGE_IDS,
  buildChapterBeats,
  buildChapterDirectory,
  buildOutlineFoundation,
  buildOutlineStructure,
  buildRollingOutline,
  buildStorylines,
  isOutlinePageId,
  outlinePageKind,
  resolveChapterOpenTarget,
  resolveCurrentVolumeNumber
} from './outlineModel'

const NOW = '2026-09-13T12:00:00.000Z'

/** 夹具用真实契约解析，避免手写对象与 schema 漂移。 */
function rawOutline() {
  return {
    status: '草稿',
    synopsis: '断简在雷变之夜苏醒，被卷入归墟的旧约。',
    themes: ['记忆与代价', '旧秩序的崩塌'],
    mainConflict: '主角要保住记忆，就必须交还归墟的钥匙。',
    endingDirection: '主角成为新的守约者，但失去自己的一部分。',
    updatedAt: NOW,
    volumes: [
      {
        id: 'vol-1', volumeNumber: 1, title: '断简苏醒',
        goal: '建立主角与断简的关系', climax: '雷变之夜', resolution: '主角被迫离家',
        chapters: [
          {
            id: 'card-1', volumeNumber: 1, chapterNumber: 1, title: '雷变之夜',
            pov: '林砚', objective: '活下来', conflict: '雷变与追兵同时到来',
            turningPoint: '断简认主', reveal: '断简认得他', endingHook: '追兵认出断简',
            characterIds: ['chr-1'], setupThreadIds: ['th-1'], payoffThreadIds: [],
            status: '已写作', beatStatus: '已确认',
            beats: [
              {
                id: 'beat-1', order: 1, title: '夜雨入城', purpose: '铺垫', conflict: '城门封闭',
                outcome: '翻墙入城', location: '回雁城', timeframe: '雨夜', characterIds: ['chr-1'], reveal: '', threadActions: []
              },
              {
                id: 'beat-2', order: 2, title: '断简发声', purpose: '触发事件', conflict: '主角不敢信',
                outcome: '接受断简', location: '旧宅', timeframe: '当夜', characterIds: ['chr-1'], reveal: '断简会说话', threadActions: ['埋设 th-1']
              }
            ],
            beatFindings: [
              {
                id: 'bf-1', beatId: 'beat-1', severity: '中', category: '因果断裂',
                message: '翻墙入城的动机不充分', suggestion: '补一句追兵的距离', status: '待处理'
              }
            ],
            lineAssignments: [{ lineId: 'line-main', role: '主线' }]
          },
          {
            id: 'card-2', volumeNumber: 1, chapterNumber: 2, title: '旧约之名',
            pov: '林砚', objective: '查名', conflict: '无人肯说', turningPoint: '找到旧拓片',
            reveal: '旧约存在', endingHook: '有人跟踪他',
            characterIds: ['chr-1'], setupThreadIds: [], payoffThreadIds: [],
            status: '未规划', beatStatus: '未生成', beats: [], beatFindings: [],
            downstreamReviewStatus: '待复核', downstreamReviewReason: '卷纲目标已更新'
          }
        ]
      },
      {
        id: 'vol-2', volumeNumber: 2, title: '归墟旧约',
        goal: '', climax: '', resolution: '', chapters: []
      }
    ],
    rollingWindow: {
      currentChapterNumber: 2, detailStartChapterNumber: 1, detailEndChapterNumber: 20,
      windowSize: 20, coarseThroughChapterNumber: 40, updatedAt: NOW
    }
  }
}

function rawProject() {
  return {
    schemaVersion: 7,
    id: 'novel-outline',
    title: '归墟纪事',
    seed: '',
    status: '创作中',
    revision: 7,
    settings: {
      genreTemplate: '通用', targetWords: 300_000, plannedVolumes: 2, plannedChapters: 40,
      pointOfView: '第三人称限知', tense: '过去时', audience: '', style: '', contentLimits: '',
      language: '简体中文', rhetoricIntensity: 1
    },
    outline: rawOutline(),
    chapters: [
      {
        id: 'ch-1', volumeNumber: 1, chapterNumber: 1, title: '雷变之夜',
        blocks: [{ id: 'ch-1-b1', text: '夜雨落在回雁城的瓦上。' }], status: '草稿', sourceDigest: '', updatedAt: NOW
      },
      {
        id: 'ch-9', volumeNumber: 1, chapterNumber: 9, title: '未入纲的一章',
        blocks: [{ id: 'ch-9-b1', text: '这一章没有对应章纲。' }], status: '待审校', sourceDigest: '', updatedAt: NOW
      }
    ],
    memories: [],
    plotThreads: [
      {
        id: 'th-1', title: '断简的温度', detail: '断简一直是温的', characterIds: ['chr-1'], status: '已埋设',
        setupMethod: '', resolutionMethod: '', progress: [], updatedAt: NOW
      },
      {
        id: 'th-2', title: '旧拓片来历', detail: '', characterIds: [], status: '已回收',
        setupMethod: '', resolutionMethod: '', progress: [], updatedAt: NOW
      }
    ],
    storylines: [
      {
        id: 'line-1', title: '寻找旧约', type: '调查', whyNecessary: '主线推进',
        openingState: '断简苏醒', finalGoal: '弄清旧约内容', endCondition: '拿到完整旧约',
        currentProgress: 0.25, nextAction: '去旧档库', status: '推进中', updatedAt: NOW,
        characterIds: [], entryIds: [], relatedPlotThreadIds: ['th-1'],
        keyNodes: [{ id: 'node-1', title: '旧档库', description: '', targetChapterNumber: 3, status: '未开始', evidence: [] }],
        chapterPlans: [{
          chapterId: 'card-2', chapterNumber: 2, subGoal: '取得拓片线索', method: '翻查旧档', obstacle: '看守阻拦',
          outcome: '拿到半张拓片', nextTrigger: '被跟踪', changes: ['信息'], status: '计划', evidence: []
        }],
        evidenceChain: [], unresolvedQuestions: ['拓片是谁留的']
      }
    ],
    branches: [],
    reviews: [],
    worldConstraints: [],
    worldQualityFindings: [],
    createdAt: NOW,
    updatedAt: NOW
  }
}

function baseProject(): NovelProject {
  return NovelProjectSchema.parse(rawProject())
}

function emptyProject(): NovelProject {
  return NovelProjectSchema.parse({ ...rawProject(), outline: undefined, chapters: [], plotThreads: [], storylines: undefined })
}

describe('大纲二级页面拆分', () => {
  it('六个二级入口都有稳定的页面类型，且互不相同', () => {
    expect(OUTLINE_PAGE_IDS).toHaveLength(6)
    const kinds = OUTLINE_PAGE_IDS.map((id) => outlinePageKind(id))
    expect(new Set(kinds).size).toBe(6)
    for (const id of OUTLINE_PAGE_IDS) expect(isOutlinePageId(id)).toBe(true)
    expect(isOutlinePageId('world-overview')).toBe(false)
    // 未知 id 回落到总纲页，而不是空白
    expect(outlinePageKind('not-a-page')).toBe('foundation')
  })

  it('同一份项目在六个页面上产出不同内容（不是同一份复用）', () => {
    const project = baseProject()
    const foundation = buildOutlineFoundation(project, 'ch-1')
    const directory = buildChapterDirectory(project, 'ch-1')
    const rolling = buildRollingOutline(project)
    const beats = buildChapterBeats(project, 'card-1')
    const storylines = buildStorylines(project)
    const structure = buildOutlineStructure(project)

    expect(new Set([foundation.kind, directory.kind, rolling.kind, beats.kind, storylines.kind, structure.kind]).size).toBe(6)

    // 各自的区分性内容来自不同数据面
    expect(foundation.volumes).toHaveLength(2)
    expect(directory.bodyWithoutCard.map((item) => item.chapterNumber)).toEqual([9])
    expect(rolling.window?.detailEndChapterNumber).toBe(20)
    expect(beats.beats.map((beat) => beat.order)).toEqual([1, 2])
    expect(storylines.lines.map((line) => line.id)).toEqual(['line-1'])
    expect(structure.actions).toHaveLength(6)
  })
})

describe('总纲与卷纲', () => {
  it('总纲字段与卷卡全部来自传入项目', () => {
    const model = buildOutlineFoundation(baseProject(), 'ch-1')
    expect(model.hasOutline).toBe(true)
    expect(model.themes).toEqual(['记忆与代价', '旧秩序的崩塌'])
    expect(model.mainConflict).toBe('主角要保住记忆，就必须交还归墟的钥匙。')
    expect(model.volumes.map((volume) => volume.title)).toEqual(['断简苏醒', '归墟旧约'])
    expect(model.volumes[0]!.chapters.map((card) => card.title)).toEqual(['雷变之夜', '旧约之名'])
    expect(model.totals.plannedChapterCount).toBe(2)
    expect(model.totals.writtenChapterCount).toBe(2)
    expect(model.totals.openThreadCount).toBe(1)
    expect(model.totals.words).toBeGreaterThan(0)
  })

  it('空字段如实标为缺失，不生成占位内容', () => {
    const model = buildOutlineFoundation(baseProject(), 'ch-1')
    expect(model.volumes[1]!.missingFields).toEqual(['本卷目标', '本卷高潮', '本卷收束'])
    expect(model.volumes[1]!.goal).toBe('')
    expect(model.volumes[1]!.statusTally).toBe('暂无章纲')
  })

  it('当前卷跟随选中章节，并在没有选中时回落到第一卷', () => {
    const project = baseProject()
    expect(resolveCurrentVolumeNumber(project, 'ch-1')).toBe(1)
    expect(resolveCurrentVolumeNumber(project)).toBe(1)
    const renamed = NovelProjectSchema.parse({
      ...rawProject(),
      outline: { ...rawOutline(), volumes: [{ ...rawOutline().volumes[0]!, volumeNumber: 3 }], rollingWindow: undefined }
    })
    expect(resolveCurrentVolumeNumber(renamed)).toBe(3)
  })

  it('卷状态统计只汇总真实章纲状态', () => {
    const model = buildOutlineFoundation(baseProject(), 'ch-1')
    expect(model.volumes[0]!.statusTally).toBe('已写作 1 · 未规划 1')
  })
})

describe('章节目录', () => {
  it('按真实卷章展示，并如实标出有正文但无章纲的差额', () => {
    const model = buildChapterDirectory(baseProject(), 'ch-1')
    expect(model.totalCards).toBe(2)
    expect(model.totalBodies).toBe(2)
    expect(model.bodyWithoutCard).toEqual([{ chapterId: 'ch-9', chapterNumber: 9, title: '未入纲的一章', status: '待审校' }])
  })

  it('章节状态只显示真实业务状态，不显示自造状态', () => {
    const model = buildChapterDirectory(baseProject(), 'ch-1')
    const cards = model.volumes.flatMap((volume) => volume.chapters)
    expect(cards.map((card) => card.cardStatus)).toEqual(['已写作', '未规划'])
    expect(cards[0]!.bodyStatus).toBe('草稿')
    expect(cards[0]!.beatStatus).toBe('已确认')
    expect(cards[1]!.hasBody).toBe(false)
    expect(cards[1]!.bodyStatus).toBeUndefined()
    expect(cards[1]!.downstreamPending).toBe(true)
  })

  it('单击章节进入章纲编辑而不是正文创作', () => {
    const target = resolveChapterOpenTarget('card-2')
    expect(target).toEqual({ stageId: 'outline', subnavId: 'chapter-beats', chapterId: 'card-2' })
    expect(target.stageId).not.toBe('writing')
    expect(target.subnavId).not.toBe('prose-editor')
  })
})

describe('近期详细规划', () => {
  it('有窗口时只列出窗口内的真实章纲', () => {
    const model = buildRollingOutline(baseProject())
    expect(model.connected).toBe(true)
    expect(model.notice).toBeUndefined()
    expect(model.inWindow.map((card) => card.chapterNumber)).toEqual([1, 2])
    expect(model.outsideWindow).toEqual([])
    expect(model.window?.coarseThroughChapterNumber).toBe(40)
    expect(model.window?.updatedAt).toBe(NOW)
  })

  it('没有窗口时明确标注筛选能力尚未接通，且不编造范围与内容', () => {
    const project = NovelProjectSchema.parse({ ...rawProject(), outline: { ...rawOutline(), rollingWindow: undefined } })
    const model = buildRollingOutline(project)
    expect(model.connected).toBe(false)
    expect(model.window).toBeUndefined()
    expect(model.inWindow).toEqual([])
    expect(model.notice?.title).toBe('「近期」筛选目前不可用')
    expect(model.notice?.detail).toContain('rollingWindow')
    // 窗口外的章纲仍然可数，但不会被当作「近期」内容展示
    expect(model.outsideWindow.map((card) => card.chapterNumber)).toEqual([1, 2])
  })
})

describe('剧情步骤', () => {
  it('步骤、顺序、建议与剧情线分配都来自传入章纲', () => {
    const model = buildChapterBeats(baseProject(), 'card-1')
    expect(model.headline).toBe('第 1 章《雷变之夜》')
    expect(model.beats.map((beat) => beat.order)).toEqual([1, 2])
    expect(model.beats[1]!.threadActions).toEqual(['埋设 th-1'])
    expect(model.beatStatus).toBe('已确认')
    expect(model.findings.map((finding) => finding.id)).toEqual(['bf-1'])
    expect(model.pendingFindingCount).toBe(1)
    expect(model.lines).toEqual([{ lineId: 'line-main', role: '主线', purpose: undefined, exceptionReason: undefined }])
  })

  it('默认目标章跟随正文选中章，无匹配时取第一章纲', () => {
    expect(buildChapterBeats(baseProject(), 'ch-1').card?.cardId).toBe('card-1')
    expect(buildChapterBeats(baseProject()).card?.cardId).toBe('card-1')
    expect(buildChapterBeats(baseProject(), 'card-2').card?.cardId).toBe('card-2')
  })

  it('章纲没有步骤时不会自动生成步骤', () => {
    const model = buildChapterBeats(baseProject(), 'card-2')
    expect(model.card?.cardId).toBe('card-2')
    expect(model.beats).toEqual([])
    expect(model.beatStatus).toBe('未生成')
    expect(model.editable).toBe(false)
  })

  it('无数据时是只读空态，且写明编辑接口未接通', () => {
    const model = buildChapterBeats(emptyProject())
    expect(model.card).toBeUndefined()
    expect(model.beats).toEqual([])
    expect(model.editable).toBe(false)
    expect(model.targetNotice).toContain('还没有章纲')
    expect(model.notice.title).toBe('剧情步骤需要校验，目前不能直接编辑')
  })
})

describe('重要事件线', () => {
  it('只展示项目自身保存的剧情线', () => {
    const model = buildStorylines(baseProject())
    expect(model.notice).toBeUndefined()
    expect(model.lines).toHaveLength(1)
    const line = model.lines[0]!
    expect(line.title).toBe('寻找旧约')
    expect(line.type).toBe('调查')
    expect(line.progressPercent).toBe(25)
    expect(line.keyNodes.map((node) => node.targetChapterNumber)).toEqual([3])
    expect(line.chapterPlans.map((plan) => plan.chapterNumber)).toEqual([2])
    expect(line.evidenceCount).toBe(0)
    expect(line.unresolvedQuestionCount).toBe(1)
    expect(model.relatedOpenThreadCount).toBe(1)
  })

  it('没有剧情线时不按章节数量虚构事件，并标注未接通', () => {
    const project = NovelProjectSchema.parse({ ...rawProject(), storylines: [] })
    const model = buildStorylines(project)
    expect(model.lines).toEqual([])
    expect(model.notice?.title).toBe('项目里还没有剧情线记录')
    expect(model.notice?.detail).toContain('自动归集')
  })
})

describe('结构调整', () => {
  it('结构检查结果由项目数据现场推导', () => {
    const model = buildOutlineStructure(baseProject())
    const ids = model.findings.map((finding) => finding.id)
    expect(ids).toContain('body-without-card')
    expect(ids).toContain('unplanned-cards')
    expect(ids).toContain('beats-unconfirmed')
    expect(ids).toContain('downstream-review')
    expect(ids).toContain('empty-volumes')
    expect(ids).toContain('volumes-missing-goal')
    // 章纲编号是 1、2，连续；正文第 9 章不会被误当成章纲编号缺口
    expect(ids).not.toContain('number-gaps')

    const unconfirmed = model.findings.find((finding) => finding.id === 'beats-unconfirmed')!
    expect(unconfirmed.chapterNumbers).toEqual([2])
    const missingBody = model.findings.find((finding) => finding.id === 'body-without-card')!
    expect(missingBody.chapterNumbers).toEqual([9])
    expect(missingBody.severity).toBe('高')
    expect(model.severityCounts.高).toBe(1)
  })

  it('章节编号缺口会被如实列出', () => {
    const outline = rawOutline()
    const project = NovelProjectSchema.parse({
      ...rawProject(),
      outline: {
        ...outline,
        volumes: [outline.volumes[0]!, { ...outline.volumes[1]!, chapters: [{ ...outline.volumes[0]!.chapters[0]!, id: 'card-5', chapterNumber: 5, title: '第五章' }] }]
      }
    })
    const finding = buildOutlineStructure(project).findings.find((item) => item.id === 'number-gaps')!
    expect(finding.chapterNumbers).toEqual([3, 4])
    expect(finding.severity).toBe('低')
  })

  it('所有结构操作禁用并写明原因，AI 不能直接改写正式卷章', () => {
    const model = buildOutlineStructure(baseProject())
    expect(model.operable).toBe(false)
    expect(model.actions).toHaveLength(6)
    for (const action of model.actions) {
      expect(action.enabled).toBe(false)
      expect(action.reason).toContain('尚未开放')
    }
    expect(model.notice.title).toBe('结构调整需要评估，目前不能直接改动')
    expect(model.notice.detail).toContain('不能直接移动、删除或改写正式卷章')
  })
})

describe('空项目不出现假数据', () => {
  it('没有大纲与正文时，各页面都返回空模型而不是占位内容', () => {
    const project = emptyProject()
    const foundation = buildOutlineFoundation(project)
    expect(foundation.hasOutline).toBe(false)
    expect(foundation.volumes).toEqual([])
    expect(foundation.themes).toEqual([])
    expect(foundation.totals.plannedChapterCount).toBe(0)
    expect(foundation.totals.words).toBe(0)

    const directory = buildChapterDirectory(project)
    expect(directory.volumes).toEqual([])
    expect(directory.bodyWithoutCard).toEqual([])

    const rolling = buildRollingOutline(project)
    expect(rolling.connected).toBe(false)
    expect(rolling.outsideWindow).toEqual([])
    expect(rolling.notice).toBeDefined()

    const beats = buildChapterBeats(project)
    expect(beats.card).toBeUndefined()
    expect(beats.beats).toEqual([])

    const storylines = buildStorylines(project)
    expect(storylines.lines).toEqual([])
    expect(storylines.relatedOpenThreadCount).toBe(0)

    // 空项目下本地结构检查也不应误报「有问题」
    const structure = buildOutlineStructure(project)
    expect(structure.findings).toEqual([])
    expect(structure.severityCounts).toEqual({ 高: 0, 中: 0, 低: 0 })
  })
})
