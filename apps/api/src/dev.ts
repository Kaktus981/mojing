import { join } from 'node:path'
import { MemorySecretStore } from '../../../packages/core/src/secrets'
import { createMojingServer } from './mojingServer'

const dataRoot = process.env.MOJING_DEV_DATA_DIR
  ?? join(process.cwd(), '.mojing-dev')
const databasePath = process.env.MOJING_DEV_DATABASE_PATH
  ?? join(dataRoot, 'mojing.db')
const token = process.env.MOJING_SESSION_TOKEN ?? 'mojing-dev-local'
const port = Number(process.env.MOJING_API_PORT ?? 8787)
const secretStore = new MemorySecretStore(process.env.MOJING_DEV_API_KEY)
const server = await createMojingServer({
  databasePath,
  secretStore,
  sessionToken: token,
  allowedOrigin: process.env.MOJING_WEB_ORIGIN ?? 'http://localhost:5173'
})

await server.app.listen({ host: '127.0.0.1', port })
process.stdout.write(`墨境 API 已启动：http://localhost:${port}\n`)

const shutdown = async (): Promise<void> => {
  const forceExit = setTimeout(() => process.exit(0), 1_500)
  forceExit.unref()
  server.app.server.closeIdleConnections?.()
  try {
    await server.app.close()
  } finally {
    clearTimeout(forceExit)
    process.exit(0)
  }
}
process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
