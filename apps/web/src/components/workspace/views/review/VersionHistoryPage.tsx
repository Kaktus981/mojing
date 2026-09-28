import { CheckCircle2, History, RefreshCw, Scale, Trash2, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Banner, Btn, Card, EmptyState, KV, Stat, Tag } from '../../../ui/Primitives'
import {
  formatTime,
  formatWords,
  type ReviewPageId,
  type VersionHistoryModel,
  type VersionHistoryRow
} from './reviewModel'

/**
 * 页面 5/5 · 版本历史 / 检查点 / 受控恢复。
 *
 * 数据源：store 的 `versions`（真实快照：名称 / 时间 / 来源 / 版本号）+ 真实 `project.revision`。
 *
 * 六段结构，每一段都只陈述真实能力：
 *   ① 版本目录    —— 真实快照列表，可选中；空目录如实说明「一条快照都没有」。
 *   ② 当前版本摘要 —— revision / 状态 / 时间 / 章节数 / 字数全部来自真实项目；
 *                    选中快照时展示它的真实元数据。这里**不给任何变更条数**，
 *                    因为那需要差异预览（见 ③）。
 *   ③ 差异预览    —— 走真实端点 GET /versions/:versionId/restore-preview。状态分四态：
 *                    「未预览 / 正在加载 / 预览失败 / 预览有效」。加载中与失败都不显示
 *                    任何差异明细，也不放行恢复；服务端返回值一律先过契约 `safeParse`，
 *                    解析失败按「预览失败」处理并显示错误，不做类型强转、不填默认值。
 *   ④ 命名检查点  —— 只暴露 store 已有的真实能力（固定名称「手动检查点」）。
 *                    自定义命名输入框保持禁用并写明原因（store 不接收自定义名）。
 *   ⑤ 受控恢复    —— 恢复状态由契约纯函数 `versionRestoreState()` 判定，输入是
 *                    **真实预览 + 当前选中快照 + 当前项目 revision + 当前保存状态**。
 *                    换选中、改正文、保存中、预览过期都会让按钮立刻回到禁用；
 *                    只有本页这一条受控入口，不走旧的直接恢复通道。
 *   ⑥ 删除版本    —— 真实的逐条删除（store.removeVersion → DELETE /versions/:id），
 *                    先选中目标、再要求一次显式确认；不做批量、不做静默删除。
 */
