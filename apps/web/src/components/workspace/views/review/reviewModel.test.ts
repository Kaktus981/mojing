import { describe, expect, it } from 'vitest'
import {
  NovelProjectSchema,
  NovelRevisionProposalSchema,
  NovelVersionDiffScopeSchema,
  NovelVersionSummarySchema,
  ReviewItemSchema,
  emptyWorldDetails,
  type NovelProject,
  type NovelRevisionProposal,
  type NovelVersionSummary
} from '../../../../../../../packages/contracts/src'
import {
  CHECKPOINT_DEFAULT_REASON,
  EXPORT_FORMATS,
  REVIEW_NOTICE_BRANCH_ADOPT,
  REVIEW_NOTICE_BRANCH_FRESHNESS,
  REVIEW_NOTICE_CANDIDATE_GATE,
  REVIEW_NOTICE_CONTROLLED_RESTORE,
  REVIEW_NOTICE_CREATE,
  REVIEW_NOTICE_DIFF_PREVIEW,
  REVIEW_NOTICE_EXPORT_PREFLIGHT,
  REVIEW_NOTICE_NAMED_CHECKPOINT,
  REVIEW_NOTICE_RESOLUTION,
  REVIEW_NOTICE_VERSION_REMOVE,
  REVIEW_PAGE_IDS,
  VERSION_DIFF_SCOPES,
  branchAdoptBlockedReason,
  buildExportManifest,
  buildReviewIssues,
  buildRevisionCandidates,
  buildStoryBranches,
  buildVersionHistory,
  chapterLabel,
  chapterWordCount,
  formatTime,
  formatWords,
  isReviewPageId,
  reviewPageKind,
  severityTone
} from './reviewModel'

const NOW = '2026-09-13T12:00:00.000Z'

function settings() {
  return {
    genreTemplate: '通用', targetWords: 200_000, plannedVolumes: 2, plannedChapters: 20,
    pointOfView: '第三人称限知', tense: '过去时', audience: '', style: '', contentLimits: '',
    language: '简体中文', rhetoricIntensity: 1
  }
}

/**
 * 夹具刻意做成「一份有真实缺口的项目」：
 *   - 第 3 章 0 字（空章）、第 4 章在第 2 卷（验证卷数来自真实 volumeNumber）；
 *   - rv-3 已忽略却没有 resolution（验证「缺少处理记录」不被补造）；
 *   - rv-4 没有任何证据（验证定位写「无证据」而不是编一个章节）；
 *   - 四条分支分别命中 最新 / 需要重新比较 / 来源缺失 三种新鲜度；
 *   - 五条候选分别命中 版本一致 / 基线落后 / 已应用 / 已冲突 / 已拒绝。
 * 只有这样才能同时证明「真实数据照着显示」与「不给假数据」。
 */
function rawProject() {
  return {
    schemaVersion: 7,
    id: 'novel-review',
    title: '折光之城',
    seed: '',
    status: '创作中',
    revision: 12,
    settings: settings(),
    chapters: [
      { id: 'ch-1', volumeNumber: 1, chapterNumber: 1, title: '第一章 雾中来客', blocks: [{ id: 'b-1', text: '沈砚抵达回雁城。' }], status: '定稿', sourceDigest: 'digest-ch1-v2', updatedAt: NOW },
      { id: 'ch-2', volumeNumber: 1, chapterNumber: 2, title: '第二章 断简', blocks: [{ id: 'b-2', text: '柳明说断简认主。' }, { id: 'b-3', text: ' 沈砚沉默。 ' }], status: '待审校', sourceDigest: 'digest-ch2', updatedAt: NOW },
      { id: 'ch-3', volumeNumber: 1, chapterNumber: 3, title: '第三章 归墟', blocks: [], status: '草稿', sourceDigest: '', updatedAt: NOW },
      { id: 'ch-4', volumeNumber: 2, chapterNumber: 4, title: '第四章 断简之下', blocks: [{ id: 'b-9', text: '归墟之下。' }], status: '草稿', sourceDigest: 'digest-ch4', updatedAt: NOW }
    ],
    worldBible: {
      status: '草稿', summary: '', premise: '', themes: [], rules: [], geography: '', historySummary: '',
      entries: [
        {
          id: 'e-1', type: '角色', name: '沈砚', aliases: [], tags: [], summary: '', notes: '',
          locked: false, aiVisibility: '始终可见', relations: [], customFields: {}, details: emptyWorldDetails('角色')
        }
      ],
      timeline: [], updatedAt: NOW
    },
    outline: { status: '草稿', synopsis: '', themes: [], mainConflict: '', endingDirection: '', updatedAt: NOW, volumes: [] },
    memories: [],
    plotThreads: [],
    branches: [
      // 来源章 ch-1 摘要 'digest-ch1-v2' 与分支摘要一致 → 最新。
      {
        id: 'br-1', name: '归墟改由沈砚开启', description: '', baseChapterId: 'ch-1',
        chapters: [
          { id: 'br-1-c1', volumeNumber: 1, chapterNumber: 1, title: '第一章 雾中来客', blocks: [{ id: 'br-1-b1', text: '沈砚独自抵达回雁城。' }], status: '草稿', sourceDigest: '', updatedAt: NOW }
        ],
        status: '可比较', createdAt: NOW, updatedAt: NOW, baseRevision: 12, sourceDigest: 'digest-ch1-v2'
      },
      // 来源章 ch-2 摘要已变为 'digest-ch2'，分支仍是旧值 → 需要重新比较；基线落后 4 版。
      {
        id: 'br-2', name: '柳明不交出断简', description: '备选走向', baseChapterId: 'ch-2',
        chapters: [],
        status: '构思中', createdAt: NOW, updatedAt: NOW, baseRevision: 8, sourceDigest: 'digest-ch2-old'
      },
      // 已采用 → 采用按钮必须禁用（避免重复生成候选）；来源章也不在项目里。
      {
        id: 'br-3', name: '断简归柳明', description: '', baseChapterId: 'ch-999',
        chapters: [], status: '已采用', createdAt: NOW, updatedAt: NOW, baseRevision: 12
      },
      // 来源章存在但摘要为空 → 来源缺失。
      {
        id: 'br-4', name: '空章分支', description: '', baseChapterId: 'ch-3',
        chapters: [], status: '已归档', createdAt: NOW, updatedAt: NOW, sourceDigest: 'digest-x'
      }
    ],
    reviews: [
      ReviewItemSchema.parse({
        id: 'rv-1', chapterId: 'ch-1', category: '连续性', severity: '高',
        title: '断简出场顺序冲突', description: '第一章断简已在沈砚手中。',
        evidence: [
          { chapterId: 'ch-1', blockId: 'b-1', excerpt: '沈砚抵达回雁城。' },
          { chapterId: 'ch-2', blockId: 'b-2', excerpt: '柳明说断简认主。' }
        ],
        recommendation: '把断简首次出现移到第二章。', status: '待处理', createdAt: NOW,
        linkedProposalIds: ['c-1']
      }),
      ReviewItemSchema.parse({
        id: 'rv-2', chapterId: 'ch-2', category: '逻辑', severity: '中',
        title: '回溯动机不成立', description: '柳明的动机缺少铺垫。',
        evidence: [{ chapterId: 'ch-2', blockId: 'b-2', excerpt: '柳明说断简认主。' }],
        recommendation: '补一句柳明的顾虑。', status: '已完成', createdAt: NOW,
        resolution: { method: '候选已应用并复核', resolvedAt: '2026-09-13T09:00:00.000Z', proposalIds: ['c-3'] }
      }),
      // 已忽略但没有 resolution：必须被标为「缺少处理记录」。
      ReviewItemSchema.parse({
        id: 'rv-3', chapterId: 'ch-3', category: '节奏', severity: '低',
        title: '第三章开场过慢', description: '归墟段落节奏拖沓。', evidence: [],
        recommendation: '压缩环境描写。', status: '已忽略', createdAt: NOW
      }),
      ReviewItemSchema.parse({
        id: 'rv-4', category: '伏笔', severity: '中',
        title: '断简温度伏笔未回收', description: '伏笔计划到第六章回收，目前无推进。',
        evidence: [], recommendation: '在第四章补一条推进。', status: '待处理', createdAt: NOW
      })
    ],
    worldConstraints: [],
    worldQualityFindings: [],
    createdAt: NOW,
    updatedAt: NOW
  }
}

