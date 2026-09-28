import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNovelStore } from '../../../../novelStore'
import { Banner, Btn, Field, Tag } from '../../../ui/Primitives'
import { useWorldEdit } from './useWorldEdit'
import {
  applyAddWorldConstraint,
  applyConstraintFieldEdit,
  applyConstraintListEdit,
  applyRemoveWorldConstraint,
  constraintReferenceCount,
  type WriteResult
} from './worldWriting'
import type { NovelProject } from '../../../../../../../packages/contracts/src'
import type { RulesBoundariesModel } from './worldModel'

const CONSTRAINT_STATUSES = ['待确认', '已确认', '已锁定', '已拒绝'] as const

function constraintTone(status: string): 'ok' | 'amber' | 'accent' | 'default' {
  if (status === '已锁定') return 'accent'
  if (status === '已确认') return 'ok'
  if (status === '待确认') return 'amber'
  return 'default'
}

/**
 * 页面 2/5 · 规则与边界。
 *
 * 数据源：
 *   - 世界规则：`project.worldBible.rules`（真实字符串数组，可增删改，走 updateProject）；
 *   - 术语边界：`project.worldConstraints`（term / definition / notDefinition / 允许与禁止
 *     用法 / 未决问题 / 事实 / 来源证据 / status）；
 *   - 审校发现：`project.worldQualityFindings`（类型、严重度、证据摘录、解释、建议、状态）。
 *
 * 边界：本页只允许作者自己改规则文本、切换术语状态；**不**接受或应用任何 AI 修复。
 * AI 修复必须先进候选层，这一点在页面上如实说明（见 notice）。
 */
