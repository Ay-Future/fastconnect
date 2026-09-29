import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const requiredFiles = [
  'LICENSE',
  'NOTICE.md',
  'README.md',
  'RELEASING.md',
  'package.json',
  'package-lock.json',
  'src/share/main/lib/updater.ts',
  'src/renderer/icon/android.svg',
]

const missing = requiredFiles.filter((file) => !existsSync(file))
if (missing.length) {
  throw new Error(`Missing Corresponding Source files: ${missing.join(', ')}`)
}

if (!readFileSync('LICENSE', 'utf8').includes('GNU AFFERO GENERAL PUBLIC LICENSE')) {
  throw new Error('LICENSE must contain the GNU Affero General Public License.')
}

try {
  execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], {
    stdio: 'ignore',
  })
} catch {
  throw new Error(
    'Create the initial commit before publishing a binary; this repository does not yet have HEAD.'
  )
}

const tag = execFileSync('git', ['tag', '--points-at', 'HEAD'], {
  encoding: 'utf8',
}).trim()
if (!tag) {
  throw new Error(
    'Create an annotated release tag at HEAD before publishing a binary so recipients can retrieve its exact source.'
  )
}

console.log(`Release-source verification passed for tag(s): ${tag.replaceAll('\n', ', ')}`)
