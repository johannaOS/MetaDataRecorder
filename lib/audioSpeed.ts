/**
 * Offline pitch-preserving speed change via ffmpeg.
 *
 * expo-av's real-time pitch correction on Android uses MediaPlayer's fixed-quality
 * time-stretching — the quality cannot be improved via any expo-av API.
 * This module pre-processes audio at the desired speed using ffmpeg's atempo
 * filter (which gives noticeably better quality) and caches the result.
 *
 * Limitation: the atempo filter supports 0.5–2.0 directly; values outside that
 * range are chained (e.g. 0.25x = atempo=0.5,atempo=0.5).
 */

import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import { cacheDirectory, copyAsync, deleteAsync, getInfoAsync } from 'expo-file-system/legacy';

function getExt(uri: string): string {
  return uri.replace(/\?.*$/, '').match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() ?? 'm4a';
}

function atempoChain(rate: number): string {
  // atempo supports [0.5, 2.0]. Chain filters for values outside this range.
  const filters: string[] = [];
  let r = rate;
  while (r < 0.5) { filters.push('atempo=0.5'); r /= 0.5; }
  while (r > 2.0) { filters.push('atempo=2.0'); r /= 2.0; }
  filters.push(`atempo=${r.toFixed(4)}`);
  return filters.join(',');
}

function cacheKey(recordingId: number, rate: number): string {
  const rateStr = Math.round(rate * 100).toString();
  return `${cacheDirectory}speed_${recordingId}_${rateStr}.m4a`;
}

async function toFileUri(uri: string): Promise<{ uri: string; cleanup: () => void }> {
  if (!uri.startsWith('content://')) return { uri, cleanup: () => {} };
  const ext = getExt(uri);
  const dest = `${cacheDirectory}speaktmp_${Date.now()}.${ext}`;
  await copyAsync({ from: uri, to: dest });
  return { uri: dest, cleanup: () => deleteAsync(dest, { idempotent: true }).catch(() => {}) };
}

/**
 * Returns a file:// URI to a processed version of the recording at the
 * given playback rate. Result is cached — subsequent calls with the same
 * (recordingId, rate) return immediately.
 *
 * @param recordingId  Used for the cache key only (not read from DB here).
 * @param inputUri     Original recording URI (file:// or content://).
 * @param rate         Playback rate, e.g. 0.75 for 75% speed.
 * @param onProgress   Optional callback fired with percent 0–100 as ffmpeg runs.
 */
export async function processSpeed(
  recordingId: number,
  inputUri: string,
  rate: number,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const output = cacheKey(recordingId, rate);

  // Return cached file if it already exists
  const info = await getInfoAsync(output);
  if (info.exists) return output;

  onProgress?.(0);

  const { uri: src, cleanup } = await toFileUri(inputUri);
  try {
    const filters = atempoChain(rate);
    const cmd = `-i "${src}" -af "${filters}" -vn -c:a aac -b:a 128k "${output}"`;
    const session = await FFmpegKit.executeAsync(cmd, undefined, undefined, stat => {
      if (onProgress && stat.getTime() > 0) {
        // stat.getTime() is the processed duration in ms; approximate progress
        onProgress(Math.min(99, (stat.getTime() / 1000) * 10));
      }
    });
    const rc = await session.getReturnCode();
    if (!ReturnCode.isSuccess(rc)) {
      const logs = await session.getLogs();
      throw new Error(`ffmpeg failed:\n${logs.map(l => l.getMessage()).slice(-5).join('\n')}`);
    }
  } finally {
    cleanup();
  }

  onProgress?.(100);
  return output;
}

/** Remove cached speed variants for a recording (e.g. when it is deleted). */
export async function clearSpeedCache(recordingId: number): Promise<void> {
  const rates = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];
  await Promise.all(
    rates.map(r => deleteAsync(cacheKey(recordingId, r), { idempotent: true }).catch(() => {}))
  );
}
