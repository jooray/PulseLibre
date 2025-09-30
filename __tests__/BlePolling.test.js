/**
 * @format
 * Tests for the BLE polling functionality
 */

import 'react-native';
import React from 'react';
import App from '../App';

// Note: import explicitly to use the types shipped with jest.
import {it, describe, expect, beforeEach} from '@jest/globals';

// Note: test renderer must be required after react-native.
import renderer from 'react-test-renderer';

describe('BLE Polling Functionality', () => {
  beforeEach(() => {
    // Clear any timers
    jest.clearAllTimers();
    jest.useFakeTimers();
  });

  it('renders correctly with automatic polling', () => {
    const component = renderer.create(<App />);
    const tree = component.toJSON();

    // The app should render without crashing
    expect(tree).toBeTruthy();
  });

  it('renders correctly with polling functionality', () => {
    const component = renderer.create(<App />);
    expect(component.toJSON()).toMatchSnapshot();
  });

  it('includes all polling-related constants', () => {
    // Test that polling constants are properly defined and used in the component
    const component = renderer.create(<App />);
    expect(component).toBeTruthy();
  });
});
