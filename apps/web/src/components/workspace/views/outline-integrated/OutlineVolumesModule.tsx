import { useMemo } from 'react'
import { AlertTriangle, CheckCircle2, ListOrdered, ListTree, Plus, Wrench } from 'lucide-react'
import type { NovelProject } from '../../../../../../../packages/contracts/src'
import { useNovelStore } from '../../../../novelStore'
import type { WorkspaceNavigationTarget } from '../../workspaceNavigation'
import { Banner, Btn, EmptyState, Field, Tag } from '../../../ui/Primitives'
import { buildOutlineFoundation, buildOutlineStructure } from '../outline/outlineModel'
import {
  INTEGRATED_OUTLINE_CANONICAL_TARGETS,
  applyAddOutlineVolume,
  applyCreateBlankOutline,
  applyOutlineFieldEdit,
  applyVolumeFieldEdit,
  type OutlineEditableField,
  type OutlineVolumeEditableField
} from './outlineIntegrationModel'

/**
 * 「分批细化」的范围：作者先圈定**整卷**或**卷内的某一章**，再让右侧助手在这个范围内生成候选。
 *
 * 范围只有这两种粒度，是因为它直接对应服务端已有的 `LocalRevisionScope`
 * （`volume` / `chapter`）——「范围即权限」，越界变更在创建草稿这一步就被拒绝。
 * 界面不发明新的写入路径，只把作者的选择如实报给助手。
 */
export type OutlineRefineScope = { volumeId: string; chapterId?: string }

/**
 * 模块 2/4 · 总纲与卷纲。
 *
 * M3 起本模块是手写大纲的**唯一编辑位置**：
 *   - 空项目可直接建立契约完整、内容全空的空白大纲（不写示例内容）；
 *   - 总纲（总纲正文 / 主冲突 / 结局方向）与卷字段（卷名 / 目标 / 高潮 / 收束）均可手写；
 *   - 支持新增卷，卷号由现有数据决定，重复点击不会产生重复卷；
 *   - 所有写入都经纯 mutator 走同一个保存通道（`updateProject → 900ms 防抖 → persistNow`）；
 *     改动定稿规划时按既有规则退回「草稿」，不自动改正文。
 *
 * 逐章列表、章纲详情与受控结构调整都在「章节规划」模块。
 */
