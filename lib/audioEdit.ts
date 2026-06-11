import { trimAudio } from '@siteed/audio-studio';
import { cacheDirectory, copyAsync, deleteAsync } from 'expo-file-system/legacy';

function getExt(uri: string): string {
  return uri.replace(/\?.*$/, '').match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() ?? 'm4a';
}

// content:// URIs (MediaStore) are copied to a file:// cache path first so the
// native trimmer can read them reliably.
async function toFileUri(uri: string): Promise<{ uri: string; cleanup: () => void }> {
  if (!uri.startsWith('content://')) return { uri, cleanup: () => {} };
  const ext = getExt(uri);
  const dest = `${cacheDirectory}trimin_${Date.now()}.${ext}`;
  await copyAsync({ from: uri, to: dest });
  return { uri: dest, cleanup: () => deleteAsync(dest, { idempotent: true }).catch(() => {}) };
}

/**
 * Keep only the selected range — discard everything outside [startMs, endMs].
 * Returns a file:// URI to the trimmed AAC file.
 */
export async function cutKeepSelected(
  inputUri: string,
  startMs: number,
  endMs: number,
): Promise<string> {
  const { uri: src, cleanup } = await toFileUri(inputUri);
  try {
    const result = await trimAudio({
      fileUri: src,
      mode: 'single',
      startTimeMs: Math.round(startMs),
      endTimeMs: Math.round(endMs),
      outputFormat: { format: 'aac' },
    });
    return result.uri;
  } finally {
    cleanup();
  }
}

/**
 * Remove the selected range — keep the parts before and after [startMs, endMs].
 * Returns a file:// URI to the trimmed AAC file.
 */
export async function cutRemoveSelected(
  inputUri: string,
  startMs: number,
  endMs: number,
  _totalDurationMs: number,
): Promise<string> {
  const { uri: src, cleanup } = await toFileUri(inputUri);
  try {
    const result = await trimAudio({
      fileUri: src,
      mode: 'remove',
      ranges: [{ startTimeMs: Math.round(startMs), endTimeMs: Math.round(endMs) }],
      outputFormat: { format: 'aac' },
    });
    return result.uri;
  } finally {
    cleanup();
  }
}
