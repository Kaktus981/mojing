import { safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { SecretStore } from '../../../packages/core/src/secrets'

export class ElectronSecretStore implements SecretStore {
  private values: Record<string, string> | undefined

  constructor(private readonly filePath: string) {}

  async get(id: string): Promise<string | undefined> {
    const encrypted = (await this.load())[id]
    if (!encrypted) return undefined
    this.assertAvailable()
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  }

  async set(id: string, value: string): Promise<void> {
    this.assertAvailable()
    const values = await this.load()
    values[id] = safeStorage.encryptString(value).toString('base64')
    await this.persist(values)
  }

  async delete(id: string): Promise<void> {
    const values = await this.load()
    delete values[id]
    await this.persist(values)
  }

  private assertAvailable(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows 安全存储当前不可用，请重新登录系统后再试。')
    }
  }

  private async load(): Promise<Record<string, string>> {
    if (this.values) return this.values
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as unknown
      this.values = isRecord(parsed) ? parsed : {}
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.values = {}
    }
    return this.values
  }

  private async persist(values: Record<string, string>): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    await fs.writeFile(temporaryPath, JSON.stringify(values), { encoding: 'utf8', mode: 0o600 })
    await fs.rename(temporaryPath, this.filePath)
  }
}

function isRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((item) => typeof item === 'string')
}
