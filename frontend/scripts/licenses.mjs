import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(import.meta.dirname, '..')

export function generateNotices() {
  // Include transitive dependencies: upstream bundles can hide them from Vite.
  const packages = JSON.parse(execFileSync('npm', ['query', '.prod'], {
    cwd: root, encoding: 'utf8',
  })).filter((pkg) => pkg.path !== root)
  const sections = packages.toSorted((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
  ).map((pkg) => {
    const files = readdirSync(pkg.path, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^(licen[cs]e|copying|notice|copyright)/i.test(entry.name))
      .map((entry) => entry.name).toSorted()
    if (!files.some((name) => /^(licen[cs]e|copying)/i.test(name))) {
      throw new Error(`Missing license text for ${pkg.name}@${pkg.version}`)
    }
    const text = files.map((name) => readFileSync(resolve(pkg.path, name), 'utf8').trim()).join('\n\n')
    return `## ${pkg.name} - ${pkg.version} (${pkg.license ?? 'see license text'})\n\n${text}`
  })
  return `# Third-party licenses\n\nProduction dependencies, including code bundled by upstream packages.\n\n${sections.join('\n\n')}\n`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const notices = generateNotices()
  mkdirSync(resolve(root, 'dist/licenses'), { recursive: true })
  writeFileSync(resolve(root, 'dist/licenses/THIRD_PARTY.txt'), notices)
}
