#!/usr/bin/env node
import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const targets = {
  copilot: '.github/skills',
  claude: '.claude/skills',
};

const usage = `Usage: local-lite install-skills [--target copilot|claude] [--dir <path>] [--force]

Copies the bundled AI skills into your project.
  --target  copilot (default, .github/skills) or claude (.claude/skills)
  --dir     custom destination directory (overrides --target)
  --force   overwrite existing skill files`;

function parseArgs(argv) {
  const options = { target: 'copilot', dir: undefined, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--force') options.force = true;
    else if (arg === '--target') options.target = argv[++i];
    else if (arg === '--dir') {
      options.dir = argv[++i];
      if (!options.dir) throw new Error('--dir requires a path.');
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.dir && !targets[options.target]) {
    throw new Error(`Unknown target "${options.target}". Use copilot or claude.`);
  }
  return options;
}

async function installSkills(options) {
  const destination = path.resolve(process.cwd(), options.dir ?? targets[options.target]);
  await mkdir(destination, { recursive: true });
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isDirectory())) {
    await cp(path.join(skillsRoot, entry.name), path.join(destination, entry.name), {
      recursive: true,
      force: options.force,
      errorOnExist: false,
    });
    console.log(`Installed ${entry.name} -> ${path.join(destination, entry.name)}`);
  }
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === 'install-skills') {
    await installSkills(parseArgs(rest));
  } else {
    console.log(usage);
    process.exitCode = command && command !== '--help' && command !== '-h' ? 1 : 0;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(usage);
  process.exitCode = 1;
}