export function VersionHistoryPage({
  model,
  busy,
  onCreateCheckpoint,
  onRemoveVersion,
  onGoTo,
  selectedVersionId,
  onSelectVersion,
  restorePreview,
  onPreviewRestore,
  onRestore
}: {
  model: VersionHistoryModel
  busy: boolean
  onCreateCheckpoint: (reason?: string) => void
  onRemoveVersion: (versionId: string) => void
  onGoTo: (page: ReviewPageId) => void
  /** 选中的快照由 ReviewView 持有：它同时决定「这条快照的预览」是否仍然有效。传 undefined 表示清空选中。 */
  selectedVersionId?: string
  onSelectVersion: (versionId?: string) => void
  /** 恢复差异预览：只有预览过、且预览仍绑定当前稿时才允许恢复。 */
  restorePreview?: { versionId: string; targetRevision: number; currentRevision: number; diffs: Array<{ scope: string; changed: number; added: number; removed: number; sample: string[] }> }
  onPreviewRestore: (versionId: string) => void
  onRestore: (versionId: string) => void
}): React.JSX.Element {
  const [confirmingRemove, setConfirmingRemove] = useState<string>()
  const [checkpointName, setCheckpointName] = useState('')

  if (!model.hasProject) {
    return (
      <EmptyState
        icon={History}
        title="尚未打开项目"
        description="版本快照依附于具体作品，请先打开一个项目再看它的版本历史。"
      />
    )
  }

  const selected = model.rows.find((row) => row.id === selectedVersionId)
  /**
   * 提交条件（三条缺一不可）：
   *   1. 契约判定为「可恢复」（预览存在、revision 与摘要都还对得上、当前稿已保存）；
   *   2. 预览确实属于**当前选中的这条快照**；
   *   3. 预览已通过契约解析（status === '预览有效'）。
   * 换选中、改正文、保存中、预览过期都会让这里立刻变 false，按钮自动回到禁用。
   */
  const restoreReady = Boolean(
    selected &&
      model.restore.state === '可恢复' &&
      model.diffPreview.status === '预览有效' &&
      model.restore.previewVersionId === selected.id &&
      restorePreview &&
      restorePreview.versionId === selected.id
  )

  /** 禁用原因必须说准是哪一条不满足，不能笼统写一句「请先预览差异」。 */
  const restoreBlockedReason = (): string => {
    if (!selected) return '请先选中一条快照'
    if (model.diffPreview.status === '正在加载') return '差异预览正在加载，等它返回后再确认恢复。'
    if (model.diffPreview.status === '预览失败') return model.diffPreview.error ?? '差异预览失败，请重新预览差异。'
    if (model.restore.previewOnOtherSnapshot) return '当前的预览属于另一条快照，请在这条快照上重新预览差异。'
    if (model.restore.state === '当前稿未保存') {
      return model.restore.unsavedReason ?? '当前稿还没有保存完，保存成功后才能恢复。'
    }
    if (model.restore.state === '预览已过期') return '预览已过期：当前稿在预览之后又变了，请重新预览差异。'
    if (model.restore.state === '预览缺失') return '这条快照还没有差异预览，请先点「预览差异」。'
    return '预览尚未就绪，请重新预览差异。'
  }

  return (
    <>
      {/* ① 版本目录 ------------------------------------------------------ */}
      <div className="mjp-stats" style={{ marginBottom: 10 }}>
        <Stat label="快照总数" value={model.counts.total} unit=" 条" />
        <Stat label="与当前版本同号" value={model.counts.atCurrent} unit=" 条" />
        <Stat label="最早版本号" value={model.counts.oldestRevision ?? '——'} />
        <Stat label="最新版本号" value={model.counts.newestRevision ?? '——'} />
      </div>

      <div className="mjp-sec-h">
        ① 版本目录
        <span className="idx">真实快照 · 点一条查看它的元数据，删除也以选中为准</span>
      </div>

      {model.rows.length === 0 ? (
        <Card title="还没有任何版本快照" icon={History}>
          <p className="mjp-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.75 }}>
            还没有版本记录。点击下方「创建检查点」保存当前版本。
          </p>
        </Card>
      ) : (
        <div className="mjp-jump-list">
          {model.rows.map((row) => (
            <SnapshotRow
              key={row.id}
              row={row}
              selected={row.id === selectedVersionId}
              onSelect={() => {
                onSelectVersion(row.id)
                setConfirmingRemove(undefined)
              }}
            />
          ))}
        </div>
      )}

      {/* ② 当前版本摘要 -------------------------------------------------- */}
      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        ② 当前版本摘要
      </div>
      <Card title="当前正式稿" icon={CheckCircle2}>
        <div className="mjp-stats">
          <Stat label="当前版本号" value={model.current.revision} />
          <Stat label="章节数" value={model.current.chapterCount} unit=" 章" />
          <Stat label="正文总字数" value={formatWords(model.current.words)} unit=" 字" />
          <Stat label="目录快照数" value={model.counts.total} unit=" 条" />
        </div>
        <div className="mjp-vh-rows">
          <KV label="项目状态" value={model.current.status || '未记录'} />
          <KV label="最后更新" value={formatTime(model.current.updatedAt)} />
          <KV
            label="与当前版本同号的快照"
            value={model.counts.atCurrent ? `有 ${model.counts.atCurrent} 条` : '没有'}
          />
        </div>

        <div className="mjp-sec-h" style={{ margin: '14px 0 8px' }}>
          选中快照
          <span className="idx">{selected ? `版本 ${selected.revision}` : '未选中'}</span>
        </div>
        {selected ? (
          <div className="mjp-vh-rows">
            <KV label="版本号" value={selected.revision} />
            <KV label="快照名称 / 原因" value={selected.reason || '未记录'} />
            <KV label="快照来源" value={selected.source || '未记录'} />
            <KV label="创建时间" value={formatTime(selected.createdAt)} />
            <KV
              label="相对当前版本"
              value={selected.revisionLag > 0 ? `落后 ${selected.revisionLag} 版` : '与当前版本一致'}
            />
            <KV label="是否当前版本快照" value={selected.isCurrent ? '是' : '否'} />
          </div>
        ) : (
          <p className="mjp-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.75 }}>
            在上面的「版本目录」里点一条快照，这里会显示它的真实元数据（版本号 / 原因 / 来源 / 时间）。
          </p>
        )}
      </Card>

      {/* ③ 差异预览 ------------------------------------------------------ */}
      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        ③ 差异预览
        <span className="idx">七个范围 · 比对由墨境完成</span>
      </div>
      <div className="mjp-vh-rows">
        <KV
          label="差异预览能力"
          value={model.diffPreview.connected ? '可以预览' : '当前不可用'}
        />
        <KV
          label="这次预览的状态"
          value={
            <Tag
              tone={
                model.diffPreview.status === '预览有效'
                  ? 'ok'
                  : model.diffPreview.status === '预览失败'
                    ? 'amber'
                    : 'outline'
              }
            >
              {model.diffPreview.status}
            </Tag>
          }
        />
        <KV
          label="预览目标"
          value={
            model.diffPreview.summary
              ? `第 ${model.diffPreview.summary.currentRevision} 版 → 第 ${model.diffPreview.summary.targetRevision} 版${
                  model.restore.previewOnOtherSnapshot ? '（这条预览属于另一条快照，对当前选中无效）' : ''
                }`
              : '还没有可用的预览结果'
          }
        />
      </div>
      {model.diffPreview.status === '正在加载' ? (
        <Banner tone="info" title="差异预览正在加载">
          正在比对这条快照与当前稿的差异，返回之前不会显示任何差异内容，也不允许恢复。
        </Banner>
      ) : model.diffPreview.status === '预览失败' ? (
        <Banner tone="danger" title="差异预览失败">
          {model.diffPreview.error} 本次不显示任何差异内容，恢复保持禁用。
        </Banner>
      ) : model.diffPreview.status === '预览有效' ? (
        <Banner tone="info" title="差异预览有效">
          {model.diffPreview.summary!.totalDiffs === 0
            ? '比对后，两个版本在七个范围上没有差异。'
            : `比对本条快照与当前稿，共 ${model.diffPreview.summary!.totalDiffs} 个范围有差异，明细见 ⑤ 节下方。`}
          恢复只改内容，不会删除任何历史快照。
        </Banner>
      ) : (
        <Banner tone="info" title={model.diffPreview.notice.title}>
          {model.diffPreview.notice.detail}
        </Banner>
      )}
      <Card title="七个范围" icon={Scale}>
        {model.diffPreview.scopes.map((scope) => {
          const hit = model.diffPreview.summary?.scopes.find((item) => item.scope === scope)
          return (
            <div key={scope} className="mjp-health-row">
              <span className="nm">{scope}</span>
              <span className="val">
                {model.diffPreview.status === '预览有效'
                  ? hit
                    ? `改 ${hit.changed} · 增 ${hit.added} · 删 ${hit.removed}`
                    : '无差异'
                  : model.diffPreview.status === '预览失败'
                    ? '预览失败，未取得此项'
                    : '在 ⑤ 预览差异时逐项列出'}
              </span>
            </div>
          )
        })}
      </Card>

      {/* ④ 命名检查点 ---------------------------------------------------- */}
      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        ④ 命名检查点
        <span className="idx">只有固定名称这一条真实通道</span>
      </div>
      <Card title="创建检查点" icon={History}>
        <label className="mjp-hint" htmlFor="mjp-checkpoint-name">
          检查点名称（留空则使用默认名称「手动检查点」）
        </label>
        <div className="mjp-vh-form">
          <input
            id="mjp-checkpoint-name"
            className="mjp-input"
            aria-label="检查点名称"
            maxLength={200}
            placeholder="例如：定稿前 / 交稿版"
            value={checkpointName}
            onChange={(event) => setCheckpointName(event.target.value)}
          />
          <Btn
            size="sm"
            variant="primary"
            disabled={busy || !model.namedCheckpoint.canCreate}
            title={model.namedCheckpoint.canCreate ? '创建时会先保存当前稿，再记录这条快照。' : '需要先打开一个项目。'}
            onClick={() => {
              onCreateCheckpoint(checkpointName.trim() || undefined)
              setCheckpointName('')
            }}
          >
            以这个名称创建检查点
          </Btn>
        </div>
        <p className="mjp-hint" style={{ margin: '8px 0 0' }}>
          名称会作为快照的 reason 原样写入版本历史；留空时使用兼容默认值「手动检查点」，与旧行为一致。
        </p>
      </Card>

      {/* ⑤ 受控恢复 ------------------------------------------------------ */}
      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        ⑤ 受控恢复
        <span className="idx">先预览差异，再确认恢复；恢复前会自动保存当前稿并建快照</span>
      </div>
      <Card title="恢复到选中快照" icon={RefreshCw}>
        <div className="mjp-vh-rows">
          <KV label="当前是否可恢复" value={<Tag tone={model.restore.state === '可恢复' ? 'ok' : 'amber'}>{model.restore.state}</Tag>} />
          <KV label="选中快照" value={selected ? `第 ${selected.revision} 版 · ${selected.reason}` : '未选中（请在上面的目录里点一条）'} />
          <KV
            label="差异预览"
            value={
              model.diffPreview.status === '预览有效'
                ? `已取得这条快照的差异（第 ${model.diffPreview.summary!.currentRevision} 版 → 第 ${model.diffPreview.summary!.targetRevision} 版）`
                : model.diffPreview.status === '正在加载'
                  ? '正在比对差异'
                  : model.diffPreview.status === '预览失败'
                    ? '预览失败，恢复保持禁用'
                    : '尚未预览这条快照'
            }
          />
          <KV label="当前稿保存状态" value={model.restore.saveState ?? '未知（未打开项目）'} />
          <KV label="能否跳过预览直接恢复" value="不能：恢复必须先预览差异" />
        </div>
        <div className="mjp-row" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
          <Btn
            size="sm"
            icon={ShieldCheck}
            disabled={busy || !selected || model.diffPreview.status === '正在加载'}
            title={
              model.diffPreview.status === '正在加载'
                ? '差异预览正在加载，等它返回。'
                : '比对本条快照与当前稿的差异；这次预览属于哪条快照会被记下来。'
            }
            onClick={() => selected && onPreviewRestore(selected.id)}
          >
            预览差异
          </Btn>
          <Btn
            size="sm"
            variant="primary"
            disabled={busy || !selected || !restoreReady}
            title={restoreReady ? '会先留下一条「恢复前快照」，再换回目标内容。' : restoreBlockedReason()}
            onClick={() => selected && onRestore(selected.id)}
          >
            确认恢复到此版本
          </Btn>
        </div>

        {restorePreview && model.diffPreview.status === '预览有效' && (
          <div style={{ marginTop: 10 }}>
            <Banner tone="info" title={`差异预览：第 ${restorePreview.currentRevision} 版 → 第 ${restorePreview.targetRevision} 版`}>
              {restorePreview.diffs.length === 0
                ? '两个版本在正文、大纲、世界观、记忆、伏笔、审稿与分支上没有差异。'
                : `共 ${restorePreview.diffs.length} 个范围有差异，明细见下。恢复只改内容，不会删除任何历史快照。`}
            </Banner>
            {restorePreview.diffs.map((diff) => (
              <div key={diff.scope} className="mjp-health-row">
                <span className="nm">{diff.scope}</span>
                <Tag tone="outline">改 {diff.changed}</Tag>
                <Tag tone="amber">增 {diff.added}</Tag>
                <Tag tone="danger">删 {diff.removed}</Tag>
                <span className="mjp-muted" style={{ fontSize: 11 }}>
                  {diff.sample.slice(0, 2).join('；')}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ⑥ 删除版本 ------------------------------------------------------ */}
      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        ⑥ 删除版本
        <span className="idx">一次一条 · 删的是快照，不动正文</span>
      </div>
      <Banner tone="info" title={model.remove.notice.title}>
        {model.remove.notice.detail}
      </Banner>
      <Card title="删除选中的快照" icon={Trash2}>
        {model.rows.length === 0 ? (
          <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>
            目录里没有任何快照，因此没有可删除的目标。
          </p>
        ) : !selected ? (
          <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>
            请先在上面的「版本目录」中选中一条快照，这里才会出现删除入口 —— 删除必须明确指向一个具体版本。
          </p>
        ) : confirmingRemove === selected.id ? (
          <>
            <p className="mjp-hint is-warn" style={{ margin: '0 0 10px' }}>
              即将删除：版本 {selected.revision} · {selected.reason || selected.source || '未记录原因'} ·{' '}
              {formatTime(selected.createdAt)}。只删除这一条快照，当前小说内容不受影响，删除后无法恢复。
            </p>
            <div className="mjp-vh-form">
              <Btn size="sm" onClick={() => setConfirmingRemove(undefined)} disabled={busy}>
                取消
              </Btn>
              <Btn
                size="sm"
                variant="primary"
                disabled={busy}
                onClick={() => {
                  onRemoveVersion(selected.id)
                  setConfirmingRemove(undefined)
                  onSelectVersion(undefined)
                }}
              >
                确认删除版本 {selected.revision}
              </Btn>
            </div>
          </>
        ) : (
          <>
            <div className="mjp-vh-rows">
              <KV label="删除目标" value={`版本 ${selected.revision}`} />
              <KV label="快照名称 / 原因" value={selected.reason || '未记录'} />
              <KV label="创建时间" value={formatTime(selected.createdAt)} />
            </div>
            <div className="mjp-vh-form" style={{ marginTop: 10 }}>
              <Btn size="sm" icon={Trash2} disabled={busy} onClick={() => setConfirmingRemove(selected.id)}>
                删除此快照
              </Btn>
              <span className="mjp-hint">下一步会再要求一次确认；不支持批量删除。</span>
            </div>
          </>
        )}
      </Card>

      {/* 去处理 ---------------------------------------------------------- */}
      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        去处理
        <span className="idx">整本回滚只走 ⑤ 的受控通道；日常改正文走下面的入口</span>
      </div>
      <div className="mjp-jump-list">
        <button type="button" className="mjp-jump" onClick={() => onGoTo('revision-candidates')}>
          <Scale size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="t">AI 修改候选</span>
          <span className="d">想改正文就逐条确认候选，而不是回滚整个版本</span>
        </button>
        <button type="button" className="mjp-jump" onClick={() => onGoTo('export-manuscript')}>
          <History size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="t">导出成稿</span>
          <span className="d">导出前先确认当前稿的字数与空章节情况</span>
        </button>
      </div>
    </>
  )
}

/** 版本目录里的一行：整行可点选，选中态用 is-active 明确标出。 */
function SnapshotRow({
  row,
  selected,
  onSelect
}: {
  row: VersionHistoryRow
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`mjp-jump${selected ? ' is-active' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <History size={15} strokeWidth={1.8} aria-hidden="true" />
      <span className="t">
        版本 {row.revision} · {row.reason || '未记录原因'}
        {row.source && <span className="mjp-muted"> · 来源 {row.source}</span>}
        {row.isCurrent && <Tag tone="ok">当前版本</Tag>}
      </span>
      <span className="d">
        {formatTime(row.createdAt)}
        {row.revisionLag > 0 ? ` · 落后 ${row.revisionLag} 版` : ' · 与当前版本一致'}
      </span>
    </button>
  )
}
