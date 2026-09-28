import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, ChevronUp, ListOrdered, PenLine, Plus, Target, Trash2, Wrench, X } from 'lucide-react'
import type { NovelProject } from '../../../../../../../packages/contracts/src'
import type { WorkspaceNavigationTarget } from '../../workspaceNavigation'
import { useNovelStore } from '../../../../novelStore'
import { Banner, Btn, EmptyState, Field, KV, Segmented, Tag } from '../../../ui/Primitives'
import { beatStatusTone, outlineCardStatusTone } from '../outline/OutlineFoundationPage'
import { buildChapterBeats, buildChapterDirectory, buildRollingOutline } from '../outline/outlineModel'
import { StructureEditPanel } from './StructureEditPanel'
import {
  BEAT_EDITABLE_FIELDS,
  applyAddBeat,
  applyAddChapterOutline,
  applyBeatFieldEdit,
  applyChapterOutlineFieldEdit,
  applyChapterReferenceEdit,
  applyConfirmBeats,
  applyCreateOutlineForBody,
  applyMoveBeat,
  applyRemoveBeat,
  type BeatEditableField,
  type ChapterOutlineEditableField,
  type ChapterReferenceKind,
  type IntegratedOutlineFocusId
} from './outlineIntegrationModel'

type ChapterMode = 'all' | 'nearby'

/** 章纲字段的界面标签；顺序与纯模型里的白名单一致。 */
const CHAPTER_FIELD_LABELS: Record<ChapterOutlineEditableField, string> = {
  title: '标题',
  pov: '视角',
  objective: '目标',
  conflict: '冲突',
  turningPoint: '转折',
  reveal: '揭示',
  endingHook: '结尾'
}

/** 步骤字段的界面标签。 */
const BEAT_FIELD_LABELS: Record<BeatEditableField, string> = {
  title: '步骤名',
  purpose: '目标',
  conflict: '冲突',
  outcome: '结果',
  location: '地点',
  timeframe: '时间',
  reveal: '揭示'
}

const LONG_FIELDS: ReadonlySet<string> = new Set(['objective', 'conflict', 'turningPoint', 'reveal', 'endingHook', 'purpose', 'outcome'])

/** 展示前按 id 去重（只影响渲染，不改写项目里的存值）。 */
function uniqueIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids))
}

/** 「本章引用」某一类关联的界面描述；`missingCount` 由基表算出，见组件内 `referenceGroups`。 */
type ChapterReferenceGroupBase = {
  kind: ChapterReferenceKind
  label: string
  addLabel: string
  testId: string
  /** 章纲上真实存下的 id（已去重）。 */
  selected: string[]
  /** 项目里已存在的可选对象；只从这里选，本模块不新建。 */
  options: Array<{ id: string; label: string }>
  /** id → 作者可见名称；查不到即失效引用，界面必须明确提示而不是静默清空。 */
  known: Map<string, string>
  missingText: string
  emptyText: string
  noCandidateShortText: string
  /** 项目里有候选项、但全部已经关联时的占位文案。 */
  allSelectedShortText: string
  noCandidateText: string
  jumpTitle: string
  target: (id: string) => WorkspaceNavigationTarget
}

type ChapterReferenceGroup = ChapterReferenceGroupBase & { missingCount: number }

/**
 * 模块 3/4 · 章节规划。
 *
 * 主从工作台：左侧是按卷筛选的章节列表，右侧是单章详情（章纲字段 + 剧情步骤）。
 *
 * M4 起本模块是**章纲与剧情步骤的唯一手写位置**，全部经纯 mutator 落到同一个保存通道
 * `updateProject → 900ms 防抖 → persistNow → revision`：
 *   - 章纲七字段（标题 / 视角 / 目标 / 冲突 / 转折 / 揭示 / 结尾）可手写；
 *   - 「本章引用」可就地维护章纲上的角色 / 伏笔关联（出场角色、计划埋设的伏笔、计划回收的伏笔），
 *     只写章纲的 id 数组，不把计划记成伏笔已经埋设或已经回收，也不写任何证据；
 *   - 剧情步骤可新增、改写、上下移、删除、确认；改动已确认的步骤会退回「待确认」并标记复核；
 *   - 「新建章节规划」只建立章纲并留在本模块，不创建正文；
 *   - 「开始写作」为选中章纲建立**唯一**正文，已有正文时改为「继续写作」走既有正文导航；
 *   - 正文没有章纲时提供「补建章纲」，只建立作者确认的空规划，不猜正文摘要。
 *
 * 结构性调整（调序 / 跨卷移动 / 删除 / 拆分 / 合并）必须由服务端给出影响摘要后再确认，
 * 因此不在本组件里直接改写大纲。导航类操作（筛选、折叠、选中）只改 React 局部状态。
 */
