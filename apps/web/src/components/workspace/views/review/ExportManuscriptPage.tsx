import { Download, PackageCheck, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { NovelProject } from '../../../../../../../packages/contracts/src'
import { useNovelStore } from '../../../../novelStore'
import { Banner, Btn, Card, EmptyState, Tag } from '../../../ui/Primitives'
import { useDelayedFlag, type AsyncState } from '../../../ui/asyncState'
import { buildExportPrecheck, exportPrecheckAllowsExport, exportPrecheckState, type NovelExportFormat } from './exportPrecheck'
import { formatWords, type ExportFormatId, type ExportManifestModel, type ReviewPageId } from './reviewModel'

/**
 * 页面 1/4 · 导出成稿。
 *
 * 数据源：`project.chapters`（真实字数与章节状态）、store 的 `versions`（真实快照）。
 *
 * 点击导出时先保存并检查成稿；项目备份只要求保存成功。
 */
export async function attemptExport({ format, persistNow, getSaveState, pendingProposalCount, onExport }: {
  format: ExportFormatId
  persistNow: () => Promise<NovelProject | undefined>
  getSaveState: () => string
  pendingProposalCount: number
  onExport: (format: ExportFormatId) => Promise<void>
}): Promise<{ precheck?: ReturnType<typeof buildExportPrecheck>; message?: string }> {
  const saved = await persistNow()
  if (!saved) return { message: '最新改动没有保存成功，已取消导出。请先解决保存问题。' }

  if (format === 'json') {
    await onExport(format)
    return {}
  }

  const precheck = buildExportPrecheck(saved, format as NovelExportFormat, {
    saveState: getSaveState(), pendingProposalCount, now: new Date().toISOString()
  })
  if (exportPrecheckAllowsExport(exportPrecheckState(precheck, { projectRevision: saved.revision, format }))) {
    await onExport(format)
  }
  return { precheck }
}

export function ExportManuscriptPage({
  model,
  project,
  busy,
  onExport,
  onGoTo
}: {
  model: ExportManifestModel
  project: NovelProject
  busy: boolean
  onExport: (format: ExportFormatId) => Promise<void>
  onGoTo: (page: ReviewPageId) => void
}): React.JSX.Element {
  const [format, setFormat] = useState<ExportFormatId>('docx')
  const persistNow = useNovelStore((state) => state.persistNow)
  const revisions = useNovelStore((state) => state.revisions)
  const [precheck, setPrecheck] = useState<ReturnType<typeof buildExportPrecheck>>()
  const [precheckMessage, setPrecheckMessage] = useState<string>()
  const [exporting, setExporting] = useState(false)
  const showExportWait = useDelayedFlag(exporting)
  const exportState: AsyncState = exporting ? 'busy' : 'idle'

  async function runExport(): Promise<void> {
    if (exporting) return
    setExporting(true)
    try {
      const result = await attemptExport({
        format,
        persistNow,
        getSaveState: () => useNovelStore.getState().saveState,
        pendingProposalCount: revisions.filter((item) => item.status === '待处理').length,
        onExport
      })
      setPrecheck(result.precheck)
      setPrecheckMessage(result.message)
    } finally {
      setExporting(false)
    }
  }

  const checked = precheck && exportPrecheckState(precheck, { projectRevision: project.revision, format }) !== '已过期'
    ? precheck : undefined
  const isBackup = format === 'json'

  if (!model.hasProject) {
    return (
      <EmptyState
        icon={PackageCheck}
        title="尚未打开项目"
        description="导出依附于具体项目，请先打开一个作品。"
      />
    )
  }

  const selected = model.formats.find((item) => item.id === format) ?? model.formats[0]!
  const selectedLabel = selected.backup ? '备份整个项目' : selected.label

  return (
    <>
      <div className="mjp-overview">
        <div className="mjp-ov">
          <div className="l">可导出章节</div>
          <div className="v">{model.chapterCount}</div>
          <div className="sub">共 {model.volumeCount} 卷</div>
        </div>
        <div className="mjp-ov">
          <div className="l">正文总字数</div>
          <div className="v">{formatWords(model.totalWords)}</div>
          <div className="sub">按段落文字（不含空白字符）</div>
        </div>
        <div className="mjp-ov">
          <div className="l">空章节</div>
          <div className="v">{model.emptyChapters}</div>
          <div className="sub">{model.chapterCount === 0 ? '还没有章节' : model.emptyChapters > 0 ? '导出后为空章' : '每章都有正文'}</div>
        </div>
        <div className="mjp-ov">
          <div className="l">版本快照</div>
          <div className="v">{model.versions.total}</div>
          <div className="sub">{model.versions.latestRevision === undefined ? '尚无快照' : `最新版本 ${model.versions.latestRevision}`}</div>
        </div>
      </div>

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        导出格式
        <span className="idx">草稿也可以导出；只产生文件，不修改任何正式内容</span>
      </div>

      <div className="mjp-fmt-grid">
        {model.formats.map((item) => (
          <button
            key={item.id}
            type="button"
            className="mjp-fmt"
            style={item.id === format ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' } : undefined}
            onClick={() => { setFormat(item.id); setPrecheck(undefined); setPrecheckMessage(undefined) }}
          >
            <b>{item.backup ? '备份整个项目' : item.label}</b>
            <small>{item.ext}</small>
            <span className="mjp-muted" style={{ fontSize: 11, marginTop: 4 }}>{item.desc}</span>
            {item.backup && <Tag tone="outline">项目备份</Tag>}
          </button>
        ))}
      </div>

      <div className="mjp-row" style={{ marginTop: 14, gap: 10 }}>
        <Btn
          variant="primary"
          icon={Download}
          loading={showExportWait}
          disabled={busy || exporting}
          aria-busy={exporting}
          data-state={exportState}
          data-testid="export-submit"
          onClick={() => void runExport()}
        >
          {showExportWait ? '正在导出，请稍候…' : `导出 ${selectedLabel}（${selected.ext}）`}
        </Btn>
        <span className="mjp-hint">
          {isBackup
            ? '包含作品内容和创作资料。'
            : '点击导出后会先保存，并检查正文是否可以导出。'}
        </span>
      </div>
      {precheckMessage && <Banner tone="warn" title="导出已取消">{precheckMessage}</Banner>}
      {checked && !isBackup && checked.blockers.length > 0 && (
        <Banner tone="danger" title={`有 ${checked.blockers.length} 项问题需要处理`}>
          <ul className="mjp-muted" style={{ margin: '6px 0 0 18px', fontSize: 12, lineHeight: 1.8 }}>
            {checked.blockers.map((item) => <li key={item.code}>{item.message}</li>)}
          </ul>
        </Banner>
      )}
      {checked && !isBackup && checked.warnings.length > 0 && (
        <Banner tone="warn" title={`有 ${checked.warnings.length} 项提醒`}>
          <ul className="mjp-muted" style={{ margin: '6px 0 0 18px', fontSize: 12, lineHeight: 1.8 }}>
            {checked.warnings.map((item) => <li key={`${item.code}-${item.targetId ?? ''}`}>{item.message}</li>)}
          </ul>
        </Banner>
      )}

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        分章明细
        <span className="idx">字数与状态直接取自各章正文，不做估算</span>
      </div>
      {model.rows.length === 0 ? (
        <Card title="还没有章节" icon={ShieldCheck}>
          <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>在正文创作里建立第一章之后，这里会出现逐章的导出明细。</p>
        </Card>
      ) : (
        <Card title="章节" icon={ShieldCheck} tight>
          {model.rows.map((row) => (
            <div key={row.id} className="mjp-health-row">
              <span className="nm">
                <b>{row.label}</b>
                <span className="mjp-muted"> · {row.title}</span>
              </span>
              <Tag tone={row.empty ? 'amber' : row.status === '定稿' ? 'ok' : 'outline'}>{row.empty ? '空章' : row.status}</Tag>
              <span className="val">{formatWords(row.words)} 字</span>
            </div>
          ))}
        </Card>
      )}

      {model.latest && (
        <p className="mjp-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
          最新一章：{model.latest.label} {model.latest.title} · {formatWords(model.latest.words)} 字 · {model.latest.blocks} 个段落
        </p>
      )}

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        去核对
        <span className="idx">导出前如有未处理问题，先去这里</span>
      </div>
      <div className="mjp-jump-list">
        <button type="button" className="mjp-jump" onClick={() => onGoTo('review-issues')}>
          <ShieldCheck size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="t">审稿问题</span>
          <span className="d">看还有哪些待处理问题与缺少处理记录的旧问题</span>
        </button>
        <button type="button" className="mjp-jump" onClick={() => onGoTo('revision-candidates')}>
          <PackageCheck size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="t">AI 修改候选</span>
          <span className="d">逐条确认后再导出，避免把未定稿候选留到成稿里</span>
        </button>
      </div>
    </>
  )
}
