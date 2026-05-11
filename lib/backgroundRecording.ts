import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { S } from './strings';

// ── Foreground notification handler ───────────────────────────────────────────
// Tell expo-notifications how to handle a notification arriving while the app
// is already in the foreground (recording status: no alert, no sound).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// ── Background task ───────────────────────────────────────────────────────────
// Must be defined at module level (before any navigation or React rendering).
// expo-av manages the audio session via its own Android foreground service;
// registering a task here ensures the Android OS keeps this process alive
// even when backgrounded without audio focus.
export const BACKGROUND_RECORDING_TASK = 'BACKGROUND_RECORDING_TASK';

TaskManager.defineTask(BACKGROUND_RECORDING_TASK, () => {
  // Intentionally empty — audio continuity is handled by expo-av.
});

// ── Constants ─────────────────────────────────────────────────────────────────
const NOTIFICATION_ID = 'recording-in-progress';
const CHANNEL_ID      = 'recording-status';
const CATEGORY_ID     = 'recording';
export const STOP_ACTION = 'stop';

// ── One-time setup (call once during app initialisation) ──────────────────────
export async function initRecordingNotifications(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Inspelning pågår',
      // DEFAULT importance: always visible in the shade without making a sound.
      // LOW was hiding the notification on some devices; HIGH triggers heads-up popups.
      importance: Notifications.AndroidImportance.DEFAULT,
      enableVibrate: false,
      showBadge: false,
      sound: null,
    });
  }

  await Notifications.setNotificationCategoryAsync(CATEGORY_ID, [
    {
      identifier: STOP_ACTION,
      buttonTitle: S.stopRecordingBtn,
      options: { opensAppToForeground: true },
    },
  ]);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtSecs(s: number): string {
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

function buildContent(elapsed: number): Notifications.NotificationContentInput {
  return {
    title: S.appTitle,
    body: `● ${S.recordingInProgress}  ${fmtSecs(elapsed)}`,
    data: { type: 'recording' },
    sticky: true,
    autoDismiss: false,
    categoryIdentifier: CATEGORY_ID,
    vibrate: [],
    sound: false,
  };
}

// On Android, use the dedicated low-importance channel; on iOS, trigger: null.
function makeTrigger(): Notifications.NotificationTriggerInput {
  return Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null;
}

export async function showRecordingNotification(elapsed: number): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: buildContent(elapsed),
      trigger: makeTrigger(),
    });
  } catch (e) {
    console.log('[RecordingNotification] show failed:', e);
  }
}

export async function updateRecordingNotification(elapsed: number): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: buildContent(elapsed),
      trigger: makeTrigger(),
    });
  } catch {
    // Notification permission may have been revoked — ignore silently.
  }
}

export async function hideRecordingNotification(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(NOTIFICATION_ID);
  } catch {
    // Already dismissed or never shown — ignore.
  }
}
