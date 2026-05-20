import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { saveAudioFile } from 'save-to-music';
import * as Sentry from '@sentry/react-native';

import { generateSafeFilename } from './filename';

const FOLDER_NAME = 'VoiceRecorder';

// ── Tier 1: native MediaStore (Android) ──────────────────────────────────────
// Calls MediaStore.Audio.Media.EXTERNAL_CONTENT_URI with RELATIVE_PATH so the
// file lands in Music/VoiceRecorder/ and is immediately visible in file managers.
// Android 10+ (API 29+): MediaStore insert with IS_PENDING flag.
// Android 9-            : direct write to Music/VoiceRecorder/.
// iOS                   : returns null — Tier 2 handles it.

async function tryNativeSave(cacheUri: string, displayName: string): Promise<string | null> {
  try {
    Sentry.addBreadcrumb({ category: 'save', message: 'Tier 1: attempting MediaStore save', level: 'info' });
    console.log('[Save:Tier1] native MediaStore save — displayName:', displayName);
    const result = await saveAudioFile(cacheUri, displayName);
    if (result) {
      Sentry.addBreadcrumb({ category: 'save', message: 'Tier 1: MediaStore save succeeded', level: 'info' });
      console.log('[Save:Tier1] saved:', result);
    }
    return result;
  } catch (e) {
    Sentry.addBreadcrumb({ category: 'save', message: 'Tier 1: MediaStore save failed, will fall back', level: 'warning' });
    console.warn('[Save:Tier1] native save failed:', String(e));
    return null;
  }
}

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
    console.log('[Save] could not list dir:', String(e));
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

// ── Tier 2: app documents (fallback + iOS primary) ────────────────────────────
// Always works on all platforms. On iOS, UIFileSharingEnabled makes these files
// visible in the Files app under the app name.

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

  const destFile = resolveUniqueFile(vrDir, title);
  console.log('[Save:Tier2] destination:', destFile.uri);

  srcFile.copy(destFile);
  console.log('[Save:Tier2] copy done — dest exists:', destFile.exists);

  return destFile.uri;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Copies a cache-directory recording to permanent storage and returns its URI.
 *
 * Android : Tier 1 — native MediaStore → Music/VoiceRecorder/ (all Android versions)
 *           Tier 2 — app documents if the native save fails for any reason
 * iOS     : Tier 2 — app documents (visible in Files app via UIFileSharingEnabled)
 */
export async function copyToPermanentStorage(
  cacheUri: string,
  title = 'Untitled',
): Promise<string> {
  console.log('[Save] copyToPermanentStorage — title:', title, 'cacheUri:', cacheUri);

  if (Platform.OS === 'android') {
    const displayName = generateSafeFilename(title, []);
    const native = await tryNativeSave(cacheUri, displayName);
    if (native) {
      Sentry.addBreadcrumb({ category: 'save', message: 'copyToPermanentStorage complete (Tier 1)', level: 'info' });
      console.log('[Save] saved via Tier 1 (Music/VoiceRecorder):', native);
      return native;
    }
  }

  const docs = writeToDocuments(cacheUri, title);
  Sentry.addBreadcrumb({ category: 'save', message: 'copyToPermanentStorage complete (Tier 2)', level: 'info', data: { platform: Platform.OS } });
  console.log('[Save] saved via Tier 2 (documents):', docs);
  return docs;
}
