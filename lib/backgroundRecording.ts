import notifee, { AndroidImportance, EventType } from '@notifee/react-native';
import * as TaskManager from 'expo-task-manager';

import { S } from './strings';

// ── Background task ───────────────────────────────────────────────────────────
// Defined at module level so it is registered before any navigation renders.
// expo-av manages the audio session; this task keeps any HeadlessJS context alive.
export const BACKGROUND_RECORDING_TASK = 'BACKGROUND_RECORDING_TASK';

TaskManager.defineTask(BACKGROUND_RECORDING_TASK, () => {
  // Intentionally empty — audio continuity is handled by expo-av + notifee FGS.
});

// ── Foreground service ────────────────────────────────────────────────────────
// Registered at module level, before any React component renders.
// The Promise never resolves; the service runs until stopForegroundService() is called.
// This is what grants FOREGROUND_SERVICE_TYPE_MICROPHONE on Android 12+,
// preventing the OS from revoking mic access during screen lock or app-switch.
notifee.registerForegroundService(() => new Promise(() => {}));

// Suppress the "[notifee] no background event handler has been set" warning.
// Without this, Android fires a background event every second during the foreground
// service, flooding the log and causing unnecessary JS wakeups.
notifee.onBackgroundEvent(async () => {});

// ── Constants ─────────────────────────────────────────────────────────────────
const CHANNEL_ID           = 'recording-status';
const NOTIFICATION_ID      = 'recording-in-progress';
const PLAYBACK_NOTIF_ID    = 'playback-in-progress';
export const STOP_ACTION   = 'stop';

// ── One-time setup (call once during app initialisation) ──────────────────────
export async function initRecordingNotifications(): Promise<void> {
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Inspelning pågår',
    importance: AndroidImportance.DEFAULT,
    vibration: false,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// `timestamp` is an absolute ms epoch used as the chronometer's start point.
// Pass `Date.now() - elapsedMs` so the system widget counts up correctly,
// even when the recording has accumulated paused time.
function buildContent(timestamp: number) {
  return {
    id: NOTIFICATION_ID,
    title: S.appTitle,
    body: `● ${S.recordingInProgress}`,
    android: {
      channelId: CHANNEL_ID,
      asForegroundService: true,
      ongoing: true,
      importance: AndroidImportance.DEFAULT,
      pressAction: { id: 'default', launchActivity: 'default' as const },
      timestamp,
      showChronometer: true,
      actions: [
        {
          title: S.stopRecordingBtn,
          pressAction: { id: STOP_ACTION, launchActivity: 'default' as const },
        },
      ],
    },
  };
}

// Call once when recording starts (or resumes after pause).
// `timestamp` = absolute ms epoch for the chronometer — pass `Date.now() - elapsedMs`
// so the counter shows the correct accumulated time rather than starting from zero.
export async function showRecordingNotification(timestamp: number): Promise<void> {
  try {
    await notifee.displayNotification(buildContent(timestamp));
  } catch (e) {
    console.log('[RecordingNotification] show failed:', e);
  }
}

// No-op: elapsed time is shown via the system showChronometer widget.
// Re-displaying the notification every second created one PendingIntent per call,
// which exhausted the Android system limit (~2300) after a long recording session.
export async function updateRecordingNotification(_elapsed: number): Promise<void> {}

export async function hideRecordingNotification(): Promise<void> {
  try {
    await notifee.stopForegroundService();
  } catch { /* already stopped */ }
  try {
    await notifee.cancelNotification(NOTIFICATION_ID);
  } catch { /* already gone */ }
}

// ── Playback foreground service ───────────────────────────────────────────────
// Keeps audio alive during screen lock and app-switch.
// Notifee's service is declared with foregroundServiceType="microphone|mediaPlayback"
// (via withForegroundMicrophoneService plugin), satisfying Android 14's requirement
// that background audio playback runs inside a mediaPlayback foreground service.

export async function showPlaybackNotification(title: string): Promise<void> {
  try {
    await notifee.displayNotification({
      id: PLAYBACK_NOTIF_ID,
      title: S.appTitle,
      body: `▶ ${title}`,
      android: {
        channelId: CHANNEL_ID,
        asForegroundService: true,
        ongoing: true,
        importance: AndroidImportance.LOW,
        pressAction: { id: 'default', launchActivity: 'default' as const },
      },
    });
  } catch (e) {
    console.log('[PlaybackNotification] show failed:', e);
  }
}

export async function hidePlaybackNotification(): Promise<void> {
  try { await notifee.stopForegroundService(); } catch { /* already stopped */ }
  try { await notifee.cancelNotification(PLAYBACK_NOTIF_ID); } catch { /* already gone */ }
}

// ── Foreground event subscription ─────────────────────────────────────────────
// Subscribe to the Stop button press from the recording notification.
// Returns an unsubscribe function — pass as the return value of useEffect.
export function onRecordingNotificationStop(handler: () => void): () => void {
  return notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.ACTION_PRESS && detail.pressAction?.id === STOP_ACTION) {
      handler();
    }
  });
}
