import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  useColorScheme,
  Platform,
  Alert,
  ActivityIndicator,
  AppState,
  SafeAreaView,
  StatusBar,
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
import KeepAwake from 'react-native-keep-awake';

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

// Keep-alive constants
const KEEPALIVE_INTERVAL = 10000; // Send keepalive every 10 seconds
const STATUS_POLL_INTERVAL = 30000; // Poll battery status every 30 seconds

const App = () => {
  // State Variables
  const [timer, setTimer] = useState(10); // Timer in minutes
  const [strength, setStrength] = useState(5); // Default strength
  const [battery, setBattery] = useState(null); // Battery level
  const [charging, setCharging] = useState(null); // Charging status
  const [scanning, setScanning] = useState(false); // Scanning state
  const [connectedDevice, setConnectedDevice] = useState(null); // Connected device
  const [isRunning, setIsRunning] = useState(false); // Timer running state
  const [remainingTime, setRemainingTime] = useState(0); // Remaining time in seconds
  const [appState, setAppState] = useState(AppState.currentState);

  // Reference for intervals to allow clearing
  const intervalRef = useRef(null);
  const keepaliveRef = useRef(null);
  const statusPollRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const disconnectSubscriptionRef = useRef(null);
  const isReconnectingRef = useRef(false);

  const colorScheme = useColorScheme();
  const isDarkMode = colorScheme === 'dark';
  const backgroundColor = isDarkMode ? '#0F1419' : '#F3F4F6';
  const styles = getStyles(isDarkMode);

  // Request permissions on mount
  useEffect(() => {
    requestBluetoothPermissions();

    // Listen for app state changes
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription?.remove();
      manager.stopDeviceScan();
      if (connectedDevice) {
        manager.cancelDeviceConnection(connectedDevice.id);
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (keepaliveRef.current) {
        clearInterval(keepaliveRef.current);
      }
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current);
      }
      if (disconnectSubscriptionRef.current) {
        disconnectSubscriptionRef.current.remove();
      }
    };
  }, []);

  // Handle app state changes
  const handleAppStateChange = (nextAppState) => {
    appStateRef.current = nextAppState;
    setAppState(nextAppState);

    // When app comes to foreground, refresh device status
    if (nextAppState === 'active' && connectedDevice) {
      console.log('App became active, refreshing device status...');
      queryDeviceStatus(connectedDevice);
    }
  };

  // Handle device disconnection - auto-reconnect
  const handleDisconnection = () => {
    console.log('Device disconnected, attempting to reconnect...');
    setConnectedDevice(null);
    setBattery(null);
    setCharging(null);

    // Clear any existing intervals
    if (keepaliveRef.current) {
      clearInterval(keepaliveRef.current);
      keepaliveRef.current = null;
    }
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }

    // Don't stop the timer - we'll resume when reconnected
    // Auto-scan and reconnect
    if (!isReconnectingRef.current) {
      isReconnectingRef.current = true;
      setTimeout(() => {
        scanForDevices();
        isReconnectingRef.current = false;
      }, 1000); // Small delay before reconnecting
    }
  };

  // Keep screen awake while running
  useEffect(() => {
    if (isRunning) {
      KeepAwake.activate();
      console.log('Screen wake lock activated');
    } else {
      KeepAwake.deactivate();
      console.log('Screen wake lock deactivated');
    }

    return () => {
      KeepAwake.deactivate();
    };
  }, [isRunning]);

  // Start keepalive interval when device is running
  useEffect(() => {
    if (isRunning && connectedDevice) {
      console.log('Starting keepalive interval...');

      // Send strength level periodically to keep device alive
      keepaliveRef.current = setInterval(() => {
        console.log('Sending keepalive with current strength...');
        sendCommand(`${strength}\n`);
      }, KEEPALIVE_INTERVAL);

      return () => {
        if (keepaliveRef.current) {
          console.log('Clearing keepalive interval');
          clearInterval(keepaliveRef.current);
        }
      };
    }
  }, [isRunning, connectedDevice, strength]);

  // Poll device status periodically when connected
  useEffect(() => {
    if (connectedDevice) {
      console.log('Starting status polling interval...');

      statusPollRef.current = setInterval(() => {
        console.log('Polling device status...');
        queryDeviceStatus(connectedDevice);
      }, STATUS_POLL_INTERVAL);

      return () => {
        if (statusPollRef.current) {
          console.log('Clearing status polling interval');
          clearInterval(statusPollRef.current);
        }
      };
    }
  }, [connectedDevice]);

  // Request Bluetooth and Location permissions
  const requestBluetoothPermissions = async () => {
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
  };

  // Scan for BLE devices
  const scanForDevices = () => {
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
  };

  // Connect to the BLE device
  const connectToDevice = async device => {
    try {
      console.log(`Connecting to device: ${device.name}`);
      const connected = await manager.connectToDevice(device.id, { autoConnect: false });
      console.log('Connected to device:', connected.name);

      // Discover services and characteristics
      await connected.discoverAllServicesAndCharacteristics();
      console.log('Services and characteristics discovered');

      // Set up disconnection listener
      if (disconnectSubscriptionRef.current) {
        disconnectSubscriptionRef.current.remove();
      }
      disconnectSubscriptionRef.current = manager.onDeviceDisconnected(
        connected.id,
        (error, disconnectedDevice) => {
          console.log('Device disconnected:', disconnectedDevice?.name, error?.message);
          handleDisconnection();
        }
      );

      setConnectedDevice(connected);

      // Subscribe to notifications
      subscribeToNotifications(connected);

      // Query initial battery and charging status
      await queryDeviceStatus(connected);

      // If a session was running, resume it
      if (isRunning && remainingTime > 0) {
        console.log('Resuming session after reconnection...');
        await sendCommand('D\n', connected); // Activate device
        await sendCommand(`${strength}\n`, connected); // Set strength
      }
    } catch (error) {
      console.error('Connection error:', error);
      // Don't show alert, just retry after a delay
      console.log('Will retry connection...');
      setTimeout(() => {
        if (!isReconnectingRef.current) {
          isReconnectingRef.current = true;
          scanForDevices();
          isReconnectingRef.current = false;
        }
      }, 2000);
    }
  };

  // Query device status (battery and charging)
  const queryDeviceStatus = async device => {
    console.log('Querying device status...');
    await sendCommand('Q\n', device); // Query battery
    await sendCommand('u\n', device); // Query charging status
  };

  // Subscribe to notifications from the device
  const subscribeToNotifications = device => {
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
  };

  // Handle incoming notifications
  const handleNotification = (decodedData, rawBytes) => {
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
  };

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
  const sendCommand = async (command, device = connectedDevice) => {
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
      // Don't show alert - trigger reconnection instead
      // Check if it's a disconnection error
      if (error.message?.includes('not connected') || error.message?.includes('disconnected')) {
        console.log('Device appears disconnected, triggering reconnection...');
        handleDisconnection();
      }
    }
  };

  // Handle Start Button Press
  const handleStart = async () => {
    if (!connectedDevice) {
      console.log('Cannot start - device not connected');
      return;
    }

    console.log('Start button pressed.');
    setIsRunning(true);
    setRemainingTime(timer * 60); // Set remaining time in seconds

    await sendCommand('D\n'); // Activate device
    await sendCommand(`${strength}\n`); // Set strength
    console.log(`Timer started for ${timer} minutes with strength ${strength}.`);
  };

  // Handle Stop Button Press
  const handleStop = async () => {
    console.log('Stop button pressed.');
    setIsRunning(false);
    setRemainingTime(0); // Reset remaining time

    if (connectedDevice) {
      await sendCommand('0\n'); // Deactivate device
      console.log('Device stopped.');
      await queryDeviceStatus(connectedDevice); // Update status
    }
  };

  // Implement countdown timer
  useEffect(() => {
    if (isRunning && remainingTime > 0) {
      console.log(`Timer started: ${remainingTime} seconds remaining.`);
      intervalRef.current = setInterval(() => {
        setRemainingTime(prevTime => {
          if (prevTime <= 1) {
            clearInterval(intervalRef.current);
            console.log('Timer ended.');
            handleStop(); // Automatically stop when timer reaches zero
            return 0;
          }
          return prevTime - 1;
        });
      }, 1000); // Decrement every second
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning]);

  // Handle Strength Change
  const handleStrengthChange = async value => {
    setStrength(value);
    console.log(`Strength slider changed to: ${value}`);

    if (isRunning && connectedDevice) {
      await sendCommand(`${value}\n`); // Update strength
      console.log(`Strength updated to ${value} while running.`);
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
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor={backgroundColor}
        translucent={Platform.OS === 'ios'}
      />
      {/* Status Bar */}
      <View style={styles.statusBar}>
        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>Connection</Text>
          <View style={styles.connectionIndicator}>
            <View style={[styles.dot, connectedDevice ? styles.dotConnected : styles.dotDisconnected]} />
            <Text style={styles.statusValue}>
              {connectedDevice ? 'Connected' : 'Disconnected'}
            </Text>
          </View>
        </View>
        <View style={styles.statusDivider} />
        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>Battery</Text>
          <Text style={styles.statusValue}>
            {battery !== null ? `${battery}%` : '--'}
          </Text>
        </View>
        <View style={styles.statusDivider} />
        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>Charging</Text>
          <Text style={styles.statusValue}>
            {charging !== null ? (charging === 'Charging' ? '⚡' : '○') : '--'}
          </Text>
        </View>
      </View>

      {/* Main Content */}
      <View style={styles.mainContent}>
        {/* Timer Display */}
        <View style={styles.timerCard}>
          <Text style={styles.timerLabel}>Session Timer</Text>
          <View style={styles.timerDisplay}>
            <TouchableOpacity
              style={styles.timerButton}
              onPress={decreaseTimer}
              disabled={isRunning}
            >
              <Text style={[styles.timerButtonText, isRunning && styles.timerButtonDisabled]}>−</Text>
            </TouchableOpacity>
            <View style={styles.timerTextContainer}>
              <Text style={styles.timerText}>
                {formatTime(remainingTime > 0 ? remainingTime : timer * 60)}
              </Text>
              {isRunning && remainingTime > 0 && (
                <View style={styles.progressBar}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${(remainingTime / (timer * 60)) * 100}%` }
                    ]}
                  />
                </View>
              )}
            </View>
            <TouchableOpacity
              style={styles.timerButton}
              onPress={increaseTimer}
              disabled={isRunning}
            >
              <Text style={[styles.timerButtonText, isRunning && styles.timerButtonDisabled]}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Strength Control */}
        <View style={styles.strengthCard}>
          <Text style={styles.strengthLabel}>Intensity Level</Text>
          <View style={styles.strengthDisplay}>
            <TouchableOpacity
              style={styles.strengthButton}
              onPress={() => handleStrengthChange(Math.max(1, strength - 1))}
            >
              <Text style={styles.strengthButtonText}>−</Text>
            </TouchableOpacity>
            <View style={styles.strengthBadge}>
              <Text style={styles.strengthValue}>{strength}</Text>
            </View>
            <TouchableOpacity
              style={styles.strengthButton}
              onPress={() => handleStrengthChange(Math.min(9, strength + 1))}
            >
              <Text style={styles.strengthButtonText}>+</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.sliderContainer}>
            <Text style={styles.sliderMinMax}>1</Text>
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={9}
              step={1}
              value={strength}
              onValueChange={handleStrengthChange}
              minimumTrackTintColor={isDarkMode ? '#4A90E2' : '#2563EB'}
              maximumTrackTintColor={isDarkMode ? '#374151' : '#D1D5DB'}
              thumbTintColor={isDarkMode ? '#60A5FA' : '#3B82F6'}
            />
            <Text style={styles.sliderMinMax}>9</Text>
          </View>
        </View>

        {/* Control Buttons */}
        <View style={styles.controlsContainer}>
          {connectedDevice ? (
            <TouchableOpacity
              style={[
                styles.mainButton,
                isRunning ? styles.stopButton : styles.startButton
              ]}
              onPress={isRunning ? handleStop : handleStart}
            >
              <Text style={styles.mainButtonText}>
                {isRunning ? '■ Stop' : '▶ Start'}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.mainButton, styles.scanButton, scanning && styles.scanningButton]}
              onPress={scanForDevices}
              disabled={scanning}
            >
              {scanning ? (
                <>
                  <ActivityIndicator color="#FFFFFF" size="small" style={styles.buttonSpinner} />
                  <Text style={styles.mainButtonText}>Scanning...</Text>
                </>
              ) : (
                <Text style={styles.mainButtonText}>📡 Scan for Device</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
};

// Styles
const getStyles = isDarkMode =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? '#0F1419' : '#F3F4F6',
      paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
    },
    statusBar: {
      flexDirection: 'row',
      backgroundColor: isDarkMode ? '#1A1F2E' : '#FFFFFF',
      paddingVertical: 16,
      paddingHorizontal: 20,
      marginTop: 16,
      marginHorizontal: 16,
      borderRadius: 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 3,
    },
    statusItem: {
      flex: 1,
      alignItems: 'center',
    },
    statusLabel: {
      fontSize: 12,
      color: isDarkMode ? '#9CA3AF' : '#6B7280',
      marginBottom: 4,
      fontWeight: '500',
    },
    statusValue: {
      fontSize: 14,
      color: isDarkMode ? '#E5E7EB' : '#1F2937',
      fontWeight: '600',
    },
    statusDivider: {
      width: 1,
      backgroundColor: isDarkMode ? '#374151' : '#E5E7EB',
      marginHorizontal: 8,
    },
    connectionIndicator: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    dotConnected: {
      backgroundColor: '#10B981',
    },
    dotDisconnected: {
      backgroundColor: '#EF4444',
    },
    mainContent: {
      flex: 1,
      paddingHorizontal: 16,
      paddingTop: 20,
      justifyContent: 'space-between',
      paddingBottom: 40,
    },
    timerCard: {
      backgroundColor: isDarkMode ? '#1A1F2E' : '#FFFFFF',
      borderRadius: 16,
      padding: 24,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 4,
    },
    timerLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: isDarkMode ? '#9CA3AF' : '#6B7280',
      marginBottom: 16,
      textAlign: 'center',
    },
    timerDisplay: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    timerButton: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: isDarkMode ? '#374151' : '#E5E7EB',
      justifyContent: 'center',
      alignItems: 'center',
    },
    timerButtonText: {
      fontSize: 32,
      fontWeight: '300',
      color: isDarkMode ? '#E5E7EB' : '#1F2937',
    },
    timerButtonDisabled: {
      opacity: 0.3,
    },
    timerTextContainer: {
      marginHorizontal: 32,
      alignItems: 'center',
    },
    timerText: {
      fontSize: 56,
      fontWeight: '700',
      color: isDarkMode ? '#FFFFFF' : '#1F2937',
      fontVariant: ['tabular-nums'],
    },
    progressBar: {
      width: 200,
      height: 4,
      backgroundColor: isDarkMode ? '#374151' : '#E5E7EB',
      borderRadius: 2,
      marginTop: 12,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: isDarkMode ? '#60A5FA' : '#3B82F6',
      borderRadius: 2,
    },
    strengthCard: {
      backgroundColor: isDarkMode ? '#1A1F2E' : '#FFFFFF',
      borderRadius: 16,
      padding: 24,
      marginTop: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 4,
    },
    strengthLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: isDarkMode ? '#9CA3AF' : '#6B7280',
      textAlign: 'center',
      marginBottom: 16,
    },
    strengthDisplay: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
    },
    strengthButton: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: isDarkMode ? '#374151' : '#E5E7EB',
      justifyContent: 'center',
      alignItems: 'center',
    },
    strengthButtonText: {
      fontSize: 32,
      fontWeight: '300',
      color: isDarkMode ? '#E5E7EB' : '#1F2937',
    },
    strengthBadge: {
      backgroundColor: isDarkMode ? '#3B82F6' : '#2563EB',
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 24,
      minWidth: 80,
      alignItems: 'center',
      marginHorizontal: 24,
    },
    strengthValue: {
      fontSize: 32,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    sliderContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    slider: {
      flex: 1,
      marginHorizontal: 12,
    },
    sliderMinMax: {
      fontSize: 14,
      fontWeight: '600',
      color: isDarkMode ? '#6B7280' : '#9CA3AF',
      width: 24,
      textAlign: 'center',
    },
    controlsContainer: {
      marginTop: 24,
    },
    mainButton: {
      height: 64,
      borderRadius: 32,
      justifyContent: 'center',
      alignItems: 'center',
      flexDirection: 'row',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 6,
    },
    startButton: {
      backgroundColor: isDarkMode ? '#10B981' : '#059669',
    },
    stopButton: {
      backgroundColor: isDarkMode ? '#EF4444' : '#DC2626',
    },
    scanButton: {
      backgroundColor: isDarkMode ? '#3B82F6' : '#2563EB',
    },
    scanningButton: {
      opacity: 0.7,
    },
    mainButtonText: {
      fontSize: 20,
      fontWeight: '700',
      color: '#FFFFFF',
      letterSpacing: 0.5,
    },
    buttonSpinner: {
      marginRight: 12,
    },
  });

export default App;
