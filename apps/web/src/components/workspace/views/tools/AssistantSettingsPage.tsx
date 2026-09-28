import { Cpu, FileText, History, Link, Network, RefreshCw, RotateCcw, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  AssistantTaskType, CreativeCapability, CreativeSkillPreviewResult, NovelProject, ProviderConfigPublic
} from '../../../../../../../packages/contracts/src'
import { ASSISTANT_TASK_TYPES } from '../../../../../../../packages/contracts/src'
import { mojingClient, type CreativeSkillVersionRecord, type RemoteCreativeSkillPreviewResult, type RemoteCreativeSkillUpdatePreviewResult } from '../../../../api/mojingClient'
import { LOOPBACK } from '../../../settings/ProviderConfigForm'
import { Btn, Card, EmptyState, Field, Status, Switch, Tag } from '../../../ui/Primitives'
import { SeatAssemblyPanel } from './SeatCapabilityAssembler'
import {
  activeSkillVersion, describeSkillSource, describeSkillStatus, nextSkillCenterStep, normalizeRemoteSkillUrl,
  previousSkillCenterStep, skillCenterSteps, summarizeVersionAction, type SkillCenterCapability, type SkillCenterStepId
} from './skillCenterModel'
import '../../../../styles/skill-center.css'

const TASK_TYPES = ASSISTANT_TASK_TYPES
/** 用户配置能力可选择的适用任务（与契约 `CreativeTaskScopeSchema` 一致）。 */
const TASK_SCOPE_OPTIONS: ReadonlyArray<CreativeCapability['taskScopes'][number]> = [
  '世界设定', '结构规划', '场景节拍', '正文创作', '连续性', '记忆', '伏笔', '中文审校'
]

function message(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败。'
}

function versionLabel(version: CreativeSkillVersionRecord): string {
  return version.version ?? version.skillVersion ?? (version.revision ? String(version.revision) : '未知')
}

