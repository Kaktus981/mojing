import { Lightbulb, ShieldCheck, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { NovelProject, WorldExpansionProposal, WorldSettingSimilarity } from '../../../../../../../packages/contracts/src'
import { mojingClient } from '../../../../api/mojingClient'
import { useNovelStore } from '../../../../novelStore'
import { Btn, Card, Field, Status, Tag } from '../../../ui/Primitives'
import { useDelayedFlag, type AsyncState } from '../../../ui/asyncState'

const SOURCE_LABEL: Record<WorldExpansionProposal['source'], string> = {
  手动暂存: '我手动记下的想法', 'AI 建议': 'AI 建议', 正文发现: '正文里发现的设定'
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败。'
}

/**
 * 设定提案（D6）。
 *
 * 统一收纳三类来源：手动暂存、AI 建议、正文发现。
 * 归属唯一：永久设定/术语/规则进这里；章节摘要与人物状态归记忆；伏笔归记忆与伏笔；
 * 矛盾与质量问题归审稿。同名或别名相同**只提示合并方向，不自动合并**；
 * 锁定条目必须先解锁，AI 不能自动覆盖。手写正式词条仍可直接保存，不必经过候选。
 */
export function SettingProposalsPage({ project }: { project: NovelProject }): React.JSX.Element {
  const replaceProject = useNovelStore((state) => state.replaceProject)
  const [title, setTitle] = useState('')
  const [reason, setReason] = useState('')
  const [source, setSource] = useState<WorldExpansionProposal['source']>('手动暂存')
  const [excerpt, setExcerpt] = useState('')
  const [similar, setSimilar] = useState<WorldSettingSimilarity[]>([])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const showBusy = useDelayedFlag(busy)
  const asyncState: AsyncState = busy ? 'busy' : 'idle'

  const pending = (project.worldExpansionProposals ?? []).filter((item) => item.status === '待确认')

  const entry = () => ({
    id: `entry-${Date.now()}`, type: '自定义' as const, name: title.trim(), aliases: [], tags: [],
    summary: reason.trim(), notes: '', locked: false, aiVisibility: '按需召回' as const,
    relations: [], customFields: {}, details: { fields: {}, lists: {} }
  })

  async function stage(): Promise<void> {
    setBusy(true); setFailure(undefined); setNotice(undefined)
    try {
      const preview = await mojingClient.settingProposals.preview(project.id, {
        source, title: title.trim(), reason: reason.trim() || '待补充理由',
        proposedEntries: [entry()],
        evidence: excerpt.trim() ? { excerpt: excerpt.trim(), inferred: false } : null
      })
      setSimilar(preview.similar)
      if (preview.similar.length === 0) await submit()
      else setNotice('已经有同名或相似的条目：请确认是要合并到它，还是新增另一个设定。')
    } catch (error) { setFailure(message(error)) } finally { setBusy(false) }
  }

  async function submit(): Promise<void> {
    setBusy(true); setFailure(undefined)
    try {
      const created = await mojingClient.settingProposals.create(project.id, {
        source, title: title.trim(), reason: reason.trim() || '待补充理由',
        proposedEntries: [entry()],
        evidence: excerpt.trim() ? { excerpt: excerpt.trim(), inferred: false } : null
      })
      setNotice(`已暂存设定提案「${created.proposal.title}」；正式世界观还没有变化。`)
      setTitle(''); setReason(''); setExcerpt(''); setSimilar([])
      // 提案存在项目里，取回最新项目才能列出待确认项。
      replaceProject(await mojingClient.novels.get(project.id))
    } catch (error) { setFailure(message(error)) } finally { setBusy(false) }
  }

  async function adopt(proposalId: string): Promise<void> {
    setBusy(true); setFailure(undefined); setNotice(undefined)
    try {
      replaceProject(await mojingClient.settingProposals.adopt(project.id, proposalId))
      setNotice('已采用设定提案；应用前的世界观已保存到版本历史，相关章节标记为待复核。')
    } catch (error) { setFailure(message(error)) } finally { setBusy(false) }
  }

  async function ignore(proposalId: string): Promise<void> {
    setBusy(true); setFailure(undefined); setNotice(undefined)
    try {
      replaceProject(await mojingClient.settingProposals.reject(project.id, proposalId))
      setNotice('已忽略这条提案；同一证据之后不会再反复提醒。')
    } catch (error) { setFailure(message(error)) } finally { setBusy(false) }
  }

  return (
    <div aria-busy={busy} data-state={asyncState} data-testid="setting-proposals-async-scope">
      {notice && <div className="mjp-banner info"><div>{notice}</div></div>}
      {failure && <div className="mjp-banner warn" role="alert" data-testid="setting-error"><div>{failure}</div></div>}
      {showBusy && (
        <div className="mjp-status warn" role="status" data-testid="setting-proposals-wait">
          <span className="mjp-spin" aria-hidden="true">◌</span>
          正在处理，请稍候…
        </div>
      )}

      <Card
        title="暂存一个设定想法"
        icon={Lightbulb}
        tight
      >
        <Field label="设定名称">
          <input className="mjp-input" aria-label="设定名称" value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="为什么需要它">
          <textarea className="mjp-textarea" aria-label="设定理由" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <Field label="原文依据（没有就留空，会被标为推测）">
          <input className="mjp-input" aria-label="原文依据" value={excerpt} onChange={(event) => setExcerpt(event.target.value)} />
        </Field>
        <div className="mjp-row wrap" style={{ gap: 6 }}>
          {(['手动暂存', 'AI 建议', '正文发现'] as const).map((item) => (
            <Btn
              key={item}
              size="sm"
              active={source === item}
              aria-pressed={source === item}
              onClick={() => setSource(item)}
            >
              {SOURCE_LABEL[item]}
            </Btn>
          ))}
        </div>
        <Btn size="sm" disabled={busy || !title.trim()} onClick={() => void stage()} data-testid="setting-stage">
          暂存为设定提案
        </Btn>
      </Card>

      {similar.length > 0 && (
        <Card title="已有相似条目" icon={ShieldCheck} desc="只提示合并方向，不自动合并。" tight>
          {similar.map((item) => (
            <div key={item.entryId} className="mjp-health-row" data-testid="setting-similar">
              <span className="nm">
                <b>{item.name}</b>
                <span className="mjp-muted"> · {item.type} · {item.reason}</span>
              </span>
              <span className="mjp-row" style={{ gap: 6 }}>
                {item.locked && <Tag tone="amber" dot>已锁定</Tag>}
              </span>
            </div>
          ))}
          <Btn size="sm" disabled={busy} onClick={() => void submit()} data-testid="setting-confirm-new">
            仍然新增为另一个设定
          </Btn>
        </Card>
      )}

      <Card title="待确认的设定提案" icon={Sparkles} desc="采用会写入正式世界观；忽略后同一证据不再提醒。" tight>
        {pending.length === 0 ? (
          <Status tone="ok">暂无待确认提案</Status>
        ) : pending.map((proposal) => (
          <div key={proposal.id} className="mjp-health-row" data-testid="setting-proposal">
            <span className="nm">
              <b>{proposal.title}</b>
              <span className="mjp-muted"> · {SOURCE_LABEL[proposal.source]}</span>
              {proposal.evidence ? (
                <span className="mjp-muted"> · 依据「{proposal.evidence.excerpt.slice(0, 30)}」{proposal.evidence.inferred ? '（推测）' : ''}</span>
              ) : <span className="mjp-muted"> · 无原文依据</span>}
              {proposal.conflicts.length > 0 && <span className="mjp-muted"> · {proposal.conflicts.length} 项冲突</span>}
            </span>
            <span className="mjp-row" style={{ gap: 6 }}>
              <Btn size="sm" disabled={busy} onClick={() => void adopt(proposal.id)} data-testid="setting-adopt">采用</Btn>
              <Btn size="sm" disabled={busy} onClick={() => void ignore(proposal.id)} data-testid="setting-ignore">忽略</Btn>
            </span>
          </div>
        ))}
      </Card>
    </div>
  )
}
