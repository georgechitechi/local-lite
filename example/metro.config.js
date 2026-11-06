const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files in the local-lite parent package
config.watchFolders = [workspaceRoot];

// 2. Ensure only ONE copy of React, React Native, and React DOM are ever bundled
const singletonModules = {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-dom': path.resolve(projectRoot, 'node_modules/react-dom'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
};

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

config.resolver.extraNodeModules = singletonModules;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (singletonModules[moduleName]) {
    return context.resolveRequest(context, singletonModules[moduleName], platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

