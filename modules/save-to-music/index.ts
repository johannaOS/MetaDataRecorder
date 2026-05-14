import { requireNativeModule } from 'expo-modules-core';

const SaveToMusicNative = requireNativeModule('SaveToMusic');

/**
 * Saves an audio file to a visible location on the device.
 *
 * Android 10+ : Music/VoiceRecorder/ via MediaStore.Audio (content:// URI returned)
 * Android 9-  : Music/VoiceRecorder/ via direct filesystem write (file:// URI returned)
 * iOS         : returns null — caller falls back to app documents
 *               (enable UIFileSharingEnabled in Info.plist to make those visible
 *                in the Files app under the app name)
 */
export async function saveAudioFile(
  localUri: string,
  displayName: string,
): Promise<string | null> {
  return SaveToMusicNative.saveAudioFile(localUri, displayName);
}
