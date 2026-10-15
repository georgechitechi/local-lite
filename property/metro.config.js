const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// 1. Watch root package directory for live updates
config.watchFolders = [monorepoRoot];

// 2. Force Metro to resolve a single copy of React and core modules from the property app
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  'expo-sqlite': path.resolve(projectRoot, 'node_modules/expo-sqlite'),
  'expo-modules-core': path.resolve(projectRoot, 'node_modules/expo-modules-core'),
  'react-native-screens': path.resolve(projectRoot, 'node_modules/react-native-screens'),
  'react-native-reanimated': path.resolve(projectRoot, 'node_modules/react-native-reanimated'),
  'expo-router': path.resolve(projectRoot, 'node_modules/expo-router'),
};

// 3. Prioritize local node_modules and disable lookup in parent directories
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
];

// Add .wasm to asset extensions to support expo-sqlite on web/export
config.resolver.assetExts.push('wasm');

module.exports = config;