function baseProject(): NovelProject {
  return NovelProjectSchema.parse(rawProject())
}

/** 一份「什么都还没写」的真实空项目：不补任何占位。 */
function emptyProject(): NovelProject {
  return NovelProjectSchema.parse({ ...rawProject(), chapters: [], branches: [], reviews: [] })
}

/** 真实形状的修改候选：五种状态与两种基线版本差各一条。 */
function revisions(): NovelRevisionProposal[] {
  return [
    NovelRevisionProposalSchema.parse({
      id: 'c-1', projectId: 'novel-review', kind: 'chapter-revision', target: 'chapter', targetId: 'ch-1',
      baseRevision: 12, summary: '把断简首次出现移到第二章', candidate: { title: '第一章 雾中来客', blocks: [{ id: 'b-1', text: '沈砚独自抵达回雁城。' }] },
      status: '待处理', createdAt: NOW, reviewId: 'rv-1',
      sceneQualityFindings: [
        {
          id: 'sq-1', chapterId: 'ch-1', category: '因果不清', severity: '中', confidence: 0.7,
          evidence: { chapterId: 'ch-1', blockId: 'b-1', excerpt: '沈砚抵达回雁城。' },
          explanation: '断简来源不清。', baseCandidateDigest: 'cand-1', source: '本地规则', createdAt: NOW
        }
      ]
    }),
    NovelRevisionProposalSchema.parse({
      id: 'c-2', projectId: 'novel-review', kind: 'outline', target: 'outline',
      baseRevision: 9, summary: '把归墟卷拆成两卷', candidate: { volumes: [{ id: 'v-1' }, { id: 'v-2' }] },
      status: '待处理', createdAt: NOW,
      structureOperation: '拆分章节',
      structureImpact: {
        operation: '拆分章节', summary: '拆分第三章', risk: '中',
        affectedChapterIds: ['ch-3'], affectedChapterNumbers: [3],
        affectedOutlineCount: 1, affectedBodyCount: 1, affectedMemoryCount: 0,
        affectedThreadCount: 0, affectedReviewCount: 0,
        warnings: ['拆分会移动后续章号'], changes: ['新增一章纲', '重排章号'], createdAt: NOW
      }
    }),
    NovelRevisionProposalSchema.parse({
      id: 'c-3', projectId: 'novel-review', kind: 'chapter', target: 'branch', targetId: 'br-3',
      baseRevision: 12, summary: '采用分支「断简归柳明」的正文', candidate: { chapters: [] },
      status: '已应用', createdAt: NOW
    }),
    NovelRevisionProposalSchema.parse({
      id: 'c-4', projectId: 'novel-review', kind: 'world-repair-suggestion', target: 'worldBible', targetId: 'e-1',
      baseRevision: 11, summary: '修正沈砚的身份描述', candidate: { summary: '修订后的设定' },
      status: '已冲突', createdAt: NOW
    }),
    // 关联的审稿问题已不在项目里：联表必须落空，不猜标题。
    NovelRevisionProposalSchema.parse({
      id: 'c-5', projectId: 'novel-review', kind: 'story-direction', target: 'directionCards',
      baseRevision: 12, summary: '新增一条方向卡', candidate: { title: '雾城双线' },
      status: '已拒绝', createdAt: NOW, reviewId: 'rv-404'
    })
  ]
}

function versions(): NovelVersionSummary[] {
  return [
    NovelVersionSummarySchema.parse({ id: 'v-1', projectId: 'novel-review', revision: 10, reason: '手动检查点', source: '手动', createdAt: '2026-09-12T10:00:00.000Z' }),
    NovelVersionSummarySchema.parse({ id: 'v-2', projectId: 'novel-review', revision: 12, reason: '应用候选前保存', source: '应用候选', createdAt: NOW })
  ]
}

/**
 * 真实端点 GET /versions/:versionId/restore-preview 会返回的载荷形状。
 * `targetRevision` 取快照版本、`currentRevision` 取触发预览时的当前稿版本。
 * 故意不经过 schema.parse：调用方要拿到「原始 HTTP 响应」，由模型侧 safeParse 收口。
 */
function previewFor(versionId: string, overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'novel-review',
    versionId,
    targetRevision: 10,
    currentRevision: 12,
    previewDigest: 'digest-from-server',
    createdAt: NOW,
    diffs: [{ scope: '正文', changed: 2, added: 1, removed: 0, sample: ['沈砚独自抵达回雁城。 → 沈砚在雾里抵达回雁城。'] }],
    ...overrides
  }
}

/** 同一份项目、指定 revision：用于验证「项目又编辑过之后预览立刻过期」。 */
function projectAtRevision(revision: number): NovelProject {
  return NovelProjectSchema.parse({ ...rawProject(), revision })
}

