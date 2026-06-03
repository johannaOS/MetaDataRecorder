/**
 * Offline key transposition via ffmpeg.
 *
 * Shifts pitch by N semitones without changing tempo using:
 *   asetrate=SR*2^(N/12)  — changes pitch by adjusting sample rate (also changes speed)
 *   atempo=2^(-N/12)      — compensates to restore original speed
 *   aresample=SR          — restores the original sample rate
 *
 * Quality is acceptable for folk music learning. Better quality would require
 * the rubberband filter (needs custom ffmpeg build) or a native SoundTouch module.
 *
 * Results are cached per (recordingId, semitones).
 */

import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import { cacheDirectory, copyAsync, deleteAsync, getInfoAsync } from 'expo-file-system/legacy';

const SAMPLE_RATE = 44100;
const SEMITONE_RANGE = { min: -12, max: 12 }; // ±1 octave

function getExt(uri: string): string {
  return uri.replace(/\?.*$/, '').match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() ?? 'm4a';
}

function cacheKey(recordingId: number, semitones: number): string {
  const semi = semitones >= 0 ? `p${semitones}` : `m${Math.abs(semitones)}`;
  return `${cacheDirectory}transpose_${recordingId}_${semi}.m4a`;
}

async function toFileUri(uri: string): Promise<{ uri: string; cleanup: () => void }> {
  if (!uri.startsWith('content://')) return { uri, cleanup: () => {} };
  const ext = getExt(uri);
  const dest = `${cacheDirectory}transptmp_${Date.now()}.${ext}`;
  await copyAsync({ from: uri, to: dest });
  return { uri: dest, cleanup: () => deleteAsync(dest, { idempotent: true }).catch(() => {}) };
}

/**
 * Returns a file:// URI to a transposed copy of the recording.
 * Result is cached — subsequent calls with the same (recordingId, semitones) return instantly.
 *
 * @param semitones  Positive = higher pitch, negative = lower. Range: -12 to +12.
 */
export async function transposeRecording(
  recordingId: number,
  inputUri: string,
  semitones: number,
  onProgress?: (pct: number) => void,
): Promise<string> {
  if (semitones === 0) return inputUri;

  const clampedSemitones = Math.max(SEMITONE_RANGE.min, Math.min(SEMITONE_RANGE.max, semitones));
  const output = cacheKey(recordingId, clampedSemitones);

  const info = await getInfoAsync(output);
  if (info.exists) return output;

  onProgress?.(0);

  const ratio = Math.pow(2, clampedSemitones / 12);
  const compensate = Math.pow(2, -clampedSemitones / 12);
  const newRate = Math.round(SAMPLE_RATE * ratio);

  const { uri: src, cleanup } = await toFileUri(inputUri);
  try {
    const filters = `asetrate=${newRate},atempo=${compensate.toFixed(6)},aresample=${SAMPLE_RATE}`;
    const cmd = `-i "${src}" -af "${filters}" -vn -c:a aac -b:a 128k "${output}"`;
    const session = await FFmpegKit.executeAsync(cmd, undefined, undefined, stat => {
      if (onProgress && stat.getTime() > 0) {
        onProgress(Math.min(99, (stat.getTime() / 1000) * 10));
      }
    });
    const rc = await session.getReturnCode();
    if (!ReturnCode.isSuccess(rc)) {
      const logs = await session.getLogs();
      throw new Error(`ffmpeg transpose failed:\n${logs.map(l => l.getMessage()).slice(-5).join('\n')}`);
    }
  } finally {
    cleanup();
  }

  onProgress?.(100);
  return output;
}

export function semitoneLabel(n: number): string {
  if (n === 0) return '0';
  return n > 0 ? `+${n}` : `${n}`;
}

export function semitoneToNoteName(base: string, semitones: number): string {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const idx = notes.indexOf(base.toUpperCase());
  if (idx === -1) return '';
  return notes[((idx + semitones) % 12 + 12) % 12];
}

export const TRANSPOSE_RANGE = SEMITONE_RANGE;

/** Remove all cached transpositions for a recording. */
export async function clearTransposeCache(recordingId: number): Promise<void> {
  const tasks: Promise<void>[] = [];
  for (let s = SEMITONE_RANGE.min; s <= SEMITONE_RANGE.max; s++) {
    if (s !== 0) tasks.push(deleteAsync(cacheKey(recordingId, s), { idempotent: true }).catch(() => {}));
  }
  await Promise.all(tasks);
}
