const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// 1. Watch root package directory for live updates
config.watchFolders = [monorepoRoot];

// 2. Force Metro to resolve a single copy of React from the example app
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  'expo-sqlite': path.resolve(projectRoot, 'node_modules/expo-sqlite'),
};

// 3. Prioritize local node_modules and disable lookup in parent directories
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
];

module.exports = config;
