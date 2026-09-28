export type WorkspaceInkBackground = 'landscape' | 'mountain' | 'harbor' | 'city'

/** 工作区共享水墨构图：二级栏、画布和助手栏使用同一张底图。 */
export function resolveWorkspaceInkBackground(stage: string, hasTool = false): WorkspaceInkBackground {
  if (hasTool) return 'mountain'
  if (stage === 'writing') return 'city'
  if (stage === 'outline' || stage === 'idea') return 'landscape'
  if (stage === 'memory') return 'harbor'
  // 世界观页面内容以空态和规则文字为主，沿用暖纸山水，避免深绿封面图抢过正文。
  if (stage === 'world') return 'landscape'
  // 项目概览是跨栏的首屏，使用留白更多的横向山水，便于在左右栏透出轮廓。
  return 'landscape'
}