/** 取夹具里的某一条：取不到直接失败，避免用非空断言掩盖夹具写错。 */
function pick<T>(items: readonly T[], predicate: (item: T) => boolean): T {
  const found = items.find(predicate)
  if (!found) throw new Error('夹具里没有符合条件的数据，请先修夹具')
  return found
}

// ================================================================ 页面分派

describe('审稿与导出 · 页面分派', () => {
  it('五个二级入口互不相同，且都是合法页面 id', () => {
    expect(REVIEW_PAGE_IDS).toHaveLength(5)
    expect(new Set(REVIEW_PAGE_IDS).size).toBe(5)
    for (const id of REVIEW_PAGE_IDS) expect(isReviewPageId(id)).toBe(true)
  })

  it('每个入口映射到各自不同的页面类型', () => {
    const kinds = REVIEW_PAGE_IDS.map((id) => reviewPageKind(id))
    expect(kinds).toEqual(['export', 'issues', 'candidates', 'branches', 'history'])
    expect(new Set(kinds).size).toBe(5)
  })

  it('未知子页 id 回落到导出成稿，而不是抛错或给出空白页', () => {
    expect(isReviewPageId('not-a-page')).toBe(false)
    expect(reviewPageKind('not-a-page')).toBe('export')
    expect(reviewPageKind('')).toBe('export')
  })
})

// ================================================================ 通用工具

describe('审稿与导出 · 通用工具', () => {
  it('章节字数按段落文字计数，并剥掉空白字符', () => {
    const project = baseProject()
    expect(chapterWordCount(pick(project.chapters, (c) => c.id === 'ch-1'))).toBe(8)
    // ' 沈砚沉默。 ' 两侧有空格：剥掉空白后是 5 个字，不是 7。
    expect(chapterWordCount(pick(project.chapters, (c) => c.id === 'ch-2'))).toBe(13)
    expect(chapterWordCount(pick(project.chapters, (c) => c.id === 'ch-3'))).toBe(0)
  })

  it('字数按中文千分位展示，缺时间就写未记录', () => {
    expect(formatWords(26)).toBe('26')
    expect(formatWords(12345)).toBe('12,345')
    expect(formatTime(undefined)).toBe('未记录')
    expect(formatTime('')).toBe('未记录')
    expect(formatTime('2026-09-13T12:00:00.000Z')).not.toBe('未记录')
  })

  it('风险等级到色调的映射：高=危险、中=警示、其余=信息', () => {
    expect(severityTone('高')).toBe('danger')
    expect(severityTone('中')).toBe('amber')
    expect(severityTone('低')).toBe('info')
    expect(severityTone('未知')).toBe('info')
  })

  it('章号缺失时写「未标注章号」，不猜一个数字', () => {
    expect(chapterLabel(3)).toBe('第 3 章')
    expect(chapterLabel(undefined)).toBe('未标注章号')
  })

  it('四种导出格式只声明 JSON 为完整备份，其余是成稿', () => {
    expect(EXPORT_FORMATS.map((item) => item.id)).toEqual(['docx', 'md', 'txt', 'json'])
    expect(EXPORT_FORMATS.filter((item) => item.backup).map((item) => item.id)).toEqual(['json'])
    for (const item of EXPORT_FORMATS) {
      expect(item.label.length).toBeGreaterThan(0)
      expect(item.ext.startsWith('.')).toBe(true)
    }
  })
})

// ================================================================ 页 1 · 导出成稿

describe('导出成稿 · 只按真实正文统计', () => {
  it('章节数 / 卷数 / 总字数 / 空章节数都来自真实数据', () => {
    const model = buildExportManifest(baseProject(), versions())
    expect(model.kind).toBe('export')
    expect(model.hasProject).toBe(true)
    expect(model.chapterCount).toBe(4)
    // 三个章在第 1 卷、一个在第 2 卷 —— 卷数取自真实 volumeNumber。
    expect(model.volumeCount).toBe(2)
    expect(model.totalWords).toBe(26)
    // 第 3 章没有任何段落，如实计为空章。
    expect(model.emptyChapters).toBe(1)
    expect(model.status).toBe('就绪')
    expect(model.canExport).toBe(true)
  })

  it('分章明细按章号升序，最新一章是章号最大的一章', () => {
    const model = buildExportManifest(baseProject(), versions())
    expect(model.rows.map((row) => row.label)).toEqual(['第 1 章', '第 2 章', '第 3 章', '第 4 章'])
    expect(model.latest?.label).toBe('第 4 章')
    expect(model.rows.map((row) => row.empty)).toEqual([false, false, true, false])
  })

  it('版本快照取的是真实版本号最大的那一条', () => {
    const model = buildExportManifest(baseProject(), versions())
    expect(model.versions.total).toBe(2)
    expect(model.versions.latestRevision).toBe(12)
    expect(model.versions.latestReason).toBe('应用候选前保存')
  })

  it('一章都没有时如实写「无正文」并禁用导出，而不是假就绪', () => {
    const model = buildExportManifest(emptyProject(), versions())
    expect(model.chapterCount).toBe(0)
    expect(model.totalWords).toBe(0)
    expect(model.status).toBe('无正文')
    expect(model.canExport).toBe(false)
    expect(model.latest).toBeUndefined()
  })

  it('没有项目时不编造统计，且仍然给出完整性检查的口径', () => {
    const model = buildExportManifest(undefined, versions())
    expect(model.hasProject).toBe(false)
    expect(model.canExport).toBe(false)
    expect(model.rows).toEqual([])
    expect(model.notice).toBe(REVIEW_NOTICE_EXPORT_PREFLIGHT)
  })

  it('导出前完整性检查说明区分本机运行、阻断与提醒', () => {
    expect(REVIEW_NOTICE_EXPORT_PREFLIGHT.title).toContain('完整性检查')
    expect(REVIEW_NOTICE_EXPORT_PREFLIGHT.detail).toContain('本机')
    expect(REVIEW_NOTICE_EXPORT_PREFLIGHT.detail).toContain('阻断')
    expect(REVIEW_NOTICE_EXPORT_PREFLIGHT.detail).toContain('提醒')
    expect(REVIEW_NOTICE_EXPORT_PREFLIGHT.detail).toContain('不能代替通读全稿')
  })
})

// ================================================================ 页 2 · 审稿问题

