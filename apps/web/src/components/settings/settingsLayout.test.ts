import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SETTINGS_SECTIONS } from './settingsNavigation'

const settingsPage = readFileSync(resolve(__dirname, 'SettingsPage.tsx'), 'utf8')
const settingsStyles = readFileSync(resolve(__dirname, '../../styles/99-settings.css'), 'utf8')
const pathPane = readFileSync(resolve(__dirname, 'panes/PathPane.tsx'), 'utf8')
const modelPane = readFileSync(resolve(__dirname, 'panes/ModelPane.tsx'), 'utf8')
const aboutPane = readFileSync(resolve(__dirname, 'panes/AboutPane.tsx'), 'utf8')
const a11yPane = readFileSync(resolve(__dirname, 'panes/A11yPane.tsx'), 'utf8')
const jobsPane = readFileSync(resolve(__dirname, 'panes/JobsPane.tsx'), 'utf8')
const importPane = readFileSync(resolve(__dirname, 'panes/ImportPane.tsx'), 'utf8')
const hallPage = readFileSync(resolve(__dirname, '../hall/HallPage.tsx'), 'utf8')
const versionHistoryPage = readFileSync(resolve(__dirname, '../workspace/views/review/VersionHistoryPage.tsx'), 'utf8')
const exportPage = readFileSync(resolve(__dirname, '../workspace/views/review/ExportManuscriptPage.tsx'), 'utf8')
const renderedBody = (source: string): string => source.slice(source.indexOf('export function'))

describe('设置中心信息架构', () => {
  it('相同设置只保留一个入口，二级栏不超过六项', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.label)).toEqual([
      '本机存储', '模型服务', '外观与辅助', '关于与维护'
    ])
    expect(new Set(SETTINGS_SECTIONS.map((section) => section.id)).size).toBe(SETTINGS_SECTIONS.length)
    expect(SETTINGS_SECTIONS.length).toBeLessThanOrEqual(6)
  })

  it('恢复固定二级侧栏，中心只渲染选中的设置栏目', () => {
    expect(settingsPage).toContain('className="mjp-snav"')
    expect(settingsPage).toContain('aria-label="设置栏目"')
    expect(settingsPage).toContain('aria-current={section.id === active ? \'page\' : undefined}')
    expect(settingsPage).toContain('<Pane />')
    expect(settingsPage).not.toContain('SECTION_ORDER.map')
    expect(settingsStyles).toMatch(/\.mjp-body\.mjp-settings\s*\{[^}]*grid-template-columns:\s*var\(--w-subnav\)\s+minmax\(0,\s*1fr\);/s)
  })

  it('设置页不重复显示项目统计、导入与任务流水', () => {
    expect(settingsPage).not.toContain('在册项目')
    expect(settingsPage).not.toContain('ImportPane')
    expect(settingsPage).not.toContain('JobsPane')
    expect(pathPane).not.toContain('待确认记忆')
    expect(pathPane).not.toContain('任务记录')
    expect(settingsPage).not.toContain('AI 产出始终需要人工确认后才会写入正文')
  })

  it('正式界面不展示开发连接信息，但保留未开放能力提示', () => {
    for (const file of [pathPane, modelPane, aboutPane, jobsPane]) {
      const source = renderedBody(file)
      expect(source).not.toContain('产品标识')
      expect(source).not.toContain('前端开发端口')
      expect(source).not.toContain('会话凭据来源')
      expect(source).not.toContain('凭据来源')
      expect(source).not.toContain('SQLite')
      expect(source).not.toContain('GET /')
      expect(source).not.toContain('mojing-dev-local')
    }
    expect(pathPane).toContain('选择目录并重启')
    expect(aboutPane).toContain('导出诊断信息')
    expect(aboutPane).toContain('清理界面缓存')
    expect(aboutPane).toContain('尚未开放')
  })

  it('辅助设置与导入说明使用用户语言', () => {
    expect(renderedBody(a11yPane)).not.toContain('CSS px')
    expect(renderedBody(a11yPane)).not.toContain('focus-visible')
    expect(renderedBody(importPane)).not.toContain('段落 ID')
    expect(renderedBody(importPane)).not.toContain('服务端自动识别')
  })

  it('导入与项目检查点已在各自的原有页面，设置页不再复制按钮', () => {
    expect(hallPage).toContain('导入文稿')
    expect(versionHistoryPage).toContain('创建检查点')
    expect(exportPage).toContain('isBackup')
    expect(settingsPage).not.toContain('onOpenVersionHistory')
  })
})
