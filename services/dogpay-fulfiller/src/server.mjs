import { createServer } from 'node:http'

import { createApp } from './app.mjs'
import { createBitBrowser } from './bitbrowser.mjs'
import { createChatGPTPurchaser } from './chatgpt.mjs'
import { createClaudePurchaser } from './claude.mjs'
import { loadConfig } from './config.mjs'

try {
  process.loadEnvFile()
} catch {
  // No .env file; rely on the real environment.
}

const config = loadConfig(process.env)
const purchasers = { chatgpt: createChatGPTPurchaser(config), claude: createClaudePurchaser(config) }
const app = createApp({ config, purchase: (job, report) => purchasers[job.provider](job, report) })

createServer((req, res) => {
  app.handle(req, res).catch((error) => {
    console.error(`request failed: ${error.message}`)
    if (!res.headersSent) res.writeHead(500)
    res.end()
  })
}).listen(config.port, config.host, () => {
  console.log(`dogpay-fulfiller listening on ${config.host}:${config.port}; plans and card come from ez-ai settings`)
  createBitBrowser(config.bitBrowserUrl)
    .health()
    .then(() => console.log(`BitBrowser Local API is reachable at ${config.bitBrowserUrl}`))
    .catch((error) => console.warn(`warning: purchases will fail until BitBrowser runs: ${error.message}`))
})