function loadedAtLabel(value?: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * 助手与技能（项目工具 · 技能中心）。
 *
 * 本页负责**模型选择、任务覆盖，以及技能文件的导入 / 启停 / 编辑 / 删除**。
 * 席位与能力装配面板（`SeatCapabilityAssembler`）在「任务中心」与本页共用同一实现，
 * 本页只做它的容器，不再复制第二套装配逻辑。右侧常驻助手只显示当前任务的简短摘要（D5/D7）。
 *
 * 写入边界：
 *  1. 自定义（用户配置）能力可编辑并生成新版本；**内置能力由服务端标记为不可改写**，本页如实渲染为只读。
 *  2. 技能是纯文字创作参考，导入前先预览、未知脚本字段一律拒绝，不执行任何命令。
 *  3. 密钥只在全局设置里管理，本页只选择已配置的服务，不展示也不保存密钥。
 */
export function AssistantSettingsPage({ project }: { project: NovelProject }): React.JSX.Element {
  const [capabilities, setCapabilities] = useState<SkillCenterCapability[]>([])
  const [providers, setProviders] = useState<ProviderConfigPublic[]>([])
  const [taskConfigs, setTaskConfigs] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [failure, setFailure] = useState<string>()

  const [filename, setFilename] = useState('')
  const [content, setContent] = useState('')
  const [preview, setPreview] = useState<CreativeSkillPreviewResult>()
  const [previewError, setPreviewError] = useState<string>()
  const [remoteUrl, setRemoteUrl] = useState('')
  const [remoteRef, setRemoteRef] = useState('')
  const [remotePreview, setRemotePreview] = useState<RemoteCreativeSkillPreviewResult>()
  const [remoteError, setRemoteError] = useState<string>()
  const [versionHistoryId, setVersionHistoryId] = useState<string>()
  const [versions, setVersions] = useState<Record<string, CreativeSkillVersionRecord[]>>({})
  const [versionBusy, setVersionBusy] = useState<string>()
  const [activeStep, setActiveStep] = useState<SkillCenterStepId>('directory')
  const [versionPreview, setVersionPreview] = useState<{
    kind: 'update' | 'rollback'
    capability: SkillCenterCapability
    version?: CreativeSkillVersionRecord
    remote?: RemoteCreativeSkillUpdatePreviewResult
  }>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showAllTasks, setShowAllTasks] = useState(false)
  /** 正在编辑的自定义能力；`undefined` 表示没有打开编辑表单。 */
  const [editingId, setEditingId] = useState<string>()
  const [editDraft, setEditDraft] = useState<{ name: string; description: string; taskScopes: string[]; skillText: string }>()

  const refresh = async (): Promise<void> => {
    const [seatsResult, providerList, taskList, catalog] = await Promise.all([
      mojingClient.creativeSeats.list(project.id),
      mojingClient.providers.list(),
      mojingClient.assistantTasks.list(project.id),
      mojingClient.creativeSkills.catalog(project.id)
    ])
    setCapabilities((catalog.length ? catalog : seatsResult.capabilities) as SkillCenterCapability[])
    setProviders(providerList)
    setTaskConfigs(Object.fromEntries(taskList.filter((item) => item.providerId).map((item) => [item.taskType, item.providerId!])))
  }

  async function retryLoad(): Promise<void> {
    setRetrying(true)
    setFailure(undefined)
    setLoading(true)
    try {
      await refresh()
    } catch (error) {
      setFailure(message(error))
    } finally {
      setLoading(false)
      setRetrying(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try { await refresh() } catch (error) { if (!cancelled) setFailure(message(error)) } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  const custom = useMemo(() => capabilities.filter((item) => item.source === '用户配置'), [capabilities])
  const builtIn = useMemo(() => capabilities.filter((item) => item.source === '内置'), [capabilities])
  const loaded = useMemo(() => capabilities.filter((item) => describeSkillStatus(item).tone === 'ok'), [capabilities])
  const latestLoaded = useMemo(() => loaded.reduce<SkillCenterCapability | undefined>((current, item) => {
    if (!item.loadedAt) return current
    return !current?.loadedAt || item.loadedAt > current.loadedAt ? item : current
  }, undefined), [loaded])

  async function runPreview(): Promise<void> {
    setBusy(true); setPreviewError(undefined); setPreview(undefined); setNotice(undefined)
    try {
      setPreview(await mojingClient.creativeSkills.preview(project.id, { filename: filename.trim() || 'skill.md', content }))
      setActiveStep('permissions')
    } catch (error) {
      setPreviewError(message(error))
    } finally { setBusy(false) }
  }

  async function install(): Promise<void> {
    if (!preview) return
    setBusy(true); setNotice(undefined); setPreviewError(undefined)
    try {
      const installed = await mojingClient.creativeSkills.install(project.id, {
        filename: filename.trim() || 'skill.md', content, expectedDigest: preview.preview.sourceDigest
      })
      await refresh()
      setPreview(undefined)
      setContent('')
      setFilename('')
      setActiveStep('directory')
      setNotice(`已导入「${installed.name}」，当前为停用状态；需要时再在下方启用。`)
    } catch (error) {
      setPreviewError(message(error))
    } finally { setBusy(false) }
  }

  async function runRemotePreview(): Promise<void> {
    const normalizedUrl = normalizeRemoteSkillUrl(remoteUrl)
    if (!normalizedUrl) {
      setRemoteError('请输入以 HTTPS 开头、文件名为 SKILL.md 的远程地址。')
      setRemotePreview(undefined)
      return
    }
    setBusy(true); setRemoteError(undefined); setRemotePreview(undefined); setNotice(undefined)
    try {
      setRemotePreview(await mojingClient.creativeSkills.remotePreview(project.id, {
        url: normalizedUrl,
        ...(remoteRef.trim() ? { expectedRef: remoteRef.trim() } : {})
      }))
      setActiveStep('permissions')
    } catch (error) { setRemoteError(message(error)) } finally { setBusy(false) }
  }

  async function installRemote(): Promise<void> {
    if (!remotePreview) return
    const normalizedUrl = normalizeRemoteSkillUrl(remoteUrl)
    if (!normalizedUrl) return
    setBusy(true); setRemoteError(undefined); setNotice(undefined)
    try {
      const installed = await mojingClient.creativeSkills.remoteInstall(project.id, {
        url: normalizedUrl,
        ...(remoteRef.trim() ? { expectedRef: remoteRef.trim() } : {}),
        expectedDigest: remotePreview.preview.sourceDigest
      })
      await refresh()
      setRemotePreview(undefined); setRemoteUrl(''); setRemoteRef('')
      setActiveStep('directory')
      setNotice(`已固定并导入「${installed.name}」；当前为停用状态，启用前不会进入创作调用。`)
    } catch (error) { setRemoteError(message(error)) } finally { setBusy(false) }
  }

  async function loadVersions(capability: SkillCenterCapability): Promise<void> {
    if (versionHistoryId === capability.id) {
      setVersionHistoryId(undefined)
      return
    }
    setVersionHistoryId(capability.id); setVersionBusy(capability.id); setNotice(undefined); setActiveStep('versions'); setVersionPreview(undefined)
    try {
      const result = await mojingClient.creativeSkills.versions(project.id, capability.id)
      setVersions((previous) => ({ ...previous, [capability.id]: result }))
    } catch (error) { setNotice(message(error)); setVersionHistoryId(undefined) } finally { setVersionBusy(undefined) }
  }

  async function previewRemoteUpdate(capability: SkillCenterCapability): Promise<void> {
    if (!capability.sourceUrl) return
    setVersionBusy(capability.id); setNotice(undefined)
    try {
      const remote = await mojingClient.creativeSkills.remoteUpdatePreview(project.id, capability.id, {
        url: capability.sourceUrl,
        ...(capability.sourceRef ? { expectedRef: capability.sourceRef } : {})
      })
      const nextVersion = remote.preview.capability.skillVersion ?? remote.source.sourceRef
      const currentVersion = capability.skillVersion ?? capability.loadedVersion ?? '未知'
      if (remote.source.sourceDigest === capability.sourceDigest) {
        setNotice(`「${capability.name}」当前已经是最新来源。`)
        return
      }
      setVersionPreview({ kind: 'update', capability, remote })
      setActiveStep('versions')
      setNotice(`已读到「${capability.name}」的更新预览（v${currentVersion} → v${nextVersion}），尚未应用。`)
    } catch (error) { setNotice(message(error)) } finally { setVersionBusy(undefined) }
  }

  function previewRollback(capability: SkillCenterCapability, version: CreativeSkillVersionRecord): void {
    setVersionPreview({ kind: 'rollback', capability, version })
    setVersionHistoryId(capability.id)
    setActiveStep('versions')
    setNotice(undefined)
  }

  async function applyVersionPreview(): Promise<void> {
    if (!versionPreview) return
    const { capability } = versionPreview
    setVersionBusy(capability.id); setNotice(undefined)
    try {
      if (versionPreview.kind === 'update' && versionPreview.remote) {
        await mojingClient.creativeSkills.updateRemote(project.id, capability.id, {
          url: capability.sourceUrl,
          ...(capability.sourceRef ? { expectedRef: capability.sourceRef } : {}),
          ...(capability.sourceDigest ? { expectedDigest: capability.sourceDigest } : {}),
          previewDigest: versionPreview.remote.preview.sourceDigest
        })
        await refresh()
        setNotice(`已应用「${capability.name}」的更新。`)
      } else if (versionPreview.kind === 'rollback' && versionPreview.version?.id) {
        await mojingClient.creativeSkills.rollback(project.id, capability.id, versionPreview.version.id)
        await refresh()
        setNotice(`已将「${capability.name}」回滚到 v${versionLabel(versionPreview.version)}。`)
      }
      setVersionPreview(undefined)
    } catch (error) { setNotice(message(error)) } finally { setVersionBusy(undefined) }
  }

  async function toggleCapability(capability: SkillCenterCapability, enabled: boolean): Promise<void> {
    setBusy(true); setNotice(undefined)
    try {
      await mojingClient.creativeSeats.setCapabilityEnabled(project.id, capability.id, enabled)
      await refresh()
    } catch (error) { setNotice(message(error)) } finally { setBusy(false) }
  }

  async function removeCapability(capability: SkillCenterCapability): Promise<void> {
    setBusy(true); setNotice(undefined)
    try {
      await mojingClient.creativeSeats.removeCapability(project.id, capability.id)
      await refresh()
    } catch (error) { setNotice(message(error)) } finally { setBusy(false) }
  }

  /** 打开编辑表单：只对用户配置能力开放；内置能力没有这个入口。 */
  function beginEdit(capability: SkillCenterCapability): void {
    setNotice(undefined)
    setEditingId(capability.id)
    setEditDraft({
      name: capability.name,
      description: capability.description,
      taskScopes: [...capability.taskScopes],
      skillText: capability.skillText ?? ''
    })
  }

  function closeEdit(): void {
    setEditingId(undefined)
    setEditDraft(undefined)
  }

  /**
   * 保存编辑：走 `creativeSeats.updateCapability`（服务端会生成新的 updatedAt/摘要版本）。
   * 名称、说明与至少一项适用任务必填；技能文字留空表示不修改原有文字。
   */
  async function saveEdit(): Promise<void> {
    if (!editingId || !editDraft) return
    if (!editDraft.name.trim() || !editDraft.description.trim() || editDraft.taskScopes.length === 0) {
      setNotice('技能名称、用途说明与至少一项适用任务都必填。')
      return
    }
    setBusy(true); setNotice(undefined)
    try {
      await mojingClient.creativeSeats.updateCapability(project.id, editingId, {
        name: editDraft.name.trim(),
        description: editDraft.description.trim(),
        taskScopes: editDraft.taskScopes as CreativeCapability['taskScopes'],
        ...(editDraft.skillText.trim() ? { skillText: editDraft.skillText.trim() } : {})
      })
      await refresh()
      closeEdit()
      setNotice('技能已保存为新版本；启用状态保持不变。')
    } catch (error) { setNotice(message(error)) } finally { setBusy(false) }
  }

  async function pickFile(file: File | undefined): Promise<void> {
    if (!file) return
    setFilename(file.name)
    setContent(await file.text())
    setPreview(undefined)
    setPreviewError(undefined)
  }

  async function setTaskProvider(taskType: AssistantTaskType, providerId: string): Promise<void> {
    setBusy(true); setNotice(undefined)
    try {
      if (providerId) await mojingClient.assistantTasks.save(project.id, taskType, { providerId })
      else await mojingClient.assistantTasks.remove(project.id, taskType)
      setTaskConfigs((prev) => {
        const next = { ...prev }
        if (providerId) next[taskType] = providerId
        else delete next[taskType]
        return next
      })
    } catch (error) { setNotice(message(error)) } finally { setBusy(false) }
  }

  if (loading) {
    return (
      <div className="mjp-col" style={{ gap: 12 }}>
        <div className="mjp-skeleton" style={{ height: 72 }} />
        <div className="mjp-skeleton" style={{ height: 120 }} />
      </div>
    )
  }

  if (failure) {
    return (
      <div role="alert" aria-live="assertive">
        <EmptyState
          icon={Network}
          title="读不到助手配置"
          description={`${failure} 配置数据都在本机，现在没有连上，所以这里无法展示。`}
          action={<Btn size="sm" icon={RefreshCw} disabled={retrying} data-testid="skill-center-retry" onClick={() => void retryLoad()}>{retrying ? '正在重试…' : '重试读取'}</Btn>}
        />
      </div>
    )
  }

  return (
    <>
      <div className="skill-center-page" data-testid="assistant-settings-page" data-skill-active={activeStep}>
        <header className="skill-center-header">
          <div>
            <p className="skill-center-kicker">助手与技能</p>
            <h2>配置创作助手</h2>
            <p className="skill-center-lead">先确认实际配置，再接入技能；任何更新与回滚都会先给你看变化。</p>
          </div>
          <div className="skill-center-evidence" role="status" aria-live="polite">
            <span className="skill-center-evidence-dot" aria-hidden="true" />
            {loading ? '正在读取配置' : failure ? '配置读取失败' : `${capabilities.length} 项能力 · ${providers.length} 个模型服务`}
          </div>
        </header>

        <nav className="skill-center-steps" aria-label="助手与技能设置步骤">
          {skillCenterSteps.map((step, index) => (
            <button
              key={step.id}
              type="button"
              className={activeStep === step.id ? 'is-active' : undefined}
              aria-current={activeStep === step.id ? 'step' : undefined}
              onClick={() => setActiveStep(step.id)}
            >
              <span className="skill-center-step-index">{index + 1}</span>
              <span><b>{step.label}</b><small>{step.description}</small></span>
            </button>
          ))}
        </nav>

        {notice && <div className="mjp-banner info" role="status"><div>{notice}</div></div>}

      <div className="skill-center-directory" hidden={activeStep !== 'directory'} data-skill-step="directory">
      <section className="assistant-seat-assembly">
        <h2>席位与能力装配</h2>
        <p className="mjp-muted" style={{ margin: '4px 0 0', fontSize: 12.5, lineHeight: 1.7 }}>
          每个席位可以单独启停，也可以更换模型或装配能力；展开「高级设置」后即可调整。
        </p>
        <SeatAssemblyPanel project={project} />
      </section>

      <div className="skill-center-model-card">
      <Card title="模型服务" icon={Cpu} tight>
        {providers.length === 0 ? (
          <div>
            <Status tone="warn">尚未配置模型服务</Status>
            <p className="mjp-muted" style={{ margin: '8px 0 0', fontSize: 12.5, lineHeight: 1.7 }}>
              没有模型服务也可以继续手动写作；技能库与任务配置现在就能保存，配置好服务后直接生效。
            </p>
          </div>
        ) : (
          providers.map((provider) => (
            <div key={provider.id} className="mjp-health-row">
              <span className="nm"><b>{provider.name}</b><span className="mjp-muted"> · {provider.model}</span></span>
              <span className="mjp-row" style={{ gap: 6 }}>
                {provider.hasApiKey ? <Tag tone="ok" dot>已填密钥</Tag> : LOOPBACK.test(provider.baseUrl) ? <Tag tone="ok" dot>本机服务无需密钥</Tag> : <Tag tone="amber" dot>缺密钥</Tag>}
              </span>
            </div>
          ))
        )}
      </Card>
      </div>

      <div className="skill-center-task-card">
      <Card
        title="任务专用模型"
        icon={Cpu}
        headRight={<Switch checked={showAllTasks} onChange={setShowAllTasks} label="显示全部任务" />}
        tight
      >
        {(showAllTasks ? TASK_TYPES : TASK_TYPES.slice(0, 3)).map((taskType) => (
          <div key={taskType} className="mjp-health-row">
            <span className="nm">{taskType}</span>
            <select
              aria-label={`${taskType}使用的模型服务`}
              value={taskConfigs[taskType] ?? ''}
              disabled={busy}
              onChange={(event) => void setTaskProvider(taskType, event.target.value)}
            >
              <option value="">沿用项目默认</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>
              ))}
            </select>
          </div>
        ))}
      </Card>
      </div>

      <div className="skill-center-library-card">
      <Card title="技能库" icon={Network} tight>
        <div className="mjp-notice" style={{ marginBottom: 10 }} data-testid="loaded-skills">
          <div className="ic"><ShieldCheck size={17} strokeWidth={1.8} /></div>
          <div>
            <b>已加载技能</b>
            <p>{loaded.length ? loaded.map((item) => `${item.name}${item.loadedStages?.length ? `（${item.loadedStages.join('、')}）` : ''}`).join('、') : '当前没有技能进入真实调用。启用后会按适用任务自动装配。'}</p>
            {latestLoaded?.loadedAt && loadedAtLabel(latestLoaded.loadedAt) && <small className="skill-center-load-meta">最近一次真实调用：{loadedAtLabel(latestLoaded.loadedAt)} · {latestLoaded.name}</small>}
          </div>
        </div>
        {custom.length === 0 ? (
          <p className="mjp-muted" style={{ margin: '0 0 8px', fontSize: 13 }}>还没有导入任何技能。</p>
        ) : (
          custom.map((capability) => {
            const source = describeSkillSource(capability)
            const status = describeSkillStatus(capability)
            const history = versions[capability.id] ?? []
            const active = activeSkillVersion({ ...capability, versions: history })
            return (
            <div key={capability.id} className="custom-skill-row">
              <div className="mjp-health-row" data-testid="custom-skill">
                <span className="nm">
                  <b>{capability.name}</b>
                  <span className="mjp-muted"> · {capability.description}</span>
                  <span className="mjp-muted"> · 适用：{capability.taskScopes.join('、')}</span>
                </span>
                <span className="mjp-row" style={{ gap: 6 }}>
                  <Tag tone="outline">{source.label}</Tag>
                  <Tag tone="outline">{capability.permission}</Tag>
                  <span data-testid="skill-state"><Tag tone={capability.enabled ? 'ok' : 'default'} dot>{capability.enabled ? '已启用' : '已停用'}</Tag></span>
                  {capability.enabled && status.tone === 'ok' ? <Tag tone="ok" dot>{status.label}</Tag> : capability.enabled ? <Tag tone="amber" dot>待加载</Tag> : null}
                  {capability.skillVersion ? <Tag tone="outline">v{capability.skillVersion}</Tag> : null}
                  <Btn
                    size="sm"
                    disabled={busy}
                    data-testid="custom-skill-edit"
                    onClick={() => (editingId === capability.id ? closeEdit() : beginEdit(capability))}
                  >
                    {editingId === capability.id ? '收起编辑' : '编辑'}
                  </Btn>
                  <Btn size="sm" disabled={busy} onClick={() => void toggleCapability(capability, !capability.enabled)}>
                    {capability.enabled ? '停用' : '启用'}
                  </Btn>
                  {(capability.sourceKind === 'remote' || capability.sourceKind === '远程' || capability.sourceUrl) && (
                    <>
                      <Btn size="sm" icon={RefreshCw} disabled={busy || versionBusy === capability.id} data-testid="remote-skill-update" onClick={() => void previewRemoteUpdate(capability)}>检查更新</Btn>
                    </>
                  )}
                  <Btn size="sm" icon={History} disabled={busy || versionBusy === capability.id} data-testid="skill-history" onClick={() => void loadVersions(capability)}>{versionHistoryId === capability.id ? '收起版本' : '版本记录'}</Btn>
                  <Btn size="sm" icon={Trash2} disabled={busy} onClick={() => void removeCapability(capability)}>删除</Btn>
                </span>
              </div>
              <div className="mjp-muted" style={{ margin: '-2px 0 8px', fontSize: 12 }} data-testid="skill-source">
                {source.detail}
              </div>
              {editingId === capability.id && editDraft && (
                <div className="mjp-window" style={{ margin: '8px 0' }}>
                  <Field label="能力名称">
                    <input className="mjp-input" aria-label="能力名称" value={editDraft.name} onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })} />
                  </Field>
                  <Field label="用途说明">
                    <textarea className="mjp-textarea" rows={2} aria-label="用途说明" value={editDraft.description} onChange={(event) => setEditDraft({ ...editDraft, description: event.target.value })} />
                  </Field>
                  <Field label="适用任务" hint="至少保留一项。">
                    <div className="mjp-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {TASK_SCOPE_OPTIONS.map((scope) => (
                        <button
                          key={scope}
                          type="button"
                          className={editDraft.taskScopes.includes(scope) ? 'mjp-chip is-on' : 'mjp-chip'}
                          onClick={() => setEditDraft({
                            ...editDraft,
                            taskScopes: editDraft.taskScopes.includes(scope)
                              ? editDraft.taskScopes.filter((item) => item !== scope)
                              : [...editDraft.taskScopes, scope]
                          })}
                        >
                          {scope}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label="技能文字" hint="纯文字创作参考；留空表示不修改原有技能文字。">
                    <textarea className="mjp-textarea" rows={4} aria-label="技能文字" value={editDraft.skillText} onChange={(event) => setEditDraft({ ...editDraft, skillText: event.target.value })} />
                  </Field>
                  <div className="mjp-row" style={{ gap: 8 }}>
                    <Btn size="sm" variant="primary" disabled={busy} data-testid="custom-skill-save" onClick={() => void saveEdit()}>保存为新版本</Btn>
                    <Btn size="sm" variant="ghost" disabled={busy} onClick={closeEdit}>取消</Btn>
                  </div>
                  </div>
              )}
              {versionHistoryId === capability.id && (
                <div className="mjp-window" style={{ margin: '8px 0' }} data-testid="skill-version-history">
                  <div className="mjp-health-row">
                    <span className="nm"><b>版本记录</b><span className="mjp-muted"> · 当前生效版本 {active ? `v${active.skillVersion ?? active.version ?? active.revision ?? '未知'}` : '未标记'}</span></span>
                    {versionBusy === capability.id ? <Status tone="warn">读取中</Status> : null}
                  </div>
                  {history.length === 0 && versionBusy !== capability.id ? <p className="mjp-muted">暂时没有可回滚的旧版本。</p> : history.map((version) => {
                    const isActive = version.active || version.skillVersion === capability.skillVersion || version.version === capability.skillVersion
                    return (
                      <div key={version.id} className="mjp-health-row">
                        <span className="nm"><b>v{versionLabel(version)}</b><span className="mjp-muted"> · {version.createdAt.slice(0, 10)}{isActive ? ' · 当前' : ''}</span></span>
                        <Btn size="sm" variant="ghost" icon={RotateCcw} disabled={isActive || busy || versionBusy === capability.id} onClick={() => previewRollback(capability, version)}>预览回滚</Btn>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            )
          })
        )}

        <div className="mjp-health-row" style={{ marginTop: 8 }}>
          <span className="nm">
            <b>内置能力</b>
            <span className="mjp-muted"> · {builtIn.length} 项，随栏目自动装配，不能删除或编辑</span>
          </span>
          <Btn size="sm" onClick={() => setShowAdvanced((prev) => !prev)}>{showAdvanced ? '收起' : '查看'}</Btn>
        </div>
        {showAdvanced && builtIn.map((capability) => (
          <div key={capability.id} className="mjp-health-row">
            <span className="nm"><b>{capability.name}</b><span className="mjp-muted"> · {capability.description}</span></span>
            <span className="mjp-row" style={{ gap: 6 }}>
              <Tag tone="outline">{capability.permission}</Tag>
              <Tag tone={capability.enabled ? 'ok' : 'default'} dot>{capability.enabled ? '可用' : '已停用'}</Tag>
            </span>
          </div>
        ))}
      </Card>
      </div>

      </div>

      <div hidden={activeStep !== 'connect'} data-skill-step="connect">
      <Card title="接入远程 SKILL.md" icon={Link} tight>
        <Field label="GitHub SKILL.md 地址" hint="仅接受 github.com 或 raw.githubusercontent.com 的 HTTPS 地址，路径最后一段必须是 SKILL.md。">
          <input
            className="mjp-input"
            aria-label="远程 SKILL.md 地址"
            value={remoteUrl}
            placeholder="https://github.com/owner/repo/blob/main/SKILL.md"
            onChange={(event) => { setRemoteUrl(event.target.value); setRemotePreview(undefined); setRemoteError(undefined) }}
          />
        </Field>
        <Field label="版本标记（可选）" hint="留空使用来源默认版本；填写后固定到指定版本。">
          <input
            className="mjp-input"
            aria-label="远程技能版本引用"
            value={remoteRef}
            placeholder="默认版本或版本号"
            onChange={(event) => { setRemoteRef(event.target.value); setRemotePreview(undefined) }}
          />
        </Field>
        <div className="mjp-row" style={{ gap: 8 }}>
          <Btn size="sm" icon={FileText} disabled={busy || !remoteUrl.trim()} onClick={() => void runRemotePreview()}>读取来源</Btn>
          <Btn size="sm" variant="primary" disabled={busy || !remotePreview} onClick={() => void installRemote()}>固定来源并导入</Btn>
        </div>
        {remoteError && <div className="mjp-notice is-warn" role="alert" style={{ marginTop: 10 }} data-testid="remote-skill-error"><div className="ic"><ShieldCheck size={17} strokeWidth={1.8} /></div><div><b>远程来源未通过校验</b><p>{remoteError}</p></div></div>}
        {remotePreview && (
          <div className="mjp-notice" style={{ marginTop: 10 }} data-testid="remote-skill-preview">
            <div className="ic"><ShieldCheck size={17} strokeWidth={1.8} /></div>
            <div>
              <b>预览：{remotePreview.preview.capability.name}</b>
              <p>{remotePreview.preview.capability.description}</p>
              <ul>
                <li>来源：{remotePreview.source?.sourceUrl ?? remotePreview.sourceUrl ?? remoteUrl}{remotePreview.source?.sourceRef ? ` · ${remotePreview.source.sourceRef}` : remotePreview.sourceRef ? ` · ${remotePreview.sourceRef}` : ''}</li>
                <li>权限：{remotePreview.preview.capability.permission}（只作为文字创作参考）</li>
                <li>导入后：默认停用，启用前不会进入模型调用。</li>
              </ul>
              {remotePreview.existing ? <p>库里已有相同内容的技能「{remotePreview.existing.name}」，确认后会沿用已有记录，不覆盖当前启用状态。</p> : null}
              {remotePreview.preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          </div>
        )}
      </Card>
      </div>

      <div hidden={activeStep !== 'connect'} data-skill-step="connect">
      <Card title="导入技能" icon={Upload} tight>
        <Field label="技能文件" hint="只读取文件文字内容，不执行脚本，不访问网络。">
          <input
            type="file"
            accept=".md,.txt,.json"
            aria-label="选择技能文件"
            onChange={(event) => void pickFile(event.target.files?.[0])}
          />
        </Field>
        <Field label="技能正文（也可以直接粘贴）">
          <textarea
            aria-label="技能正文"
            value={content}
            rows={6}
            placeholder={'# 冲突设计\n不得改写已确认事实。\n约束：只指出冲突，不下结论。'}
            onChange={(event) => setContent(event.target.value)}
          />
        </Field>
        <div className="mjp-row" style={{ gap: 8 }}>
          <Btn size="sm" icon={FileText} disabled={busy || !content.trim()} onClick={() => void runPreview()}>预览</Btn>
          <Btn size="sm" variant="primary" disabled={busy || !preview} onClick={() => void install()}>确认导入</Btn>
        </div>

        {previewError && (
          <div className="mjp-notice is-warn" role="alert" style={{ marginTop: 10 }} data-testid="skill-error">
            <div className="ic"><ShieldCheck size={17} strokeWidth={1.8} /></div>
            <div><b>没能通过校验</b><p>{previewError}</p></div>
          </div>
        )}

        {preview && (
          <div className="mjp-notice" style={{ marginTop: 10 }} data-testid="skill-preview">
            <div className="ic"><ShieldCheck size={17} strokeWidth={1.8} /></div>
            <div>
              <b>预览：{preview.preview.capability.name}</b>
              <p>{preview.preview.capability.description}</p>
              <ul>
                <li>适用任务：{preview.preview.capability.taskScopes.join('、')}</li>
                <li>权限：{preview.preview.capability.permission}（不能扩大写入范围）</li>
                {preview.preview.capability.constraints.length > 0 && <li>约束：{preview.preview.capability.constraints.join('；')}</li>}
              </ul>
              {preview.existing ? (
                <p data-testid="skill-duplicate">
                  库里已经有同内容的技能「{preview.existing.name}」（{preview.existing.enabled ? '已启用' : '已停用'}），确认导入会直接沿用，不会覆盖它。
                </p>
              ) : (
                <p>导入后为停用状态，需要你在本页明确启用。</p>
              )}
              {preview.preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          </div>
        )}
      </Card>
      </div>

      <div hidden={activeStep !== 'permissions'} data-skill-step="permissions">
        <Card title="预览权限" icon={ShieldCheck} tight>
          {preview && (
            <div className="skill-center-preview" data-testid="skill-preview-step">
              <div className="skill-center-preview-title"><b>{preview.preview.capability.name}</b><Tag tone="outline">本地来源</Tag></div>
              <p>{preview.preview.capability.description}</p>
              <ul>
                <li>适用任务：{preview.preview.capability.taskScopes.join('、')}</li>
                <li>权限：{preview.preview.capability.permission}（不会扩大写入范围）</li>
                {preview.preview.capability.constraints.length > 0 && <li>约束：{preview.preview.capability.constraints.join('；')}</li>}
              </ul>
              {preview.existing ? <p>库里已有同内容技能「{preview.existing.name}」，确认后沿用已有记录，不覆盖当前启用状态。</p> : <p>导入后默认停用，需要你在目录中明确启用。</p>}
              {preview.preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          )}
          {remotePreview && (
            <div className="skill-center-preview" data-testid="remote-skill-preview-step">
              <div className="skill-center-preview-title"><b>{remotePreview.preview.capability.name}</b><Tag tone="outline">远程来源</Tag></div>
              <p>{remotePreview.preview.capability.description}</p>
              <ul>
                <li>来源：{remotePreview.source.sourceUrl} · {remotePreview.source.sourceRef}</li>
                <li>权限：{remotePreview.preview.capability.permission}（只作为文字创作参考）</li>
              </ul>
              {remotePreview.existing ? <p>库里已有相同内容的技能「{remotePreview.existing.name}」，确认后沿用已有记录。</p> : <p>导入后默认停用，启用前不会进入创作调用。</p>}
              {remotePreview.preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          )}
          {!preview && !remotePreview && <EmptyState icon={ShieldCheck} title="还没有可预览内容" description="回到接入步骤读取一个技能来源。" />}
          <div className="skill-center-step-actions">
            <Btn size="sm" variant="ghost" onClick={() => setActiveStep('connect')}>返回接入</Btn>
            {preview && <Btn size="sm" variant="primary" disabled={busy} onClick={() => void install()}>确认导入</Btn>}
            {remotePreview && <Btn size="sm" variant="primary" disabled={busy} onClick={() => void installRemote()}>确认固定并导入</Btn>}
          </div>
        </Card>
      </div>

      <div hidden={activeStep !== 'versions'} data-skill-step="versions">
        <Card title="版本更新与回滚" icon={History} tight>
          {versionPreview && (() => {
            const fromVersion = versionPreview.capability.skillVersion ?? versionPreview.capability.loadedVersion ?? '未知'
            const toVersion = versionPreview.kind === 'update'
              ? (versionPreview.remote?.preview.capability.skillVersion ?? versionPreview.remote?.source.sourceRef ?? '新来源')
              : versionLabel(versionPreview.version!)
            const summary = summarizeVersionAction({ kind: versionPreview.kind, capabilityName: versionPreview.capability.name, fromVersion, toVersion })
            return (
              <div className="skill-center-version-preview" data-testid="skill-version-preview" role="status">
                <div className="skill-center-preview-title"><b>{summary.title}</b><Tag tone="amber">尚未应用</Tag></div>
                <p>{summary.detail}</p>
                {versionPreview.kind === 'rollback' && versionPreview.version && <ul><li>目标版本：v{versionLabel(versionPreview.version)}</li><li>创建于：{versionPreview.version.createdAt.slice(0, 10)}</li></ul>}
                <div className="skill-center-step-actions">
                  <Btn size="sm" variant="ghost" disabled={versionBusy === versionPreview.capability.id} onClick={() => setVersionPreview(undefined)}>取消</Btn>
                  <Btn size="sm" variant="primary" disabled={versionBusy === versionPreview.capability.id} onClick={() => void applyVersionPreview()}>{summary.confirmLabel}</Btn>
                </div>
              </div>
            )
          })()}
          {!versionPreview && versionHistoryId && (() => {
            const capability = capabilities.find((item) => item.id === versionHistoryId)
            const history = versions[versionHistoryId] ?? []
            if (!capability) return <EmptyState icon={History} title="技能已不在当前目录" description="重新读取目录后再查看版本。" />
            return (
              <div data-testid="skill-version-history-step">
                <div className="skill-center-preview-title"><b>{capability.name}</b><Tag tone="outline">当前 v{capability.skillVersion ?? '未知'}</Tag></div>
                {versionBusy === capability.id && <p className="skill-center-muted">正在读取版本记录…</p>}
                {versionBusy !== capability.id && history.length === 0 && <p className="skill-center-muted">暂时没有可回滚的旧版本。</p>}
                {history.map((version) => {
                  const isActive = version.active || version.skillVersion === capability.skillVersion || version.version === capability.skillVersion
                  return <div key={version.id} className="skill-center-version-row"><span><b>v{versionLabel(version)}</b><small>{version.createdAt.slice(0, 10)}{isActive ? ' · 当前' : ''}</small></span><Btn size="sm" variant="ghost" disabled={isActive || busy || versionBusy === capability.id} onClick={() => previewRollback(capability, version)}>预览回滚</Btn></div>
                })}
              </div>
            )
          })()}
          {!versionPreview && !versionHistoryId && <EmptyState icon={History} title="选择一项技能查看版本" description="在目录中打开远程技能的版本记录。" />}
        </Card>
      </div>

      <div className="skill-center-step-actions skill-center-footer-actions">
        {previousSkillCenterStep(activeStep) && <Btn size="sm" variant="ghost" onClick={() => setActiveStep(previousSkillCenterStep(activeStep)!)}>上一步</Btn>}
        {nextSkillCenterStep(activeStep) && <Btn size="sm" variant="primary" onClick={() => setActiveStep(nextSkillCenterStep(activeStep)!)}>下一步：{skillCenterSteps.find((step) => step.id === nextSkillCenterStep(activeStep))?.label}</Btn>}
      </div>
      </div>
    </>
  )
}