describe('审稿问题 · 旧问题不补造处理记录', () => {
  it('已结束但没有处理记录的问题被如实标为「缺少处理记录」', () => {
    const model = buildReviewIssues(baseProject())
    // rv-3 状态已是「已忽略」，但没有 resolution：绝不能被算成「已记录」。
    expect(pick(model.rows, (row) => row.id === 'rv-3').resolutionState).toBe('缺少处理记录')
    expect(model.counts.missingResolution).toBe(1)
  })

  it('有处理记录的问题能读出真实处理方式与时间', () => {
    const model = buildReviewIssues(baseProject())
    const row = pick(model.rows, (item) => item.id === 'rv-2')
    expect(row.status).toBe('已完成')
    expect(row.resolutionState).toBe('已记录')
    expect(row.resolutionMethod).toBe('候选已应用并复核')
    expect(row.resolutionAt).toBe('2026-09-13T09:00:00.000Z')
  })

  it('待处理问题一律是「待处理」，不会被处理记录影响', () => {
    const model = buildReviewIssues(baseProject())
    expect(pick(model.rows, (row) => row.id === 'rv-1').resolutionState).toBe('待处理')
    expect(pick(model.rows, (row) => row.id === 'rv-4').resolutionState).toBe('待处理')
  })

  it('定位取自真实证据章节；没有证据就写「无证据」而不是编一个章节', () => {
    const model = buildReviewIssues(baseProject())
    expect(pick(model.rows, (row) => row.id === 'rv-1').location).toBe('第 1 章 ↔ 第 2 章')
    expect(pick(model.rows, (row) => row.id === 'rv-3').location).toBe('无证据')
    // rv-4 没有任何证据，同样不做推断。
    const rv4 = pick(model.rows, (row) => row.id === 'rv-4')
    expect(rv4.evidence).toEqual([])
    expect(rv4.location).toBe('无证据')
  })

  it('统计口径：待处理 / 高风险 / 关联候选 / 分布都按真实状态计算', () => {
    const model = buildReviewIssues(baseProject())
    expect(model.counts.total).toBe(4)
    expect(model.counts.pending).toBe(2)
    expect(model.counts.completed).toBe(1)
    expect(model.counts.ignored).toBe(1)
    expect(model.counts.severe).toBe(1)
    expect(model.counts.linked).toBe(1)
    expect(model.bySeverity).toEqual([
      { severity: '高', total: 1, pending: 1 },
      { severity: '中', total: 2, pending: 1 },
      { severity: '低', total: 1, pending: 0 }
    ])
    // 只保留真实出现过的类别，不补 0 行。
    expect(model.byCategory.map((entry) => entry.category).sort()).toEqual(['伏笔', '节奏', '连续性', '逻辑'])
    expect(model.byCategory.every((entry) => entry.total > 0)).toBe(true)
  })

  it('新建问题与处理记录的口径据实改写：能自己记、不提供删除、缺少记录会标出', () => {
    const model = buildReviewIssues(baseProject())
    expect(model.notice).toBe(REVIEW_NOTICE_RESOLUTION)
    expect(model.createNotice).toBe(REVIEW_NOTICE_CREATE)
    // 据 2026-09-14 核对：页面确实渲染了「新建审稿问题」表单，因此文案改为「可以自己记」；
    // 旧文案「前端没有手工新增或删除问题的端点」会与同页的表单自相矛盾，不得复活。
    expect(REVIEW_NOTICE_CREATE.detail).toContain('手动记录')
    expect(REVIEW_NOTICE_CREATE.detail).toContain('不提供删除')
    expect(REVIEW_NOTICE_RESOLUTION.detail).toContain('缺少处理记录')
    expect(REVIEW_NOTICE_RESOLUTION.detail).toContain('会单独标出')
    expect(REVIEW_NOTICE_RESOLUTION.detail).not.toMatch(/无法(保存|写入)/)
  })

  it('没有项目时不编造问题', () => {
    const model = buildReviewIssues(undefined)
    expect(model.hasProject).toBe(false)
    expect(model.rows).toEqual([])
    expect(model.counts.total).toBe(0)
  })
})

// ================================================================ 页 3 · AI 修改候选

describe('AI 修改候选 · 基线落后与联表都按真实数据', () => {
  it('版本一致与基线落后分别按 baseRevision 与当前版本计算', () => {
    const model = buildRevisionCandidates(revisions(), baseProject())
    const same = pick(model.rows, (row) => row.id === 'c-1')
    expect(same.baseRevision).toBe(12)
    expect(same.revisionLag).toBe(0)
    expect(same.stale).toBe(false)

    const behind = pick(model.rows, (row) => row.id === 'c-2')
    expect(behind.baseRevision).toBe(9)
    expect(behind.revisionLag).toBe(3)
    expect(behind.stale).toBe(true)
    expect(model.counts.stale).toBe(1)
  })

  it('联表命中才给标题；关联问题已不在项目里就不猜', () => {
    const model = buildRevisionCandidates(revisions(), baseProject())
    expect(pick(model.rows, (row) => row.id === 'c-1').linkedReviewTitle).toBe('断简出场顺序冲突')
    // c-5 的 reviewId 是 rv-404，项目里没有这条问题。
    expect(pick(model.rows, (row) => row.id === 'c-5').linkedReviewTitle).toBeUndefined()
    expect(pick(model.rows, (row) => row.id === 'c-5').reviewId).toBe('rv-404')
  })

  it('五种状态各自计数，分布只保留真实出现的目标', () => {
    const model = buildRevisionCandidates(revisions(), baseProject())
    expect(model.rows).toHaveLength(5)
    expect(model.counts.pending).toBe(2)
    expect(model.counts.applied).toBe(1)
    expect(model.counts.rejected).toBe(1)
    expect(model.counts.conflicted).toBe(1)
    expect(model.targetGroups.map((group) => group.label).sort()).toEqual(['世界观', '剧情分支', '大纲', '故事方向卡', '正文章节'])
    expect(model.targetGroups.every((group) => group.count > 0)).toBe(true)
  })

  it('候选字段名直接取候选负载的顶层键，便于作者知道会改到什么', () => {
    const model = buildRevisionCandidates(revisions(), baseProject())
    expect(pick(model.rows, (row) => row.id === 'c-1').candidateFields).toEqual(['title', 'blocks'])
    expect(pick(model.rows, (row) => row.id === 'c-2').candidateFields).toEqual(['volumes'])
  })

  it('结构调整候选才带影响摘要，且只拼接真实存在的字段', () => {
    const model = buildRevisionCandidates(revisions(), baseProject())
    const outline = pick(model.rows, (row) => row.id === 'c-2')
    expect(outline.structureImpact).toBeDefined()
    expect(outline.structureImpact).toContain('operation：拆分章节')
    expect(outline.structureImpact).toContain('changes 2 项')
    // 普通候选不应凭空得到结构调整影响。
    expect(pick(model.rows, (row) => row.id === 'c-1').structureImpact).toBeUndefined()
  })

  it('附带的质量检查条数按真实数组长度计算', () => {
    const model = buildRevisionCandidates(revisions(), baseProject())
    expect(pick(model.rows, (row) => row.id === 'c-1').sceneQualityCount).toBe(1)
    expect(pick(model.rows, (row) => row.id === 'c-1').qualityCount).toBe(0)
  })

  it('候选应用说明批量处理的安全边界', () => {
    const model = buildRevisionCandidates(revisions(), baseProject())
    expect(model.notice).toBe(REVIEW_NOTICE_CANDIDATE_GATE)
    expect(REVIEW_NOTICE_CANDIDATE_GATE.detail).toContain('批量处理')
  })

  it('没有项目时不编造候选', () => {
    const model = buildRevisionCandidates(revisions(), undefined)
    expect(model.hasProject).toBe(false)
    expect(model.rows).toEqual([])
    expect(model.counts.total).toBe(0)
  })
})

