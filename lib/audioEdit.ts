import { FFmpegKit, ReturnCode } from 'expo-ffmpeg-kit';
import { cacheDirectory, copyAsync, deleteAsync, writeAsStringAsync } from 'expo-file-system/legacy';

function msToSec(ms: number): string {
  return (ms / 1000).toFixed(3);
}

function tmpPath(tag: string, ext: string): string {
  return `${cacheDirectory}${tag}_${Date.now()}.${ext}`;
}

function getExt(uri: string): string {
  return uri.replace(/\?.*$/, '').match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() ?? 'm4a';
}

async function run(cmd: string): Promise<void> {
  const session = await FFmpegKit.execute(cmd);
  const rc = await session.getReturnCode();
  if (!ReturnCode.isSuccess(rc)) {
    const output = await session.getOutput();
    const trace = await session.getFailStackTrace();
    throw new Error(`FFmpeg failed (rc=${rc}):\n${output ?? ''}\n${trace ?? ''}`);
  }
}

// content:// URIs need a file:// copy before ffmpeg can read them.
async function toFileUri(uri: string): Promise<{ uri: string; cleanup: () => void }> {
  if (!uri.startsWith('content://')) return { uri, cleanup: () => {} };
  const ext = getExt(uri);
  const dest = tmpPath('ffin', ext);
  await copyAsync({ from: uri, to: dest });
  return { uri: dest, cleanup: () => deleteAsync(dest, { idempotent: true }).catch(() => {}) };
}

/**
 * Keep only the selected range — discard everything outside [startMs, endMs].
 * Returns a file:// URI in the cache directory.
 */
export async function cutKeepSelected(
  inputUri: string,
  startMs: number,
  endMs: number,
): Promise<string> {
  const { uri: src, cleanup } = await toFileUri(inputUri);
  try {
    const ext = getExt(src);
    const output = tmpPath('cutkeep', ext);
    await run(`-i "${src}" -ss ${msToSec(startMs)} -to ${msToSec(endMs)} -c copy "${output}"`);
    return output;
  } finally {
    cleanup();
  }
}

/**
 * Remove the selected range — keep the parts before and after [startMs, endMs].
 * Returns a file:// URI in the cache directory.
 */
export async function cutRemoveSelected(
  inputUri: string,
  startMs: number,
  endMs: number,
  totalDurationMs: number,
): Promise<string> {
  const { uri: src, cleanup } = await toFileUri(inputUri);
  try {
    const ext = getExt(src);
    const hasBefore = startMs > 200;
    const hasAfter  = endMs < totalDurationMs - 200;

    if (!hasBefore && !hasAfter) throw new Error('Nothing left after cut');

    if (hasBefore && !hasAfter) {
      const output = tmpPath('cutrem', ext);
      await run(`-i "${src}" -ss 0 -to ${msToSec(startMs)} -c copy "${output}"`);
      return output;
    }

    if (!hasBefore && hasAfter) {
      const output = tmpPath('cutrem', ext);
      await run(`-i "${src}" -ss ${msToSec(endMs)} -c copy "${output}"`);
      return output;
    }

    // Both sides present — extract each then concatenate
    const part1  = tmpPath('cutp1',   ext);
    const part2  = tmpPath('cutp2',   ext);
    const list   = tmpPath('cutlist', 'txt');
    const output = tmpPath('cutrem',  ext);

    await run(`-i "${src}" -ss 0 -to ${msToSec(startMs)} -c copy "${part1}"`);
    await run(`-i "${src}" -ss ${msToSec(endMs)} -c copy "${part2}"`);
    await writeAsStringAsync(list, `file '${part1}'\nfile '${part2}'`);
    await run(`-f concat -safe 0 -i "${list}" -c copy "${output}"`);

    await Promise.all([part1, part2, list].map(f =>
      deleteAsync(f, { idempotent: true }).catch(() => {})
    ));
    return output;
  } finally {
    cleanup();
  }
}
