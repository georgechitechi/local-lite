const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// 1. Watch root package directory for live updates
config.watchFolders = [monorepoRoot];

// 2. Force Metro to resolve React and native dependencies from convex_app
config.resolver.extraNodeModules = new Proxy(
  {
    react: path.resolve(projectRoot, 'node_modules/react'),
    'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
    'expo-sqlite': path.resolve(projectRoot, 'node_modules/expo-sqlite'),
  },
  {
    get: (target, name) => {
      if (Object.prototype.hasOwnProperty.call(target, name)) {
        return target[name];
      }
      return path.join(projectRoot, 'node_modules', name);
    },
  }
);

// 3. Block parent package's duplicate node_modules/react
config.resolver.blockList = [
  new RegExp(path.resolve(monorepoRoot, 'node_modules/react/.*').replace(/[/\\]/g, '[/\\\\]')),
];

config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
];

// Support wasm for expo-sqlite web
config.resolver.assetExts.push('wasm');

module.exports = config;
