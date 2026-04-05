import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { initExecutorch } from 'react-native-executorch';
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher';

export default function RootLayout() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    const initialize = async () => {
      try {
        await initExecutorch({ resourceFetcher: ExpoResourceFetcher });
        setIsInitialized(true);
      } catch (error: any) {
        console.error('ExecuTorch init error:', error);
        setInitError(error.message || 'Failed to initialize');
        // Still allow app to run even if init fails
        setIsInitialized(true);
      }
    };
    initialize();
  }, []);

  if (!isInitialized) {
    return (
      <SafeAreaProvider>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00D9FF" />
          <Text style={styles.loadingText}>Initializing Jarvis...</Text>
        </View>
        <StatusBar style="light" />
      </SafeAreaProvider>
    );
  }

  return (
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
});
