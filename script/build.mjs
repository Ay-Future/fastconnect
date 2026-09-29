import { $, cd, fs, usePowerShell } from 'zx'

if (process.platform === 'win32') {
  usePowerShell()
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const pkg = await fs.readJson('package.json')
const electron = pkg.devDependencies.electron
delete pkg.devDependencies
pkg.devDependencies = {
  electron,
}
delete pkg.scripts
pkg.scripts = {
  start: 'electron main/index.js',
}
pkg.main = 'main/index.js'

await $`${npm} run build:main`
await $`${npm} run build:preload`
await $`${npm} run build:renderer`

await fs.copy('build', 'dist/build')
await fs.copy('resources', 'dist/resources')
await fs.copy('fastbug', 'dist/resources/fastbug')
cd('dist')

await fs.writeJson('package.json', pkg, {
  spaces: 2,
})

await $`${npm} i --production`
