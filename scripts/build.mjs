import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(projectRoot, 'dist');
const tscBin = path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');

await rm(distDir, { recursive: true, force: true });

const result = spawnSync(process.execPath, [tscBin], {
  cwd: projectRoot,
  stdio: 'inherit',
});
if (result.error || result.status !== 0) {
  throw new Error('tsc failed', { cause: result.error });
}