export function ChapterPlanningModule({
  project,
  focusId,
  selectedChapterId,
  outlineChapterId,
  onOpenChapterOutline,
  onOpenChapter,
  onStartWriting,
  onNavigate
}: {
  project: NovelProject
  focusId: IntegratedOutlineFocusId
  selectedChapterId?: string
  outlineChapterId?: string
  onOpenChapterOutline: (cardId: string) => void
  /** 进入正文的唯一入口：只有它才走既有正文导航；选中章纲不会自动跳正文。 */
  onOpenChapter?: (chapterId: string) => void
  /** 「开始写作」：为章纲建立唯一正文并进入正文；由工作区负责落库与导航。 */
  onStartWriting?: (cardId: string) => void
  /** 「本章引用」跳转：把作者送到拥有该条资料的栏目，不在本模块复制那些管理界面。 */
  onNavigate?: (target: WorkspaceNavigationTarget) => void
}): React.JSX.Element {
  const updateProject = useNovelStore((state) => state.updateProject)

  const directory = useMemo(() => buildChapterDirectory(project, selectedChapterId), [project, selectedChapterId])
  const rolling = useMemo(() => buildRollingOutline(project), [project])
  const allCards = useMemo(() => directory.volumes.flatMap((volume) => volume.chapters), [directory])

  const initialCardId = useMemo(() => {
    if (outlineChapterId && allCards.some((card) => card.cardId === outlineChapterId)) return outlineChapterId
    const bodyNumber = project.chapters.find((chapter) => chapter.id === selectedChapterId)?.chapterNumber
    const matched = allCards.find((card) => card.chapterNumber === bodyNumber)
    return matched?.cardId ?? allCards[0]?.cardId ?? ''
  }, [allCards, outlineChapterId, project.chapters, selectedChapterId])

  const [selectedCardId, setSelectedCardId] = useState(initialCardId)
  const [mode, setMode] = useState<ChapterMode>(focusId === 'nearby-chapters' ? 'nearby' : 'all')
  const [volumeFilter, setVolumeFilter] = useState<'all' | number>('all')
  const [stepsOpen, setStepsOpen] = useState(focusId === 'chapter-detail')
  /**
   * 结构调整默认收起：它是低频且带影响确认的操作，展开状态只属于本组件的局部状态，
   * 折叠本身不产生任何写请求。
   */
  const [structureOpen, setStructureOpen] = useState(focusId === 'structure')

  /**
   * 选中可能失效（例如结构变更删掉了当前章、或换到别的卷筛选）。
   * 这里回退到模块初始化时算出的目标卡，避免详情区停在「没有可展示的章纲」。
   */
  const activeCardId = allCards.some((item) => item.cardId === selectedCardId) ? selectedCardId : initialCardId

  const visibleCards = useMemo(() => {
    const scoped = volumeFilter === 'all' ? allCards : allCards.filter((card) => card.volumeNumber === volumeFilter)
    if (mode === 'all') return scoped
    const index = scoped.findIndex((card) => card.cardId === activeCardId)
    if (index < 0) return scoped.slice(0, 5)
    const start = Math.max(0, Math.min(index - 2, scoped.length - 5))
    return scoped.slice(start, start + 5)
  }, [activeCardId, allCards, mode, volumeFilter])

  const beats = useMemo(() => buildChapterBeats(project, activeCardId || undefined), [project, activeCardId])
  const card = beats.card
  /**
   * 步骤里的人名一律显示词条真名 —— 界面不把内部 id 渲染给作者。
   * 口径与 `memoryModel.ts:517` / `storylineWriting.ts:511` 一致：词条被删掉时才退回 id。
   */
  const entryNames = useMemo(
    () => new Map((project.worldBible?.entries ?? []).map((entry) => [entry.id, entry.name])),
    [project.worldBible?.entries]
  )

  /**
   * 本章引用：章纲上的角色 / 伏笔关联（`characterIds` / `setupThreadIds` / `payoffThreadIds`）。
   * 这三项由大纲与生成结果写入，之前在整个工作区都没有展示位置；章纲卡模型不含它们，
   * 所以这里按选中章 id 直接读项目里的原始章纲。
   *
   * 展示前按 id 去重：本模块的写通道不会产生重复引用，但旧数据或生成结果可能留下重复项，
   * 界面只显示一条（不改写存值，避免出现「同一名字出现两次」的假象）。
   */
  const rawCard = useMemo(
    () => (project.outline?.volumes ?? []).flatMap((volume) => volume.chapters).find((item) => item.id === activeCardId),
    [project.outline?.volumes, activeCardId]
  )
  const threadNames = useMemo(
    () => new Map((project.plotThreads ?? []).map((thread) => [thread.id, thread.title])),
    [project.plotThreads]
  )
  const referencedCharacters = uniqueIds(rawCard?.characterIds ?? [])
  const referencedSetupThreads = uniqueIds(rawCard?.setupThreadIds ?? [])
  const referencedPayoffThreads = uniqueIds(rawCard?.payoffThreadIds ?? [])

  /**
   * 「本章引用」三类关联的界面描述。候选池只取项目里**已经存在**的对象：
   * 角色取世界观里的「角色」词条，伏笔取伏笔台账；本模块不新建角色或伏笔。
   */
  const characterEntryOptions = (project.worldBible?.entries ?? [])
    .filter((entry) => entry.type === '角色')
    .map((entry) => ({ id: entry.id, label: entry.name }))
  const threadOptions = (project.plotThreads ?? []).map((thread) => ({ id: thread.id, label: thread.title }))

  const referenceGroupBase: ChapterReferenceGroupBase[] = [
    {
      kind: 'character',
      label: '出场角色',
      addLabel: '添加出场角色',
      testId: 'chapter-references-characters',
      selected: referencedCharacters,
      options: characterEntryOptions,
      known: entryNames,
      missingText: '这条角色关联指向的词条已不在世界观里，可以移除',
      emptyText: '这一章还没有关联角色。',
      noCandidateShortText: '世界观里还没有角色词条',
      allSelectedShortText: '角色已全部关联',
      noCandidateText: '世界观里还没有角色词条，先在「世界观 · 世界词条」建立，再回这里关联。',
      jumpTitle: '去「世界观 · 世界词条」查看这个名字的资料',
      target: (id) => ({ stageId: 'world', subnavId: 'world-entries', focusId: id })
    },
    {
      kind: 'setupThread',
      label: '计划埋设的伏笔',
      addLabel: '添加计划埋设的伏笔',
      testId: 'chapter-references-setup-threads',
      selected: referencedSetupThreads,
      options: threadOptions,
      known: threadNames,
      missingText: '这条伏笔关联指向的条目已不在伏笔里，可以移除',
      emptyText: '这一章还没有登记计划埋设的伏笔。',
      noCandidateShortText: '伏笔台账里还没有伏笔',
      allSelectedShortText: '伏笔已全部登记',
      noCandidateText: '伏笔台账里还没有伏笔，先在「记忆与伏笔 · 伏笔中心」建立，再回这里登记计划。',
      jumpTitle: '去「记忆与伏笔 · 伏笔中心」查看这条伏笔',
      target: (id) => ({ stageId: 'memory', subnavId: 'foreshadowing', focusId: id })
    },
    {
      kind: 'payoffThread',
      label: '计划回收的伏笔',
      addLabel: '添加计划回收的伏笔',
      testId: 'chapter-references-payoff-threads',
      selected: referencedPayoffThreads,
      options: threadOptions,
      known: threadNames,
      missingText: '这条伏笔关联指向的条目已不在伏笔里，可以移除',
      emptyText: '这一章还没有登记计划回收的伏笔。',
      noCandidateShortText: '伏笔台账里还没有伏笔',
      allSelectedShortText: '伏笔已全部登记',
      noCandidateText: '伏笔台账里还没有伏笔，先在「记忆与伏笔 · 伏笔中心」建立，再回这里登记计划。',
      jumpTitle: '去「记忆与伏笔 · 伏笔中心」查看这条伏笔',
      target: (id) => ({ stageId: 'memory', subnavId: 'foreshadowing', focusId: id })
    }
  ]

  const referenceGroups: ChapterReferenceGroup[] = referenceGroupBase.map((group) => ({
    ...group,
    missingCount: group.selected.filter((id) => !group.known.has(id)).length
  }))
  /** 章纲对应的正文；没有正文时不显示「进入正文」，避免给出走到空页的入口。 */
  const bodyChapter = card
    ? project.chapters.find((chapter) => chapter.chapterNumber === card.chapterNumber)
    : undefined

  /* ---------- 写通道：全部经纯 mutator，只改授权字段 ---------- */

  function addChapterOutline(): void {
    const id = `oc-${Date.now().toString(36)}`
    const volumeNumber = volumeFilter === 'all' ? undefined : volumeFilter
    updateProject((draft) => {
      applyAddChapterOutline(draft, volumeNumber === undefined ? {} : { volumeNumber }, new Date().toISOString(), id)
    })
    setSelectedCardId(id)
  }

  function editChapterField(field: ChapterOutlineEditableField, value: string): void {
    if (!card) return
    updateProject((draft) => {
      applyChapterOutlineFieldEdit(draft, card.cardId, field, value, new Date().toISOString())
    })
  }

  function addBeat(): void {
    if (!card) return
    const id = `beat-${Date.now().toString(36)}`
    updateProject((draft) => {
      applyAddBeat(draft, card.cardId, new Date().toISOString(), id)
    })
    setStepsOpen(true)
  }

  function editBeat(beatId: string, field: BeatEditableField, value: string): void {
    if (!card) return
    updateProject((draft) => {
      applyBeatFieldEdit(draft, card.cardId, beatId, field, value, new Date().toISOString())
    })
  }

  function moveBeat(beatId: string, direction: 'up' | 'down'): void {
    if (!card) return
    updateProject((draft) => {
      applyMoveBeat(draft, card.cardId, beatId, direction, new Date().toISOString())
    })
  }

  function removeBeat(beatId: string): void {
    if (!card) return
    updateProject((draft) => {
      applyRemoveBeat(draft, card.cardId, beatId, new Date().toISOString())
    })
  }

  function confirmBeats(): void {
    if (!card) return
    updateProject((draft) => {
      applyConfirmBeats(draft, card.cardId, new Date().toISOString())
    })
  }

  function createOutlineForBody(bodyChapterId: string): void {
    // 补建的章纲沿用该正文的稳定身份，补完之后两者按身份关联，以后调整结构也不串章。
    updateProject((draft) => {
      applyCreateOutlineForBody(draft, bodyChapterId, new Date().toISOString())
    })
  }

  /**
   * 选择 / 移除一条章纲引用。只写章纲上那一个 id 数组：不把「计划埋设 / 计划回收」
   * 记成伏笔已经埋设或已经回收，也不写任何证据；角色与伏笔本体在任何情况下都不会被删除。
   */
  function editReference(kind: ChapterReferenceKind, referenceId: string, selected: boolean): void {
    if (!card) return
    updateProject((draft) => {
      applyChapterReferenceEdit(draft, card.cardId, kind, referenceId, selected, new Date().toISOString())
    })
  }

  const pending = beats.findings.filter((finding) => finding.status === '待处理')

  if (directory.volumes.length === 0) {
    return (
      <EmptyState
        icon={ListOrdered}
        title="还没有章节目录"
        description="大纲里没有卷章结构，因此没有可规划的章节。先在「总纲与卷纲」建立卷与章节。"
      />
    )
  }

  return (
    <>
      {directory.bodyWithoutCard.length > 0 && (
        <Banner tone="warn" title={`有 ${directory.bodyWithoutCard.length} 章正文没有对应章纲`}>
          {directory.bodyWithoutCard.map((chapter) => `第 ${chapter.chapterNumber} 章《${chapter.title}》`).join('、')}
          {' '}不在章纲结构中。可以在这里补建一张空的章纲卡，再自行填写规划；本操作不会读取或改写正文内容。
          <div className="mjp-row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
            {directory.bodyWithoutCard.map((chapter) => (
              <Btn key={chapter.chapterId} size="sm" icon={Plus} onClick={() => createOutlineForBody(chapter.chapterId)}>
                为第 {chapter.chapterNumber} 章补建章纲
              </Btn>
            ))}
          </div>
        </Banner>
      )}

      {rolling.connected && rolling.window ? (
        <div className="mjp-window">
          <KV label="已保存的近期规划窗口" value={`第 ${rolling.window.detailStartChapterNumber} – ${rolling.window.detailEndChapterNumber} 章`} mono />
          <KV label="窗口当前章" value={`第 ${rolling.window.currentChapterNumber} 章`} mono />
          <KV label="窗口大小" value={`${rolling.window.windowSize} 章`} mono />
          <KV label="窗口记录时间" value={rolling.window.updatedAt} mono />
        </div>
      ) : (
        <p className="mjp-oi-note">
          尚未设置近期规划窗口。「当前附近5章」仅用于浏览所选章节前后内容，不会改变章节规划。
        </p>
      )}

      <div className="mjp-oi-plan-wrap">
        <div className="mjp-oi-plan">
        <aside className="mjp-oi-plan-list">
          <div className="mjp-oi-toolbar">
            <select
              className="mjp-select"
              aria-label="按卷筛选章节"
              value={String(volumeFilter)}
              onChange={(event) => setVolumeFilter(event.target.value === 'all' ? 'all' : Number(event.target.value))}
            >
              <option value="all">全部卷</option>
              {directory.volumes.map((volume) => (
                <option key={volume.id} value={volume.volumeNumber}>第{volume.volumeNumber}卷 · {volume.title}</option>
              ))}
            </select>
            <Segmented
              value={mode}
              options={[
                { value: 'all', label: '全部章节' },
                { value: 'nearby', label: '当前附近 5 章' }
              ]}
              onChange={setMode}
            />
          </div>

          <div className="mjp-oi-toolbar">
            <Btn size="sm" icon={Plus} onClick={addChapterOutline} title="只建立一张空的章纲卡，不创建正文">
              新建章节规划
            </Btn>
          </div>

          <div className="mjp-oi-cards">
            {visibleCards.length === 0 ? (
              <p className="mjp-oi-empty">当前筛选下没有章纲。</p>
            ) : (
              visibleCards.map((item) => (
                <button
                  key={item.cardId}
                  type="button"
                  className={`mjp-oi-item${item.cardId === activeCardId ? ' is-active' : ''}`}
                  title={`查看第 ${item.chapterNumber} 章的章纲详情（只切换本页选中，不修改任何字段）`}
                  onClick={() => setSelectedCardId(item.cardId)}
                >
                  <span className="no">{item.chapterNumber}</span>
                  <span className="ti">
                    <span className="nm">{item.title || `第${item.chapterNumber}章`}</span>
                    <span className="sub">
                      {item.downstreamPending ? '上游变更待复核 · ' : ''}
                      {item.hasBody ? `正文：${item.bodyStatus} · ${item.words.toLocaleString()} 字` : '尚未写正文'}
                    </span>
                  </span>
                  <span className="tags">
                    <Tag tone={outlineCardStatusTone(item.cardStatus)}>{item.cardStatus}</Tag>
                    <Tag tone={beatStatusTone(item.beatStatus)}>{item.beatStatus}</Tag>
                  </span>
                </button>
              ))
            )}
          </div>

          <p className="mjp-oi-empty">
            共 {directory.totalCards} 张章纲 · {directory.totalBodies} 章正文。
            {mode === 'nearby' ? ' 当前显示的是选中章附近的 5 章。' : ''}
          </p>
        </aside>

        <section className="mjp-oi-plan-detail">
          {!card ? (
            <EmptyState
              icon={Target}
              title="没有可展示的章纲"
              description={beats.targetNotice ?? '请先在左侧选择一个章节。'}
            />
          ) : (
            <>
              <div className="mjp-beats-head">
                <div>
                  <div className="tt">第 {card.chapterNumber} 章 · {card.title || '未命名'}</div>
                  <div className="meta">
                    <Tag tone={beatStatusTone(card.beatStatus)} dot>{card.beatStatus}</Tag>
                    <Tag tone="outline">{card.cardStatus}</Tag>
                    <span className="mjp-muted">
                      {card.beatCount} 个步骤 · {card.hasBody ? `正文：${card.bodyStatus} · ${card.words.toLocaleString()} 字` : '尚未开始写作'}
                    </span>
                  </div>
                </div>
                <div className="acts">
                  <Btn size="sm" variant="ghost" onClick={() => onOpenChapterOutline(card.cardId)}>在目录中定位</Btn>
                  {bodyChapter ? (
                    <Btn
                      size="sm"
                      icon={PenLine}
                      onClick={() => onOpenChapter?.(bodyChapter.id)}
                      title={`第 ${card.chapterNumber} 章已有正文，继续写作`}
                    >
                      继续写作
                    </Btn>
                  ) : (
                    <Btn
                      size="sm"
                      variant="primary"
                      icon={PenLine}
                      disabled={!onStartWriting}
                      onClick={() => onStartWriting?.(card.cardId)}
                      title={`为第 ${card.chapterNumber} 章建立唯一正文并进入写作`}
                    >
                      开始写作
                    </Btn>
                  )}
                </div>
              </div>

              {card.downstreamPending && (
                <Banner tone="warn" title="这一章标记了待复核">
                  {card.downstreamReason ?? '本章的上游规划或剧情步骤在确认之后发生变化，请重新核对章纲与步骤。'}
                </Banner>
              )}

              <div className="mjp-sec-h">章纲</div>
              <div className="mjp-grid-2">
                <Field label={CHAPTER_FIELD_LABELS.title} hint="章标题；留空即为空，不会自动补默认名。">
                  <input
                    className="mjp-input"
                    type="text"
                    maxLength={240}
                    aria-label="章节标题"
                    value={card.title}
                    onChange={(event) => editChapterField('title', event.target.value)}
                  />
                </Field>
                <Field label={CHAPTER_FIELD_LABELS.pov} hint="本章的叙事视角。">
                  <input
                    className="mjp-input"
                    type="text"
                    maxLength={240}
                    aria-label="叙事视角"
                    value={card.pov}
                    onChange={(event) => editChapterField('pov', event.target.value)}
                  />
                </Field>
              </div>
              <div className="mjp-grid-2" style={{ marginTop: 12 }}>
                {(['objective', 'conflict', 'turningPoint', 'reveal', 'endingHook'] as ChapterOutlineEditableField[]).map((field) => (
                  <Field key={field} label={CHAPTER_FIELD_LABELS[field]} hint="只影响章纲规划，不会自动改写正文。">
                    <textarea
                      className="mjp-textarea"
                      rows={3}
                      maxLength={2_000}
                      aria-label={CHAPTER_FIELD_LABELS[field]}
                      value={card[field]}
                      onChange={(event) => editChapterField(field, event.target.value)}
                    />
                  </Field>
                ))}
              </div>

              {/**
               * 本章引用：把章纲上的角色 / 伏笔关联集中展示并就地维护在**这一处**。
               *
               * 这里维护的是**章纲计划**：勾选「计划埋设 / 计划回收」只登记本章的打算，
               * 不会把伏笔改成「已埋设 / 已回收」，也不会替它写任何证据；正文与伏笔的实际状态
               * 仍在「记忆与伏笔」里维护。候选只取项目里已经存在的角色词条与伏笔，本模块不新建，
               * 也不复制那两处的管理界面。关联为空时如实写空，不铺占位假数据。
               */}
              <section className="mjp-oi-refs" data-testid="chapter-references">
                <div className="mjp-sec-h">
                  本章引用
                  <span className="idx">
                    角色 {referencedCharacters.length} · 计划埋设 {referencedSetupThreads.length} · 计划回收 {referencedPayoffThreads.length}
                  </span>
                </div>
                <p className="mjp-muted">
                  这里维护的是本章的计划：选中的「计划埋设 / 计划回收」只是登记这一章的打算，
                  不会把伏笔改成已经埋设或已经回收，也不会替它写证据；伏笔本身的状态仍在「记忆与伏笔」里维护。
                  条目的名字可以点开，跳到拥有它的栏目去看那条资料本身。
                </p>

                {referenceGroups.map((group) => {
                  const available = group.options.filter((option) => !group.selected.includes(option.id))
                  return (
                    <div className="mjp-oi-refgroup" key={group.kind} data-testid={group.testId}>
                      <div className="mjp-oi-refhead">
                        <span className="lbl">{group.label}</span>
                        <select
                          className="mjp-select mjp-oi-refadd"
                          aria-label={group.addLabel}
                          value=""
                          disabled={available.length === 0}
                          onChange={(event) => {
                            if (event.target.value) editReference(group.kind, event.target.value, true)
                          }}
                        >
                          <option value="">{group.options.length === 0 ? group.noCandidateShortText : available.length === 0 ? group.allSelectedShortText : '选择已有对象…'}</option>
                          {available.map((option) => (
                            <option key={option.id} value={option.id}>{option.label}</option>
                          ))}
                        </select>
                      </div>

                      <div className="tags">
                        {group.selected.length === 0 ? (
                          <span className="mjp-oi-empty">{group.emptyText}</span>
                        ) : (
                          group.selected.map((id) => {
                            const label = group.known.get(id)
                            return (
                              <span className="mjp-ref-item" key={id}>
                                {label ? (
                                  <button
                                    type="button"
                                    className="mjp-ref-chip"
                                    title={group.jumpTitle}
                                    data-testid={`chapter-ref-${group.kind}-${id}`}
                                    onClick={() => onNavigate?.(group.target(id))}
                                  >
                                    {label}
                                  </button>
                                ) : (
                                  <span
                                    className="mjp-ref-chip is-missing"
                                    title={group.missingText}
                                    data-testid={`chapter-ref-missing-${group.kind}-${id}`}
                                  >
                                    已失效引用
                                  </span>
                                )}
                                <button
                                  type="button"
                                  className="mjp-ref-x"
                                  aria-label={label ? `移除${group.label}：${label}` : `移除一条已失效的${group.label}引用`}
                                  title="只解除本章与它的关联，不会删除这条资料本身"
                                  data-testid={`chapter-ref-remove-${group.kind}-${id}`}
                                  onClick={() => editReference(group.kind, id, false)}
                                >
                                  <X size={12} strokeWidth={2.2} aria-hidden="true" />
                                </button>
                              </span>
                            )
                          })
                        )}
                      </div>

                      {group.missingCount > 0 && (
                        <p className="mjp-oi-refwarn" data-testid={`chapter-ref-warning-${group.kind}`}>
                          有 {group.missingCount} 条关联指向的资料已经不在项目里（名字显示为「已失效引用」）。
                          它们不会自动消失，需要逐条点右侧的移除按钮处理。
                        </p>
                      )}
                      {group.options.length === 0 && (
                        <p className="mjp-oi-empty">{group.noCandidateText}</p>
                      )}
                    </div>
                  )
                })}
              </section>

              <section className={`mjp-oi-fold${stepsOpen ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="mjp-oi-fold-h"
                  aria-expanded={stepsOpen}
                  onClick={() => setStepsOpen((previous) => !previous)}
                >
                  <ChevronRight className="chev" size={16} strokeWidth={1.8} aria-hidden="true" />
                  剧情步骤
                  <span className="idx">{beats.beats.length} 步 · 状态：{beats.beatStatus ?? '未记录'}</span>
                </button>
                {stepsOpen && (
                  <div className="mjp-oi-fold-b">
                    {beats.beats.length === 0 ? (
                      <p className="mjp-oi-empty">
                        这一章还没有剧情步骤。点「新增步骤」自己写第一步；本模块不会自动生成步骤。
                      </p>
                    ) : (
                      <div className="mjp-beats">
                        {beats.beats.map((beat, index) => (
                          <article key={beat.id} className="mjp-beat">
                            <div className="ord" aria-hidden="true">{beat.order}</div>
                            <div className="bd">
                              <div className="mjp-grid-2">
                                {BEAT_EDITABLE_FIELDS.map((field) => (
                                  <Field key={field} label={BEAT_FIELD_LABELS[field]} hint="改动已确认的步骤会退回「待确认」。">
                                    {LONG_FIELDS.has(field) ? (
                                      <textarea
                                        className="mjp-textarea"
                                        rows={2}
                                        maxLength={2_000}
                                        aria-label={`第${beat.order}步 ${BEAT_FIELD_LABELS[field]}`}
                                        value={beat[field]}
                                        onChange={(event) => editBeat(beat.id, field, event.target.value)}
                                      />
                                    ) : (
                                      <input
                                        className="mjp-input"
                                        type="text"
                                        maxLength={500}
                                        aria-label={`第${beat.order}步 ${BEAT_FIELD_LABELS[field]}`}
                                        value={beat[field]}
                                        onChange={(event) => editBeat(beat.id, field, event.target.value)}
                                      />
                                    )}
                                  </Field>
                                ))}
                              </div>
                              {(beat.characterIds.length > 0 || beat.threadActions.length > 0) && (
                                <div className="tags" style={{ marginTop: 8 }}>
                                  {beat.characterIds.map((id) => <Tag key={`c-${id}`} tone="outline">人物：{entryNames.get(id) || id}</Tag>)}
                                  {beat.threadActions.map((action) => <Tag key={`t-${action}`} tone="outline">伏笔：{action}</Tag>)}
                                </div>
                              )}
                              <div className="mjp-row" style={{ marginTop: 8, gap: 8 }}>
                                <Btn size="sm" icon={ChevronUp} disabled={index === 0} onClick={() => moveBeat(beat.id, 'up')} aria-label={`第${beat.order}步上移`}>
                                  上移
                                </Btn>
                                <Btn size="sm" icon={ChevronDown} disabled={index === beats.beats.length - 1} onClick={() => moveBeat(beat.id, 'down')} aria-label={`第${beat.order}步下移`}>
                                  下移
                                </Btn>
                                <Btn size="sm" variant="danger" icon={Trash2} onClick={() => removeBeat(beat.id)} aria-label={`删除第${beat.order}步`}>
                                  删除
                                </Btn>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                    <div className="mjp-row" style={{ marginTop: 12, gap: 8 }}>
                      <Btn size="sm" icon={Plus} onClick={addBeat}>新增步骤</Btn>
                      <Btn
                        size="sm"
                        variant="primary"
                        disabled={beats.beats.length === 0 || beats.beatStatus === '已确认'}
                        onClick={confirmBeats}
                        title={beats.beats.length === 0 ? '还没有步骤，先新增一个再确认' : beats.beatStatus === '已确认' ? '当前步骤已经是「已确认」' : '确认本章剧情步骤'}
                      >
                        确认步骤
                      </Btn>
                    </div>
                  </div>
                )}
              </section>

              <section className="mjp-oi-fold">
                <button
                  type="button"
                  className="mjp-oi-fold-h"
                  aria-expanded={structureOpen}
                  onClick={() => setStructureOpen((previous) => !previous)}
                >
                  <ChevronRight className="chev" size={16} strokeWidth={1.8} aria-hidden="true" />
                  结构编织师
                  <span className="idx">
                    <Wrench size={13} strokeWidth={1.8} aria-hidden="true" /> 调序 / 跨卷移动 / 删除 / 拆分 / 合并
                  </span>
                </button>
                {structureOpen && (
                  <div className="mjp-oi-fold-b">
                    <StructureEditPanel project={project} selectedCardId={card.cardId} />
                  </div>
                )}
              </section>

              <div className="mjp-sec-h" style={{ marginTop: 18 }}>
                剧情步骤建议
                <span className="idx">{pending.length} 条待处理 / 共 {beats.findings.length} 条</span>
              </div>

              {beats.findings.length === 0 ? (
                <p className="mjp-muted">这一章没有保存剧情步骤建议。</p>
              ) : (
                beats.findings.map((finding) => (
                  <div
                    key={finding.id}
                    className={`mjp-issue${finding.severity === '高' ? ' is-danger' : finding.severity === '中' ? ' is-warn' : ' is-ok'}`}
                  >
                    <div className="mjp-issue-h">
                      <AlertTriangle size={15} strokeWidth={1.8} aria-hidden="true" />
                      <span className="tt">{finding.category}</span>
                      <Tag tone={finding.status === '待处理' ? 'amber' : 'default'}>{finding.status}</Tag>
                      <span className="loc">严重度 {finding.severity}</span>
                    </div>
                    <div className="mjp-issue-b">
                      {finding.message}
                      {finding.suggestion && <blockquote>{finding.suggestion}</blockquote>}
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </section>
        </div>
      </div>
    </>
  )
}
