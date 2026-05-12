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
import { setMediaLibraryGranted } from '@/lib/saveRecording';
import { S } from '@/lib/strings';
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: 'https://a9756747b61aafe771c93842e8a1517d@o4511375765798913.ingest.de.sentry.io/4511375768682576',

  // Adds more context data to events (IP address, cookies, user, etc.)
  // For more information, visit: https://docs.sentry.io/platforms/react-native/data-management/data-collected/
  sendDefaultPii: true,

  // Enable Logs
  enableLogs: true,

  // Configure Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1,
  integrations: [Sentry.mobileReplayIntegration(), Sentry.feedbackIntegration()],

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: __DEV__,
});

export const unstable_settings = {
  anchor: '(tabs)',
};

export default Sentry.wrap(function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => { (async () => {
    initDb();
    autoBackupOnStartup(); // auto-backup runs after DB is ready

    // Request all required permissions before any recording starts.
    // Each request is isolated in its own try-catch so one failure cannot
    // block or deadlock any other. Do NOT fire two permission requests
    // simultaneously — the Android permission system can deadlock if two
    // dialogs are triggered at the same time.
    console.log('[Layout] requesting MediaLibrary permission…');
    try {
      const { granted } = await MediaLibrary.requestPermissionsAsync();
      console.log('[Layout] MediaLibrary permission result:', granted);
      setMediaLibraryGranted(granted);
    } catch (e) {
      console.warn('[Layout] MediaLibrary.requestPermissionsAsync failed:', e);
      setMediaLibraryGranted(false);
    }

    console.log('[Layout] requesting Notifications permission…');
    try {
      await Notifications.requestPermissionsAsync();
      console.log('[Layout] Notifications permission done');
    } catch (e) {
      console.warn('[Layout] Notifications.requestPermissionsAsync failed:', e);
    }

    console.log('[Layout] initialising recording notification channel…');
    try {
      await initRecordingNotifications();
      console.log('[Layout] recording notification channel ready');
    } catch (e) {
      console.warn('[Layout] initRecordingNotifications failed:', e);
    }
  })(); }, []);

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
});
