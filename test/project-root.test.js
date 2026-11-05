import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { discoverBaselineInstructionFiles } from '../src/native-agent-instructions.js'

test('worktree 子目录只用唯一标记回溯到 night-bot 根 AGENTS.md', async () => {
  const root = await mkdtemp(join(tmpdir(), 'night-project-root-'))
  const cwd = join(root, 'runtime', 'test', 'fixtures', 'worktree', 'repo')
  try {
    await mkdir(cwd, { recursive: true })
    await writeFile(join(root, '.night-project-root'), '')
    await writeFile(join(root, 'AGENTS.md'), '# test instructions')
    const files = await discoverBaselineInstructionFiles({
      cwd,
      agentsHome: join(root,'agents'),
      projectRootMarkers: ['.night-project-root'],
      instructionFileCandidates: ['AGENTS.md'],
      localInstructionFileCandidates: [],
    })

    assert.ok(files.some((file) => file.absolutePath === join(root, 'AGENTS.md')))
    assert.ok(files.every((file) => !file.absolutePath.includes('agent-studio-next')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
