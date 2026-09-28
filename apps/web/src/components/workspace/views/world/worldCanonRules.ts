/**
 * 世界观完整度与定稿门槛的共享纯校验。
 *
 * 展示层（worldModel 的 buildWorldOverview）与定稿操作（worldWriting 的
 * applyWorldOverviewFinalize）共用同一份判定，避免两处各写一份规则。
 *
 * 这是「定稿操作」而不是新增保存通道：本模块不导入 React、不导入 store、
 * 也不依赖 worldModel，只负责判定「还缺哪些必填项、能不能定稿」。真正的落盘
 * 仍由调用方通过既有的 updateProject 完成（900ms 防抖 + baseRevision 乐观并发）。
 */

export const WORLD_REQUIRED_FIELDS = [
  { key: 'summary', label: '世界摘要' },
  { key: 'premise', label: '核心前提' },
  { key: 'geography', label: '地理' },
  { key: 'historySummary', label: '历史概览' }
] as const

export type WorldRequiredFieldKey = (typeof WORLD_REQUIRED_FIELDS)[number]['key']

export type WorldOverviewFields = {
  summary?: string
  premise?: string
  geography?: string
  historySummary?: string
}

/**
 * 收集世界观还缺哪些必填项。口径与 worldModel 的历史内联判定逐字一致：
 * 字段存在但 trim 后为空串即视为缺失。
 * 传入 undefined（尚未建立世界主体）时返回空数组——「缺主体」由调用方单独判定，
 * 不在这里冒充「缺某个字段」。
 */
export function collectWorldMissingFields(world: WorldOverviewFields | undefined): string[] {
  if (!world) return []
  const missing: string[] = []
  for (const { key, label } of WORLD_REQUIRED_FIELDS) {
    const value = world[key]
    if (!value || !value.trim()) missing.push(label)
  }
  return missing
}

export type WorldFinalizeCheck = { canFinalize: boolean; missing: string[] }

/** 只有世界主体存在且四项必填都填了，才算可以定稿。 */
export function checkWorldFinalize(world: WorldOverviewFields | undefined): WorldFinalizeCheck {
  const missing = collectWorldMissingFields(world)
  return { canFinalize: Boolean(world) && missing.length === 0, missing }
}