// ================================================================ 页 4 · 剧情分支

describe('剧情分支 · 新鲜度真实比对', () => {
  it('摘要一致=最新；摘要不同=需要重新比较；缺摘要=来源缺失', () => {
    const model = buildStoryBranches(baseProject())
    const fresh = pick(model.rows, (row) => row.id === 'br-1')
    expect(fresh.freshness).toBe('最新')
    expect(fresh.freshnessTone).toBe('ok')

    const stale = pick(model.rows, (row) => row.id === 'br-2')
    expect(stale.freshness).toBe('需要重新比较')
    expect(stale.freshnessTone).toBe('amber')
    expect(stale.revisionLag).toBe(4)

    // 来源章 ch-3 的 sourceDigest 是空串：只能记「来源缺失」，不能猜「最新」。
    const missing = pick(model.rows, (row) => row.id === 'br-4')
    expect(missing.freshness).toBe('来源缺失')
    expect(missing.freshnessTone).toBe('danger')
    expect(missing.hasCurrentDigest).toBe(false)
  })

  it('来源章节已不在项目里时如实说明，不拿别的章节顶替', () => {
    const model = buildStoryBranches(baseProject())
    const orphan = pick(model.rows, (row) => row.id === 'br-3')
    expect(orphan.baseChapterFound).toBe(false)
    expect(orphan.baseChapterLabel).toBe('来源章节已不在项目中')
    expect(orphan.baseChapterTitle).toBe('')
    expect(orphan.freshness).toBe('来源缺失')
  })

  it('采用按钮的禁用理由全部来自真实数据', () => {
    const model = buildStoryBranches(baseProject())
    // 已采用：重复点会产生重复候选。
    const adopted = pick(model.rows, (row) => row.id === 'br-3')
    expect(adopted.adoptable).toBe(false)
    expect(adopted.adoptBlockedReason).toContain('已采用')
    // 已归档：即使来源也缺失，优先说明分支当前不可再采用。
    const missing = pick(model.rows, (row) => row.id === 'br-4')
    expect(missing.adoptable).toBe(false)
    expect(missing.adoptBlockedReason).toContain('已归档')
    // 只有已有备选正文且未归档的分支可采用。
    expect(pick(model.rows, (row) => row.id === 'br-1').adoptable).toBe(true)
    expect(pick(model.rows, (row) => row.id === 'br-1').adoptBlockedReason).toBeUndefined()
    expect(pick(model.rows, (row) => row.id === 'br-2').adoptable).toBe(false)
    expect(pick(model.rows, (row) => row.id === 'br-2').adoptBlockedReason).toContain('没有备选正文')
  })

  it('统计口径：状态分布、新鲜度分布、可采用数都按真实分支计算', () => {
    const model = buildStoryBranches(baseProject())
    expect(model.rows).toHaveLength(4)
    expect(model.counts.drafting).toBe(1)
    expect(model.counts.comparable).toBe(1)
    expect(model.counts.adopted).toBe(1)
    expect(model.counts.archived).toBe(1)
    expect(model.counts.fresh).toBe(1)
    expect(model.counts.stale).toBe(1)
    expect(model.counts.missingSource).toBe(2)
    expect(model.counts.adoptable).toBe(1)
  })

  it('分支正文按章号升序，字数取自分支自己的段落', () => {
    const model = buildStoryBranches(baseProject())
    const branch = pick(model.rows, (row) => row.id === 'br-1')
    expect(branch.chapterCount).toBe(1)
    expect(branch.chapters.map((chapter) => chapter.label)).toEqual(['第 1 章'])
    expect(branch.words).toBe(10)
  })

  it('采用分支只生成候选，且新鲜度按摘要比对的口径都写在界面上', () => {
    const model = buildStoryBranches(baseProject())
    expect(model.notice).toBe(REVIEW_NOTICE_BRANCH_ADOPT)
    expect(REVIEW_NOTICE_BRANCH_ADOPT.detail).toContain('不会直接替换正式章节')
    expect(model.freshnessNotice).toBe(REVIEW_NOTICE_BRANCH_FRESHNESS)
    expect(REVIEW_NOTICE_BRANCH_FRESHNESS.detail).toContain('缺少比对依据')
  })

  it('禁用理由函数：已采用、已归档、无备选正文与来源缺失会拦', () => {
    expect(branchAdoptBlockedReason({ status: '已采用' }, '最新')).toContain('已采用')
    expect(branchAdoptBlockedReason({ status: '构思中' }, '来源缺失')).toContain('缺少来源版本记录')
    expect(branchAdoptBlockedReason({ status: '构思中' }, '最新')).toBeUndefined()
    expect(branchAdoptBlockedReason({ status: '可比较' }, '需要重新比较')).toBeUndefined()
    expect(branchAdoptBlockedReason({ status: '构思中', chapters: [] }, '最新')).toContain('没有备选正文')
    expect(branchAdoptBlockedReason({ status: '已归档' }, '最新')).toContain('已归档')
  })

  it('没有项目时不编造分支', () => {
    const model = buildStoryBranches(undefined)
    expect(model.hasProject).toBe(false)
    expect(model.rows).toEqual([])
    expect(model.counts.total).toBe(0)
    expect(model.counts.adoptable).toBe(0)
  })
})

// ================================================================ 页 5 · 版本历史

