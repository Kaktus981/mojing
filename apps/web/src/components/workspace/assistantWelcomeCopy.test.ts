import { describe, expect, it } from 'vitest'
import { getWorkspaceAssistantProfile } from './workspaceAssistantProfiles'

const title = '雾城'

function allProfiles() {
  return ['idea', 'outline', 'world', 'writing', 'memory', 'delivery']
    .map((stage) => getWorkspaceAssistantProfile(stage, title))
    .concat(getWorkspaceAssistantProfile('world', title, true))
}

function profileCopy(profile: ReturnType<typeof getWorkspaceAssistantProfile>): string {
  return [
    profile.welcome,
    ...profile.contextSources,
    ...profile.quickActions.flatMap((action) => [action.label, action.prompt]),
    profile.resultPresentation,
    ...profile.proposalTypes
  ].join('\n')
}

function chineseLength(value: string): number {
  return value.match(/[\u3400-\u9fff]/g)?.length ?? 0
}

describe('助手欢迎语', () => {
  it('全局保持短句，不用项目自述模板', () => {
    const profiles = allProfiles()

    for (const profile of profiles) {
      expect(chineseLength(profile.welcome), profile.name).toBeLessThanOrEqual(50)
      expect(profile.welcome).not.toContain('我是《')
    }
  })

  it('助手文案不暴露内部字段名', () => {
    for (const profile of allProfiles()) {
      expect(profileCopy(profile)).not.toMatch(/\b(seed|settings|targetId|replacesId)\b/)
    }
  })
})
