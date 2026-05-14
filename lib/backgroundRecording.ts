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

// ── Constants ─────────────────────────────────────────────────────────────────
const CHANNEL_ID      = 'recording-status';
const NOTIFICATION_ID = 'recording-in-progress';
export const STOP_ACTION = 'stop';

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
function fmtSecs(s: number): string {
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

function buildContent(elapsed: number) {
  return {
    id: NOTIFICATION_ID,
    title: S.appTitle,
    body: `● ${S.recordingInProgress}  ${fmtSecs(elapsed)}`,
    android: {
      channelId: CHANNEL_ID,
      asForegroundService: true,
      ongoing: true,
      importance: AndroidImportance.DEFAULT,
      actions: [
        {
          title: S.stopRecordingBtn,
          pressAction: { id: STOP_ACTION, launchActivity: 'default' as const },
        },
      ],
    },
  };
}

export async function showRecordingNotification(elapsed: number): Promise<void> {
  try {
    await notifee.displayNotification(buildContent(elapsed));
  } catch (e) {
    console.log('[RecordingNotification] show failed:', e);
  }
}

export async function updateRecordingNotification(elapsed: number): Promise<void> {
  try {
    await notifee.displayNotification(buildContent(elapsed));
  } catch {
    // Permission may have been revoked — ignore silently.
  }
}

export async function hideRecordingNotification(): Promise<void> {
  try {
    await notifee.stopForegroundService();
  } catch { /* already stopped */ }
  try {
    await notifee.cancelNotification(NOTIFICATION_ID);
  } catch { /* already gone */ }
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
