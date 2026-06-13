import { trimAudio } from '@siteed/audio-studio';

/**
 * Audio cut/trim via @siteed/audio-studio.
 *
 * The native AudioTrimmer reads the source with
 * `MediaMetadataRetriever.setDataSource(context, Uri.parse(fileUri))`, which
 * accepts both `content://` (MediaStore) and `file://` URIs directly — so we
 * pass recording.filePath through unchanged. (A previous version copied
 * content:// to a cache file first via legacy copyAsync, which crashed with
 * "ENOENT (No such file or directory)".)
 */

/**
 * Keep only the selected range — discard everything outside [startMs, endMs].
 * Returns a file:// URI to the trimmed AAC file.
 */
export async function cutKeepSelected(
  inputUri: string,
  startMs: number,
  endMs: number,
): Promise<string> {
  const result = await trimAudio({
    fileUri: inputUri,
    mode: 'single',
    startTimeMs: Math.round(startMs),
    endTimeMs: Math.round(endMs),
    outputFormat: { format: 'aac' },
  });
  return result.uri;
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
  const result = await trimAudio({
    fileUri: inputUri,
    mode: 'remove',
    ranges: [{ startTimeMs: Math.round(startMs), endTimeMs: Math.round(endMs) }],
    outputFormat: { format: 'aac' },
  });
  return result.uri;
}
