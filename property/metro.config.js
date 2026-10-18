const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Add .wasm to asset extensions to support expo-sqlite on web/export
config.resolver.assetExts.push('wasm');

// Force Metro to resolve singleton/peer packages from this project's node_modules
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
        originModulePath: path.resolve(__dirname, 'package.json'),
      },
      moduleName,
      platform
    );
  }

  return context.resolveRequest(context, moduleName, platform);
};

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  react: path.resolve(__dirname, 'node_modules/react'),
  'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
  'react-native': path.resolve(__dirname, 'node_modules/react-native'),
  'expo-sqlite': path.resolve(__dirname, 'node_modules/expo-sqlite'),
  '@supabase/supabase-js': path.resolve(__dirname, 'node_modules/@supabase/supabase-js'),
};

module.exports = config;
