module.exports = function (api) {
  api.cache(true);
  
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'react-native-paper/babel',
      // Worklets plugin MUST be the last plugin in the list for Reanimated 4
      'react-native-worklets/plugin',
    ],
  };
};
