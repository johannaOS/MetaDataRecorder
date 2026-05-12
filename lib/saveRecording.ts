import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';

import { generateSafeFilename } from './filename';

const FOLDER_NAME = 'VoiceRecorder';

// Primary path: standard Android external Music directory.
// Works on Android 9 and, with requestLegacyExternalStorage in the manifest,
// Android 10 (API 29). On Android 11+ (API 30+) scoped storage blocks this
// path; the app-documents tier handles those devices.
// MediaLibrary is intentionally NOT used here — createAssetAsync deposits a
// copy in the root Music folder AND the VoiceRecorder subfolder, producing
// duplicates.
const ANDROID_MUSIC_PATH = 'file:///storage/emulated/0/Music/';

// ── Shared helper ─────────────────────────────────────────────────────────────

/**
 * Lists existing filenames in a directory and generates a unique destination File.
 * Uses an existence-check loop as a fallback so conflict resolution never throws
 * "file already exists" errors even when list() fails.
 */
function resolveUniqueFile(dir: Directory, title: string): [File, string] {
  let existingNames: string[] = [];
  try {
    existingNames = dir
      .list()
      .filter(item => !item.isDirectory)
      .map(item => item.uri.split('/').pop() ?? '');
  } catch { /* directory empty or unreadable */ }

  let filename = generateSafeFilename(title, existingNames);
  let destFile = new File(dir, filename);

  while (destFile.exists) {
    existingNames.push(filename);
    filename = generateSafeFilename(title, existingNames);
    destFile = new File(dir, filename);
  }

  return [destFile, filename];
}

// ── Tier 1: direct filesystem write (Android 9 / 10 with legacy storage) ──────

function tryDirectAndroidWrite(cacheUri: string, title: string): string | null {
  if (Platform.OS !== 'android') return null;
  try {
    const vrDir = new Directory(ANDROID_MUSIC_PATH + FOLDER_NAME + '/');
    vrDir.create({ intermediates: true, idempotent: true });

    const [destFile, filename] = resolveUniqueFile(vrDir, title);
    new File(cacheUri).copy(destFile);

    console.log(`[Save] direct write → Music/${FOLDER_NAME}/${filename}`);
    return destFile.uri;
  } catch (e) {
    console.log('[Save] direct write failed (Android 11+ scoped storage or permissions):', e);
    return null;
  }
}

// ── Tier 2: app documents directory (guaranteed fallback) ─────────────────────

function writeToDocuments(cacheUri: string, title: string): string {
  const vrDir = new Directory(
    new Directory(Paths.document, 'recordings'),
    FOLDER_NAME,
  );
  vrDir.create({ intermediates: true, idempotent: true });

  const [destFile, filename] = resolveUniqueFile(vrDir, title);
  new File(cacheUri).copy(destFile);

  console.log(`[Save] documents fallback → ${FOLDER_NAME}/${filename}`);
  return destFile.uri;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Copies a cache-directory recording to permanent storage and returns its URI.
 *
 * Tier 1: direct write to /storage/emulated/0/Music/VoiceRecorder/ (Android 9–10).
 * Tier 2: app private documents/recordings/VoiceRecorder/ (all platforms, guaranteed).
 *
 * MediaLibrary is deliberately excluded — it saves to both the root Music folder
 * AND the VoiceRecorder subfolder, producing duplicate files.
 *
 * Conflict resolution is always applied: duplicate titles get (1), (2), … suffixes.
 * Requires a new native build for requestLegacyExternalStorage to take effect on Android 10.
 */
export async function copyToPermanentStorage(
  cacheUri: string,
  title = 'Untitled',
): Promise<string> {
  const direct = tryDirectAndroidWrite(cacheUri, title);
  if (direct) return direct;

  return writeToDocuments(cacheUri, title);
}
