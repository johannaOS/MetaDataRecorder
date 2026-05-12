import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as MediaLibrary from 'expo-media-library';
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { autoBackupOnStartup } from '@/lib/backup';
// Importing this module registers the background task at startup (module-level side effect).
import { initRecordingNotifications } from '@/lib/backgroundRecording';
import { initDb } from '@/lib/db';
import { S } from '@/lib/strings';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    initDb();
    autoBackupOnStartup(); // auto-backup runs after DB is ready

    // Pre-request permissions at startup so they are never triggered mid-recording.
    MediaLibrary.requestPermissionsAsync().catch(() => {});
    Notifications.requestPermissionsAsync().catch(() => {});
    initRecordingNotifications().catch(() => {});
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="metadata" options={{ title: S.addDetails, headerBackTitle: S.discardBackButton }} />
        <Stack.Screen name="library" options={{ title: S.library }} />
        <Stack.Screen name="detail/[id]" options={{ title: S.recordingScreenTitle }} />
        <Stack.Screen name="fields" options={{ title: S.manageFields }} />
        <Stack.Screen name="settings" options={{ title: S.settingsTitle }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
