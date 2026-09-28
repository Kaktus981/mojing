import { useMemo, useState } from 'react'
import { AlertTriangle, GitBranch, Layers, MoveHorizontal, Scissors, Trash2, Wand2 } from 'lucide-react'
import type { NovelProject, OutlineStructureOperation } from '../../../../../../../packages/contracts/src'
import { useNovelStore } from '../../../../novelStore'
import { Banner, Btn, Field, Tag } from '../../../ui/Primitives'

type StructureOperation = OutlineStructureOperation

const OPERATIONS: Array<{ id: StructureOperation; label: string; icon: typeof Trash2; hint: string }> = [
  { id: '调序', label: '调序', icon: MoveHorizontal, hint: '只改变阅读顺序；故事时间保持原值。' },
  { id: '跨卷移动', label: '跨卷移动', icon: GitBranch, hint: '移动到另一卷；卷级承接需要重新核对。' },
  { id: '删除章节', label: '删除章节', icon: Trash2, hint: '只从大纲移除；历史正文与证据不会被删除。' },
  { id: '拆分章节', label: '拆分章节', icon: Scissors, hint: '按剧情步骤拆成两章；原章纲身份保留给作者选定的那一半，原正文与关联跟着它走。' },
  { id: '合并章节', label: '合并章节', icon: Layers, hint: '只能合并同卷内相邻的两章；合并前必须先决定两份正文如何保留。' },
  { id: '卷排序', label: '卷排序', icon: Layers, hint: '整体调整卷的阅读顺序；卷内章节编号会跟着重排。' },
  { id: '删除卷', label: '删除卷', icon: Trash2, hint: '只允许删除空卷；卷内有正文、步骤或引用时会被拒绝。' }
]

const VOLUME_OPERATIONS: ReadonlySet<StructureOperation> = new Set(['卷排序', '删除卷'])

/**
 * 结构调整面板（调序 / 跨卷移动 / 删除章节 / 拆分 / 合并 / 卷排序 / 删除卷）。
 *
 * 这个面板**不直接改写大纲**：每次操作都先把请求交给服务端的结构预览，
 * 由 core 的纯规划函数算出候选大纲与中文影响摘要（影响章卡数、已有正文数、
 * 记忆数、伏笔数、风险等级、逐条变更与警告）。作者看过影响摘要再确认，
 * 确认后仍走既有候选应用门禁（`POST /api/revisions/:id/apply`），
 * 因此不会绕过版本校验，也不会用整项目 PUT 顶掉别人的改动。
 *
 * 卷级操作的两条硬规则：
 *   1. 卷内有正文、剧情步骤、记忆、伏笔或审稿问题时**直接拒绝**，不会级联删除；
 *   2. 卷内只剩没有任何内容的章纲时，必须勾选「我已确认移除这些章纲」才会执行。
 */
