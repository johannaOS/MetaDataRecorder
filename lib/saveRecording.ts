import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

import { generateSafeFilename } from './filename';

const FOLDER_NAME = 'VoiceRecorder';
const ANDROID_MUSIC_PATH = 'file:///storage/emulated/0/Music/';

// ── Permission cache ──────────────────────────────────────────────────────────
// Set once at app startup by _layout.tsx after properly awaiting the system
// dialog. Never call requestPermissionsAsync() inside the save flow — doing so
// triggers the system dialog mid-recording which steals audio focus.
let _mediaLibraryGranted = false;

export function setMediaLibraryGranted(granted: boolean): void {
  _mediaLibraryGranted = granted;
}

// ── Shared helper ─────────────────────────────────────────────────────────────

/**
 * Lists existing filenames in a directory and generates a unique destination File.
 * Falls back to an existence check loop if list() is unavailable, ensuring
 * conflict resolution never throws "file already exists" errors.
 */
function resolveUniqueFile(dir: Directory, title: string): [File, string] {
  let existingNames: string[] = [];
  try {
    existingNames = dir
      .list()
      .filter(item => !item.isDirectory)
      .map(item => item.uri.split('/').pop() ?? '');
  } catch { /* directory empty or unreadable — generateSafeFilename handles via existence loop */ }

  let filename = generateSafeFilename(title, existingNames);
  let destFile = new File(dir, filename);

  // Existence loop: guards against race conditions or list() misses.
  while (destFile.exists) {
    existingNames.push(filename);
    filename = generateSafeFilename(title, existingNames);
    destFile = new File(dir, filename);
  }

  return [destFile, filename];
}

// ── Tier 1: direct filesystem write (Android 9 / 10 legacy mode) ──────────────

async function tryDirectAndroidWrite(
  cacheUri: string,
  title: string,
): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const vrDir = new Directory(ANDROID_MUSIC_PATH + FOLDER_NAME + '/');
    vrDir.create({ intermediates: true, idempotent: true });

    const [destFile, filename] = resolveUniqueFile(vrDir, title);
    new File(cacheUri).copy(destFile);

    console.log(`[Save] direct write → Music/${FOLDER_NAME}/${filename}`);
    return destFile.uri;
  } catch (e) {
    console.log('[Save] direct write failed (likely Android 11+ scoped storage):', e);
    return null;
  }
}

// ── Tier 2: MediaLibrary / MediaStore (Android 10+, iOS) ─────────────────────

async function tryMediaLibrary(
  cacheUri: string,
  title: string,
): Promise<string | null> {
  try {
    // Use the cached startup permission — never call any permission API here.
    // A dialog mid-save steals audio focus and silences the recording on Android.
    if (!_mediaLibraryGranted) return null;

    const album = await MediaLibrary.getAlbumAsync(FOLDER_NAME);
    const existingNames: string[] = [];
    if (album) {
      const page = await MediaLibrary.getAssetsAsync({
        album,
        mediaType: MediaLibrary.MediaType.audio,
        first: 10000,
      });
      page.assets.forEach(a => existingNames.push(a.filename));
    }

    const filename = generateSafeFilename(title, existingNames);

    const tempFile = new File(new Directory(Paths.cache), filename);
    new File(cacheUri).copy(tempFile);

    let asset: MediaLibrary.Asset;
    try {
      asset = await MediaLibrary.createAssetAsync(tempFile.uri);
    } finally {
      try { tempFile.delete(); } catch { /* best-effort */ }
    }

    if (!album) {
      await MediaLibrary.createAlbumAsync(FOLDER_NAME, asset, false);
    } else {
      await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
    }

    console.log(`[Save] MediaLibrary → Music/${FOLDER_NAME}/${filename}`);
    return asset.uri;
  } catch (e) {
    console.log('[Save] MediaLibrary failed:', e);
    return null;
  }
}

// ── Tier 3: app documents directory (guaranteed fallback) ─────────────────────

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
 * Tries three storage tiers:
 *  1. Direct write to /storage/emulated/0/Music/VoiceRecorder/ (Android 9–10)
 *  2. expo-media-library / MediaStore (Android 10+, iOS)
 *  3. App private documents directory (guaranteed fallback)
 *
 * Conflict resolution is always applied — duplicate titles get (1), (2), … suffixes.
 * Requires a new native build for requestLegacyExternalStorage to take effect.
 */
export async function copyToPermanentStorage(
  cacheUri: string,
  title = 'Untitled',
): Promise<string> {
  const direct = await tryDirectAndroidWrite(cacheUri, title);
  if (direct) return direct;

  const media = await tryMediaLibrary(cacheUri, title);
  if (media) return media;

  return writeToDocuments(cacheUri, title);
}
