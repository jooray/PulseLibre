import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Button,
  useColorScheme,
  Platform,
  Alert,
  AppState,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { BleManager } from 'react-native-ble-plx';
import {
  request,
  requestMultiple,
  check,
  checkMultiple,
  PERMISSIONS,
  RESULTS,
  openSettings,
} from 'react-native-permissions';
import { Buffer } from 'buffer'; // Import Buffer for base64 encoding

// Initialize BLE Manager
const manager = new BleManager();

// BLE Constants
const DEVICE_NAME_PREFIX = 'Pulsetto';
const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_RX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Write
const UART_TX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Notify

// Battery Voltage Constants
const BATTERY_FULL_VOLTAGE = 3.95; // Voltage at 100%
const BATTERY_EMPTY_VOLTAGE = 2.5; // Voltage at 0%

// Polling Configuration
const POLLING_INTERVAL_RUNNING = 30000; // 30 seconds when device is running
const POLLING_INTERVAL_IDLE = 60000; // 60 seconds when device is idle
const MAX_RETRY_ATTEMPTS = 3; // Maximum retry attempts for failed commands

const App = () => {
  // State Variables
  const [timer, setTimer] = useState(4); // Timer in minutes
  const [strength, setStrength] = useState(5); // Default strength
  const [battery, setBattery] = useState('--'); // Battery level
  const [charging, setCharging] = useState('--'); // Charging status
  const [scanning, setScanning] = useState(false); // Scanning state
  const [connectedDevice, setConnectedDevice] = useState(null); // Connected device
  const [isRunning, setIsRunning] = useState(false); // Timer running state
  const [remainingTime, setRemainingTime] = useState(0); // Remaining time in seconds
  const [isPollingEnabled, setIsPollingEnabled] = useState(true); // Status polling enabled
  const [appState, setAppState] = useState(AppState.currentState); // App state for background handling

  // Reference for intervals to allow clearing
  const intervalRef = useRef(null);
  const pollingRef = useRef(null);
  const retryCountRef = useRef(0);

  const colorScheme = useColorScheme();
  const isDarkMode = colorScheme === 'dark';
  const styles = getStyles(isDarkMode);

  // Request permissions on mount and handle app state changes
  useEffect(() => {
    requestBluetoothPermissions();

    // Handle app state changes for background/foreground optimization
    const handleAppStateChange = (nextAppState) => {
      console.log('App state changed:', nextAppState);
      setAppState(nextAppState);

      if (nextAppState === 'background') {
        // Pause polling when app goes to background to save battery
        stopStatusPolling();
      } else if (nextAppState === 'active' && connectedDevice && isPollingEnabled) {
        // Resume polling when returning to foreground
        startStatusPolling();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      manager.stopDeviceScan();
      if (connectedDevice) {
        manager.cancelDeviceConnection(connectedDevice.id);
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      stopStatusPolling();
      subscription?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally empty - this should only run on mount

  // Request Bluetooth and Location permissions
  const requestBluetoothPermissions = useCallback(async () => {
    if (Platform.OS === 'android') {
      const permissions = [
        PERMISSIONS.ANDROID.BLUETOOTH_SCAN,
        PERMISSIONS.ANDROID.BLUETOOTH_CONNECT,
        PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION,
      ];

      try {
        const statuses = await checkMultiple(permissions);

        const permissionsToRequest = [];

        for (const permission of permissions) {
          if (statuses[permission] !== RESULTS.GRANTED) {
            permissionsToRequest.push(permission);
          }
        }

        if (permissionsToRequest.length > 0) {
          const newStatuses = await requestMultiple(permissionsToRequest);

          const allGranted = Object.values(newStatuses).every(
            status => status === RESULTS.GRANTED
          );

          if (allGranted) {
            scanForDevices();
          } else {
            Alert.alert(
              'Permissions Required',
              'Location and Bluetooth permissions are required for scanning.',
              [
                { text: 'Grant Permissions', onPress: () => requestBluetoothPermissions() },
                { text: 'Open Settings', onPress: () => openSettings(), style: 'cancel' },
              ]
            );
          }
        } else {
          scanForDevices();
        }
      } catch (error) {
        console.error('Permission request error:', error);
        Alert.alert('Permission Error', error.message, [{ text: 'OK' }]);
      }
    } else if (Platform.OS === 'ios') {
      // Handle iOS permissions
      try {
        const status = await check(PERMISSIONS.IOS.BLUETOOTH_PERIPHERAL);

        if (status !== RESULTS.GRANTED) {
          const newStatus = await request(PERMISSIONS.IOS.BLUETOOTH_PERIPHERAL);
          if (newStatus === RESULTS.GRANTED) {
            scanForDevices();
          } else {
            Alert.alert(
              'Permissions Required',
              'Bluetooth permission is required for scanning.',
              [
                { text: 'Grant Permissions', onPress: () => requestBluetoothPermissions() },
                { text: 'Open Settings', onPress: () => openSettings(), style: 'cancel' },
              ]
            );
          }
        } else {
          scanForDevices();
        }
      } catch (error) {
        console.error('Permission request error:', error);
        Alert.alert('Permission Error', error.message, [{ text: 'OK' }]);
      }
    }
  }, [scanForDevices]);

  // Scan for BLE devices
  const scanForDevices = useCallback(() => {
    if (scanning || connectedDevice) {
      console.log('Scan already in progress or device already connected.');
      return;
    }

    console.log('Starting device scan...');
    setScanning(true);
    manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        console.log('Scan error:', error);
        setScanning(false);
        Alert.alert('Scan Error', error.message || JSON.stringify(error), [{ text: 'OK' }]);
        return;
      }

      if (device.name?.startsWith(DEVICE_NAME_PREFIX)) {
        console.log('Found device:', device.name);
        manager.stopDeviceScan();
        setScanning(false);
        connectToDevice(device);
      }
    });

    // Set a timeout to stop scanning after 10 seconds
    setTimeout(() => {
      if (scanning) {
        manager.stopDeviceScan();
        setScanning(false);
        console.log('Scanning timed out');
        Alert.alert('Scan Timeout', 'No device found. Please try scanning again.', [
          { text: 'OK' },
        ]);
      }
    }, 10000); // 10 seconds
  }, [scanning, connectedDevice, connectToDevice]);

  // Connect to the BLE device
  const connectToDevice = useCallback(async device => {
    try {
      console.log(`Connecting to device: ${device.name}`);
      const connected = await manager.connectToDevice(device.id, { autoConnect: false });
      console.log('Connected to device:', connected.name);

      // Discover services and characteristics
      await connected.discoverAllServicesAndCharacteristics();
      console.log('Services and characteristics discovered');

      setConnectedDevice(connected);

      // Subscribe to notifications
      subscribeToNotifications(connected);

      // Query initial battery and charging status
      await queryDeviceStatus(connected);

      // Start periodic status polling if enabled and app is active
      if (isPollingEnabled && appState === 'active') {
        startStatusPolling();
      }
    } catch (error) {
      console.error('Connection error:', error);
      Alert.alert('Connection Error', error.message, [{ text: 'OK' }]);
    }
  }, [isPollingEnabled, appState, queryDeviceStatus, startStatusPolling, subscribeToNotifications]);

  // Query device status (battery and charging)
  const queryDeviceStatus = useCallback(async device => {
    console.log('Querying device status...');
    await sendCommand('Q\n', device); // Query battery
    await sendCommand('u\n', device); // Query charging status
  }, [sendCommand]);

  // Start periodic status polling
  const startStatusPolling = useCallback(() => {
    if (pollingRef.current || !connectedDevice || !isPollingEnabled || appState !== 'active') {
      return;
    }

    console.log('Starting status polling...');
    const interval = isRunning ? POLLING_INTERVAL_RUNNING : POLLING_INTERVAL_IDLE;

    pollingRef.current = setInterval(async () => {
      try {
        await queryDeviceStatus(connectedDevice);
        retryCountRef.current = 0; // Reset retry count on success
      } catch (error) {
        console.warn('Status polling failed:', error);
        retryCountRef.current += 1;

        if (retryCountRef.current >= MAX_RETRY_ATTEMPTS) {
          console.error('Max retry attempts reached, stopping polling');
          stopStatusPolling();
          // Optionally show user notification about connection issues
          Alert.alert(
            'Connection Issue',
            'Unable to communicate with device. Please check connection.',
            [{ text: 'OK' }]
          );
        }
      }
    }, interval);
  }, [connectedDevice, isPollingEnabled, appState, isRunning, queryDeviceStatus, stopStatusPolling]);

  // Stop periodic status polling
  const stopStatusPolling = useCallback(() => {
    if (pollingRef.current) {
      console.log('Stopping status polling...');
      clearInterval(pollingRef.current);
      pollingRef.current = null;
      retryCountRef.current = 0;
    }
  }, []);

  // Subscribe to notifications from the device
  const subscribeToNotifications = useCallback(device => {
    console.log('Subscribing to notifications...');
    device.monitorCharacteristicForService(
      UART_SERVICE_UUID,
      UART_TX_CHAR_UUID,
      (error, characteristic) => {
        if (error) {
          console.error('Notification error:', error);
          return;
        }

        if (characteristic?.value) {
          const decodedValue = Buffer.from(characteristic.value, 'base64').toString('utf-8');
          const rawBytes = Buffer.from(characteristic.value, 'base64');
          console.log('Received notification (decoded):', decodedValue);
          console.log('Received notification (raw bytes):', rawBytes);
          handleNotification(decodedValue, rawBytes);
        }
      }
    );
  }, [handleNotification]);

  // Handle incoming notifications
  const handleNotification = useCallback((decodedData, rawBytes) => {
    // Debugging: Log both decoded and raw data
    console.log(`Decoded Data: "${decodedData}"`);
    console.log(`Raw Bytes: ${rawBytes.toString('hex')}`);

    // Trim the decoded data to remove leading/trailing whitespace
    const trimmedData = decodedData.trim();

    // Check for Battery Information
    if (trimmedData.startsWith('Batt:')) {
      try {
        const batteryVoltage = parseFloat(trimmedData.split('Batt:')[1]);
        const batteryPercentage = calculateBatteryPercentage(batteryVoltage);
        setBattery(`${batteryPercentage}%`);
        console.log(`Battery Voltage: ${batteryVoltage}V => ${batteryPercentage}%`);
      } catch (error) {
        console.error('Failed to parse battery data:', error);
      }
    }

    // Check for Charging Status based on raw bytes
    // Assuming 'u0' (0x75 0x01 0x30) = Not Charging, 'u1' (0x75 0x01 0x31) = Charging
    if (rawBytes.length >= 3 && rawBytes[0] === 0x75 && rawBytes[1] === 0x01) {
      if (rawBytes[2] === 0x30) {
        // '0'
        setCharging('Not Charging');
        console.log('Charging Status: Not Charging');
      } else if (rawBytes[2] === 0x31) {
        // '1'
        setCharging('Charging');
        console.log('Charging Status: Charging');
      } else {
        console.warn('Unknown charging status byte:', rawBytes[2]);
      }
    }

    // Handle other notifications if necessary
    // Example: "mode:D", "BR:145"
    // Currently, these are logged but not processed
  }, []);

  // Calculate battery percentage based on voltage
  const calculateBatteryPercentage = voltage => {
    if (voltage >= BATTERY_FULL_VOLTAGE) {
      return 100;
    } else if (voltage <= BATTERY_EMPTY_VOLTAGE) {
      return 0;
    } else {
      return Math.round(
        ((voltage - BATTERY_EMPTY_VOLTAGE) / (BATTERY_FULL_VOLTAGE - BATTERY_EMPTY_VOLTAGE)) * 100
      );
    }
  };

  // Send a command to the device
  const sendCommand = useCallback(async (command, device = connectedDevice) => {
    if (!device) {
      console.log('Device not connected. Cannot send command.');
      return;
    }

    try {
      console.log(`Sending command: "${command}"`);
      const base64Command = Buffer.from(command).toString('base64');
      console.log(`Base64 Command: ${base64Command}`);
      await device.writeCharacteristicWithResponseForService(
        UART_SERVICE_UUID,
        UART_RX_CHAR_UUID,
        base64Command
      );
      console.log('Command sent successfully.');
    } catch (error) {
      console.error('Failed to send command:', error);
      Alert.alert('Command Error', error.message, [{ text: 'OK' }]);
    }
  }, [connectedDevice]);

  // Handle Stop Button Press
  const handleStop = useCallback(async () => {
    if (!connectedDevice) {
      Alert.alert('Error', 'Device not connected.', [{ text: 'OK' }]);
      return;
    }

    console.log('Stop button pressed.');
    setIsRunning(false);
    setRemainingTime(0); // Reset remaining time

    try {
      await sendCommand('0\n'); // Deactivate device
      console.log('Device stopped.');
      await queryDeviceStatus(connectedDevice); // Update status
    } catch (error) {
      console.error('Error during stop:', error);
      Alert.alert('Stop Error', error.message, [{ text: 'OK' }]);
    }
  }, [connectedDevice, sendCommand, queryDeviceStatus]);

  // Handle Start Button Press
  const handleStart = async () => {
    if (!connectedDevice) {
      Alert.alert('Error', 'Device not connected.', [{ text: 'OK' }]);
      return;
    }

    console.log('Start button pressed.');
    setIsRunning(true);
    setRemainingTime(timer * 60); // Set remaining time in seconds

    try {
      await sendCommand('D\n'); // Activate device
      await sendCommand(`${strength}\n`); // Set strength
      console.log(`Timer started for ${timer} minutes with strength ${strength}.`);
    } catch (error) {
      console.error('Error during start:', error);
      Alert.alert('Start Error', error.message, [{ text: 'OK' }]);
    }
  };

  // Implement countdown timer
  useEffect(() => {
    let timerId = null;

    if (isRunning && remainingTime > 0) {
      console.log(`Timer started: ${remainingTime} seconds remaining.`);
      timerId = setInterval(() => {
        setRemainingTime(prevTime => {
          if (prevTime <= 1) {
            console.log('Timer ended.');
            handleStop(); // Automatically stop when timer reaches zero
            return 0;
          }
          return prevTime - 1;
        });
      }, 1000); // Decrement every second
      intervalRef.current = timerId;
    }

    return () => {
      if (timerId) {
        clearInterval(timerId);
      }
    };
  }, [isRunning, remainingTime, handleStop]);

  // Handle polling interval changes when running state changes
  useEffect(() => {
    if (connectedDevice && isPollingEnabled && appState === 'active') {
      // Restart polling with appropriate interval
      stopStatusPolling();
      startStatusPolling();
    }
  }, [isRunning, connectedDevice, isPollingEnabled, appState, startStatusPolling, stopStatusPolling]);

  // Handle Strength Change
  const handleStrengthChange = async value => {
    setStrength(value);
    console.log(`Strength slider changed to: ${value}`);

    if (isRunning && connectedDevice) {
      try {
        await sendCommand(`${value}\n`); // Update strength
        console.log(`Strength updated to ${value} while running.`);
      } catch (error) {
        console.error('Error updating strength:', error);
        Alert.alert('Strength Update Error', error.message, [{ text: 'OK' }]);
      }
    }
  };

  // Format remaining time as MM:SS
  const formatTime = seconds => {
    const mins = Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  // Timer Handlers should be defined before the return statement
  const increaseTimer = () => {
    setTimer(prev => prev + 1);
    console.log(`Timer increased to ${timer + 1} minutes.`);
  };

  const decreaseTimer = () => {
    setTimer(prev => Math.max(1, prev - 1));
    console.log(`Timer decreased to ${Math.max(1, timer - 1)} minutes.`);
  };

  return (
    <View style={styles.container}>
      {/* Timer Control */}
      <View style={styles.timerContainer}>
        <Button title="-" onPress={decreaseTimer} />
        <Text style={styles.timerText}>
          {formatTime(remainingTime > 0 ? remainingTime : timer * 60)}
        </Text>
        <Button title="+" onPress={increaseTimer} />
      </View>

      {/* Strength Slider */}
      <View style={styles.sliderContainer}>
        <Slider
          style={styles.slider}
          minimumValue={1}
          maximumValue={9}
          step={1}
          value={strength}
          onValueChange={handleStrengthChange}
          minimumTrackTintColor={isDarkMode ? '#1E90FF' : '#007BFF'}
          maximumTrackTintColor={isDarkMode ? '#CCCCCC' : '#888888'}
        />
        <Text style={styles.sliderLabel}>{strength}</Text>
      </View>

      {/* Start/Stop Button */}
      {connectedDevice &&
        (isRunning ? (
          <Button
            title="Stop"
            onPress={handleStop}
            color={isDarkMode ? '#FF4500' : '#FF6347'}
          />
        ) : (
          <Button
            title="Start"
            onPress={handleStart}
            color={isDarkMode ? '#007BFF' : '#1E90FF'}
          />
        ))}

      {/* Scan Button */}
      {!connectedDevice && (
        <Button
          title={scanning ? 'Scanning for device...' : 'Scan'}
          onPress={scanForDevices}
          disabled={scanning}
        />
      )}

      {/* Status Polling Toggle */}
      {connectedDevice && (
        <View style={styles.pollingContainer}>
          <Text style={styles.pollingLabel}>Status Polling:</Text>
          <Button
            title={isPollingEnabled ? 'ON' : 'OFF'}
            onPress={() => {
              setIsPollingEnabled(!isPollingEnabled);
              if (!isPollingEnabled) {
                // Enable polling
                if (appState === 'active') {
                  startStatusPolling();
                }
              } else {
                // Disable polling
                stopStatusPolling();
              }
            }}
            color={isPollingEnabled ? (isDarkMode ? '#4CAF50' : '#28a745') : (isDarkMode ? '#FF6B6B' : '#dc3545')}
          />
        </View>
      )}

      {/* Battery and Charging Status */}
      <Text style={styles.statusText}>
        Battery: {battery} | Charging: {charging}
      </Text>

      {isPollingEnabled && connectedDevice && (
        <Text style={styles.pollingInfoText}>
          Polling every {isRunning ? '30s' : '60s'} {appState !== 'active' ? '(paused in background)' : ''}
        </Text>
      )}
    </View>
  );
};

// Styles
const getStyles = isDarkMode =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: isDarkMode ? '#121212' : '#FFFFFF',
      padding: 16,
    },
    timerContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 16,
    },
    timerText: {
      fontSize: 32,
      fontWeight: 'bold',
      color: isDarkMode ? '#FFFFFF' : '#000000',
      marginHorizontal: 16,
    },
    sliderContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 16,
      width: '80%',
    },
    slider: {
      flex: 1,
    },
    sliderLabel: {
      fontSize: 24,
      fontWeight: 'bold',
      color: isDarkMode ? '#FFFFFF' : '#000000',
      marginLeft: 8,
      width: 30,
      textAlign: 'center',
    },
    statusText: {
      marginTop: 16,
      fontSize: 16,
      color: isDarkMode ? '#CCCCCC' : '#333333',
    },
    pollingContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 16,
      marginBottom: 8,
    },
    pollingLabel: {
      fontSize: 16,
      color: isDarkMode ? '#CCCCCC' : '#333333',
      marginRight: 8,
    },
    pollingInfoText: {
      marginTop: 8,
      fontSize: 12,
      color: isDarkMode ? '#999999' : '#666666',
      fontStyle: 'italic',
    },
  });

export default App;
