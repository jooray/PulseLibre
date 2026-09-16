/**
 * Mocks for the native modules App.js pulls in at import time.
 * Without these, requiring App.js throws before any test can run.
 */

// Ships with the package.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Ships with the package.
jest.mock('react-native-permissions', () =>
  require('react-native-permissions/mock'),
);

// No mock is published, so stub the surface App.js actually uses.
// `new BleManager()` runs at module scope, so this has to be safe to construct.
jest.mock('react-native-ble-plx', () => {
  const subscription = {remove: jest.fn()};
  return {
    BleManager: jest.fn().mockImplementation(() => ({
      startDeviceScan: jest.fn(),
      stopDeviceScan: jest.fn(),
      connectToDevice: jest.fn().mockResolvedValue(null),
      cancelDeviceConnection: jest.fn().mockResolvedValue(null),
      onDeviceDisconnected: jest.fn(() => subscription),
      destroy: jest.fn(),
    })),
    State: {PoweredOn: 'PoweredOn', PoweredOff: 'PoweredOff'},
  };
});

jest.mock('react-native-keep-awake', () => ({
  activate: jest.fn(),
  deactivate: jest.fn(),
}));
