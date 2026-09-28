import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ChevronRight, Lightbulb, Sparkles } from 'lucide-react'
import { StoryDirectionCandidateSchema, WritingSpecsCandidateSchema, type NovelProject, type NovelRevisionProposal } from '../../../../../../../packages/contracts/src'
import { useNovelStore } from '../../../../novelStore'
import type { WorkspaceNavigationTarget } from '../../workspaceNavigation'
import { Banner, Btn, Card, Field, KV, Tag } from '../../../ui/Primitives'
import {
  GENRE_TEMPLATE_OPTIONS,
  POINT_OF_VIEW_OPTIONS,
  RHETORIC_LEVEL_OPTIONS,
  TENSE_OPTIONS,
  buildDirectionCards,
  buildStorySeed,
  buildWritingSpecs
} from '../idea/ideaModel'
import {
  INTEGRATED_OUTLINE_CANONICAL_TARGETS,
  applyActiveDirectionCardEdit,
  applyDirectionAnswerEdit,
  applyCreateBlankOutline,
  applySeedEdit,
  applySettingEdit,
  canEnterOutline,
  type IntegratedOutlineFocusId
} from './outlineIntegrationModel'

/**
 * 模块 1/4 · 创作起点。
 *
 * 首屏突出故事种子和进入大纲；当前方向与创作规格各以一行状态进入详情。
 * 两个详情区由 `focusId` 决定初始是否展开；
 * 展开与收起只改本组件的 React 局部状态，不调用 `updateProject`。
 *
 * 本模块是「创作起点」三类已启用写入的唯一位置，全部经纯 mutator 落到同一个保存通道
 * `updateProject → 900ms 防抖 → persistNow → revision`：
 *   1. 故事种子 → `seed`；
 *   2. 方向卡「当前采用 / 取消采用」→ `activeDirectionCardId`；
 *   3. 创作规格 → `settings` 的单个字段（越界整数不写，失焦回真实值）。
 * 摘要区一律只读，不绑定 `onChange`，避免同一字段出现两条修改路径。
 *
 * 去重说明：术语与边界的查看与状态管理**只在世界观「规则与边界」**，
 * 本模块不再重复出现，也不再写入 `worldConstraints`（数据不迁移、不删除）。
 */
type FoldId = 'directions' | 'specs'

