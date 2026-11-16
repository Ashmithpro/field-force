import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import react from '@vitejs/plugin-react'

const execFileAsync = promisify(execFile)
const gistempUrl = 'https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts%2BdSST.csv'
const [githubOwner, githubRepositoryName] = process.env.GITHUB_REPOSITORY?.split('/') ?? []
const githubPagesBase = process.env.GITHUB_ACTIONS === 'true' && githubRepositoryName
  ? githubRepositoryName === `${githubOwner}.github.io` ? '/' : `/${githubRepositoryName}/`
  : './'
let cachedCsv: { csv: string; cachedAt: number; lastModified: string } | undefined

async function fetchGistempCsv(): Promise<{ csv: string; lastModified: string }> {
  try {
    const upstream = await fetch(gistempUrl, { signal: AbortSignal.timeout(15000) })
    if (!upstream.ok) throw new Error('NASA GISTEMP returned HTTP ' + upstream.status + '.')
    return { csv: await upstream.text(), lastModified: upstream.headers.get('last-modified') ?? '' }
  } catch {
    const curl = process.platform === 'win32' ? 'curl.exe' : 'curl'
    const { stdout } = await execFileAsync(curl, ['--fail', '--location', '--silent', '--show-error', '--max-time', '15', gistempUrl], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
    return { csv: String(stdout), lastModified: '' }
  }
}

function climateSeriesApi(): Plugin {
  const install = (server: { middlewares: { use: (path: string, handler: (request: any, response: any) => void) => void } }) => {
    server.middlewares.use('/api/climate-series', (_request, response) => {
      void (async () => {
        const cached = cachedCsv
        if (cached && Date.now() - cached.cachedAt < 6 * 60 * 60 * 1000) {
          response.statusCode = 200
          response.setHeader('Content-Type', 'text/csv; charset=utf-8')
          response.setHeader('Cache-Control', 'public, max-age=21600')
          if (cached.lastModified) response.setHeader('X-Source-Last-Modified', cached.lastModified)
          response.end(cached.csv)
          return
        }

        const fresh = await fetchGistempCsv()
        cachedCsv = { ...fresh, cachedAt: Date.now() }
        response.statusCode = 200
        response.setHeader('Content-Type', 'text/csv; charset=utf-8')
        response.setHeader('Cache-Control', 'public, max-age=21600')
        if (fresh.lastModified) response.setHeader('X-Source-Last-Modified', fresh.lastModified)
        response.end(fresh.csv)
      })().catch((error: unknown) => {
        response.statusCode = 502
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'NASA GISTEMP is unavailable.' }))
      })
    })
  }

  return {
    name: 'nasa-gistemp-api',
    configureServer: install,
    configurePreviewServer: install,
  }
}

export default defineConfig({
  base: githubPagesBase,
  plugins: [react(), climateSeriesApi()],
})