export function RulesBoundariesPage({ model, project }: { model: RulesBoundariesModel; project: NovelProject }): React.JSX.Element {
  // 术语删除需要检查「是否被审校问题引用」，因此这里读一份真实项目做判定。
  const { editWorld } = useWorldEdit()
  const updateProject = useNovelStore((state) => state.updateProject)
  const [newTerm, setNewTerm] = useState('')
  const [newDefinition, setNewDefinition] = useState('')
  const [constraintMessage, setConstraintMessage] = useState<string>()
  const [pendingRemoveId, setPendingRemoveId] = useState<string>()

  function report(result: WriteResult): void {
    setConstraintMessage(result.ok ? undefined : result.message)
  }

  /** 手动建立术语：名称与定义都由作者填写，来源如实标为「作者手动录入」。 */
  function addConstraint(): void {
    const id = `term-${Date.now().toString(36)}`
    let result: WriteResult = { ok: false, message: '没有项目。' }
    updateProject((draft) => {
      result = applyAddWorldConstraint(draft, { term: newTerm, definition: newDefinition }, new Date().toISOString(), id)
    })
    if (result.ok) {
      setNewTerm('')
      setNewDefinition('')
    }
    report(result)
  }

  function editConstraintText(id: string, field: 'term' | 'definition' | 'notDefinition' | 'entityType', value: string): void {
    updateProject((draft) => {
      applyConstraintFieldEdit(draft, id, field, value, new Date().toISOString())
    })
    setConstraintMessage(undefined)
  }

  function editConstraintList(id: string, field: 'allowedUsages' | 'unresolvedQuestions', value: string): void {
    updateProject((draft) => {
      applyConstraintListEdit(draft, id, field, value.split(/[、,，\n]/), new Date().toISOString())
    })
  }

  function confirmRemoveConstraint(id: string): void {
    let result: WriteResult = { ok: false, message: '没有项目。' }
    updateProject((draft) => {
      result = applyRemoveWorldConstraint(draft, id)
    })
    setPendingRemoveId(undefined)
    report(result)
  }

  function patchRule(index: number, text: string): void {
    editWorld((world) => {
      world.rules[index] = text
    })
  }

  function addRule(): void {
    editWorld((world) => {
      world.rules.push('')
    })
  }

  function removeRule(index: number): void {
    editWorld((world) => {
      world.rules.splice(index, 1)
    })
  }

  /**
   * 术语边界属于项目级数据（不在 worldBible 里），因此直接走 updateProject。
   * 只会改作者自己决定的状态，不触碰 definition —— AI 提取的文本不会被这里静默接受。
   */
  function setConstraintStatus(id: string, status: string): void {
    updateProject((draft) => {
      const constraint = draft.worldConstraints.find((item) => item.id === id)
      if (!constraint) return
      constraint.status = status as typeof constraint.status
      constraint.updatedAt = new Date().toISOString()
    })
  }

  const { constraintStats } = model

  return (
    <>
      <div className="mjp-overview">
        <div className="mjp-ov">
          <div className="l">世界规则</div>
          <div className="v">{model.rules.length}</div>
          <div className="sub">不可违反的硬约束</div>
        </div>
        <div className="mjp-ov">
          <div className="l">已定术语</div>
          <div className="v">{constraintStats.已确认 + constraintStats.已锁定}</div>
          <div className="sub">已确认 {constraintStats.已确认} · 已锁定 {constraintStats.已锁定}</div>
        </div>
        <div className="mjp-ov">
          <div className="l">待确认术语</div>
          <div className="v">{constraintStats.待确认}</div>
          <div className="sub">{constraintStats.待确认 ? '确认前不会成为正式约束' : '无待确认项'}</div>
        </div>
        <div className="mjp-ov">
          <div className="l">审校待处理</div>
          <div className="v">{model.pendingFindingCount}</div>
          <div className="sub">共 {model.findings.length} 条发现</div>
        </div>
      </div>

      <Banner tone="info" title={model.notice.title}>{model.notice.detail}</Banner>

      <div className="mjp-sec-h">
        世界规则
        <span className="idx">编辑后回到草稿状态</span>
      </div>

      {model.rules.length === 0 ? (
        <div className="mjp-card">
          <div className="mjp-card-bd">
            <p className="mjp-muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
              还没有任何世界规则。规则是长篇不漂移的底线，建议先写三条：世界能做什么、不能做什么、代价是什么。
            </p>
            <Btn icon={Plus} onClick={addRule}>新增规则</Btn>
          </div>
        </div>
      ) : (
        <div className="mjp-rule-list">
          {model.rules.map((rule) => (
            <div key={rule.index} className="mjp-rule">
              <span className="no" aria-hidden="true">{rule.index}</span>
              <textarea
                className="mjp-textarea"
                rows={2}
                value={rule.text}
                aria-label={`第 ${rule.index} 条世界规则`}
                onChange={(event) => patchRule(rule.index - 1, event.target.value)}
              />
              <Btn size="sm" variant="danger" icon={Trash2} onClick={() => removeRule(rule.index - 1)} aria-label={`删除第 ${rule.index} 条规则`} />
            </div>
          ))}
          <div className="mjp-row">
            <Btn icon={Plus} size="sm" onClick={addRule}>新增规则</Btn>
            <span className="mjp-muted" style={{ fontSize: 11 }}>编辑后会回到「草稿」状态，已写正文不会被重写。</span>
          </div>
        </div>
      )}

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        术语边界
        <span className="idx">共 {constraintStats.total} 条术语边界</span>
      </div>

      <section className="mjp-card">
        <div className="mjp-card-hd">
          <div className="ti">
            手动新增术语
            <div className="desc">名称与定义由你填写，来源会如实标为「作者手动录入」，不冒充 AI 提取结果。</div>
          </div>
        </div>
        <div className="mjp-card-bd">
          <div className="mjp-grid-2">
            <Field label="术语名称" hint="必填；例如「星纹古钟」。">
              <input className="mjp-input" type="text" maxLength={120} aria-label="新术语名称" value={newTerm} onChange={(event) => setNewTerm(event.target.value)} />
            </Field>
            <Field label="术语定义" hint="必填；定义不会被程序代写。">
              <input className="mjp-input" type="text" maxLength={2_000} aria-label="新术语定义" value={newDefinition} onChange={(event) => setNewDefinition(event.target.value)} />
            </Field>
          </div>
          <div className="mjp-row" style={{ marginTop: 12 }}>
            <Btn variant="primary" icon={Plus} onClick={addConstraint}>新增术语</Btn>
          </div>
          {constraintMessage && <Banner tone="warn" title="这一步没有写入">{constraintMessage}</Banner>}
        </div>
      </section>

      {model.constraints.length === 0 ? (
        <p className="mjp-muted">项目里还没有术语边界记录。可以用上面的表单手动建立，也可以由 AI 提取流程写入（默认「待确认」，确认与否由你在这里决定）。</p>
      ) : (
        model.constraints.map((constraint) => (
          <section key={constraint.id} className="mjp-card">
            <div className="mjp-card-hd">
              <div className="ti">
                {constraint.term}
                <div className="desc">
                  {constraint.entityType || '未标注实体类型'} · 来源：{constraint.sourceExcerpt.slice(0, 60) || '未记录证据摘录'}
                </div>
              </div>
              <div className="right">
                <Tag tone={constraintTone(constraint.status)} dot>{constraint.status}</Tag>
                {CONSTRAINT_STATUSES.filter((status) => status !== constraint.status).slice(0, 2).map((status) => (
                  <Btn
                    key={status}
                    size="sm"
                    onClick={() => setConstraintStatus(constraint.id, status)}
                    title={`把「${constraint.term}」标记为${status}（作者决定，不修改定义文本）`}
                  >
                    标记{status}
                  </Btn>
                ))}
                {pendingRemoveId === constraint.id ? (
                  <>
                    <Btn size="sm" variant="primary" onClick={() => confirmRemoveConstraint(constraint.id)}>确认删除</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setPendingRemoveId(undefined)}>取消</Btn>
                  </>
                ) : (
                  <Btn
                    size="sm"
                    variant="danger"
                    icon={Trash2}
                    aria-label={`删除术语 ${constraint.term}`}
                    onClick={() => {
                      setConstraintMessage(undefined)
                      setPendingRemoveId(constraint.id)
                    }}
                  >
                    删除
                  </Btn>
                )}
              </div>
            </div>
            <div className="mjp-card-bd">
              {pendingRemoveId === constraint.id && (
                <Banner tone="warn" title="删除前请确认影响">
                  这条术语当前为「{constraint.status}」；{constraintReferenceCount(project, constraint.id)} 条未处理的审校问题引用它。
                  {constraint.status === '已锁定' ? '锁定中的术语需要先改成其他状态（明确解锁）才能删除。' : '删除不会改动任何正文。'}
                </Banner>
              )}
              <div className="mjp-grid-2">
                <Field label="术语名称" hint="必填，不能留空。">
                  <input
                    className="mjp-input"
                    type="text"
                    maxLength={120}
                    aria-label={`术语名称 ${constraint.id}`}
                    value={constraint.term}
                    onChange={(event) => editConstraintText(constraint.id, 'term', event.target.value)}
                  />
                </Field>
                <Field label="实体类型" hint="如：器物 / 势力 / 地点。">
                  <input
                    className="mjp-input"
                    type="text"
                    maxLength={120}
                    aria-label={`实体类型 ${constraint.id}`}
                    value={constraint.entityType}
                    onChange={(event) => editConstraintText(constraint.id, 'entityType', event.target.value)}
                  />
                </Field>
                <Field label="定义" hint="必填，不能清空。">
                  <textarea
                    className="mjp-textarea"
                    rows={2}
                    maxLength={2_000}
                    aria-label={`定义 ${constraint.id}`}
                    value={constraint.definition}
                    onChange={(event) => editConstraintText(constraint.id, 'definition', event.target.value)}
                  />
                </Field>
                <Field label="不是" hint="明确排除的误解，避免歧义。">
                  <textarea
                    className="mjp-textarea"
                    rows={2}
                    maxLength={2_000}
                    aria-label={`不是 ${constraint.id}`}
                    value={constraint.notDefinition}
                    onChange={(event) => editConstraintText(constraint.id, 'notDefinition', event.target.value)}
                  />
                </Field>
                <Field label="允许用法" hint="用顿号、逗号或换行分隔。">
                  <input
                    className="mjp-input"
                    type="text"
                    aria-label={`允许用法 ${constraint.id}`}
                    value={constraint.allowedUsages.join('、')}
                    onChange={(event) => editConstraintList(constraint.id, 'allowedUsages', event.target.value)}
                  />
                </Field>
                <Field label="未决问题" hint="用顿号、逗号或换行分隔；留空即无。">
                  <input
                    className="mjp-input"
                    type="text"
                    aria-label={`未决问题 ${constraint.id}`}
                    value={constraint.unresolvedQuestions.join('、')}
                    onChange={(event) => editConstraintList(constraint.id, 'unresolvedQuestions', event.target.value)}
                  />
                </Field>
              </div>
              {constraint.allowedUsages.length > 0 && (
                <div className="mjp-tag-row">
                  <span className="mjp-muted">允许用法</span>
                  {constraint.allowedUsages.map((usage) => <Tag key={usage} tone="ok">{usage}</Tag>)}
                </div>
              )}
              {constraint.forbiddenUsages.length > 0 && (
                <div className="mjp-tag-row">
                  <span className="mjp-muted">禁止用法</span>
                  {constraint.forbiddenUsages.map((usage) => (
                    <Tag key={usage.phrase} tone="danger" >
                      {usage.phrase}
                    </Tag>
                  ))}
                </div>
              )}
              {constraint.facts.length > 0 && (
                <ul className="mjp-kn">
                  {constraint.facts.map((fact, index) => (
                    <li key={`${constraint.id}-fact-${index}`}>
                      <span className="t">{fact.subject} · {fact.relation} · {fact.object}</span>
                      <span className="mjp-muted">{fact.polarity}</span>
                      <Tag tone={fact.polarity === '禁止' ? 'danger' : 'ok'}>{fact.polarity}</Tag>
                    </li>
                  ))}
                </ul>
              )}
              {constraint.unresolvedQuestions.length > 0 && (
                <div className="mjp-unresolved">
                  <span className="k">{constraint.unresolvedQuestions.length} 项未决</span>
                  <ul>{constraint.unresolvedQuestions.map((question) => <li key={question}>{question}</li>)}</ul>
                </div>
              )}
            </div>
          </section>
        ))
      )}

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        世界观审校发现
        <span className="idx">{model.pendingFindingCount} 条待处理 / 共 {model.findings.length} 条</span>
      </div>

      {model.findings.length === 0 ? (
        <p className="mjp-muted">项目里还没有世界观审校发现。</p>
      ) : (
        model.findings.map((finding) => (
          <div
            key={finding.id}
            className={`mjp-issue${finding.severity === '高' ? ' is-danger' : finding.severity === '中' ? ' is-warn' : ' is-ok'}`}
          >
            <div className="mjp-issue-h">
              <AlertTriangle size={15} strokeWidth={1.8} aria-hidden="true" />
              <span className="tt">{finding.type}</span>
              <Tag tone={finding.status === '待处理' ? 'amber' : 'default'}>{finding.status}</Tag>
              <span className="loc">{finding.source} · 严重度 {finding.severity} · {finding.fieldPath}</span>
            </div>
            <div className="mjp-issue-b">
              {finding.explanation}
              {finding.excerpt && <blockquote>{finding.excerpt}</blockquote>}
              {finding.suggestedReplacement && (
                <p className="mjp-muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
                  建议替换（尚未应用）：{finding.suggestedReplacement}
                </p>
              )}
            </div>
          </div>
        ))
      )}

    </>
  )
}
