/**
 * @format
 */

import 'react-native';
import React from 'react';
import App from '../App';

// Note: import explicitly to use the types shipped with jest.
import {afterEach, beforeEach, it} from '@jest/globals';

// Note: test renderer must be required after react-native.
import renderer, {act, ReactTestRenderer} from 'react-test-renderer';

// App.js schedules a 10s scan timeout that it never clears, so use fake timers
// to keep the run deterministic and avoid leaving a pending handle behind.
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('renders correctly', async () => {
  let tree: ReactTestRenderer | undefined;

  // The mount effect starts async permission/BLE work, so flush it inside
  // act() and unmount before Jest tears the environment down.
  await act(async () => {
    tree = renderer.create(<App />);
  });

  await act(async () => {
    tree?.unmount();
  });
});
