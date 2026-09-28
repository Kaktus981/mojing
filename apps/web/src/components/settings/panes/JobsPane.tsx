import { Clock, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { AiUsageRecord } from '../../../../../../packages/contracts/src'
import { mojingClient } from '../../../api/mojingClient'
import { useNovelStore } from '../../../novelStore'
import { Banner, Btn, Card, EmptyState, Stat, Tag } from '../../ui/Primitives'
import type { TagTone } from '../../ui/Primitives'
import { usePaneActions } from '../PaneActions'

/* 「任务历史」栏。
 *
 * 两个真实数据源，各自独立空态，不做交叉补位：
 *   1) GET /api/usage —— 跨项目的全局模型用量流水（ai_usage 表），本栏主表；
 *   2) store.generationJobs —— 当前打开项目的生成任务（需要项目处于打开状态）。
 * 状态字面量沿用后端持久化的中文口径（已完成 / 失败 / 取消 …），
 * 与 SSE 帧的英文 type 是两套，不要在这里做混合判断。 */

const STATUS_TONE: Record<string, TagTone> = {
  成功: 'ok',
  已完成: 'ok',
  待确认: 'amber',
  待作者确认: 'amber',
  等待: 'amber',
  等待执行: 'amber',
  失败: 'danger',
  取消: 'outline',
  已取消: 'outline',
  运行中: 'ai',
  草稿: 'outline'
}

function toneFor(status: string): TagTone {
  return STATUS_TONE[status] ?? 'outline'
}

function shortTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}

function formatCost(record: AiUsageRecord): string {
  if (!record.costKnown || record.estimatedCost === undefined) return '—'
  return `${record.currency === 'CNY' ? '¥' : record.currency} ${record.estimatedCost.toFixed(4)}`
}

export function JobsPane(): React.JSX.Element {
  const project = useNovelStore((state) => state.project)
  const generationJobs = useNovelStore((state) => state.generationJobs)
  const [records, setRecords] = useState<AiUsageRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((): void => {
    setLoading(true)
    void mojingClient.usage
      .list()
      .then((items) => {
        setRecords(items)
        setError(null)
      })
      .catch((err: unknown) => {
        setRecords([])
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  usePaneActions(
    <Btn size="sm" icon={RefreshCw} onClick={load} disabled={loading}>
      {loading ? '读取中…' : '刷新'}
    </Btn>
  )

  const inputTokens = records.reduce((sum, item) => sum + item.inputTokens, 0)
  const outputTokens = records.reduce((sum, item) => sum + item.outputTokens, 0)
  const failed = records.filter((item) => item.status === '失败').length
  const knownCost = records.filter((item) => item.costKnown && item.estimatedCost !== undefined)
  const costTotals = (['CNY', 'USD'] as const).flatMap((currency) => {
    const items = knownCost.filter((item) => item.currency === currency)
    return items.length ? [`${currency} ${items.reduce((sum, item) => sum + (item.estimatedCost ?? 0), 0).toFixed(2)}`] : []
  })

  return (
    <>
      <div className="mjp-stats" style={{ marginBottom: 14 }}>
        <Stat label="调用记录" value={records.length} unit=" 次" />
        <Stat label="输入 Token" value={inputTokens.toLocaleString()} />
        <Stat label="输出 Token" value={outputTokens.toLocaleString()} />
        <Stat label="已知费用" value={costTotals.length ? costTotals.join(' / ') : '—'} tone={failed > 0 ? 'warn' : 'ai'} />
      </div>

      <Card
        icon={Clock}
        title="全局模型用量"
        headRight={<Tag tone="outline">仅保存在本机</Tag>}
      >
        {error ? <Banner tone="danger" title="读取用量失败">{error}</Banner> : null}

        {loading ? (
          <p className="mjp-hint">正在读取用量流水…</p>
        ) : records.length === 0 && !error ? (
          <EmptyState icon={Clock} title="还没有用量记录" description="发起一次 AI 任务后，这里会按时间倒序显示每次调用的 Token 与费用。" />
        ) : records.length > 0 ? (
          <div className="mjp-tbl-wrap">
            <table className="mjp-tbl">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作</th>
                  <th>模型</th>
                  <th className="num">输入</th>
                  <th className="num">输出</th>
                  <th className="num">费用</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td className="num">{shortTime(record.createdAt)}</td>
                    <td>{record.operation}</td>
                    <td>
                      <span>{record.model}</span>
                    </td>
                    <td className="num">{record.inputTokens.toLocaleString()}</td>
                    <td className="num">{record.outputTokens.toLocaleString()}</td>
                    <td className="num">{formatCost(record)}</td>
                    <td>
                      <Tag tone={toneFor(record.status)} dot>
                        {record.status}
                        {record.retryCount > 0 ? ` · 重试 ${record.retryCount}` : ''}
                      </Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <Card
        icon={Clock}
        title="当前项目任务"
        desc={project ? `${project.title} · 最近 ${generationJobs.length} 条生成任务` : '需要先打开一个项目'}
        headRight={<Tag tone="outline">项目内记录</Tag>}
      >
        {!project ? (
          <EmptyState icon={Clock} title="尚未打开项目" description="任务记录按项目保存；从项目大厅打开一本小说后，这里显示它的任务与进度。" />
        ) : generationJobs.length === 0 ? (
          <EmptyState icon={Clock} title="该项目还没有生成任务" description="在 AI 工作台发起续写或记忆提取后，任务会出现在这里。" />
        ) : (
          <div className="mjp-tbl-wrap">
            <table className="mjp-tbl">
              <thead>
                <tr>
                  <th>任务类型</th>
                  <th>状态</th>
                  <th className="num">进度</th>
                  <th className="num">估算输入</th>
                  <th className="num">估算输出</th>
                  <th>更新</th>
                </tr>
              </thead>
              <tbody>
                {generationJobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <div className="mjp-col" style={{ gap: 2 }}>
                        <span>{job.kind}</span>
                        <span className="mjp-muted">{job.message}</span>
                      </div>
                    </td>
                    <td>
                      <Tag tone={toneFor(job.status)} dot>
                        {job.status}
                      </Tag>
                    </td>
                    <td className="num">{job.progress}%</td>
                    <td className="num">{job.estimatedInputTokens.toLocaleString()}</td>
                    <td className="num">{job.estimatedOutputTokens.toLocaleString()}</td>
                    <td className="num">{shortTime(job.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
