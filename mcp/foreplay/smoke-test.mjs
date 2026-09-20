import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const transport = new StdioClientTransport({
  command: 'node',
  args: ['index.mjs'],
  env: { ...process.env, FOREPLAY_API_KEY: process.env.FOREPLAY_API_KEY || 'test' },
})
const client = new Client({ name: 'smoke', version: '0.0.0' })
await client.connect(transport)
const { tools } = await client.listTools()
console.log('TOOLS:', tools.map((t) => t.name).join(', '))
await client.close()
process.exit(0)
