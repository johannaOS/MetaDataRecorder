/**
 * Audio cut/trim operations.
 *
 * NOTE: These require ffmpeg-kit-react-native, which was archived in June 2025
 * and its Maven artifacts are no longer available. The functions below throw a
 * clear error until a maintained replacement is integrated.
 *
 * UI code (cut mode, selection handles, zoom) is fully functional and ready —
 * only the final processing step is pending a working ffmpeg library.
 */

export const FFMPEG_UNAVAILABLE =
  'Audio editing kräver FFmpeg som för tillfället inte är tillgängligt i ' +
  'denna build. Funktionen är implementerad och klar — bygget väntar på ett ' +
  'kompatibelt FFmpeg-paket för Expo SDK 54.';

export async function cutKeepSelected(
  _inputUri: string,
  _startMs: number,
  _endMs: number,
): Promise<string> {
  throw new Error(FFMPEG_UNAVAILABLE);
}

export async function cutRemoveSelected(
  _inputUri: string,
  _startMs: number,
  _endMs: number,
  _totalDurationMs: number,
): Promise<string> {
  throw new Error(FFMPEG_UNAVAILABLE);
}
