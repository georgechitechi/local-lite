import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const entrypoints = Object.keys(packageJson.exports).map((entry) =>
  entry === '.' ? packageJson.name : `${packageJson.name}/${entry.slice(2)}`
);
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'local-lite-package-check-'));
const npmCli = process.env.npm_execpath ??
  path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed.\n${result.stdout ?? ''}${result.stderr ?? ''}`,
      { cause: result.error }
    );
  }
  return result.stdout.trim();
}

try {
  const packResult = JSON.parse(
    run(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', temporaryRoot], projectRoot)
  );
  const packed = Array.isArray(packResult) ? packResult[0] : Object.values(packResult)[0];
  const tarballPath = path.join(temporaryRoot, packed.filename);
  const consumerRoot = path.join(temporaryRoot, 'consumer');
  await mkdir(consumerRoot);
  await writeFile(
    path.join(consumerRoot, 'package.json'),
    JSON.stringify({ private: true, type: 'module' })
  );

  run(
    process.execPath,
    [
      npmCli,
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--legacy-peer-deps',
      tarballPath,
      'react@18',
    ],
    consumerRoot
  );

  const importScript = `
    const entrypoints = ${JSON.stringify(entrypoints)};
    for (const entrypoint of entrypoints) {
      await import(entrypoint);
      console.log('Imported', entrypoint);
    }
  `;
  run(process.execPath, ['--input-type=module', '-e', importScript], consumerRoot);
  console.log(`Packed package consumer smoke test passed (${entrypoints.length} entry points).`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
