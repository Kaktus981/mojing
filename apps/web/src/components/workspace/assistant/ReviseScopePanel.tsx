import { PencilLine } from 'lucide-react'
import { useState } from 'react'
import type { AssistantTarget, LocalRevisionScope } from '../../../../../../packages/contracts/src'
import { mojingClient } from '../../../api/mojingClient'

const SCOPE_HINT: Record<LocalRevisionScope['kind'], string> = {
  volume: '只改这一卷的目标与卷内章纲',
  chapter: '只改这一章的目标与冲突',
  beat: '只改这一个剧情步骤',
  storyline: '只改这一条故事线'
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : '局部修改失败。'
}

/**
 * 「修改当前内容」：绑定明确作用域的操作（D1/D5）。
 *
 * 它**不形成第三套会话**：作者在这里写一句要求，服务端按当前作用域生成候选草稿，
 * 范围由服务端校验——作者说改这一步，就不会改到整章或别的卷。
 * 生成结果仍然只是草稿，采用在下方候选面板里确认。
 */
export function ReviseScopePanel({
  projectId,
  target,
  targetLabel
}: {
  projectId: string
  target: AssistantTarget
  targetLabel: string
}): React.JSX.Element {
  const scope = toScope(target)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [done, setDone] = useState<string>()

  if (!scope) return <></>

  async function generate(): Promise<void> {
    setBusy(true); setFailure(undefined); setDone(undefined)
    try {
      await mojingClient.outlineRevisions.generate(projectId, { scope: scope!, instruction: instruction.trim() })
      setDone('已生成候选草稿；请在下方查看差异后再采用。')
      setInstruction('')
      window.dispatchEvent(new CustomEvent('mojing:assistant-draft-changed'))
    } catch (error) {
      setFailure(message(error))
    } finally { setBusy(false) }
  }

  return (
    <div className="mjp-dock-revise" data-testid="revise-scope">
      <div className="mjp-dock-usage-row">
        <b>修改当前内容</b>
        <span className="mjp-muted"> · {targetLabel}（{SCOPE_HINT[scope.kind]}）</span>
      </div>
      <textarea
        aria-label="修改要求"
        rows={2}
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
      />
      <div className="mjp-row" style={{ gap: 6 }}>
        <button type="button" disabled={busy || !instruction.trim()} onClick={() => void generate()} data-testid="revise-generate">
          <PencilLine size={12} strokeWidth={2} /> 生成候选
        </button>
      </div>
      {done && <div className="mjp-dock-usage-row is-dim" data-testid="revise-done">{done}</div>}
      {failure && <div className="mjp-dock-usage-row is-error" role="alert" data-testid="revise-error">{failure}</div>}
    </div>
  )
}

function toScope(target: AssistantTarget): LocalRevisionScope | undefined {
  if (target.kind === 'volume' || target.kind === 'chapter' || target.kind === 'storyline') {
    return { kind: target.kind, projectId: target.projectId, objectId: target.objectId }
  }
  if (target.kind === 'beat') {
    return { kind: 'beat', projectId: target.projectId, objectId: target.objectId, beatId: target.beatId }
  }
  return undefined
}
