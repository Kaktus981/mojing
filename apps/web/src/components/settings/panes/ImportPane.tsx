import { Import, Save } from 'lucide-react'
import { useCallback, useMemo, useRef } from 'react'
import type { NovelVersionSummary } from '../../../../../../packages/contracts/src'
import { useNovelStore } from '../../../novelStore'
import { Banner, Btn, Card, EmptyState, KV, Status, Tag } from '../../ui/Primitives'
import { usePaneActions } from '../PaneActions'

/* 「导入与备份」栏。
 *
 * 导入走真实接口：POST /api/novels/import（multipart），成功后后端会重建项目
 * 并刷新大厅列表（store.importProject 内部完成），失败以错误信息呈现，不假装成功。
 * 章节切分由服务端按「第 N 章」与 Markdown 标题自动识别，Web 层没有切分参数，
 * 因此不做一排点了没用的切分按钮。
 *
 * 检查点走真实接口；恢复入口统一进入工作区版本历史，先预览差异再恢复。
 * 列表来自 GET /versions（需要项目处于打开状态）。 */

export function ImportPane({ onOpenVersionHistory }: { onOpenVersionHistory: () => void }): React.JSX.Element {
  const project = useNovelStore((state) => state.project)
  const versions = useNovelStore((state) => state.versions)
  const importProject = useNovelStore((state) => state.importProject)
  const createCheckpoint = useNovelStore((state) => state.createCheckpoint)
  const exportProject = useNovelStore((state) => state.exportProject)
  const busy = useNovelStore((state) => state.busy)
  const fileInput = useRef<HTMLInputElement>(null)

  const triggerPick = useCallback((): void => {
    if (!project && !busy) fileInput.current?.click()
  }, [project, busy])

  usePaneActions(
    <>
      <Btn size="sm" onClick={triggerPick} disabled={!!project || busy}>选择文件…</Btn>
      <Btn size="sm" variant="primary" onClick={() => void createCheckpoint()} disabled={!project || busy}>
        创建检查点
      </Btn>
      <Btn size="sm" onClick={() => void exportProject('json')} disabled={!project || busy}>导出备份</Btn>
    </>
  )

  const latest = useMemo(() => [...versions].sort((a, b) => b.revision - a.revision), [versions])

  return (
    <>
      <Card icon={Import} title="导入">
        <div className="mjp-rowline">
          <div>
            <div className="lab">支持格式</div>
            <div className="help">导入后墨境会按章节整理正文</div>
          </div>
          <div className="mjp-row wrap" style={{ gap: 6 }}>
            <Tag tone="outline">TXT</Tag>
            <Tag tone="outline">Markdown</Tag>
            <Tag tone="outline">DOCX</Tag>
            <Tag tone="accent">墨境 JSON</Tag>
          </div>
          <div>
            <Btn size="sm" onClick={triggerPick} disabled={!!project || busy}>选择文件…</Btn>
            <input
              ref={fileInput}
              type="file"
              disabled={!!project || busy}
              accept=".txt,.md,.markdown,.json,.docx"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file && !project && !busy) void importProject(file)
                event.target.value = ''
              }}
            />
          </div>
        </div>

        <div className="mjp-rowline">
          <div>
            <div className="lab">章节识别</div>
            <div className="help">墨境会自动识别，无需选择</div>
          </div>
          <div className="mjp-kv-grid">
            <KV label="规则一" value="「第 N 章」标题行" />
            <KV label="规则二" value="Markdown 标题（# / ##）" />
            <KV label="未识别到时" value="整篇作为单章导入" />
            <KV label="导入结果" value="新项目出现在项目大厅" />
          </div>
          <div />
        </div>

        <Banner tone="info" title="导入会新建项目">
          {project ? '当前有打开的项目，请先安全返回项目大厅，保存成功后再导入。' : '导入会新建并打开项目，不会修改或删除原始文件。'}
        </Banner>
      </Card>

      <Card
        icon={Save}
        title="备份与检查点"
        headRight={project ? <Tag tone="ok">{versions.length} 个检查点</Tag> : <Tag tone="outline">未打开项目</Tag>}
      >
        {!project ? (
          <EmptyState icon={Save} title="尚未打开项目" description="检查点按项目保存；打开一本小说后可以在这里创建与恢复版本。" />
        ) : latest.length === 0 ? (
          <EmptyState
            icon={Save}
            title="该项目还没有检查点"
            description="创建一个检查点后，AI 候选应用前的快照也会出现在这里。"
            action={<Btn size="sm" variant="primary" onClick={() => void createCheckpoint()} disabled={busy}>创建检查点</Btn>}
          />
        ) : (
          <>
            {latest[0] ? <LatestCheckpoint version={latest[0]} busy={busy} onOpenVersionHistory={onOpenVersionHistory} /> : null}

            <div className="mjp-rowline">
              <div>
                <div className="lab">全部检查点</div>
                <div className="help">按版本号倒序，仅显示摘要</div>
              </div>
              <div className="mjp-tbl-wrap is-inset">
                <table className="mjp-tbl">
                  <thead>
                    <tr>
                      <th>版本</th>
                      <th>来源</th>
                      <th>说明</th>
                      <th>时间</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {latest.map((version) => (
                      <tr key={version.id}>
                        <td className="num">v{version.revision}</td>
                        <td>{version.source}</td>
                        <td>{version.reason || '未命名快照'}</td>
                        <td className="num">{new Date(version.createdAt).toLocaleString('zh-CN')}</td>
                        <td>
                          <Btn size="sm" variant="ghost" onClick={onOpenVersionHistory} disabled={busy}>查看差异</Btn>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div />
            </div>

            <div className="mjp-row" style={{ marginTop: 12, gap: 10 }}>
              <Status tone="ok">检查点已保存</Status>
              <span className="mjp-muted">恢复请进入版本历史，预览差异后再确认。</span>
            </div>
          </>
        )}
      </Card>
    </>
  )
}

/** 「最近检查点」信息行。
 * tsconfig 开了 noUncheckedIndexedAccess，latest[0] 的类型是「可能不存在」；
 * 把收窄收到这一处，避免在 JSX 里反复对同一个数组下标做非空断言。 */
function LatestCheckpoint({ version, busy, onOpenVersionHistory }: {
  version: NovelVersionSummary
  busy: boolean
  onOpenVersionHistory: () => void
}): React.JSX.Element {
  return (
    <div className="mjp-rowline">
      <div>
        <div className="lab">最近检查点</div>
        <div className="help">
          {new Date(version.createdAt).toLocaleString('zh-CN')} · {version.source}
        </div>
      </div>
      <div className="mjp-row wrap" style={{ gap: 6 }}>
        <Tag tone="accent">v{version.revision}</Tag>
        <Tag tone="outline">{version.reason || '未命名快照'}</Tag>
      </div>
      <div>
        <Btn size="sm" onClick={onOpenVersionHistory} disabled={busy}>查看差异并恢复</Btn>
      </div>
    </div>
  )
}