describe('版本历史 · 真实快照与禁用能力', () => {
  it('差异范围与契约完全一致，不自行发明范围', () => {
    // VERSION_DIFF_SCOPES 必须逐项等于 NovelVersionDiffScopeSchema.options。
    expect([...VERSION_DIFF_SCOPES]).toEqual([...NovelVersionDiffScopeSchema.options])
  })

  it('版本目录照着真实 versions 排：版本号降序，落后版数按当前 revision 计算', () => {
    const model = buildVersionHistory(baseProject(), versions())
    // 项目 revision=12，v-2 也是 12（最新），v-1 是 10（落后 2 版）。
    expect(model.rows.map((row) => row.id)).toEqual(['v-2', 'v-1'])
    const newest = pick(model.rows, (row) => row.id === 'v-2')
    expect(newest.isCurrent).toBe(true)
    expect(newest.revisionLag).toBe(0)
    expect(newest.reason).toBe('应用候选前保存')
    expect(newest.source).toBe('应用候选')
    const older = pick(model.rows, (row) => row.id === 'v-1')
    expect(older.isCurrent).toBe(false)
    expect(older.revisionLag).toBe(2)
    expect(older.reason).toBe('手动检查点')
    expect(older.source).toBe('手动')
  })

  it('统计口径：总数 / 命中当前版本数 / 最老最新版本号都来自真实快照', () => {
    const model = buildVersionHistory(baseProject(), versions())
    expect(model.counts.total).toBe(2)
    expect(model.counts.atCurrent).toBe(1)
    expect(model.counts.oldestRevision).toBe(10)
    expect(model.counts.newestRevision).toBe(12)
  })

  it('当前版本摘要取真实项目字段，且不给任何变更条数', () => {
    const model = buildVersionHistory(baseProject(), versions())
    expect(model.current.revision).toBe(12)
    expect(model.current.status).toBe('创作中')
    expect(model.current.chapterCount).toBe(4)
    // 四章字数合计 8 + 13 + 0 + 5 = 26。
    expect(model.current.words).toBe(26)
    expect(model.current.snapshot?.id).toBe('v-2')
    expect(model.current.latest?.id).toBe('v-2')
    // 摘要结构里不存在任何「变更条数」字段 —— 那需要差异预览。
    expect(Object.keys(model.current)).not.toContain('changes')
    expect(Object.keys(model.current)).not.toContain('changedCount')
  })

  it('差异预览能力已可用，但「可用」不等于「预览成功」：没触发预览时状态仍是未预览', () => {
    const model = buildVersionHistory(baseProject(), versions())
    // connected 只说明能力可用，不携带任何「预览成功」含义。
    expect(model.diffPreview.connected).toBe(true)
    expect(model.diffPreview.status).toBe('未预览')
    // 未预览时既不给摘要、也不给差异条数，连 error 都没有。
    expect(model.diffPreview.summary).toBeUndefined()
    expect(model.diffPreview.error).toBeUndefined()
    expect([...model.diffPreview.scopes]).toEqual([...VERSION_DIFF_SCOPES])
    expect(model.diffPreview.notice).toBe(REVIEW_NOTICE_DIFF_PREVIEW)
    // 作者向文案不再暴露端点路径；改为断言它讲清了「真实比对 / 不造假 / 失败即禁用」这三件事。
    expect(REVIEW_NOTICE_DIFF_PREVIEW.detail).toContain('真实比对')
    expect(REVIEW_NOTICE_DIFF_PREVIEW.detail).not.toContain('演示数据')
    expect(REVIEW_NOTICE_DIFF_PREVIEW.detail).toContain('恢复保持禁用')
  })

  it('受控恢复缺预览 → 结论恒为「预览缺失」，且不提供绕过预览的通道', () => {
    const model = buildVersionHistory(baseProject(), versions())
    expect(model.restore.state).toBe('预览缺失')
    expect(model.restore.previewVersionId).toBeUndefined()
    expect(model.restore.previewOnOtherSnapshot).toBe(false)
    expect(model.restore.saveState).toBeUndefined()
    expect(model.restore.notice).toBe(REVIEW_NOTICE_CONTROLLED_RESTORE)
    // 作者向文案保留三条前提与「对不上就拒绝」，但不暴露字段名（previewDigest 等留在源码注释里）。
    expect(REVIEW_NOTICE_CONTROLLED_RESTORE.detail).toContain('预览必须是当前选中这条快照的')
    expect(REVIEW_NOTICE_CONTROLLED_RESTORE.detail).toContain('对不上都会被拒绝')
    expect(REVIEW_NOTICE_CONTROLLED_RESTORE.detail).toContain('恢复前快照')
    // restore 结构里不得出现任何「已启用 / 可安全恢复」这类结论字段：只有状态与事实。
    expect(Object.keys(model.restore)).toEqual([
      'state',
      'saveState',
      'unsavedReason',
      'previewVersionId',
      'previewOnOtherSnapshot',
      'notice'
    ])
    expect(Object.keys(model.restore)).not.toContain('enabled')
  })

  it('命名检查点：作者可以自己命名，留空时落到 store 的默认名', () => {
    const model = buildVersionHistory(baseProject(), versions())
    // 自定义命名可用：store.createCheckpoint(reason?) 接收作者填写的名称。
    expect(model.namedCheckpoint.customNameEnabled).toBe(true)
    expect(model.namedCheckpoint.defaultReason).toBe(CHECKPOINT_DEFAULT_REASON)
    expect(model.namedCheckpoint.defaultReason).toBe('手动检查点')
    expect(model.namedCheckpoint.canCreate).toBe(true)
    expect(model.namedCheckpoint.notice).toBe(REVIEW_NOTICE_NAMED_CHECKPOINT)
    // 作者向文案：说清「名字会原样记进版本历史」与留空时的默认名，不暴露字段名。
    expect(REVIEW_NOTICE_NAMED_CHECKPOINT.detail).toContain('名字')
    expect(REVIEW_NOTICE_NAMED_CHECKPOINT.detail).toContain('手动检查点')
  })

  it('删除版本：真实逐条删除，条数等于真实快照数，不做批量', () => {
    const model = buildVersionHistory(baseProject(), versions())
    expect(model.remove.supported).toBe(true)
    expect(model.remove.canRemove).toBe(true)
    expect(model.remove.removableCount).toBe(2)
    expect(model.remove.notice).toBe(REVIEW_NOTICE_VERSION_REMOVE)
    expect(REVIEW_NOTICE_VERSION_REMOVE.detail).toContain('批量删除')
    // 删除不可逆这件事必须写明（store 的确认框文案同为「删除后无法恢复」）。
    expect(REVIEW_NOTICE_VERSION_REMOVE.detail).toContain('无法恢复')
    // 没有批量入口字段。
    expect(Object.keys(model.remove)).not.toContain('canRemoveAll')
  })

  it('空项目（有项目但无快照）：目录为空，但结构完整，不编造版本', () => {
    const model = buildVersionHistory(emptyProject(), [])
    expect(model.hasProject).toBe(true)
    expect(model.rows).toEqual([])
    expect(model.counts.total).toBe(0)
    expect(model.counts.atCurrent).toBe(0)
    expect(model.counts.oldestRevision).toBeUndefined()
    expect(model.counts.newestRevision).toBeUndefined()
    expect(model.current.chapterCount).toBe(0)
    expect(model.current.words).toBe(0)
    expect(model.current.snapshot).toBeUndefined()
    expect(model.current.latest).toBeUndefined()
    // 空项目仍可创建检查点；但没有快照就不可删除。
    expect(model.namedCheckpoint.canCreate).toBe(true)
    expect(model.remove.canRemove).toBe(false)
    expect(model.remove.removableCount).toBe(0)
    // 无论有无快照：预览能力已接通，但没有预览来源时状态是未预览、恢复是预览缺失。
    expect(model.diffPreview.connected).toBe(true)
    expect(model.diffPreview.status).toBe('未预览')
    expect(model.restore.state).toBe('预览缺失')
  })

  it('没有项目：不展示任何快照行，创建 / 删除全部禁用', () => {
    const model = buildVersionHistory(undefined, versions())
    expect(model.hasProject).toBe(false)
    expect(model.rows).toEqual([])
    expect(model.counts.total).toBe(0)
    expect(model.current.revision).toBe(0)
    expect(model.namedCheckpoint.canCreate).toBe(false)
    expect(model.namedCheckpoint.defaultReason).toBe(CHECKPOINT_DEFAULT_REASON)
    expect(model.remove.canRemove).toBe(false)
    expect(model.remove.removableCount).toBe(0)
    expect(model.restore.state).toBe('预览缺失')
    // 没有项目时 currentRevision 未知 → 传进来的预览也无法被判定为「可恢复」。
    expect(model.restore.saveState).toBeUndefined()
    expect(model.diffPreview.connected).toBe(true)
    expect(model.diffPreview.status).toBe('未预览')
  })

  it('预览有效：只有拿到契约通过的预览时才是「预览有效」，并给出真实差异条数', () => {
    const model = buildVersionHistory(baseProject(), versions(), {
      selectedVersionId: 'v-1',
      preview: previewFor('v-1'),
      previewState: '空闲',
      saveState: '已保存'
    })
    expect(model.diffPreview.status).toBe('预览有效')
    expect(model.diffPreview.error).toBeUndefined()
    expect(model.diffPreview.summary?.versionId).toBe('v-1')
    expect(model.diffPreview.summary?.currentRevision).toBe(12)
    expect(model.diffPreview.summary?.targetRevision).toBe(10)
    expect(model.diffPreview.summary?.totalDiffs).toBe(1)
    expect(model.diffPreview.summary?.scopes[0]).toEqual({
      scope: '正文',
      changed: 2,
      added: 1,
      removed: 0,
      sample: ['沈砚独自抵达回雁城。 → 沈砚在雾里抵达回雁城。']
    })
  })

  it('正在加载：不显示任何差异内容，也不构成可恢复', () => {
    const model = buildVersionHistory(baseProject(), versions(), {
      selectedVersionId: 'v-1',
      previewState: '正在加载',
      saveState: '已保存'
    })
    expect(model.diffPreview.status).toBe('正在加载')
    expect(model.diffPreview.summary).toBeUndefined()
    expect(model.diffPreview.error).toBeUndefined()
    expect(model.restore.state).toBe('预览缺失')
  })

  it('预览失败：把真实错误原样透出，且绝不给出任何差异内容', () => {
    const model = buildVersionHistory(baseProject(), versions(), {
      selectedVersionId: 'v-1',
      previewState: '预览失败',
      previewError: '网络中断：请求未送达服务端',
      saveState: '已保存'
    })
    expect(model.diffPreview.status).toBe('预览失败')
    expect(model.diffPreview.error).toBe('网络中断：请求未送达服务端')
    expect(model.diffPreview.summary).toBeUndefined()
    expect(model.restore.state).toBe('预览缺失')
  })

  it('safeParse 拒绝不符契约的预览：显示数据错误并禁用恢复，不用默认值伪装有效', () => {
    // scope 不在契约枚举里 —— 真实 HTTP 响应可能就是错的，模型必须自己收口。
    const badScope = buildVersionHistory(baseProject(), versions(), {
      selectedVersionId: 'v-1',
      preview: previewFor('v-1', { diffs: [{ scope: '不存在的范围', changed: 1, added: 0, removed: 0, sample: [] }] }),
      saveState: '已保存'
    })
    expect(badScope.diffPreview.status).toBe('预览失败')
    expect(badScope.diffPreview.summary).toBeUndefined()
    expect(badScope.diffPreview.error).toContain('格式不正确')
    expect(badScope.restore.state).toBe('预览缺失')
    expect(badScope.restore.previewVersionId).toBeUndefined()
    expect(badScope.restore.previewOnOtherSnapshot).toBe(false)

    // 缺 previewDigest 同样不能当有效预览 —— 否则恢复请求会带着空摘要提交。
    const noDigest = buildVersionHistory(baseProject(), versions(), {
      selectedVersionId: 'v-1',
      preview: previewFor('v-1', { previewDigest: '' }),
      saveState: '已保存'
    })
    expect(noDigest.diffPreview.status).toBe('预览失败')
    expect(noDigest.restore.state).toBe('预览缺失')
  })

  it('可恢复：预览属于选中快照、revision 对得上、当前稿已保存，三者同时成立才放行', () => {
    const model = buildVersionHistory(baseProject(), versions(), {
      selectedVersionId: 'v-1',
      preview: previewFor('v-1'),
      previewState: '空闲',
      saveState: '已保存'
    })
    expect(model.restore.state).toBe('可恢复')
    expect(model.restore.previewVersionId).toBe('v-1')
    expect(model.restore.previewOnOtherSnapshot).toBe(false)
    expect(model.restore.saveState).toBe('已保存')
    expect(model.restore.unsavedReason).toBeUndefined()
  })

  it('切换选中快照后旧预览立刻失效：不再属于选中快照，恢复回落到预览缺失', () => {
    // 预览是为 v-1 取的，现在选中 v-2 —— 必须重新预览，不能沿用旧结果。
    const switched = buildVersionHistory(baseProject(), versions(), {
      selectedVersionId: 'v-2',
      preview: previewFor('v-1'),
      saveState: '已保存'
    })
    expect(switched.restore.state).toBe('预览缺失')
    expect(switched.restore.previewOnOtherSnapshot).toBe(true)
    expect(switched.restore.previewVersionId).toBe('v-1')

    // 连选中都清空时同理：预览存在，但没有可归属的选中快照 → 同样视为无效。
    const cleared = buildVersionHistory(baseProject(), versions(), {
      selectedVersionId: undefined,
      preview: previewFor('v-1'),
      saveState: '已保存'
    })
    expect(cleared.restore.state).toBe('预览缺失')
    expect(cleared.restore.previewOnOtherSnapshot).toBe(true)
  })

  it('预览之后项目又被编辑：revision 前进即判定预览已过期', () => {
    // 预览取自 revision 12，但项目现在已是 13 —— 摘要不能再代表当前稿。
    const model = buildVersionHistory(projectAtRevision(13), versions(), {
      selectedVersionId: 'v-1',
      preview: previewFor('v-1'),
      saveState: '已保存'
    })
    expect(model.diffPreview.status).toBe('预览有效')
    expect(model.restore.state).toBe('预览已过期')

    // 预览自身记的 currentRevision 落后于项目，同样过期。
    const lagging = buildVersionHistory(baseProject(), versions(), {
      selectedVersionId: 'v-1',
      preview: previewFor('v-1', { currentRevision: 9 }),
      saveState: '已保存'
    })
    expect(lagging.restore.state).toBe('预览已过期')
  })

  it('保存中 / 未保存 / 保存状态未知，都不算安全可恢复', () => {
    const input = { selectedVersionId: 'v-1', preview: previewFor('v-1') }

    const saving = buildVersionHistory(baseProject(), versions(), { ...input, saveState: '正在保存' })
    expect(saving.restore.state).toBe('当前稿未保存')
    expect(saving.restore.saveState).toBe('正在保存')
    expect(saving.restore.unsavedReason).toContain('正在保存')

    const dirty = buildVersionHistory(baseProject(), versions(), { ...input, saveState: '未保存' })
    expect(dirty.restore.state).toBe('当前稿未保存')
    expect(dirty.restore.unsavedReason).toContain('未保存')

    // 关键：不传 saveState 绝不被当成「已保存」—— 未知就要拦住，不能乐观放行。
    const unknown = buildVersionHistory(baseProject(), versions(), input)
    expect(unknown.restore.saveState).toBeUndefined()
    expect(unknown.restore.state).toBe('当前稿未保存')
    expect(unknown.restore.unsavedReason).toContain('无法确认')
  })

  it('只有结论为「当前稿未保存」时才给保存相关的原因说明', () => {
    // 预览已过期（且稿子还在保存中）时，结论是过期 —— 不能再拿保存状态来解释，
    // 否则作者会以为「等保存完就能恢复」，而其实必须先重新预览。
    const expired = buildVersionHistory(projectAtRevision(13), versions(), {
      selectedVersionId: 'v-1',
      preview: previewFor('v-1'),
      saveState: '正在保存'
    })
    expect(expired.restore.state).toBe('预览已过期')
    expect(expired.restore.unsavedReason).toBeUndefined()
  })

  it('页面类型为 history，供 ReviewView 分派', () => {
    const model = buildVersionHistory(baseProject(), versions())
    expect(model.kind).toBe('history')
    expect(reviewPageKind('version-history')).toBe('history')
  })
})

