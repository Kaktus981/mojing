export interface SecretStore {
  get(id: string): Promise<string | undefined>
  set(id: string, value: string): Promise<void>
  delete(id: string): Promise<void>
}

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>()

  constructor(initialApiKey?: string) {
    if (initialApiKey) this.values.set('default', initialApiKey)
  }

  async get(id: string): Promise<string | undefined> {
    return this.values.get(id) ?? this.values.get('default')
  }

  async set(id: string, value: string): Promise<void> {
    this.values.set(id, value)
  }

  async delete(id: string): Promise<void> {
    this.values.delete(id)
  }
}
