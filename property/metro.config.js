const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add .wasm to asset extensions to support expo-sqlite on web/export
config.resolver.assetExts.push('wasm');

module.exports = config;