export function OutlineVolumesModule({
  project,
  selectedChapterId,
  onNavigate,
  refineScope,
  onSelectRefineScope
}: {
  project: NovelProject
  selectedChapterId?: string
  onNavigate: (target: WorkspaceNavigationTarget) => void
  /** 作者圈定的分批细化范围（卷级 / 卷内某章）；为空表示只浏览不细化。 */
  refineScope?: OutlineRefineScope
  onSelectRefineScope: (scope?: OutlineRefineScope) => void
}): React.JSX.Element {
  const updateProject = useNovelStore((state) => state.updateProject)

  const foundation = useMemo(() => buildOutlineFoundation(project, selectedChapterId), [project, selectedChapterId])
  const structure = useMemo(() => buildOutlineStructure(project), [project])
  const chapterTarget = INTEGRATED_OUTLINE_CANONICAL_TARGETS['chapter-planning']

  function editOutline(field: OutlineEditableField, value: string): void {
    updateProject((draft) => {
      applyOutlineFieldEdit(draft, field, value, new Date().toISOString())
    })
  }

  function editVolume(volumeId: string, field: OutlineVolumeEditableField, value: string): void {
    updateProject((draft) => {
      applyVolumeFieldEdit(draft, volumeId, field, value, new Date().toISOString())
    })
  }

  function createBlankOutline(): void {
    updateProject((draft) => {
      applyCreateBlankOutline(draft, new Date().toISOString())
    })
  }

  function addVolume(): void {
    const volumeId = `vol-${Date.now().toString(36)}`
    updateProject((draft) => {
      applyAddOutlineVolume(draft, volumeId, new Date().toISOString())
    })
  }

  /* ---------- 分批细化范围：只报告选择，不写任何项目字段 ---------- */

  type VolumeCard = (typeof foundation.volumes)[number]

  /** 这一卷当前选中的范围值；未选中返回空串（受控 select）。 */
  function refineScopeOfVolume(volumeId: string): string {
    if (refineScope?.volumeId !== volumeId) return ''
    return refineScope.chapterId ? `chapter:${refineScope.chapterId}` : 'volume'
  }

  function selectRefineScope(volumeId: string, value: string): void {
    if (!value) { onSelectRefineScope(undefined); return }
    if (value === 'volume') { onSelectRefineScope({ volumeId }); return }
    onSelectRefineScope({ volumeId, chapterId: value.slice('chapter:'.length) })
  }

  /** 把当前范围说清楚：卷名 + 章名，作者在生成前就能看到「这次改哪儿」。 */
  function describeRefineScope(volume: VolumeCard): string {
    const head = `第${volume.volumeNumber}卷《${volume.title.trim() || '未命名'}》`
    if (!refineScope?.chapterId) return `${head} 整卷（只改本卷目标与卷内章纲）`
    const chapter = volume.chapters.find((item) => item.cardId === refineScope.chapterId)
    return chapter ? `${head} 第${chapter.chapterNumber}章《${chapter.title.trim() || '未命名'}》（只改这一章的目标与冲突）` : head
  }

  if (!foundation.hasOutline) {
    return (
      <>
        <EmptyState
          icon={ListTree}
          title="还没有小说大纲"
          description="建立一份空白大纲后，就可以手写总纲、主冲突与结局方向，并逐卷填写卷名、目标、高潮与收束。这里不会替你预填任何内容。"
          action={<Btn variant="primary" icon={Plus} onClick={createBlankOutline}>创建空白大纲</Btn>}
        />
        <p className="mjp-tbl-foot">
          空白大纲结构齐全、文本全空；只有在你还没有大纲时才会建立，已有大纲不会被覆盖。
        </p>
      </>
    )
  }

  const { totals } = foundation

  return (
    <>
      <div className="mjp-overview">
        <div className="mjp-ov">
          <div className="l">主题</div>
          <div className="v" title={foundation.themes.join(' / ')}>{foundation.themes.length ? foundation.themes.join(' / ') : '未填写'}</div>
          <div className="sub"><Tag tone={foundation.status === '定稿' ? 'accent' : 'amber'} dot>{foundation.status || '未知'}</Tag></div>
        </div>
        <div className="mjp-ov">
          <div className="l">主冲突</div>
          <div className="v" title={foundation.mainConflict}>{foundation.mainConflict || '未填写'}</div>
          <div className="sub">共 {foundation.volumes.length} 卷</div>
        </div>
        <div className="mjp-ov">
          <div className="l">结局方向</div>
          <div className="v" title={foundation.endingDirection}>{foundation.endingDirection || '未填写'}</div>
          <div className="sub">{foundation.endingDirection ? '已记录' : '未锁'}</div>
        </div>
        <div className="mjp-ov">
          <div className="l">总览</div>
          <div className="v">{totals.writtenChapterCount} / {totals.plannedChapterCount || '—'} 章</div>
          <div className="sub">{totals.words.toLocaleString()} 字 · {totals.openThreadCount} 条伏笔待回收</div>
        </div>
      </div>

      <div className="mjp-card">
        <div className="mjp-card-hd">
          <div className="ti">
            总纲
          </div>
        </div>
        <div className="mjp-card-bd">
          <Field label="总纲" hint="全书走向；留空即为空，不会自动补默认文本。">
            <textarea
              className="mjp-textarea"
              rows={5}
              maxLength={20_000}
              value={foundation.synopsis}
              aria-label="总纲"
              onChange={(event) => editOutline('synopsis', event.target.value)}
            />
          </Field>
          <div className="mjp-grid-2" style={{ marginTop: 12 }}>
            <Field label="主冲突" hint="推动全书的核心对立。">
              <textarea
                className="mjp-textarea"
                rows={3}
                maxLength={2_000}
                value={foundation.mainConflict}
                aria-label="主冲突"
                onChange={(event) => editOutline('mainConflict', event.target.value)}
              />
            </Field>
            <Field label="结局方向" hint="不写死结局，只记录方向。">
              <textarea
                className="mjp-textarea"
                rows={3}
                maxLength={2_000}
                value={foundation.endingDirection}
                aria-label="结局方向"
                onChange={(event) => editOutline('endingDirection', event.target.value)}
              />
            </Field>
          </div>
        </div>
      </div>

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        卷纲
        <span className="idx">共 {foundation.volumes.length} 卷 · 可手写卷名、目标、高潮与收束</span>
        <Btn size="sm" icon={Plus} onClick={addVolume} className="mjp-right">新增卷</Btn>
      </div>

      {foundation.volumes.length === 0 ? (
        <EmptyState
          icon={ListTree}
          title="还没有卷"
          description="先新增第一卷，再填写本卷的卷名、目标、高潮与收束；逐章规划在「章节规划」模块里展开。"
          action={<Btn variant="primary" icon={Plus} onClick={addVolume}>新增第一卷</Btn>}
        />
      ) : (
        <>
          <div className="mjp-vol">
            {foundation.volumes.map((volume) => (
              <section key={volume.id} className={`mjp-vol-card${volume.isCurrent ? ' is-current' : ''}`}>
                <div className="mjp-vol-head">
                  <span className="n">{volume.numeral}</span>
                  <span className="ti" style={{ minWidth: 0 }}>
                    <span className="nm">第{volume.volumeNumber}卷 · {volume.title || '未命名'}</span>
                    <span className="desc">{volume.goal || '尚未填写本卷目标'}</span>
                  </span>
                  <span className="stats">
                    <span>章节<b>{volume.chapters.length}</b></span>
                    <span>已写<b>{volume.writtenCount}</b></span>
                    <span>字数<b>{volume.words ? volume.words.toLocaleString() : '—'}</b></span>
                    <Tag tone={volume.missingFields.length ? 'amber' : 'outline'}>{volume.statusTally}</Tag>
                  </span>
                </div>

                <div className="mjp-card-bd">
                  <div className="mjp-grid-2">
                    <Field label="卷名">
                      <input
                        className="mjp-input"
                        type="text"
                        maxLength={120}
                        value={volume.title}
                        aria-label={`第${volume.volumeNumber}卷 卷名`}
                        onChange={(event) => editVolume(volume.id, 'title', event.target.value)}
                      />
                    </Field>
                    <Field label="本卷目标">
                      <input
                        className="mjp-input"
                        type="text"
                        maxLength={2_000}
                        value={volume.goal}
                        aria-label={`第${volume.volumeNumber}卷 本卷目标`}
                        onChange={(event) => editVolume(volume.id, 'goal', event.target.value)}
                      />
                    </Field>
                    <Field label="本卷高潮">
                      <textarea
                        className="mjp-textarea"
                        rows={2}
                        maxLength={2_000}
                        value={volume.climax}
                        aria-label={`第${volume.volumeNumber}卷 本卷高潮`}
                        onChange={(event) => editVolume(volume.id, 'climax', event.target.value)}
                      />
                    </Field>
                    <Field label="本卷收束">
                      <textarea
                        className="mjp-textarea"
                        rows={2}
                        maxLength={2_000}
                        value={volume.resolution}
                        aria-label={`第${volume.volumeNumber}卷 本卷收束`}
                        onChange={(event) => editVolume(volume.id, 'resolution', event.target.value)}
                      />
                    </Field>
                  </div>
                </div>

                <div className="mjp-oi-vol-foot">
                  {/*
                    分批细化范围：旧用例里的「生成本卷章纲」按钮已按 D 系列移除，
                    能力按 P05 批准的「选定卷/章范围分批细化」重建 —— 这里只负责**明确范围**，
                    生成与采用仍走既有的「助手 · 修改当前内容 → 候选草稿 → 查看差异 → 采用」，
                    因此不会直接覆盖任何已有章纲。
                  */}
                  <Field label="分批细化范围" hint="圈定范围后，到右侧助手「修改当前内容」里写要求；候选只落草稿，采用前必须先看差异。">
                    <select
                      className="mjp-select"
                      aria-label={`第${volume.volumeNumber}卷 细化范围`}
                      value={refineScopeOfVolume(volume.id)}
                      onChange={(event) => selectRefineScope(volume.id, event.target.value)}
                    >
                      <option value="">不细化这一卷</option>
                      <option value="volume">整卷：只改本卷目标与卷内章纲</option>
                      {volume.chapters.map((chapter) => (
                        <option key={chapter.cardId} value={`chapter:${chapter.cardId}`}>
                          第{chapter.chapterNumber}章 · {chapter.title || '未命名'}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {refineScopeOfVolume(volume.id) ? (
                    <p className="mjp-hint" data-testid="refine-range" style={{ marginTop: 6 }}>
                      当前细化范围：{describeRefineScope(volume)}
                    </p>
                  ) : null}
                  <Btn
                    size="sm"
                    icon={ListOrdered}
                    onClick={() => onNavigate(chapterTarget)}
                    title="切到「章节规划」模块；按卷筛选章节在该模块内进行"
                  >
                    前往章节规划（本卷 {volume.chapters.length} 章）
                  </Btn>
                </div>
              </section>
            ))}
          </div>
          <p className="mjp-tbl-foot">
            本模块只呈现卷级结构，不铺章节网格；逐章列表与章纲详情在「章节规划」模块。
          </p>
        </>
      )}

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        结构调整
        <span className="idx">先检查，再调整</span>
      </div>

      <Banner tone="info" title="结构检查">
        这里显示当前大纲的结构检查结果。要调整章节顺序、跨卷移动、拆分或合并，请到章节规划选择目标章节，预览影响后再确认。
      </Banner>

      <div className="mjp-stats">
        <div className="mjp-stat">
          <span className="k">结构检查项</span>
          <span className="v">{structure.findings.length}<small>条</small></span>
        </div>
        <div className={`mjp-stat${structure.severityCounts.高 ? ' is-warn' : ''}`}>
          <span className="k">高风险</span>
          <span className="v">{structure.severityCounts.高}<small>条</small></span>
        </div>
        <div className="mjp-stat">
          <span className="k">中风险</span>
          <span className="v">{structure.severityCounts.中}<small>条</small></span>
        </div>
        <div className="mjp-stat">
          <span className="k">提示</span>
          <span className="v">{structure.severityCounts.低}<small>条</small></span>
        </div>
      </div>

      {structure.findings.length === 0 ? (
        <div className="mjp-issue is-ok">
          <div className="mjp-issue-h">
            <CheckCircle2 size={15} strokeWidth={1.8} aria-hidden="true" />
            <span className="tt">未发现章节结构问题</span>
          </div>
          <div className="mjp-issue-b">
            情节节奏仍需人工检查。
          </div>
        </div>
      ) : (
        structure.findings.map((finding) => (
          <div
            key={finding.id}
            className={`mjp-issue${finding.severity === '高' ? ' is-danger' : finding.severity === '中' ? ' is-warn' : ' is-ok'}`}
          >
            <div className="mjp-issue-h">
              <AlertTriangle size={15} strokeWidth={1.8} aria-hidden="true" />
              <span className="tt">{finding.title}</span>
              <Tag tone="outline">{finding.category}</Tag>
              <span className="loc">
                严重度 {finding.severity}
                {finding.chapterNumbers.length > 0 ? ` · 涉及 ${finding.chapterNumbers.length} 章` : ''}
              </span>
            </div>
            <div className="mjp-issue-b">{finding.detail}</div>
          </div>
        ))
      )}

      <div className="mjp-struct-actions">
        <Btn size="sm" icon={Wrench} onClick={() => onNavigate(chapterTarget)} disabled={!project.outline?.volumes.length}>
          前往章节规划调整结构
        </Btn>
      </div>
    </>
  )
}
