/**
 * Pitch-preserving speed change.
 *
 * NOTE: The offline ffmpeg-based approach was removed because ffmpeg-kit-react-native
 * was archived in June 2025 and its Maven artifacts are no longer available.
 *
 * This module is now a stub. The detail screen falls back to expo-av's built-in
 * shouldCorrectPitch (Android MediaPlayer time-stretching — lower quality but functional).
 * A higher-quality offline solution awaits a maintained Expo-compatible FFmpeg library.
 */

export const SPEED_MODE: 'realtime' = 'realtime';

/** No-op without ffmpeg. */
export async function clearSpeedCache(_recordingId: number): Promise<void> {}
