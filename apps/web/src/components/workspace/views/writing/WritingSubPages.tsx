import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Eraser, Search, Sparkles, Undo2 } from 'lucide-react'
import type { NovelProject } from '../../../../../../../packages/contracts/src'
import { mojingClient } from '../../../../api/mojingClient'
import { useNovelStore } from '../../../../novelStore'
import { Banner, Btn, Field, KV, Segmented, Switch, Tag } from '../../../ui/Primitives'
import {
  CHAPTER_STATUS_OPTIONS,
  HANDOFF_STATUS_OPTIONS,
  NARRATIVE_MODE_OPTIONS,
  RETRO_PLAN_RESULT_OPTIONS,
  applyChapterControlEdit,
  applyChapterHandoffStatusEdit,
  applyChapterRetroEdit,
  applyChapterStatusEdit,
  applyReplacePlan,
  planReplaceAll,
  searchProse,
  undoReplacePlan,
  type ReplacePlan,
  type SearchScope,
  type WriteResult
} from './writingToolsModel'

/** 找出正文章节对应的章纲（身份优先，旧项目退回章号）。 */
function outlineChapterOf(project: NovelProject, chapterId?: string) {
  const bodies = project.chapters
  const current = bodies.find((chapter) => chapter.id === chapterId) ?? bodies[0]
  const flat = (project.outline?.volumes ?? []).flatMap((volume) => volume.chapters)
  const outline = flat.find((chapter) => chapter.id === current?.id)
    ?? flat.find((chapter) => chapter.chapterNumber === current?.chapterNumber)
  return { current, outline }
}

const wordNote = '字数口径与其他页面一致：不计空白。'

/**
 * 子页面 2/4 · 写作控制。
 *
 * 只编辑「这一章自己的写作口径」：故事时间、叙述方式、视角，以及正文状态。
 * 项目级的创作规格在「小说大纲 · 创作起点」里维护，这里**不复制**那套编辑器，
 * 避免同一个字段出现两条互相打架的修改路径。
 */
