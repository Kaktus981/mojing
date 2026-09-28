import type { NovelProject } from '../../../../../../../packages/contracts/src'
import { useNovelStore } from '../../../../novelStore'

type WorldBible = NonNullable<NovelProject['worldBible']>

/**
 * 世界观页面的写入通道：全部复用既有的 `updateProject`（900ms 防抖 + baseRevision
 * 乐观并发），不新增数据模型、不引入第二套保存逻辑。
 *
 * 约定（与旧 WorldView 完全一致，未做改变）：
 *   - 世界观字段被改动后，worldBible.status 回到「草稿」并更新 updatedAt；
 *   - 项目状态标记为「世界观草稿」。
 * 这样「草稿世界 + 已写正文」的组合仍会触发既有风险提醒，而不是被静默美化。
 */
export function useWorldEdit(): { editWorld: (mutate: (world: WorldBible) => void) => void } {
  const updateProject = useNovelStore((state) => state.updateProject)

  function editWorld(mutate: (world: WorldBible) => void): void {
    updateProject((draft) => {
      if (!draft.worldBible) return
      mutate(draft.worldBible)
      draft.worldBible.status = '草稿'
      draft.worldBible.updatedAt = new Date().toISOString()
      draft.status = '世界观草稿'
    })
  }

  return { editWorld }
}
