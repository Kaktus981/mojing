import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const cardSources = [
  'apps/web/src/components/workspace/views/tools/StyleWorkshopPage.tsx',
  'apps/web/src/components/workspace/views/outline-integrated/CreationStartModule.tsx',
  'apps/web/src/components/workspace/views/review/VersionHistoryPage.tsx',
  'apps/web/src/components/workspace/views/tools/AssistantSettingsPage.tsx',
  'apps/web/src/components/workspace/views/tools/TaskCenterPage.tsx',
  'apps/web/src/components/settings/panes/ImportPane.tsx'
]

describe('卡片标题副说明', () => {
  it('不再保留重复的操作边界说明', () => {
    const source = cardSources
      .map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'))
      .join('\n')

    for (const copy of [
      '同一个项目只绑定一个明确版本；停用不删除任何正文。',
      '整部长篇的起点；它会以最高优先级进入每次生成的上下文。',
      '空值不会被自动补成默认文本',
      '先预览差异 → 再确认恢复',
      '密钥只在全局设置里填写；这里只选择本项目用哪个服务。',
      '支持 TXT、Markdown、DOCX、墨境 JSON。旧「漫剧工坊」JSON 会被明确拒绝，不做隐式转换。'
    ]) {
      expect(source).not.toContain(copy)
    }
  })
})
