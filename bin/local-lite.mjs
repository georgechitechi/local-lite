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
  local-lite dashboard [--db <path>] [--port <number>] [--ui-port <number>] [--host <host>] [--readonly] [--token <secret>] [--title <title>] [--no-open] [--no-vite]
  local-lite dev [--db <path>] [--port <number>] [--ui-port <number>] [--host <host>] [--readonly] [--token <secret>] [--title <title>] [--repo <owner/repo>] [--force] [--no-open]

Commands:
  install-skills  Copy bundled AI skills into your project.
  db:generate     Generate incremental SQL migrations from a schema dictionary.
  dashboard       Launch the local-lite web dashboard for a SQLite database.
  dev             Pull the Vite dashboard from GitHub into ./dashboard, install deps, and serve it.`;

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

  const requireFromCwd = createRequire(path.join(process.cwd(), 'package.json'));
  try {
    const ts = requireFromCwd('typescript');
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
  } catch {
    try {
      return await import(pathToFileURL(absPath).href);
    } catch {
      throw new Error(
        `Cannot load TypeScript file "${filePath}". Install "typescript" in your project or pass a .js/.mjs/.json file.`,
      );
    }
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
    pathToFileURL(path.resolve(__dirname, '..', 'dist', 'schema', 'sqlMigrations.js')).href
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

function parseDashboardArgs(argv) {
  const options = {
    db: ':memory:',
    port: 4321,
    uiPort: 5173,
    host: '127.0.0.1',
    readOnly: false,
    token: undefined,
    title: undefined,
    open: true,
    noVite: false,
    repo: 'georgechitechi/local-lite',
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--readonly') options.readOnly = true;
    else if (arg === '--no-open') options.open = false;
    else if (arg === '--no-vite') options.noVite = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--repo') options.repo = argv[++i];
    else if (arg === '--db') options.db = argv[++i];
    else if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg === '--ui-port') options.uiPort = Number(argv[++i]);
    else if (arg === '--host') options.host = argv[++i];
    else if (arg === '--token') options.token = argv[++i];
    else if (arg === '--title') options.title = argv[++i];
    else if (arg !== '--') throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.db) throw new Error('--db <path> cannot be empty.');
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error('--port must be a valid TCP port (0-65535).');
  }
  if (!Number.isInteger(options.uiPort) || options.uiPort < 0 || options.uiPort > 65535) {
    throw new Error('--ui-port must be a valid TCP port (0-65535).');
  }
  return options;
}

async function openDashboardDbAdapter(dbPath) {
  const resolved = dbPath === ':memory:' ? ':memory:' : path.resolve(process.cwd(), dbPath);
  try {
    const nodeSqlite = await import('node:sqlite');
    const mod = await import(
      pathToFileURL(path.resolve(__dirname, '..', 'dist', 'adapters', 'local', 'node-sqlite.js')).href
    );
    const NodeSQLiteAdapter = mod.NodeSQLiteAdapter ?? mod.default?.NodeSQLiteAdapter;
    const db = new nodeSqlite.DatabaseSync(resolved);
    return { adapter: new NodeSQLiteAdapter(db), label: resolved, close: () => db.close() };
  } catch {
    // Fallback to better-sqlite3 if node:sqlite is unavailable
  }

  const requireFromCwd = createRequire(path.join(process.cwd(), 'package.json'));
  try {
    const BetterSqlite3 = requireFromCwd('better-sqlite3');
    const mod = await import(
      pathToFileURL(path.resolve(__dirname, '..', 'dist', 'adapters', 'local', 'better-sqlite3.js')).href
    );
    const BetterSQLite3Adapter = mod.BetterSQLite3Adapter ?? mod.default?.BetterSQLite3Adapter;
    const db = new BetterSqlite3(resolved);
    return { adapter: new BetterSQLite3Adapter(db), label: resolved, close: () => db.close() };
  } catch {
    throw new Error(
      'No SQLite driver available. Run on Node 22+ (node:sqlite) or install "better-sqlite3".',
    );
  }
}

async function runDashboard(options) {
  const http = await import('node:http');
  const dashboardMod = await import(
    pathToFileURL(path.resolve(__dirname, '..', 'dist', 'server', 'dashboard.js')).href
  );
  const createDashboardHandler =
    dashboardMod.createDashboardHandler ?? dashboardMod.default?.createDashboardHandler;
  if (typeof createDashboardHandler !== 'function') {
    throw new Error(
      'Dashboard module not built. Run "npm run build" first.',
    );
  }
  const { adapter, label, close } = await openDashboardDbAdapter(options.db);
  const handler = createDashboardHandler(adapter, {
    title: options.title ?? `local-lite (${path.basename(label)})`,
    readOnly: options.readOnly,
    authToken: options.token,
  });

  const server = http.createServer(async (req, res) => {
    try {
      const origin = `http://${req.headers.host || `${options.host}:${options.port}`}`;
      const url = new URL(req.url || '/', origin);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
      const webReq = new Request(url.toString(), {
        method: req.method,
        headers: req.headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      });
      const webRes = await handler(webReq);
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => res.setHeader(key, value));
      const buf = Buffer.from(await webRes.arrayBuffer());
      res.end(buf);
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }));
    }
  });

  await new Promise((resolve) => server.listen(options.port, options.host, resolve));
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : options.port;
  const apiOrigin = `http://${options.host}:${actualPort}`;
  const tokenSuffix = options.token ? `?token=${encodeURIComponent(options.token)}` : '';
  console.log(`local-lite API server running at ${apiOrigin}/${tokenSuffix}`);
  console.log(`Database: ${label} (${options.readOnly ? 'read-only' : 'read/write'})`);

  let viteProc = null;
  const { existsSync } = await import('node:fs');
  const pkgDashboardDir = path.resolve(__dirname, '..', 'dashboard');
  const cwdDashboardDir = path.resolve(process.cwd(), 'dashboard');
  const dashboardDir =
    options.dashboardDir ??
    (existsSync(path.join(pkgDashboardDir, 'package.json')) ? pkgDashboardDir : cwdDashboardDir);
  const viteBin = path.join(dashboardDir, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!options.noVite) {
    if (existsSync(viteBin)) {
      const { spawn } = await import('node:child_process');
      const viteArgs = [
        viteBin,
        '--host',
        options.host,
        '--port',
        String(options.uiPort),
      ];
      if (options.open) {
        viteArgs.push('--open', tokenSuffix || '/');
      }
      viteProc = spawn(process.execPath, viteArgs, {
        cwd: dashboardDir,
        env: {
          ...process.env,
          LOCAL_LITE_API_TARGET: apiOrigin,
        },
        stdio: 'inherit',
      });
    } else {
      console.log('Vite dashboard dependencies not installed; serving built-in fallback UI.');
    }
  }

  const shutdown = () => {
    if (viteProc && !viteProc.killed) {
      try { viteProc.kill(); } catch {}
    }
    server.close(() => {
      try { close(); } catch {}
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function runDev(options) {
  const { existsSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const targetDir = path.resolve(process.cwd(), 'dashboard');
  const pkgJsonPath = path.join(targetDir, 'package.json');
  const viteBin = path.join(targetDir, 'node_modules', 'vite', 'bin', 'vite.js');

  if (!existsSync(pkgJsonPath) || options.force) {
    console.log(`Pulling dashboard from ${options.repo}/dashboard into ./dashboard...`);
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const degitArgs = ['--yes', 'degit', `${options.repo}/dashboard`, 'dashboard'];
    if (options.force) degitArgs.push('--force');
    const pullRes = spawnSync(npxCmd, degitArgs, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (pullRes.error || pullRes.status !== 0) {
      throw new Error(`Failed to pull dashboard from ${options.repo}/dashboard.`);
    }
  }

  if (!existsSync(viteBin)) {
    console.log('Installing dashboard dependencies...');
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const installRes = spawnSync(npmCmd, ['--prefix', 'dashboard', 'install'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (installRes.error || installRes.status !== 0) {
      throw new Error('Failed to install dashboard dependencies.');
    }
  }

  await runDashboard({ ...options, dashboardDir: targetDir });
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === 'install-skills') {
    await installSkills(parseSkillsArgs(rest));
  } else if (command === 'db:generate') {
    await runDbGen(parseDbGenArgs(rest));
  } else if (command === 'dashboard') {
    await runDashboard(parseDashboardArgs(rest));
  } else if (command === 'dev') {
    await runDev(parseDashboardArgs(rest));
  } else {
    console.log(usage);
    process.exitCode = command && command !== '--help' && command !== '-h' ? 1 : 0;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(usage);
  process.exitCode = 1;
}
