import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const versionServiceWorkerCache = {
  name: 'groupbuk-service-worker-cache-version',
  apply: 'build',
  closeBundle() {
    const outputDirectory = resolve(process.cwd(), 'dist')
    const assetsDirectory = resolve(outputDirectory, 'assets')
    const iconDirectory = resolve(outputDirectory, 'icons')
    const fingerprintFiles = [
      ...readdirSync(assetsDirectory).map(file => resolve(assetsDirectory, file)),
      resolve(outputDirectory, 'index.html'),
      resolve(outputDirectory, 'manifest.webmanifest'),
      ...readdirSync(iconDirectory).map(file => resolve(iconDirectory, file)),
    ].sort()
    const hash = createHash('sha256')
    fingerprintFiles.forEach(file => hash.update(file.slice(outputDirectory.length)).update(readFileSync(file)))
    const timestamp = new Date().toISOString().replace(/\D/g, '')
    const version = `${timestamp}-${hash.digest('hex').slice(0, 12)}`
    const workerPath = resolve(outputDirectory, 'sw.js')
    const workerSource = readFileSync(workerPath, 'utf8')
    writeFileSync(workerPath, workerSource.replace("const CACHE_NAME = 'groupbuk-static-v1'", `const CACHE_NAME = 'groupbuk-static-${version}'`))
  },
}

export default defineConfig({ plugins: [react(), versionServiceWorkerCache], server: { host: '0.0.0.0', port: 3000, proxy: { '/api': 'http://localhost:5000' } } })