export function StructureEditPanel({
  project,
  selectedCardId
}: {
  project: NovelProject
  selectedCardId?: string
}): React.JSX.Element {
  const previewOutlineStructure = useNovelStore((state) => state.previewOutlineStructure)
  const applyRevision = useNovelStore((state) => state.applyRevision)
  const rejectRevision = useNovelStore((state) => state.rejectRevision)
  const busy = useNovelStore((state) => state.busy)

  const volumes = useMemo(() => project.outline?.volumes ?? [], [project.outline])
  const chapters = useMemo(
    () => volumes.flatMap((volume) => volume.chapters.map((chapter) => ({ ...chapter, volumeTitle: volume.title }))),
    [volumes]
  )
  const selected = chapters.find((chapter) => chapter.id === selectedCardId)

  const [operation, setOperation] = useState<StructureOperation>('调序')
  const [relativeChapterId, setRelativeChapterId] = useState('')
  const [position, setPosition] = useState<'之前' | '之后'>('之后')
  const [targetVolumeNumber, setTargetVolumeNumber] = useState('')
  const [sourceVolumeNumber, setSourceVolumeNumber] = useState('')
  const [relativeVolumeNumber, setRelativeVolumeNumber] = useState('')
  const [confirmVolumeChapters, setConfirmVolumeChapters] = useState(false)
  const [otherChapterId, setOtherChapterId] = useState('')
  const [splitAfterBeat, setSplitAfterBeat] = useState('1')
  /** 拆分后原正文归属哪张结果章纲；默认「前半」＝沿用原章纲稳定身份的最小方案。 */
  const [splitBodySide, setSplitBodySide] = useState<'前半' | '后半'>('前半')
  /** 合并时两份正文如何保留；必须由作者明确选择，所以初始为空。 */
  const [mergeBodyStrategy, setMergeBodyStrategy] = useState<'' | '拼接' | '保留为无章纲'>('')
  const [title, setTitle] = useState('')
  const [preview, setPreview] = useState<{
    proposalId: string; summary: string; changes: string[]; warnings: string[]; risk: string
    affectedOutlineCount: number; affectedBodyCount: number; affectedMemoryCount: number; affectedThreadCount: number
    /** 拆分/合并时原正文归属的说明；作者必须看完再确认。 */
    bodyHandling?: string
  }>()
  const [pending, setPending] = useState(false)

  const sameVolumeChapters = chapters.filter((chapter) => chapter.volumeNumber === selected?.volumeNumber && chapter.id !== selected?.id)
  const adjacentOther = chapters.filter((chapter) => chapter.id !== selected?.id && chapter.volumeNumber === selected?.volumeNumber)
  /** 正文按稳定身份或章号关联章纲；两种都算，避免旧项目显示成「没有正文」。 */
  const bodyOf = (chapterId?: string, chapterNumber?: number) => project.chapters.find(
    (chapter) => chapter.id === chapterId || (chapterNumber !== undefined && chapter.chapterNumber === chapterNumber)
  )
  const selectedBody = bodyOf(selected?.id, selected?.chapterNumber)
  const otherBody = bodyOf(otherChapterId || undefined, chapters.find((chapter) => chapter.id === otherChapterId)?.chapterNumber)

  const volumeNumber = (value: string): number | undefined => {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
  /** 卷级操作当前指向的卷（用于就地提示这一卷里有什么）。 */
  const inspectedVolumeNumber = operation === '删除卷' ? volumeNumber(targetVolumeNumber) : volumeNumber(sourceVolumeNumber)
  const inspectedVolume = volumes.find((volume) => volume.volumeNumber === inspectedVolumeNumber)
  const inspectedChapterIds = new Set((inspectedVolume?.chapters ?? []).map((chapter) => chapter.id))
  const inspectedChapterNumbers = new Set((inspectedVolume?.chapters ?? []).map((chapter) => chapter.chapterNumber))
  const inspectedBodies = project.chapters.filter((chapter) => inspectedChapterIds.has(chapter.id) || inspectedChapterNumbers.has(chapter.chapterNumber))
  const inspectedBeats = (inspectedVolume?.chapters ?? []).reduce((sum, chapter) => sum + chapter.beats.length, 0)

  function buildRequest() {
    const base = { baseRevision: project.revision, operation } as Record<string, unknown>
    if (VOLUME_OPERATIONS.has(operation)) {
      const target = volumeNumber(operation === '删除卷' ? targetVolumeNumber : sourceVolumeNumber)
      if (!target) return undefined
      if (operation === '卷排序') {
        const relative = volumeNumber(relativeVolumeNumber)
        if (!relative) return undefined
        return { ...base, volumeNumber: target, relativeVolumeNumber: relative, position }
      }
      return { ...base, volumeNumber: target, confirmVolumeChapters }
    }
    if (!selected) return undefined
    const withChapter = { ...base, chapterId: selected.id }
    if (operation === '调序') {
      if (!relativeChapterId) return undefined
      return { ...withChapter, relativeChapterId, position }
    }
    if (operation === '跨卷移动') {
      const parsed = volumeNumber(targetVolumeNumber)
      if (!parsed) return undefined
      return { ...withChapter, targetVolumeNumber: parsed, relativeChapterId: relativeChapterId || undefined, position: relativeChapterId ? position : undefined }
    }
    if (operation === '拆分章节') {
      const parsed = Number(splitAfterBeat)
      if (!Number.isInteger(parsed) || parsed <= 0) return undefined
      return { ...withChapter, splitAfterBeat: parsed, splitBodySide, title: title.trim() || undefined }
    }
    if (operation === '合并章节') {
      if (!otherChapterId) return undefined
      // 后章已有正文时不出候选：必须先由作者选择正文如何保留。
      if (otherBody && !mergeBodyStrategy) return undefined
      return { ...withChapter, otherChapterId, mergeBodyStrategy: mergeBodyStrategy || undefined, title: title.trim() || undefined }
    }
    return withChapter
  }

  async function runPreview(): Promise<void> {
    const request = buildRequest()
    if (!request) return
    setPending(true)
    const result = await previewOutlineStructure(request as never)
    setPending(false)
    if (!result) return
    setPreview({
      proposalId: result.proposal.id,
      summary: result.impact.summary,
      changes: [...result.impact.changes],
      warnings: [...result.impact.warnings],
      risk: result.impact.risk,
      affectedOutlineCount: result.impact.affectedOutlineCount,
      affectedBodyCount: result.impact.affectedBodyCount,
      affectedMemoryCount: result.impact.affectedMemoryCount,
      affectedThreadCount: result.impact.affectedThreadCount,
      bodyHandling: result.impact.bodyHandling
    })
  }

  async function confirmApply(): Promise<void> {
    if (!preview) return
    await applyRevision(preview.proposalId)
    setPreview(undefined)
  }

  async function discard(): Promise<void> {
    if (!preview) return
    await rejectRevision(preview.proposalId)
    setPreview(undefined)
  }

  if (volumes.length === 0) {
    return <p className="mjp-muted">还没有卷章结构，先建立卷与章纲，再回到这里调整结构。</p>
  }

  const requiresChapter = !VOLUME_OPERATIONS.has(operation)
  /**
   * 预览按钮的可用条件：除了选好目标，还要能组出一个完整请求。
   * 合并时后章已有正文却没选正文保留方式，就会在这里被拦住——
   * 不允许用「没选就按默认拼接」替作者做决定。
   */
  const ready = (VOLUME_OPERATIONS.has(operation) || Boolean(selected)) && Boolean(buildRequest())

  return (
    <>
      <div className="mjp-oi-toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        {OPERATIONS.map((item) => {
          const Icon = item.icon
          return (
            <Btn
              key={item.id}
              size="sm"
              icon={Icon}
              variant={operation === item.id ? 'primary' : undefined}
              onClick={() => {
                setOperation(item.id)
                setPreview(undefined)
              }}
              title={item.hint}
            >
              {item.label}
            </Btn>
          )
        })}
      </div>

      <p className="mjp-muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
        {requiresChapter
          ? `当前选中的章纲：${selected ? `第 ${selected.chapterNumber} 章《${selected.title || '未命名'}》` : '未选中（请先在左侧选择一张章纲）'}。`
          : '卷级操作不需要选中章纲；删除卷只允许删除空卷。'}
        所有结构操作都先预览影响、再由你确认；本面板不会直接改写大纲。
      </p>

      <div className="mjp-grid-2">
        {operation === '调序' && (
          <>
            <Field label="参照章节" hint="与哪一章交换阅读顺序。">
              <select className="mjp-select" aria-label="参照章节" value={relativeChapterId} onChange={(event) => setRelativeChapterId(event.target.value)}>
                <option value="">请选择</option>
                {sameVolumeChapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>第{chapter.chapterNumber}章 · {chapter.title || '未命名'}</option>
                ))}
              </select>
            </Field>
            <Field label="位置" hint="排在参照章之前或之后。">
              <select className="mjp-select" aria-label="位置" value={position} onChange={(event) => setPosition(event.target.value as '之前' | '之后')}>
                <option value="之前">之前</option>
                <option value="之后">之后</option>
              </select>
            </Field>
          </>
        )}

        {operation === '跨卷移动' && (
          <>
            <Field label="目标卷" hint="移动到哪一卷。">
              <select className="mjp-select" aria-label="目标卷" value={targetVolumeNumber} onChange={(event) => setTargetVolumeNumber(event.target.value)}>
                <option value="">请选择</option>
                {volumes.map((volume) => (
                  <option key={volume.id} value={volume.volumeNumber}>第{volume.volumeNumber}卷 · {volume.title}</option>
                ))}
              </select>
            </Field>
            <Field label="参照章节（可选）" hint="在目标卷里排在谁之前或之后；留空则放到卷末。">
              <select className="mjp-select" aria-label="跨卷参照章节" value={relativeChapterId} onChange={(event) => setRelativeChapterId(event.target.value)}>
                <option value="">放到目标卷末</option>
                {chapters
                  .filter((chapter) => String(chapter.volumeNumber) === targetVolumeNumber)
                  .map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>第{chapter.chapterNumber}章 · {chapter.title || '未命名'}</option>
                  ))}
              </select>
            </Field>
          </>
        )}

        {operation === '拆分章节' && (
          <>
            <Field label="在第几步之后拆分" hint="按当前章纲的剧情步骤编号计数，至少要有两个步骤。">
              <input className="mjp-input" type="number" min={1} aria-label="拆分位置" value={splitAfterBeat} onChange={(event) => setSplitAfterBeat(event.target.value)} />
            </Field>
            <Field label="前半章标题（可选）" hint="留空则按原章标题自动加「（上）」；这只是给作者的候选标题。">
              <input className="mjp-input" type="text" maxLength={240} aria-label="拆分标题" value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>
            <Field
              label="原正文归属"
              hint={selectedBody
                ? `第 ${selected?.chapterNumber} 章已有正文（${selectedBody.blocks.length} 段）。默认「前半」：前半沿用原章纲身份，原正文、记忆与伏笔关联原样跟随，另一张结果章纲从「还没有正文」开始。`
                : '当前章纲还没有正文；两张结果章纲都会从「还没有正文」开始。'}
            >
              <select className="mjp-select" aria-label="原正文归属" value={splitBodySide} onChange={(event) => setSplitBodySide(event.target.value as '前半' | '后半')}>
                <option value="前半">归前半（沿用原章纲身份，最小改动）</option>
                <option value="后半">归后半（原正文与关联改挂到后半）</option>
              </select>
            </Field>
          </>
        )}

        {operation === '合并章节' && (
          <>
            <Field label="与之合并的相邻章" hint="只能合并同一卷内阅读顺序相邻的两章。">
              <select className="mjp-select" aria-label="合并对象" value={otherChapterId} onChange={(event) => setOtherChapterId(event.target.value)}>
                <option value="">请选择</option>
                {adjacentOther.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>第{chapter.chapterNumber}章 · {chapter.title || '未命名'}</option>
                ))}
              </select>
            </Field>
            <Field label="合并后标题（可选）" hint="留空则按两章标题自动拼接。">
              <input className="mjp-input" type="text" maxLength={240} aria-label="合并标题" value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>
            <Field
              label="两份正文如何保留"
              hint={otherBody
                ? `被合并的后章已有正文（${otherBody.blocks.length} 段），合并会消掉它的章纲身份，所以必须由你选择：拼接到同一份正文，或把后章正文保留为没有对应章纲的记录。`
                : '被合并的后章没有正文，无需额外选择；合并后沿用先者正文。'}
            >
              <select
                className="mjp-select"
                aria-label="正文保留方式"
                value={mergeBodyStrategy}
                disabled={!otherChapterId}
                onChange={(event) => setMergeBodyStrategy(event.target.value as '' | '拼接' | '保留为无章纲')}
              >
                <option value="">{otherBody ? '请选择（后章有正文，必选）' : '无需选择'}</option>
                <option value="拼接">拼接为同一份正文（段落按顺序并入，不改写内容）</option>
                <option value="保留为无章纲">保留后章正文为「没有对应章纲」的记录</option>
              </select>
            </Field>
          </>
        )}

        {operation === '删除章节' && (
          <Field label="删除范围" hint="只从大纲中移除这一章；不会触发级联删除正文、记忆或伏笔。">
            <input className="mjp-input" type="text" readOnly value={selected ? `第 ${selected.chapterNumber} 章《${selected.title || '未命名'}》` : '未选中章纲'} aria-label="删除范围" />
          </Field>
        )}

        {operation === '卷排序' && (
          <>
            <Field label="要移动的卷" hint="整卷移动；卷内章节的相对顺序不变。">
              <select className="mjp-select" aria-label="要移动的卷" value={sourceVolumeNumber} onChange={(event) => setSourceVolumeNumber(event.target.value)}>
                <option value="">请选择</option>
                {volumes.map((volume) => (
                  <option key={volume.id} value={volume.volumeNumber}>第{volume.volumeNumber}卷 · {volume.title}</option>
                ))}
              </select>
            </Field>
            <Field label="参照卷" hint="移动到这个卷之前或之后。">
              <select className="mjp-select" aria-label="参照卷" value={relativeVolumeNumber} onChange={(event) => setRelativeVolumeNumber(event.target.value)}>
                <option value="">请选择</option>
                {volumes.map((volume) => (
                  <option key={volume.id} value={volume.volumeNumber}>第{volume.volumeNumber}卷 · {volume.title}</option>
                ))}
              </select>
            </Field>
            <Field label="位置" hint="排在参照卷之前或之后。">
              <select className="mjp-select" aria-label="卷位置" value={position} onChange={(event) => setPosition(event.target.value as '之前' | '之后')}>
                <option value="之前">之前</option>
                <option value="之后">之后</option>
              </select>
            </Field>
          </>
        )}

        {operation === '删除卷' && (
          <>
            <Field label="要删除的卷" hint="只允许删除空卷：卷内有正文、剧情步骤、记忆、伏笔或审稿问题时会被拒绝。">
              <select className="mjp-select" aria-label="要删除的卷" value={targetVolumeNumber} onChange={(event) => setTargetVolumeNumber(event.target.value)}>
                <option value="">请选择</option>
                {volumes.map((volume) => (
                  <option key={volume.id} value={volume.volumeNumber}>第{volume.volumeNumber}卷 · {volume.title}</option>
                ))}
              </select>
            </Field>
            <Field label="这一卷里有什么" hint="基于当前项目数据现场统计，不含任何推断。">
              <input
                className="mjp-input"
                type="text"
                readOnly
                aria-label="卷内容统计"
                value={
                  inspectedVolume
                    ? `${inspectedVolume.chapters.length} 张章纲 · ${inspectedBeats} 个剧情步骤 · ${inspectedBodies.length} 章正文`
                    : '请选择要删除的卷'
                }
              />
            </Field>
            {inspectedVolume && inspectedVolume.chapters.length > 0 && inspectedBodies.length === 0 && inspectedBeats === 0 && (
              <Field label="确认移除卷内章纲" hint="该卷只剩没有任何内容的章纲；不勾选不会删除它们。">
                <label className="mjp-muted" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    aria-label="我已确认移除这些章纲"
                    checked={confirmVolumeChapters}
                    onChange={(event) => setConfirmVolumeChapters(event.target.checked)}
                  />
                  我已确认移除这些章纲
                </label>
              </Field>
            )}
          </>
        )}
      </div>

      <div className="mjp-row" style={{ marginTop: 12, gap: 8 }}>
        <Btn size="sm" icon={Wand2} disabled={!ready || pending || busy} onClick={() => void runPreview()}>
          预览影响
        </Btn>
        {preview && (
          <>
            <Btn size="sm" variant="primary" disabled={busy} onClick={() => void confirmApply()}>
              确认执行结构变更
            </Btn>
            <Btn size="sm" variant="ghost" disabled={busy} onClick={() => void discard()}>
              放弃这次候选
            </Btn>
          </>
        )}
      </div>

      {preview && (
        <>
          <Banner tone={preview.risk === '高' ? 'danger' : preview.risk === '中' ? 'warn' : 'info'} title={`影响摘要（风险：${preview.risk}）`}>
            {preview.summary}
            <div className="mjp-row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
              <Tag tone="outline">章卡 {preview.affectedOutlineCount}</Tag>
              <Tag tone={preview.affectedBodyCount > 0 ? 'amber' : 'outline'}>已有正文 {preview.affectedBodyCount}</Tag>
              <Tag tone="outline">记忆 {preview.affectedMemoryCount}</Tag>
              <Tag tone="outline">伏笔 {preview.affectedThreadCount}</Tag>
            </div>
          </Banner>

          {/* 拆分/合并最容易出问题的是「原正文去哪」；先明确写出来，作者确认前必须看到 */}
          {preview.bodyHandling && (
            <Banner tone="info" title="正文归属">
              {preview.bodyHandling}
            </Banner>
          )}

          {preview.changes.length > 0 && (
            <ul className="mjp-muted" style={{ fontSize: 12, lineHeight: 1.8, margin: '8px 0 0 18px' }}>
              {preview.changes.map((change) => <li key={change}>{change}</li>)}
            </ul>
          )}

          {preview.warnings.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {preview.warnings.map((warning) => (
                <p key={warning} className="mjp-muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
                  <AlertTriangle size={13} strokeWidth={1.8} aria-hidden="true" /> {warning}
                </p>
              ))}
            </div>
          )}

          <p className="mjp-muted" style={{ fontSize: 12, lineHeight: 1.7, marginTop: 8 }}>
            候选基于版本 {project.revision}。确认后走既有候选应用门禁：项目版本在预览之后发生变化时会被拒绝并要求你重新预览，
            应用前的项目会保存到「历史记录」；正文、章节记忆与伏笔会按稳定身份跟随自己的章纲，不会有内容被删除。
          </p>
        </>
      )}
    </>
  )
}
