import { describe, expect, it } from 'vitest'
import { LOOPBACK } from './ProviderConfigForm'

describe('本机模型地址识别', () => {
  it('只认可真实回环主机，避免把外部相似域名当成本机服务', () => {
    expect(LOOPBACK.test('http://localhost:54671/v1')).toBe(true)
    expect(LOOPBACK.test('http://127.0.0.1:54671/v1')).toBe(true)
    expect(LOOPBACK.test('http://[::1]:54671/v1')).toBe(true)
    expect(LOOPBACK.test('https://localhost.example.com/v1')).toBe(false)
    expect(LOOPBACK.test('https://127.0.0.1.example.com/v1')).toBe(false)
  })
})
