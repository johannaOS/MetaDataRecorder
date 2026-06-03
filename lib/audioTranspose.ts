/**
 * Key transposition stub.
 *
 * NOTE: The ffmpeg-based implementation was removed because ffmpeg-kit-react-native
 * was archived in June 2025 and its Maven artifacts are no longer available.
 *
 * The UI (transpose panel, semitone buttons, processing state) is fully implemented.
 * Only the actual audio processing is pending a working library.
 */

export const TRANSPOSE_RANGE = { min: -12, max: 12 };

export const FFMPEG_UNAVAILABLE =
  'Transponering kräver FFmpeg som för tillfället inte är tillgängligt. ' +
  'Funktionen väntar på ett kompatibelt FFmpeg-paket för Expo SDK 54.';

export async function transposeRecording(
  _recordingId: number,
  _inputUri: string,
  _semitones: number,
  _onProgress?: (pct: number) => void,
): Promise<string> {
  throw new Error(FFMPEG_UNAVAILABLE);
}

export function semitoneLabel(n: number): string {
  if (n === 0) return '0';
  return n > 0 ? `+${n}` : `${n}`;
}

export async function clearTransposeCache(_recordingId: number): Promise<void> {}
