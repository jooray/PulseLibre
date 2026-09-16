const reactNativeConfig = require('@react-native/eslint-config/flat');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'android/**',
      'ios/**',
      'vendor/**',
      'coverage/**',
      '**/*.bundle',
    ],
  },
  ...reactNativeConfig,
  {
    // Not matched by the config's test-file globs, but it runs under Jest.
    files: ['jest.setup.js'],
    languageOptions: {
      globals: {
        jest: 'readonly',
      },
    },
  },
];
