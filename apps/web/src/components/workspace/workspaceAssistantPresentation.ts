import type { AssistantGuideUiMode } from './assistant/assistantModePreference'
import { FREE_CREATION_MODE, GUIDE_CREATION_MODE } from './assistant/assistantModePreference'

export type WorkspaceAssistantViewKind = 'chooser' | 'free' | 'guide' | 'guide-no-target'

export interface WorkspaceAssistantModeToggle {
  label: string
  nextMode: AssistantGuideUiMode
}

export function getWorkspaceAssistantModeToggle(kind: WorkspaceAssistantViewKind): WorkspaceAssistantModeToggle | undefined {
  if (kind === 'free') return { label: '切到引导构建', nextMode: GUIDE_CREATION_MODE }
  if (kind === 'guide' || kind === 'guide-no-target') return { label: '切到自由创作', nextMode: FREE_CREATION_MODE }
  return undefined
}
