import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { setAudioModeAsync } from 'expo-audio';
import * as Application from 'expo-application';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { autoBackupOnStartup } from '@/lib/backup';
// Importing this module registers the background task and notifee foreground
// service at startup (module-level side effects).
import { initRecordingNotifications } from '@/lib/backgroundRecording';
import { initDb } from '@/lib/db';
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

    // Identify the device in Sentry so errors show which device was affected.
    // androidId is stable per device + app signing key (resets on uninstall).
    // iOS uses the vendor ID which is stable per app developer.
    // This does not collect any personal data — it's a hardware/install identifier.
    try {
      const deviceId = Platform.OS === 'android'
        ? Application.androidId
        : await Application.getIosIdForVendorAsync();
      if (deviceId) Sentry.setUser({ id: deviceId });
    } catch { /* ignore — Sentry still works without user identity */ }

    // Configure expo-av for playback — must be set before Audio.Sound.createAsync
    // is ever called. Without staysActiveInBackground: true, expo-av throws
    // AudioFocusNotAcquiredException when playAsync() is called.
    // This is overridden by startRecording() (sets allowsRecordingIOS: true etc.)
    // and restored in handleStop() when recording ends.
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
        shouldDuckAndroid: false,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      });
      console.log('[Layout] expo-av audio mode set for playback');
    } catch (e) {
      console.warn('[Layout] Audio.setAudioModeAsync failed:', e);
    }
    // Configure expo-audio for background playback (used by the playback
    // foreground service and audio session management).
    try {
      await setAudioModeAsync({ playsInSilentMode: true, staysActiveInBackground: true });
      console.log('[Layout] expo-audio mode set for background playback');
    } catch (e) {
      console.warn('[Layout] setAudioModeAsync failed:', e);
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