function Fold({
  id,
  title,
  summary,
  open,
  onToggle,
  children
}: {
  id: FoldId
  title: string
  summary: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className={`mjp-oi-fold mjp-oi-start-fold${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="mjp-oi-fold-h"
        aria-expanded={open}
        aria-controls={`mjp-oi-fold-${id}`}
        onClick={onToggle}
      >
        <ChevronRight className="chev" size={16} strokeWidth={1.8} aria-hidden="true" />
        <span className="mjp-oi-fold-title">{title}</span>
        <span className="idx" title={summary}>{summary}</span>
      </button>
      {open && <div className="mjp-oi-fold-b" id={`mjp-oi-fold-${id}`}>{children}</div>}
    </section>
  )
}

/**
 * 数字输入：本地保留输入文本，只有落在契约允许区间内的整数才写入。
 * 越界输入不写入、失焦时回退到真实值，并如实展示允许区间 —— 与「创作规格」原页一致。
 */
function NumberField({
  label,
  value,
  min,
  max,
  unit,
  onCommit
}: {
  label: string
  value: number
  min: number
  max: number
  unit?: string
  onCommit: (next: number) => void
}): React.JSX.Element {
  const [text, setText] = useState(String(value))

  useEffect(() => {
    setText(String(value))
  }, [value])

  const parsed = Number(text)
  const valid = Number.isInteger(parsed) && parsed >= min && parsed <= max

  return (
    <Field
      label={label}
      hint={valid ? `允许区间 ${min.toLocaleString()} – ${max.toLocaleString()}${unit ? ` ${unit}` : ''}` : `必须是不小于 ${min} 且不大于 ${max} 的整数`}
      tone={valid ? undefined : 'warn'}
    >
      <input
        className="mjp-input"
        type="number"
        min={min}
        max={max}
        value={text}
        aria-label={label}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          const parsedNext = Number(next)
          if (Number.isInteger(parsedNext) && parsedNext >= min && parsedNext <= max) onCommit(parsedNext)
        }}
        onBlur={() => {
          if (!valid) setText(String(value))
        }}
      />
    </Field>
  )
}

function DirectionProposal({ proposal, busy, onSave, onApply, onReject }: {
  proposal: NovelRevisionProposal
  busy: boolean
  onSave: (id: string, candidate: unknown) => Promise<boolean>
  onApply: (id: string) => Promise<void>
  onReject: (id: string) => Promise<void>
}): React.JSX.Element {
  const parsed = StoryDirectionCandidateSchema.safeParse(proposal.candidate)
  const [candidate, setCandidate] = useState(() => parsed.success ? parsed.data : undefined)
  const [saving, setSaving] = useState(false)
  const [changed, setChanged] = useState(false)
  if (!candidate) return <Banner tone="warn" title="方向卡候选无法读取">这条候选格式不完整，请放弃后重新生成。</Banner>
  const editCard = (index: number, field: 'title' | 'premise', value: string): void => {
    setCandidate((current) => current && { ...current, cards: current.cards.map((card, cardIndex) => cardIndex === index ? { ...card, [field]: value, ...(field === 'premise' ? { logline: value } : {}) } : card) })
    setChanged(true)
  }
  const save = async (): Promise<boolean> => {
    if (!StoryDirectionCandidateSchema.safeParse(candidate).success) return false
    setSaving(true)
    try { const saved = await onSave(proposal.id, candidate); if (saved) setChanged(false); return saved }
    finally { setSaving(false) }
  }
  return <Card title={`待确认：${proposal.summary}`} tight>
    {proposal.status === '已冲突' && <p className="mjp-hint is-warn">项目内容已变化，应用前需要再次确认。</p>}
    {candidate.cards.map((card, index) => <div className="mjp-oi-term" key={card.id}>
      <Field label={`方向 ${index + 1} 名称`}><input className="mjp-input" value={card.title} maxLength={160} onChange={(event) => editCard(index, 'title', event.target.value)} /></Field>
      <Field label="一句话故事"><textarea className="mjp-textarea" rows={2} value={card.premise} maxLength={2000} onChange={(event) => editCard(index, 'premise', event.target.value)} /></Field>
    </div>)}
    <div className="mjp-row" style={{ gap: 8, marginTop: 10 }}>
      <Btn size="sm" disabled={busy || saving || !changed || candidate.cards.some((card) => !card.title.trim())} onClick={() => { void save() }}>保存候选修改</Btn>
      <Btn size="sm" variant="primary" disabled={busy || saving || candidate.cards.some((card) => !card.title.trim())} onClick={() => { void (async () => { if (changed && !(await save())) return; await onApply(proposal.id) })() }}>确认加入方向卡</Btn>
      <Btn size="sm" disabled={busy || saving} onClick={() => { void onReject(proposal.id) }}>放弃候选</Btn>
    </div>
  </Card>
}

function WritingSpecsProposal({ proposal, project, busy, onApply, onReject }: {
  proposal: NovelRevisionProposal
  project: NovelProject
  busy: boolean
  onApply: (id: string) => Promise<void>
  onReject: (id: string) => Promise<void>
}): React.JSX.Element {
  const parsed = WritingSpecsCandidateSchema.safeParse(proposal.candidate)
  if (!parsed.success) return <Banner tone="warn" title="规格候选无法读取">请放弃这条候选并重新生成。</Banner>
  const labels: Record<keyof typeof parsed.data, string> = {
    genreTemplate: '题材模板', targetWords: '目标字数', plannedVolumes: '预计卷数', plannedChapters: '预计章节',
    pointOfView: '叙事视角', tense: '叙述时态', audience: '目标读者', style: '语言与文风', contentLimits: '创作内容限制', rhetoricIntensity: '修辞强度'
  }
  const changes = (Object.keys(labels) as Array<keyof typeof parsed.data>).filter((key) => parsed.data[key] !== project.settings[key])
  return <Card title="待确认的创作规格建议" tight>
    {changes.length ? <div className="mjp-grid-2">{changes.map((key) => <KV key={key} label={labels[key]} value={`${String(project.settings[key]) || '未填写'} → ${String(parsed.data[key]) || '未填写'}`} />)}</div> : <p className="mjp-muted">建议与当前规格一致，无需应用。</p>}
    {proposal.status === '已冲突' && <p className="mjp-hint is-warn">项目内容已变化，应用前需要再次确认。</p>}
    <div className="mjp-row" style={{ gap: 8, marginTop: 10 }}>
      <Btn size="sm" variant="primary" disabled={busy || !changes.length} onClick={() => { void onApply(proposal.id) }}>确认应用</Btn>
      <Btn size="sm" disabled={busy} onClick={() => { void onReject(proposal.id) }}>放弃建议</Btn>
    </div>
  </Card>
}

export function CreationStartModule({
  project,
  focusId,
  onNavigate
}: {
  project: NovelProject
  focusId: IntegratedOutlineFocusId
  onNavigate: (target: WorkspaceNavigationTarget) => void
}): React.JSX.Element {
  const updateProject = useNovelStore((state) => state.updateProject)
  const generate = useNovelStore((state) => state.generate)
  const revisions = useNovelStore((state) => state.revisions)
  const applyRevision = useNovelStore((state) => state.applyRevision)
  const rejectRevision = useNovelStore((state) => state.rejectRevision)
  const updateRevision = useNovelStore((state) => state.updateRevision)
  const busy = useNovelStore((state) => state.busy)
  const [newCardTitle, setNewCardTitle] = useState('')
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([])
  const directionProposals = revisions.filter((item) => item.target === 'directionCards' && (item.status === '待处理' || item.status === '已冲突'))

  const seed = useMemo(() => buildStorySeed(project), [project])
  const directions = useMemo(() => buildDirectionCards(project), [project])
  const specs = useMemo(() => buildWritingSpecs(project), [project])

  const [openFolds, setOpenFolds] = useState<Record<FoldId, boolean>>(() => ({
    directions: focusId === 'directions',
    specs: focusId === 'specs'
  }))
  const toggleFold = (id: FoldId): void => setOpenFolds((previous) => ({ ...previous, [id]: !previous[id] }))

  const canEnter = canEnterOutline(project)
  const hasOutline = Boolean(project.outline)

  /**
   * 首次建立初步大纲：契约完整、内容全空的空白大纲。
   * 故事种子只在这一步是硬条件；大纲已存在时本模块不再拦路。
   */
  function createBlankOutline(): void {
    updateProject((draft) => {
      applyCreateBlankOutline(draft, new Date().toISOString())
    })
    onNavigate(INTEGRATED_OUTLINE_CANONICAL_TARGETS['outline-volumes'])
  }

  /* ---------- 三类已启用写入（全部经纯 mutator，只改授权字段） ---------- */

  function editSeed(value: string): void {
    updateProject((draft) => {
      applySeedEdit(draft, value)
    })
  }

  function setActiveCard(cardId: string | undefined): void {
    updateProject((draft) => {
      applyActiveDirectionCardEdit(draft, cardId)
      draft.directionCards?.forEach((card) => {
        if (card.id === cardId) card.status = '已采用'
        else if (card.status === '已采用') card.status = '候选'
      })
    })
  }

  function addCard(): void {
    const title = newCardTitle.trim()
    if (!title || (project.directionCards?.length ?? 0) >= 30) return
    updateProject((draft) => {
      draft.directionCards ??= []
      draft.directionCards.push({ id: crypto.randomUUID(), version: 1, title, premise: '', protagonistHook: '', coreConflict: '', emotionalPromise: '', openingSituation: '', status: '候选', unresolvedQuestions: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    })
    setNewCardTitle('')
    setOpenFolds((current) => ({ ...current, directions: true }))
  }

  function archiveSelectedCards(): void {
    if (!selectedCardIds.length) return
    const selected = new Set(selectedCardIds)
    updateProject((draft) => {
      draft.directionCards?.forEach((card) => { if (selected.has(card.id)) card.status = '已归档' })
      if (draft.activeDirectionCardId && selected.has(draft.activeDirectionCardId)) draft.activeDirectionCardId = undefined
    })
    setSelectedCardIds([])
  }

  function editSetting<K extends keyof NovelProject['settings']>(
    key: K,
    value: NovelProject['settings'][K]
  ): void {
    updateProject((draft) => {
      applySettingEdit(draft, key, value)
    })
  }

  return (
    <>
      <Card
        title="故事种子"
        icon={Lightbulb}
      >
        <textarea
          className="mjp-textarea"
          rows={10}
          value={seed.seed}
          placeholder="用一段话写下这个故事最核心的想法、主角的欲望与代价。"
          aria-label="故事种子"
          onChange={(event) => editSeed(event.target.value)}
        />
      </Card>

      <div className="mjp-oi-actions">
        {hasOutline ? (
          <Btn
            variant="primary"
            icon={ArrowRight}
            title="进入总纲与卷纲"
            onClick={() => onNavigate(INTEGRATED_OUTLINE_CANONICAL_TARGETS['outline-volumes'])}
          >
            进入总纲与卷纲
          </Btn>
        ) : (
          <Btn
            variant="primary"
            icon={ArrowRight}
            disabled={!canEnter}
            title={canEnter ? '建立一份完整的空白大纲：结构齐全，正文与文本全部为空' : '需要先在故事种子里写下内容，才能建立初步大纲'}
            onClick={createBlankOutline}
          >
            创建空白大纲
          </Btn>
        )}
        {!hasOutline && !canEnter && (
          <span className="mjp-muted">先写下故事种子，才能创建大纲。</span>
        )}
      </div>

      <Fold
        id="directions"
        title="当前方向"
        summary={`${directions.activeCardTitle || '未采用'} · ${directions.statusCounts.total} 张方向卡${directionProposals.length ? ` · ${directionProposals.length} 条待确认` : ''}`}
        open={openFolds.directions}
        onToggle={() => toggleFold('directions')}
      >
        <div className="mjp-row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <Btn size="sm" disabled={busy || !seed.hasSeed || (project.directionCards?.length ?? 0) > 25} onClick={() => { void generate({ kind: 'story-direction' }) }}>AI 生成方向卡候选</Btn>
          <input className="mjp-input" aria-label="新方向卡名称" value={newCardTitle} maxLength={160} onChange={(event) => setNewCardTitle(event.target.value)} placeholder="新方向卡名称" style={{ width: 220 }} />
          <Btn size="sm" disabled={!newCardTitle.trim() || (project.directionCards?.length ?? 0) >= 30} onClick={addCard}>手动添加</Btn>
          <Btn size="sm" disabled={!selectedCardIds.length} onClick={archiveSelectedCards}>归档选中项</Btn>
        </div>
        {(project.directionCards?.length ?? 0) > 25 && <p className="mjp-muted">方向卡最多 30 张；请先归档或整理已有卡片，再生成新方向。</p>}
        {directionProposals.map((proposal) => <DirectionProposal key={proposal.id} proposal={proposal} busy={busy} onSave={updateRevision} onApply={applyRevision} onReject={rejectRevision} />)}
        {directions.questions.map((question, index) => <Field key={`${question}-${index}`} label={question}>
          <input className="mjp-input" value={directions.answers[index] ?? ''} onChange={(event) => updateProject((draft) => { applyDirectionAnswerEdit(draft, index, event.target.value) })} />
        </Field>)}
        {directions.cards.length > 0 && (
          <Card title="当前采用的方向" tight>
            <div className="mjp-row" style={{ justifyContent: 'space-between' }}>
              <KV label="当前采用" value={directions.activeCardTitle || '尚未采用任何方向卡'} />
              <Btn
                size="sm"
                disabled={!directions.activeCardId}
                onClick={() => setActiveCard(undefined)}
                title="取消当前采用，不删除任何方向卡"
              >
                取消当前采用
              </Btn>
            </div>
          </Card>
        )}
        {directions.hasCards ? (
          directions.cards.map((card) => (
            <div key={card.id} className="mjp-oi-term">
              <div className="mjp-oi-term-h">
                <input type="checkbox" aria-label={`选择${card.title || '未命名方向'}`} checked={selectedCardIds.includes(card.id)} onChange={(event) => setSelectedCardIds((current) => event.target.checked ? [...current, card.id] : current.filter((id) => id !== card.id))} />
                <b>{card.title || '未命名方向'}</b>
                <Tag tone={card.status === '已采用' ? 'accent' : card.status === '候选' ? 'amber' : 'default'}>{card.status}</Tag>
                {card.isActive ? (
                  <Tag tone="accent" dot>当前采用</Tag>
                ) : card.status !== '已归档' ? (
                  <Btn
                    size="sm"
                    onClick={() => setActiveCard(card.id)}
                    title={`把「${card.title || '未命名方向'}」设为当前采用；不会删除其他方向卡`}
                  >
                    设为当前采用
                  </Btn>
                ) : null}
              </div>
              <p className="mjp-oi-term-b">{card.premise.trim() || '故事前提未填写'}</p>
              {card.missingFields.length > 0 && (
                <div className="mjp-tag-row">
                  <span className="mjp-muted">尚未填写（{card.missingFields.length} 项）</span>
                  {card.missingFields.map((label) => <Tag key={label} tone="outline">{label}</Tag>)}
                </div>
              )}
            </div>
          ))
        ) : (
          <p className="mjp-oi-empty">还没有方向卡。先记录故事方向，再回到这里选择当前采用。</p>
        )}
      </Fold>

      <Fold
        id="specs"
        title="创作规格"
        summary={`${specs.genreTemplate} · ${specs.pointOfView} · ${specs.plannedChapters} 章`}
        open={openFolds.specs}
        onToggle={() => toggleFold('specs')}
      >
        <Banner tone="info" title={specs.notice.title}>{specs.notice.detail}</Banner>
        <div className="mjp-row" style={{ marginBottom: 12 }}>
          <Btn size="sm" disabled={busy || !seed.hasSeed} onClick={() => { void generate({ kind: 'writing-specs' }) }}>从故事种子推断规格</Btn>
        </div>
        {revisions.filter((item) => item.target === 'settings' && (item.status === '待处理' || item.status === '已冲突')).map((proposal) => <WritingSpecsProposal key={proposal.id} proposal={proposal} project={project} busy={busy} onApply={applyRevision} onReject={rejectRevision} />)}

        <Card title="题材与视角" icon={Sparkles} tight>
          <div className="mjp-grid-2">
            <Field label="题材模板" hint="从预设题材里选一个。">
              <select
                className="mjp-select"
                value={specs.genreTemplate}
                onChange={(event) => editSetting('genreTemplate', event.target.value as NovelProject['settings']['genreTemplate'])}
              >
                {GENRE_TEMPLATE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="叙事视角">
              <select
                className="mjp-select"
                value={specs.pointOfView}
                onChange={(event) => editSetting('pointOfView', event.target.value as NovelProject['settings']['pointOfView'])}
              >
                {POINT_OF_VIEW_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="叙述时态">
              <select
                className="mjp-select"
                value={specs.tense}
                onChange={(event) => editSetting('tense', event.target.value as NovelProject['settings']['tense'])}
              >
                {TENSE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="语言" hint="默认简体中文；最多 40 个字符。">
              <input
                className="mjp-input"
                type="text"
                maxLength={40}
                value={specs.language}
                onChange={(event) => editSetting('language', event.target.value)}
              />
            </Field>
          </div>
        </Card>

        <Card title="篇幅" tight>
          <div className="mjp-grid-2">
            <NumberField
              label="目标字数"
              unit="字"
              value={specs.targetWords}
              min={1_000}
              max={20_000_000}
              onCommit={(next) => editSetting('targetWords', next)}
            />
            <NumberField
              label="预计卷数"
              unit="卷"
              value={specs.plannedVolumes}
              min={1}
              max={100}
              onCommit={(next) => editSetting('plannedVolumes', next)}
            />
            <NumberField
              label="预计章节"
              unit="章"
              value={specs.plannedChapters}
              min={1}
              max={10_000}
              onCommit={(next) => editSetting('plannedChapters', next)}
            />
            <Field label="平均每章" hint="由「目标字数 ÷ 预计章节」真实推导；两者有效时才有值。">
              <input className="mjp-input" type="text" readOnly value={specs.averageChapterWords ? `${specs.averageChapterWords.toLocaleString()} 字` : '无法推导'} />
            </Field>
          </div>
        </Card>

        <Card title="文风强度" tight>
          <div className="mjp-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {RHETORIC_LEVEL_OPTIONS.map((option) => (
              <button
                key={option.level}
                type="button"
                className={`mjp-btn sm${option.level === specs.rhetoricIntensity ? ' primary is-active' : ''}`}
                aria-pressed={option.level === specs.rhetoricIntensity}
                title={option.description}
                onClick={() => editSetting('rhetoricIntensity', option.level)}
              >
                {option.level} · {option.label}
              </button>
            ))}
          </div>
          <div className="mjp-row" style={{ gap: 10, marginTop: 10, alignItems: 'flex-start' }}>
            <Tag tone="ai">{specs.rhetoricLabel}</Tag>
            <span className="mjp-muted" style={{ fontSize: 12, lineHeight: 1.6 }}>{specs.rhetoricDescription}</span>
          </div>
          <p className="mjp-hint" style={{ marginTop: 8 }}>生成时带入的指令：{specs.rhetoricInstruction}</p>
        </Card>

        <Card title="读者与文风" tight>
          <div className="mjp-col" style={{ gap: 12 }}>
            <Field label="目标读者" hint="最多 500 字。">
              <textarea
                className="mjp-textarea"
                rows={2}
                maxLength={500}
                value={specs.audience}
                onChange={(event) => editSetting('audience', event.target.value)}
              />
            </Field>
            <Field label="语言与文风" hint="最多 2000 字。">
              <textarea
                className="mjp-textarea"
                rows={3}
                maxLength={2000}
                value={specs.style}
                onChange={(event) => editSetting('style', event.target.value)}
              />
            </Field>
            <Field label="创作内容限制" hint="不希望 AI 触碰的题材、尺度与桥段；最多 2000 字。">
              <textarea
                className="mjp-textarea"
                rows={3}
                maxLength={2000}
                value={specs.contentLimits}
                onChange={(event) => editSetting('contentLimits', event.target.value)}
              />
            </Field>
          </div>
        </Card>

        {specs.missingFields.length > 0 && (
          <Card title="尚未填写的规格" tight>
            <div className="mjp-tag-row">
              {specs.missingFields.map((label) => <Tag key={label} tone="outline">{label}</Tag>)}
            </div>
          </Card>
        )}

      </Fold>
    </>
  )
}
