#!/usr/bin/env node
import { cp, mkdir, readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, '..', 'skills');
const targets = {
  copilot: '.github/skills',
  claude: '.claude/skills',
  antigravity: '.gemini/skills',
  gemini: '.gemini/skills',
  cursor: '.cursor/skills',
  agent: '.agent/skills',
};

const usage = `Usage:
  local-lite install-skills [--target copilot|claude|antigravity|cursor|agent] [--dir <path>] [--force]
  local-lite db:generate --schema <path> [--tables <path>] [--out <dir>] [--name <name>] [--dialect mysql|postgres|sqlite] [--server-schema <path>] [--dry-run]

Commands:
  install-skills  Copy bundled AI skills into your project.
  db:generate     Generate incremental SQL migrations from a schema dictionary.`;

function parseSkillsArgs(argv) {
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
    throw new Error(`Unknown target "${options.target}". Supported: ${Object.keys(targets).join(', ')}.`);
  }
  return options;
}

function parseDbGenArgs(argv) {
  const options = {
    schema: undefined,
    tables: undefined,
    out: 'server/migrations',
    name: 'auto_schema',
    dialect: 'mysql',
    serverSchema: undefined,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--schema') options.schema = argv[++i];
    else if (arg === '--tables') options.tables = argv[++i];
    else if (arg === '--out') options.out = argv[++i];
    else if (arg === '--name') options.name = argv[++i];
    else if (arg === '--dialect') options.dialect = argv[++i];
    else if (arg === '--server-schema') options.serverSchema = argv[++i];
    else if (arg !== '--') throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.schema) {
    throw new Error('--schema <path> is required for db:generate.');
  }
  if (!['mysql', 'postgres', 'sqlite'].includes(options.dialect)) {
    throw new Error(`Unsupported dialect "${options.dialect}". Use mysql, postgres, or sqlite.`);
  }
  return options;
}

async function loadModuleExports(filePath) {
  const absPath = path.resolve(process.cwd(), filePath);
  if (absPath.endsWith('.json')) {
    return JSON.parse(await readFile(absPath, 'utf8'));
  }
  if (!absPath.endsWith('.ts') && !absPath.endsWith('.mts')) {
    return await import(pathToFileURL(absPath).href);
  }

  try {
    return await import(pathToFileURL(absPath).href);
  } catch {
    const requireFromCwd = createRequire(path.join(process.cwd(), 'package.json'));
    let ts;
    try {
      ts = requireFromCwd('typescript');
    } catch {
      throw new Error(
        `Cannot load TypeScript file "${filePath}". Install "typescript" in your project or pass a .js/.mjs/.json file.`,
      );
    }
    const source = await readFile(absPath, 'utf8');
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: absPath,
    });
    const moduleObj = { exports: {} };
    const fn = new vm.Script(
      `(function(exports, require, module) {\n${transpiled.outputText}\n})`,
      { filename: absPath },
    );
    fn.runInThisContext()(moduleObj.exports, () => ({}), moduleObj);
    return moduleObj.exports;
  }
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

async function runDbGen(options) {
  const { generateSqlMigration } = await import(
    pathToFileURL(path.resolve(__dirname, '..', 'dist', 'schema', 'index.js')).href
  );
  const schemaExports = await loadModuleExports(options.schema);
  const dictionary =
    schemaExports.SCHEMA_DICTIONARY || schemaExports.default || schemaExports;

  let tableOrder = [];
  if (options.tables) {
    const tablesExports = await loadModuleExports(options.tables);
    tableOrder = tablesExports.CORE_TABLES || tablesExports.default || [];
  }

  const result = generateSqlMigration({
    dictionary,
    tableOrder,
    dialect: options.dialect,
    migrationsDir: path.resolve(process.cwd(), options.out),
    name: options.name,
    dryRun: options.dryRun,
    serverSchemaPath: options.serverSchema
      ? path.resolve(process.cwd(), options.serverSchema)
      : undefined,
  });

  for (const warning of result.warnings) {
    console.warn(`[warn] ${warning}`);
  }

  if (result.up.length === 0) {
    console.log('No schema changes detected.');
    return;
  }

  if (options.dryRun) {
    console.log(result.sql);
    return;
  }

  if (result.migrationPath) {
    console.log(`Generated migration: ${path.relative(process.cwd(), result.migrationPath)}`);
  }
  if (result.serverSchemaPath) {
    console.log(`Updated schema map:  ${path.relative(process.cwd(), result.serverSchemaPath)}`);
  }
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === 'install-skills') {
    await installSkills(parseSkillsArgs(rest));
  } else if (command === 'db:generate') {
    await runDbGen(parseDbGenArgs(rest));
  } else {
    console.log(usage);
    process.exitCode = command && command !== '--help' && command !== '-h' ? 1 : 0;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(usage);
  process.exitCode = 1;
}