export function WritingControlsPage({ project, chapterId }: { project: NovelProject; chapterId?: string }): React.JSX.Element {
  const updateProject = useNovelStore((state) => state.updateProject)
  const generate = useNovelStore((state) => state.generate)
  const busy = useNovelStore((state) => state.busy)
  const [genNotice, setGenNotice] = useState<string>()
  const { current, outline } = outlineChapterOf(project, chapterId)

  if (!current) return <p className="mjp-muted">还没有章节。先在「章节规划」建立章纲，再用「开始写作」建立正文。</p>

  /**
   * 整章生成的唯一前置校验：把「缺什么」如实说清楚，缺任何一项都**不提交**，
   * 这样作者能直接去对应页面补齐，而不是拿一个模糊的报错。
   */
  function prerequisiteBlock(): string | undefined {
    if (!project.worldBible) return '世界观未建立：请先在「世界观」建立世界主体，再按步骤生成整章。'
    if (!project.outline) return '大纲未建立：请先在「小说大纲」建立总纲与卷纲，再按步骤生成整章。'
    if (!outline || outline.beats.length === 0 || outline.beatStatus !== '已确认') {
      return '当前章剧情步骤未确认：请先到「小说大纲 · 剧情步骤」确认这一章的每一步。'
    }
    return undefined
  }

  /**
   * 按确认的剧情步骤生成整章：走真实的 `/generations` 通道，产出会作为**候选**返回，
   * 不会覆盖作者已经写好的正文。这里只负责发起，采用仍在候选面板里由作者确认。
   */
  function runGenerate(): void {
    const blocked = prerequisiteBlock()
    if (blocked) {
      setGenNotice(blocked)
      return
    }
    setGenNotice('已按确认的剧情步骤发起整章生成；结果会作为候选返回，不会覆盖你写的正文。')
    void generate({ kind: 'chapter', chapterId: current!.id, acknowledgedDraftPlanning: true })
  }

  function editControl(field: 'storyTime' | 'narrativeMode' | 'pov', value: string): void {
    if (!outline) return
    updateProject((draft) => {
      applyChapterControlEdit(draft, outline.id, field, value)
    })
  }

  function setStatus(status: string): void {
    updateProject((draft) => {
      applyChapterStatusEdit(draft, current!.id, status)
    })
  }

  return (
    <>
      <div className="mjp-card">
        <div className="mjp-card-hd">
          <div className="ti">
            写作控制 · 第 {current.chapterNumber} 章《{current.title}》
          </div>
        </div>
        <div className="mjp-card-bd">
          {!outline && (
            <Banner tone="warn" title="这一章还没有章纲">
              故事时间、叙述方式与视角保存在章纲上，因此这一章暂时改不了这三项；
              可以到「小说大纲 · 章节规划」为它补建章纲。正文状态仍然可以改。
            </Banner>
          )}
          <div className="mjp-grid-2">
            <Field label="故事时间" hint="这一章发生在故事世界的什么时候；留空即未记录。">
              <input
                className="mjp-input"
                type="text"
                maxLength={500}
                aria-label="故事时间"
                disabled={!outline}
                value={outline?.storyTime ?? ''}
                onChange={(event) => editControl('storyTime', event.target.value)}
              />
            </Field>
            <Field label="叙述方式" hint="顺叙 / 倒叙 / 插叙 / 回忆；留空即未记录。">
              <select
                className="mjp-select"
                aria-label="叙述方式"
                disabled={!outline}
                value={outline?.narrativeMode ?? ''}
                onChange={(event) => editControl('narrativeMode', event.target.value)}
              >
                <option value="">未记录</option>
                {NARRATIVE_MODE_OPTIONS.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
              </select>
            </Field>
            <Field label="视角" hint="本章跟随谁的视线；留空即未记录。">
              <input
                className="mjp-input"
                type="text"
                maxLength={240}
                aria-label="视角"
                disabled={!outline}
                value={outline?.pov ?? ''}
                onChange={(event) => editControl('pov', event.target.value)}
              />
            </Field>
            <Field label="正文状态" hint="草稿 / 待审校 / 定稿；只标记状态，不改正文。">
              <select
                className="mjp-select"
                aria-label="正文状态"
                value={current.status}
                onChange={(event) => setStatus(event.target.value)}
              >
                {CHAPTER_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </Field>
          </div>
          {/* 整章生成入口：只在「写作控制」这一页出现，正文编辑页没有它（writing-layout-regression）。 */}
          <div className="writing-generate-entry" data-testid="manual-step-generate" style={{ marginTop: 14 }}>
            <div className="mjp-row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <Btn variant="primary" icon={Sparkles} disabled={busy} onClick={runGenerate}>
                按确认的剧情步骤生成
              </Btn>
              <span className="mjp-muted" style={{ fontSize: 12 }}>
                请先建立世界观与大纲，并确认本章剧情步骤。生成内容经你确认后才会进入正文。
              </span>
            </div>
            {genNotice && <Banner tone={prerequisiteBlock() ? 'warn' : 'info'} title={prerequisiteBlock() ? '还不能提交' : '已发起生成'}>{genNotice}</Banner>}
          </div>
          <div className="mjp-window" style={{ marginTop: 14 }}>
            <KV label="所属卷" value={`第 ${current.volumeNumber} 卷`} mono />
            <KV label="章号" value={`第 ${current.chapterNumber} 章`} mono />
            <KV label="段落数" value={`${current.blocks.length} 段`} mono />
          </div>
          <p className="mjp-muted" style={{ marginTop: 10, fontSize: 12 }}>{wordNote}</p>
        </div>
      </div>
    </>
  )
}

/**
 * 子页面 3/4 · 章后交接。
 *
 * 记录本章结果、偏差原因与下章调整，并给出交接状态。
 * **不会**把交接内容自动写成正式记忆：正式记忆在「记忆与伏笔 · 正式记忆」里单独维护。
 */
export function ChapterHandoffPage({ project, chapterId }: { project: NovelProject; chapterId?: string }): React.JSX.Element {
  const updateProject = useNovelStore((state) => state.updateProject)
  const [message, setMessage] = useState<string>()
  const [confirmAutoAnalyze, setConfirmAutoAnalyze] = useState(false)
  const { current } = outlineChapterOf(project, chapterId)

  if (!current) return <p className="mjp-muted">还没有章节可以交接。</p>
  const retro = current.retro
  const autoAnalyze = project.settings.chapterAutoAnalyze === true

  /** 开关本身走同一条 updateProject 保存通道；**关闭随时生效、不再确认**。 */
  function setAutoAnalyze(next: boolean): void {
    updateProject((draft) => {
      draft.settings.chapterAutoAnalyze = next
    })
  }

  function editRetro(patch: Parameters<typeof applyChapterRetroEdit>[2]): void {
    updateProject((draft) => {
      applyChapterRetroEdit(draft, current!.id, patch, new Date().toISOString())
    })
    setMessage(undefined)
  }

  function setHandoff(status: string): void {
    let result: WriteResult = { ok: false, message: '没有项目。' }
    updateProject((draft) => {
      result = applyChapterHandoffStatusEdit(draft, current!.id, status, new Date().toISOString())
    })
    setMessage(result.ok ? undefined : result.message)
    // 只有「开关已开启」且「交接真的成功」才排分析任务；普通保存与交接失败都不会触发。
    if (result.ok && status === '已交接' && project.settings.chapterAutoAnalyze === true) {
      void mojingClient.chapterAnalyses.create(project.id, { chapterId: current!.id, trigger: '交接后自动' })
    }
  }

  return (
    <>
      <div className="mjp-card">
        <div className="mjp-card-hd">
          <div className="ti">
            章后交接 · 第 {current.chapterNumber} 章《{current.title}》
            <div className="desc">章后交接只记录本章完成情况，不会修改正文。</div>
          </div>
          <div className="right">
            <Tag tone={current.handoffStatus === '已交接' ? 'ok' : current.handoffStatus === '需补写' ? 'amber' : 'default'} dot>
              {current.handoffStatus ?? '未交接'}
            </Tag>
          </div>
        </div>
        <div className="mjp-card-bd">
          {message && <Banner tone="warn" title="这一步没有写入">{message}</Banner>}
          <div className="mjp-grid-2">
            <Field label="计划完成情况" hint="这一章相对计划的结果；留空即未记录。">
              <select
                className="mjp-select"
                aria-label="计划完成情况"
                value={retro?.planResult ?? ''}
                onChange={(event) => editRetro({ planResult: event.target.value || undefined })}
              >
                <option value="">未记录</option>
                {RETRO_PLAN_RESULT_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="交接状态" hint="标记「已交接」前必须先写下本章结果。">
              <select className="mjp-select" aria-label="交接状态" value={current.handoffStatus ?? '未交接'} onChange={(event) => setHandoff(event.target.value)}>
                {HANDOFF_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </Field>
            <Field label="本章结果" hint="这一章实际发生了什么；必填后才算交接。">
              <textarea
                className="mjp-textarea"
                rows={3}
                maxLength={2_000}
                aria-label="本章结果"
                value={retro?.actualResult ?? ''}
                onChange={(event) => editRetro({ actualResult: event.target.value })}
              />
            </Field>
            <Field label="偏差 / 未决事项" hint="与计划的偏差或还没解决的问题。">
              <textarea
                className="mjp-textarea"
                rows={3}
                maxLength={2_000}
                aria-label="偏差与未决事项"
                value={retro?.deviationReason ?? ''}
                onChange={(event) => editRetro({ deviationReason: event.target.value })}
              />
            </Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <Field label="下章调整提示" hint="给下一章自己的提醒；不会自动写进章纲或记忆。">
              <textarea
                className="mjp-textarea"
                rows={2}
                maxLength={2_000}
                aria-label="下章调整提示"
                value={retro?.nextAdjustment ?? ''}
                onChange={(event) => editRetro({ nextAdjustment: event.target.value })}
              />
            </Field>
          </div>
          {retro?.confirmedAt && (
            <p className="mjp-muted" style={{ marginTop: 10, fontSize: 12 }}>交接确认时间：{retro.confirmedAt}</p>
          )}

          {/*
            章后自动分析开关（唯一的开关入口在这里，任务中心不复制第二个）：
            默认关闭；**开启前**先展示发送范围与模型调用说明并要求确认，**关闭随时生效、不再确认**。
          */}
          <div className="mjp-col" style={{ gap: 8, marginTop: 14 }}>
            <Switch
              checked={autoAnalyze}
              data-testid="chapter-auto-analyze"
              onChange={(next) => {
                if (next) { setConfirmAutoAnalyze(true); return }
                setConfirmAutoAnalyze(false)
                setAutoAnalyze(false)
              }}
              label="交接成功后自动分析本章"
            />
            <span className="mjp-muted" style={{ fontSize: 12 }}>
              {autoAnalyze
                ? '已开启：只要把这一章标记为「已交接」，就会自动排一次章后分析。'
                : '已关闭自动分析；需要时可在任务中心手动开始。'}
            </span>
            {confirmAutoAnalyze && !autoAnalyze && (
              <Banner
                tone="warn"
                title="开启后会发生什么"
                action={
                  <span className="mjp-row" style={{ gap: 8 }}>
                    <Btn size="sm" variant="primary" data-testid="chapter-auto-analyze-confirm" onClick={() => { setAutoAnalyze(true); setConfirmAutoAnalyze(false) }}>
                      确认开启
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setConfirmAutoAnalyze(false)}>取消</Btn>
                  </span>
                }
              >
                交接成功后<strong>会调用一次模型</strong>分析本章正文。
                <br />
                发送范围：仅<strong>这一章</strong>的正文文本，以及生成所需的上下文；不会发送整本书，也不改动任何已保存内容。
                <br />
                分析结果只作为候选（摘要、状态/设定/伏笔候选、质量发现），未经你确认不会写入正式资料或正文。
              </Banner>
            )}
          </div>

          <Banner tone="info" title="交接不等于记忆">
            这些内容只是作者复盘记录，不会自动变成正式记忆；需要沉淀的最多手动加到「记忆与伏笔 · 正式记忆」并注明来源。
          </Banner>
        </div>
      </div>
    </>
  )
}

/**
 * 子页面 4/4 · 改写与查找。
 *
 * 查找区分「当前章 / 全书」，命中带真实章节与段落位置；
 * 批量替换分两步：先预览命中数量与每段变化，再在执行时逐段复核，
 * 预览之后被改过的段落会让整批取消（不覆盖新写的内容），替换后可撤销。
 */
export function RewriteSearchPage({ project, chapterId }: { project: NovelProject; chapterId?: string }): React.JSX.Element {
  const updateProject = useNovelStore((state) => state.updateProject)
  const { current } = outlineChapterOf(project, chapterId)

  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [scope, setScope] = useState<SearchScope>('chapter')
  const [plan, setPlan] = useState<ReplacePlan>()
  const [undone, setUndone] = useState(false)
  const [message, setMessage] = useState<string>()

  const hits = useMemo(
    () => searchProse(project.chapters, query, scope, current?.id),
    [project.chapters, query, scope, current?.id]
  )

  if (!current) return <p className="mjp-muted">还没有正文可以查找。</p>

  function preview(): void {
    setMessage(undefined)
    setUndone(false)
    if (!query) {
      setPlan(undefined)
      setMessage('请先输入要查找的内容。')
      return
    }
    const next = planReplaceAll(hits, query, replacement)
    setPlan(next)
    if (next.hitCount === 0) setMessage('没有命中，因此没有可替换的内容。')
  }

  function execute(): void {
    if (!plan) return
    let result = { ok: false, message: '没有项目。', applied: 0 } as ReturnType<typeof applyReplacePlan>
    updateProject((draft) => {
      result = applyReplacePlan(draft, plan)
    })
    setMessage(result.ok ? undefined : result.message)
    if (result.ok) setUndone(false)
  }

  function undo(): void {
    if (!plan) return
    let result = { ok: false, message: '没有项目。', restored: 0 } as ReturnType<typeof undoReplacePlan>
    updateProject((draft) => {
      result = undoReplacePlan(draft, plan)
    })
    setMessage(result.ok ? undefined : result.message)
    if (result.ok) setUndone(true)
  }

  return (
    <>
      <div className="mjp-card">
        <div className="mjp-card-hd">
          <div className="ti">
            查找
            <div className="desc">可以只在当前章找，也可以在全书中找；命中会显示章节与段落位置。</div>
          </div>
        </div>
        <div className="mjp-card-bd">
          <div className="mjp-oi-toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
            <input
              className="mjp-input"
              type="text"
              style={{ minWidth: 240 }}
              placeholder="要查找的文字"
              aria-label="查找内容"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPlan(undefined)
              }}
            />
            <Segmented
              value={scope}
              options={[
                { value: 'chapter', label: '当前章' },
                { value: 'book', label: '全书' }
              ]}
              onChange={(next) => {
                setScope(next)
                setPlan(undefined)
              }}
            />
            <span className="mjp-muted" style={{ fontSize: 12 }}>
              <Search size={13} strokeWidth={1.8} aria-hidden="true" /> 命中 {hits.length} 处
            </span>
          </div>

          {hits.length === 0 ? (
            <p className="mjp-muted">{query ? '没有命中。' : '输入要查找的文字后，这里会列出每一处命中的位置。'}</p>
          ) : (
            <ul className="mjp-kn" style={{ marginTop: 10 }}>
              {hits.map((hit) => (
                <li key={`${hit.blockId}-${hit.offset}`}>
                  <span className="t">第 {hit.chapterNumber} 章《{hit.chapterTitle}》· 第 {hit.blockIndex + 1} 段 · 第 {hit.offset + 1} 字</span>
                  <span className="mjp-muted">…{hit.excerpt}…</span>
                  <Tag tone="outline">{scope === 'chapter' ? '当前章' : '全书'}</Tag>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mjp-card" style={{ marginTop: 14 }}>
        <div className="mjp-card-hd">
          <div className="ti">
            批量替换
            <div className="desc">先预览命中数量与每一段的变化，确认后再执行；执行时若段落已被改动，整批取消。</div>
          </div>
        </div>
        <div className="mjp-card-bd">
          {message && <Banner tone="warn" title="替换状态">{message}</Banner>}
          <div className="mjp-oi-toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
            <input
              className="mjp-input"
              type="text"
              style={{ minWidth: 240 }}
              placeholder="替换为"
              aria-label="替换为"
              value={replacement}
              onChange={(event) => {
                setReplacement(event.target.value)
                setPlan(undefined)
              }}
            />
            <Btn size="sm" onClick={preview}>预览替换</Btn>
            <Btn size="sm" variant="primary" disabled={!plan || plan.steps.length === 0} onClick={execute}>执行替换</Btn>
            <Btn size="sm" variant="ghost" icon={Undo2} disabled={!plan || undone} onClick={undo}>撤销替换</Btn>
          </div>

          {plan && plan.steps.length > 0 && (
            <>
              <p className="mjp-muted" style={{ fontSize: 12, marginTop: 10 }}>
                命中 {plan.hitCount} 处，涉及 {plan.steps.length} 个段落。
              </p>
              <ul className="mjp-kn">
                {plan.steps.map((step) => (
                  <li key={`${step.chapterId}-${step.blockId}`}>
                    <span className="t">{step.before}</span>
                    <span className="mjp-muted"><Eraser size={13} strokeWidth={1.8} aria-hidden="true" /> {step.after}</span>
                    <Tag tone="outline">替换后</Tag>
                  </li>
                ))}
              </ul>
            </>
          )}
          {undone && (
            <p className="mjp-muted" style={{ fontSize: 12, marginTop: 8 }}>
              <CheckCircle2 size={13} strokeWidth={1.8} aria-hidden="true" /> 已撤销这次替换，正文回到替换前的样子。
            </p>
          )}
          <p className="mjp-muted" style={{ fontSize: 12, marginTop: 8 }}>
            <AlertCircle size={13} strokeWidth={1.8} aria-hidden="true" /> 替换只改正文文字，不动章纲、记忆与伏笔；
            如果这些段落需要重新分析记忆，请在「记忆与伏笔」里单独发起。
          </p>
        </div>
      </div>
    </>
  )
}
