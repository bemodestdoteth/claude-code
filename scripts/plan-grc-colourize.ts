import { readFile, writeFile } from 'node:fs/promises'
import { colourizeMarkedGrcBlocks } from './lib/grc-colourize.ts'

const targetPath = process.argv[2]

if (!targetPath) {
  console.error('Usage: bun scripts/plan-grc-colourize.ts <plan.html>')
  process.exit(1)
}

const html = await readFile(targetPath, 'utf8')
const colourized = await colourizeMarkedGrcBlocks({ html })
await writeFile(targetPath, colourized)
