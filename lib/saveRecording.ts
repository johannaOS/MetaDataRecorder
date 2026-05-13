import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';

import { generateSafeFilename } from './filename';

const FOLDER_NAME = 'VoiceRecorder';

// Primary path: standard Android external Music directory.
// Works on Android 9 and, with requestLegacyExternalStorage in the manifest,
// Android 10 (API 29). On Android 11+ (API 30+) scoped storage blocks this
// path; the app-documents tier handles those devices.
const ANDROID_MUSIC_PATH = 'file:///storage/emulated/0/Music/';

// ── Shared helper ─────────────────────────────────────────────────────────────

function resolveUniqueFile(dir: Directory, title: string): [File, string] {
  let existingNames: string[] = [];
  try {
    existingNames = dir
      .list()
      .filter(item => !item.isDirectory)
      .map(item => item.uri.split('/').pop() ?? '');
    console.log('[Save] existing files in dir:', existingNames.length);
  } catch (e) {
    console.log('[Save] could not list dir (empty or inaccessible):', String(e));
  }

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
  console.log('[Save:Tier1] starting — cacheUri:', cacheUri);

  try {
    // Verify the source cache file actually exists before attempting the copy.
    const srcFile = new File(cacheUri);
    const srcInfo = srcFile.info();
    console.log('[Save:Tier1] source exists:', srcFile.exists, 'size:', srcInfo.size ?? 'unknown');
    if (!srcFile.exists) {
      console.warn('[Save:Tier1] source file missing — cannot copy');
      return null;
    }

    const vrDirUri = ANDROID_MUSIC_PATH + FOLDER_NAME + '/';
    console.log('[Save:Tier1] target dir:', vrDirUri);
    const vrDir = new Directory(vrDirUri);
    vrDir.create({ intermediates: true, idempotent: true });
    console.log('[Save:Tier1] directory ready');

    const [destFile, filename] = resolveUniqueFile(vrDir, title);
    console.log('[Save:Tier1] destination:', destFile.uri);

    srcFile.copy(destFile);
    console.log('[Save:Tier1] copy done — dest exists:', destFile.exists);

    return destFile.uri;
  } catch (e) {
    console.warn('[Save:Tier1] failed (likely Android 11+ scoped storage):', String(e));
    return null;
  }
}

// ── Tier 2: app documents directory (guaranteed fallback) ─────────────────────

function writeToDocuments(cacheUri: string, title: string): string {
  console.log('[Save:Tier2] writing to documents — cacheUri:', cacheUri);

  const srcFile = new File(cacheUri);
  if (!srcFile.exists) {
    console.warn('[Save:Tier2] source file missing:', cacheUri);
    throw new Error(`Source file not found: ${cacheUri}`);
  }
  console.log('[Save:Tier2] source size:', srcFile.info().size ?? 'unknown');

  const vrDir = new Directory(
    new Directory(Paths.document, 'recordings'),
    FOLDER_NAME,
  );
  vrDir.create({ intermediates: true, idempotent: true });
  console.log('[Save:Tier2] directory ready:', vrDir.uri);

  const [destFile, filename] = resolveUniqueFile(vrDir, title);
  console.log('[Save:Tier2] destination:', destFile.uri);

  srcFile.copy(destFile);
  console.log('[Save:Tier2] copy done — dest exists:', destFile.exists);

  return destFile.uri;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Copies a cache-directory recording to permanent storage and returns its URI.
 *
 * Tier 1: direct write to /storage/emulated/0/Music/VoiceRecorder/ (Android 9–10).
 * Tier 2: app private documents/recordings/VoiceRecorder/ (all platforms, guaranteed).
 */
export async function copyToPermanentStorage(
  cacheUri: string,
  title = 'Untitled',
): Promise<string> {
  console.log('[Save] copyToPermanentStorage — title:', title, 'cacheUri:', cacheUri);

  const direct = tryDirectAndroidWrite(cacheUri, title);
  if (direct) {
    console.log('[Save] saved via Tier 1 (Music folder):', direct);
    return direct;
  }

  const docs = writeToDocuments(cacheUri, title);
  console.log('[Save] saved via Tier 2 (documents):', docs);
  return docs;
}
