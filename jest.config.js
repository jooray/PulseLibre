module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // The preset only transforms react-native and @react-native* packages.
  // react-native-permissions ships its jest mock as ESM, so it needs transforming too.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-permissions)/)',
  ],
};
