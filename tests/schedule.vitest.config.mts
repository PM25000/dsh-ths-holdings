import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
const source = process.env.DSH_SOURCE_ROOT
if (!source) throw new Error('Set DSH_SOURCE_ROOT to the built DeepSeek Harness checkout')
const requireDsh = createRequire(join(source, 'package.json'))
const { default: tsconfigPaths } = await import(pathToFileURL(requireDsh.resolve('vite-tsconfig-paths')).href)
const { standardDecoratorPlugin } = await import(pathToFileURL(join(source, 'vitest.shared.ts')).href)
export default {
  plugins: [tsconfigPaths({ projects: [join(source, 'tsconfig.base.json')] }), standardDecoratorPlugin()],
  root: fileURLToPath(new URL('..', import.meta.url)),
  resolve: { alias: { vitest: join(dirname(requireDsh.resolve('vitest/package.json')), 'dist/index.js') } },
  server: { fs: { allow: [source, fileURLToPath(new URL('..', import.meta.url))] } },
  test: { include: ['tests/schedule.e2e.ts'], testTimeout: 60000, hookTimeout: 60000, fileParallelism: false },
}
