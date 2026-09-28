import { Accessibility, Cpu, FolderOpen, Info, type LucideIcon } from 'lucide-react'

export type SettingsSectionId = 'path' | 'model' | 'appearance' | 'about'

export type SettingsSectionMeta = {
  id: SettingsSectionId
  label: string
  icon: LucideIcon
  sub: string
}

export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  { id: 'path', label: '本机存储', icon: FolderOpen, sub: '管理项目数据、缓存与日志的存放位置。' },
  { id: 'model', label: '模型服务', icon: Cpu, sub: '配置模型连接并测试是否可用。' },
  { id: 'appearance', label: '外观与辅助', icon: Accessibility, sub: '调整主题、字体、界面缩放和动效。' },
  { id: 'about', label: '关于与维护', icon: Info, sub: '查看版本，并管理诊断信息与界面缓存。' }
]

export function getSettingsSection(id: SettingsSectionId): SettingsSectionMeta {
  const found = SETTINGS_SECTIONS.find((section) => section.id === id)
  if (!found) throw new Error(`未知的设置栏目：${id}`)
  return found
}
