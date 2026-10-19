const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files in the project and the local-lite workspace root
config.watchFolders = [workspaceRoot];

// 2. Add .wasm to asset extensions to support expo-sqlite on web/export
config.resolver.assetExts.push('wasm');

// 3. Let Metro resolve packages in project's node_modules first, then workspace
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 4. Force Metro to resolve singleton/peer packages from this project's node_modules
// to prevent duplicate React runtime instances when using linked/monorepo packages (e.g. local-lite).
const PINNED_PACKAGES = [
  'react',
  'react-dom',
  'react-native',
  'expo-sqlite',
  '@supabase/supabase-js',
];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    PINNED_PACKAGES.includes(moduleName) ||
    PINNED_PACKAGES.some((pkg) => moduleName.startsWith(pkg + '/'))
  ) {
    return context.resolveRequest(
      {
        ...context,
        originModulePath: path.resolve(projectRoot, 'package.json'),
      },
      moduleName,
      platform
    );
  }

  return context.resolveRequest(context, moduleName, platform);
};

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'local-lite': workspaceRoot,
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-dom': path.resolve(projectRoot, 'node_modules/react-dom'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  'expo-sqlite': path.resolve(projectRoot, 'node_modules/expo-sqlite'),
  '@supabase/supabase-js': path.resolve(projectRoot, 'node_modules/@supabase/supabase-js'),
};

module.exports = config;
