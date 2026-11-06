const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Support WebAssembly (.wasm) for expo-sqlite on web
config.resolver.assetExts.push('wasm');

// 1. Watch all files in the local-lite parent package
config.watchFolders = [workspaceRoot];

// 2. Ensure only ONE copy of React and React DOM are ever bundled
const singletonModules = {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-dom': path.resolve(projectRoot, 'node_modules/react-dom'),
};

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

config.resolver.extraNodeModules = singletonModules;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // On web, react-native MUST resolve to react-native-web
  if (platform === 'web' && moduleName === 'react-native') {
    return context.resolveRequest(context, 'react-native-web', platform);
  }

  if (singletonModules[moduleName]) {
    return context.resolveRequest(context, singletonModules[moduleName], platform);
  }

  // On native platforms (android / ios), ensure singleton react-native
  if (moduleName === 'react-native') {
    return context.resolveRequest(
      context,
      path.resolve(projectRoot, 'node_modules/react-native'),
      platform
    );
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

