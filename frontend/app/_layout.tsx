import React, { useState, useRef, useEffect, createContext, useContext } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { initExecutorch } from 'react-native-executorch';
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher';

// Context to share initialization state
const ExecutorchContext = createContext<{ isReady: boolean; error: string | null }>({
  isReady: false,
  error: null,
});

export const useExecutorchStatus = () => useContext(ExecutorchContext);

export default function RootLayout() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    
    const initialize = async () => {
      try {
        console.log('Starting ExecuTorch initialization...');
        await initExecutorch({ resourceFetcher: ExpoResourceFetcher });
        console.log('ExecuTorch initialized successfully!');
        if (isMounted) {
          setIsInitialized(true);
        }
      } catch (error: any) {
        console.error('ExecuTorch init error:', error);
        if (isMounted) {
          setInitError(error.message || 'Failed to initialize');
          setIsInitialized(true); // Still allow app to show error
        }
      }
    };
    
    initialize();
    
    return () => {
      isMounted = false;
    };
  }, []);

  if (!isInitialized) {
    return (
      <SafeAreaProvider>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00D9FF" />
          <Text style={styles.loadingText}>Initializing Jarvis...</Text>
          <Text style={styles.loadingSubtext}>Setting up local AI engine</Text>
        </View>
        <StatusBar style="light" />
      </SafeAreaProvider>
    );
  }

  return (
    <ExecutorchContext.Provider value={{ isReady: !initError, error: initError }}>
      <SafeAreaProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#0A0A0F' },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" />
        </Stack>
        <StatusBar style="light" />
      </SafeAreaProvider>
    </ExecutorchContext.Provider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0A0A0F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#00D9FF',
    fontSize: 18,
    marginTop: 16,
    fontWeight: '600',
  },
  loadingSubtext: {
    color: '#666',
    fontSize: 14,
    marginTop: 8,
  },
});
