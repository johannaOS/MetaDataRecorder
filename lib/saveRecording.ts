import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { generateSafeFilename } from './filename';

const FOLDER_NAME = 'VoiceRecorder';

// ── Shared helper ─────────────────────────────────────────────────────────────

function resolveUniqueFile(dir: Directory, title: string): File {
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

  return destFile;
}

// ── App documents directory ───────────────────────────────────────────────────
// Reliable on all platforms. Files are in private app storage — not directly
// browseable in a file manager, but accessible via the app's Library screen
// and shareable via the share sheet.
//
// NOTE: Saving to Music/VoiceRecorder/ on Android 11+ requires the MediaStore
// API with MediaStore.Audio.Media.EXTERNAL_CONTENT_URI and a RELATIVE_PATH.
// expo-media-library's createAssetAsync incorrectly classifies .m4a files as
// images/media on Android 14, triggering a system permission dialog on every
// save. A proper native Expo module is needed for the Music folder approach.
// Until then, app documents is the correct fallback.

function writeToDocuments(cacheUri: string, title: string): string {
  console.log('[Save] writing to documents — cacheUri:', cacheUri);

  const srcFile = new File(cacheUri);
  if (!srcFile.exists) {
    console.warn('[Save] source file missing:', cacheUri);
    throw new Error(`Source file not found: ${cacheUri}`);
  }
  console.log('[Save] source size:', srcFile.info().size ?? 'unknown');

  const vrDir = new Directory(
    new Directory(Paths.document, 'recordings'),
    FOLDER_NAME,
  );
  vrDir.create({ intermediates: true, idempotent: true });
  console.log('[Save] directory ready:', vrDir.uri);

  const destFile = resolveUniqueFile(vrDir, title);
  console.log('[Save] destination:', destFile.uri);

  srcFile.copy(destFile);
  console.log('[Save] copy done — dest exists:', destFile.exists);

  return destFile.uri;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function copyToPermanentStorage(
  cacheUri: string,
  title = 'Untitled',
): Promise<string> {
  console.log('[Save] copyToPermanentStorage — title:', title, 'cacheUri:', cacheUri);
  const uri = writeToDocuments(cacheUri, title);
  console.log('[Save] saved:', uri);
  return uri;
}