// ================================================================ M9-3 · 作者主界面不出现开发词汇

describe('作者主界面文案 · 提示卡里不出现开发词汇', () => {
  const ALL_NOTICES = [
    REVIEW_NOTICE_RESOLUTION,
    REVIEW_NOTICE_CREATE,
    REVIEW_NOTICE_EXPORT_PREFLIGHT,
    REVIEW_NOTICE_CANDIDATE_GATE,
    REVIEW_NOTICE_BRANCH_ADOPT,
    REVIEW_NOTICE_BRANCH_FRESHNESS,
    REVIEW_NOTICE_DIFF_PREVIEW,
    REVIEW_NOTICE_CONTROLLED_RESTORE,
    REVIEW_NOTICE_NAMED_CHECKPOINT,
    REVIEW_NOTICE_VERSION_REMOVE
  ]

  it('十条提示卡全部有标题与说明，且 id 不重复', () => {
    expect(ALL_NOTICES).toHaveLength(10)
    for (const notice of ALL_NOTICES) {
      expect(notice.title.trim().length, notice.id).toBeGreaterThan(0)
      expect(notice.detail.trim().length, notice.id).toBeGreaterThan(20)
    }
    expect(new Set(ALL_NOTICES.map((notice) => notice.id)).size).toBe(ALL_NOTICES.length)
  })

  /**
   * 这些提示卡渲染在作者看得到的横幅里，只允许出现作者向说法。
   * 端点路径、请求方法、契约名、字段名一律留在源码注释与交接文档中。
   * 新增提示卡若带进这些词，本用例会直接失败 —— 作为 M9-3 的常驻守卫。
   */
  it.each(ALL_NOTICES.map((notice) => [notice.id, notice] as const))('%s 不含端点路径 / 请求方法 / 契约名 / 字段名', (_id, notice) => {
    const text = `${notice.title} ${notice.detail}`
    const forbidden: Array<[string, RegExp]> = [
      ['端点路径', /\/api\//],
      ['请求方法', /\b(GET|PUT|POST|DELETE|PATCH)\b/],
      ['契约名', /Schema|契约/],
      ['摘要字段名', /previewDigest|sourceDigest|currentRevision/],
      ['store / 函数名', /store\.|\w+\(\)\s*(→|->)/],
      ['命名空间 / 路由', /命名空间|专用路由|端点/],
      ['序列化 / 字段', /序列化|字段名/]
    ]
    for (const [label, pattern] of forbidden) {
      expect(text, `${notice.id} 命中「${label}」：${pattern}`).not.toMatch(pattern)
    }
  })

  it('安全说明必须保留：未保存 / 已保存前提与「不会自动改写正文」都在', () => {
    expect(REVIEW_NOTICE_CONTROLLED_RESTORE.detail).toContain('已经保存')
    expect(REVIEW_NOTICE_CONTROLLED_RESTORE.detail).toContain('还没保存完')
    expect(REVIEW_NOTICE_CREATE.detail).toContain('不会自动改写正文')
    expect(REVIEW_NOTICE_EXPORT_PREFLIGHT.detail).toContain('保存失败')
  })
})
