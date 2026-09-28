import { describe, expect, it } from 'vitest'
import { parseZoomLevel, zoomFactor } from './zoomPreference'

describe('界面缩放偏好', () => {
  it('只接受应用提供的三档缩放，旧值回落到默认', () => {
    expect(parseZoomLevel('125')).toBe('125')
    expect(parseZoomLevel('150')).toBe('150')
    expect(parseZoomLevel('175')).toBe('100')
    expect(parseZoomLevel(null)).toBe('100')
  })

  it('给桌面窗口传入对应的缩放倍数', () => {
    expect(zoomFactor('100')).toBe(1)
    expect(zoomFactor('125')).toBe(1.25)
    expect(zoomFactor('150')).toBe(1.5)
  })
})
