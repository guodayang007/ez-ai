import { createServer } from 'node:http'

import { createApp } from './app.mjs'
import { createChatGPTPurchaser } from './chatgpt.mjs'
import { loadConfig } from './config.mjs'

try {
  process.loadEnvFile()
} catch {
  // No .env file; rely on the real environment.
}

const config = loadConfig(process.env)
const app = createApp({ config, purchase: createChatGPTPurchaser(config) })

createServer((req, res) => {
  app.handle(req, res).catch((error) => {
    console.error(`request failed: ${error.message}`)
    if (!res.headersSent) res.writeHead(500)
    res.end()
  })
}).listen(config.port, config.host, () => {
  console.log(`dogpay-fulfiller listening on ${config.host}:${config.port}, plans: ${[...config.allowedPlans].join(', ')}`)
})
