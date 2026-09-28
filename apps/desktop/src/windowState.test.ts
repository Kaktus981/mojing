import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadWindowState, parseWindowState, placeWindow, saveWindowState } from './windowState'

const primary = { x: 0, y: 0, width: 1920, height: 1040 }
const secondary = { x: 1920, y: 0, width: 1280, height: 984 }

describe('桌面窗口状态', () => {
  it('首次打开时在当前显示器预设还原大小并最大化', () => {
    expect(placeWindow(null, [primary, secondary], secondary)).toEqual({
      bounds: { x: 1920, y: 22, width: 1280, height: 940 },
      maximized: true
    })
  })

  it('记住有效的普通窗口位置、大小和最大化状态', () => {
    const saved = parseWindowState({ bounds: { x: 80, y: 60, width: 1320, height: 820 }, maximized: false })
    expect(placeWindow(saved, [primary, secondary], secondary)).toEqual(saved)
    expect(parseWindowState({ bounds: { x: 80, y: 60, width: 1320, height: 820 }, maximized: true })?.maximized).toBe(true)
  })

  it('显示器断开后将上次窗口移到当前显示器可用区域', () => {
    const saved = parseWindowState({ bounds: { x: 2250, y: 40, width: 1100, height: 780 }, maximized: false })
    expect(placeWindow(saved, [primary], primary)).toEqual({
      bounds: { x: 410, y: 130, width: 1100, height: 780 },
      maximized: false
    })
  })

  it('跨显示器窗口按占用面积较大的显示器恢复', () => {
    const saved = parseWindowState({ bounds: { x: 1800, y: 80, width: 1100, height: 800 }, maximized: false })
    expect(placeWindow(saved, [primary, secondary], primary).bounds).toEqual({ x: 1920, y: 80, width: 1100, height: 800 })
  })

  it('忽略损坏的记录，且不把离屏窗口恢复到可见区域外', () => {
    expect(parseWindowState({ bounds: { x: 0, y: 0, width: -1, height: 900 }, maximized: false })).toBeNull()
    expect(parseWindowState({ bounds: { x: 0, y: 0, width: 1200, height: 900 }, maximized: 'yes' })).toBeNull()
    const saved = parseWindowState({ bounds: { x: 1800, y: 900, width: 1200, height: 850 }, maximized: false })
    expect(placeWindow(saved, [primary], primary).bounds).toEqual({ x: 720, y: 190, width: 1200, height: 850 })
  })

  it('在应用数据目录保存并读取窗口状态，损坏的文件不会阻止启动', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mojing-window-state-'))
    try {
      const state = { bounds: { x: 160, y: 90, width: 1440, height: 900 }, maximized: false }
      saveWindowState(directory, state)
      expect(loadWindowState(directory)).toEqual(state)
      writeFileSync(join(directory, 'window-state.json'), '{broken', 'utf8')
      expect(loadWindowState(directory)).toBeNull()
    } finally {
      if (directory.startsWith(join(tmpdir(), 'mojing-window-state-'))) rmSync(directory, { recursive: true, force: true })
    }
  })
})
