import type { CreativeCapability } from '../../../../../../../packages/contracts/src'

/** Optional runtime metadata added by the skill-center phase. */
export type SkillVersion = {
  id?: string
  version?: string
  skillVersion?: string
  revision?: number
  sourceDigest?: string
  sourceUrl?: string
  createdAt?: string
  active?: boolean
}

export type SkillCenterCapability = Omit<CreativeCapability, 'sourceKind' | 'sourceUrl' | 'sourceRef' | 'loadedVersion'> & {
  sourceKind?: '内置' | '用户配置' | '远程' | '本地' | 'builtin' | 'local' | 'remote'
  sourceUrl?: string
  sourceRef?: string
  loaded?: boolean
  loadedStages?: string[]
  status?: string
  loadedVersion?: string
  activeVersion?: string
  versions?: SkillVersion[]
}

export type SkillSourceDescription = { label: string; detail: string }
export type SkillStatusDescription = { label: string; tone: 'default' | 'amber' | 'ok' }

export type SkillCenterStepId = 'directory' | 'connect' | 'permissions' | 'versions'
export type SkillCenterStep = { id: SkillCenterStepId; label: string; description: string }

export const skillCenterSteps: readonly SkillCenterStep[] = [
  { id: 'directory', label: '目录', description: '模型、席位与已加载技能' },
  { id: 'connect', label: '接入', description: '读取本地或远程 SKILL.md' },
  { id: 'permissions', label: '预览权限', description: '查看范围后再导入' },
  { id: 'versions', label: '版本更新回滚', description: '预览变更并确认应用' }
]

export function nextSkillCenterStep(step: SkillCenterStepId): SkillCenterStepId | null {
  const index = skillCenterSteps.findIndex((item) => item.id === step)
  return index >= 0 && index < skillCenterSteps.length - 1 ? skillCenterSteps[index + 1]!.id : null
}

export function previousSkillCenterStep(step: SkillCenterStepId): SkillCenterStepId | null {
  const index = skillCenterSteps.findIndex((item) => item.id === step)
  return index > 0 ? skillCenterSteps[index - 1]!.id : null
}

export type VersionActionSummary = { title: string; detail: string; confirmLabel: string }

export function summarizeVersionAction(input: {
  kind: 'update' | 'rollback'
  capabilityName: string
  fromVersion: string
  toVersion: string
}): VersionActionSummary {
  if (input.kind === 'update') {
    return {
      title: `检查到「${input.capabilityName}」的新版本`,
      detail: `当前 v${input.fromVersion}，预览 v${input.toVersion}；确认后才会替换当前来源。`,
      confirmLabel: '确认应用更新'
    }
  }
  return {
    title: `预览回滚「${input.capabilityName}」`,
    detail: `当前 v${input.fromVersion}，确认后会恢复到 v${input.toVersion}；历史版本仍会保留。`,
    confirmLabel: '确认回滚'
  }
}

export function normalizeRemoteSkillUrl(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    const url = new URL(trimmed)
    const host = url.hostname.toLowerCase()
    if (
      url.protocol !== 'https:' ||
      !['github.com', 'raw.githubusercontent.com'].includes(host) ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      url.pathname.toLowerCase().split('/').pop() !== 'skill.md'
    ) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

export function describeSkillSource(capability: SkillCenterCapability): SkillSourceDescription {
  if (capability.sourceKind === '远程' || capability.sourceKind === 'remote' || capability.sourceUrl) {
    const sourceUrl = capability.sourceUrl
    let host = '已固定来源'
    if (sourceUrl) {
      try { host = new URL(sourceUrl).host } catch { host = '远程来源' }
    }
    const ref = capability.sourceRef ? ` · ${capability.sourceRef}` : ''
    return { label: '远程 SKILL.md', detail: `来源已固定 · ${host}${ref}` }
  }
  if (capability.sourceKind === '内置' || capability.sourceKind === 'builtin' || capability.source === '内置') return { label: '内置技能', detail: '随墨境版本提供' }
  return { label: '本地技能', detail: '项目内保存的纯文字技能' }
}

export function describeSkillStatus(capability: SkillCenterCapability): SkillStatusDescription {
  if (!capability.enabled) return { label: '已停用', tone: 'default' }
  const loaded = capability.loaded ?? ((capability.loadedStages?.length ?? 0) > 0 || capability.status === 'loaded' || capability.status === '已加载')
  if (loaded) {
    const version = capability.loadedVersion ?? capability.activeVersion ?? capability.skillVersion
    return { label: version ? `已加载 · v${version}` : '已加载', tone: 'ok' }
  }
  return { label: '已启用，待加载', tone: 'amber' }
}

export function activeSkillVersion(capability: SkillCenterCapability): SkillVersion | undefined {
  const activeVersion = capability.activeVersion ?? capability.loadedVersion ?? capability.skillVersion
  return capability.versions?.find((version) => version.active || version.version === activeVersion || version.skillVersion === activeVersion || version.revision?.toString() === activeVersion)
}
