import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

import { generateSafeFilename } from './filename';

// Folder name used in every storage tier.
// Appears as Music/VoiceRecorder in the Android file manager.
const FOLDER_NAME = 'VoiceRecorder';

// Standard Android primary-user external storage path.
// Works on Android 9 and, with requestLegacyExternalStorage in AndroidManifest,
// on Android 10 (API 29) as well. On Android 11+ (API 30+) scoped-storage
// restrictions block this path; the MediaLibrary tier below handles that case.
const ANDROID_MUSIC_PATH = 'file:///storage/emulated/0/Music/';

// ── Tier 1: direct filesystem write (Android 9 / 10 legacy mode) ──────────────

async function tryDirectAndroidWrite(
  cacheUri: string,
  title: string,
): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const vrDir = new Directory(ANDROID_MUSIC_PATH + FOLDER_NAME + '/');
    vrDir.create({ intermediates: true, idempotent: true });

    let existingNames: string[] = [];
    try {
      existingNames = vrDir
        .list()
        .filter(item => !item.isDirectory)
        .map(item => item.uri.split('/').pop() ?? '');
    } catch { /* empty or unreadable — start fresh */ }

    const filename = generateSafeFilename(title, existingNames);
    const destFile = new File(vrDir, filename);
    new File(cacheUri).copy(destFile);

    console.log(`[Save] direct write → Music/${FOLDER_NAME}/${filename}`);
    return destFile.uri;
  } catch (e) {
    console.log('[Save] direct write failed (Android 11+ scoped-storage), trying MediaLibrary:', e);
    return null;
  }
}

// ── Tier 2: MediaLibrary / MediaStore (Android 10+ and iOS) ──────────────────

async function tryMediaLibrary(
  cacheUri: string,
  title: string,
): Promise<string | null> {
  try {
    const { granted } = await MediaLibrary.requestPermissionsAsync();
    if (!granted) return null;

    // Collect existing filenames in the album for conflict resolution.
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

    // Write a temp file with the correct name so MediaLibrary preserves it.
    const tempFile = new File(new Directory(Paths.cache), filename);
    new File(cacheUri).copy(tempFile);

    let asset: MediaLibrary.Asset;
    try {
      asset = await MediaLibrary.createAssetAsync(tempFile.uri);
    } finally {
      try { tempFile.delete(); } catch { /* best-effort */ }
    }

    if (!album) {
      // createAlbumAsync with copyAsset=false physically moves the file into
      // Music/VoiceRecorder/ on Android 10+ via MediaStore RELATIVE_PATH.
      await MediaLibrary.createAlbumAsync(FOLDER_NAME, asset, false);
    } else {
      // Move asset into the existing album subfolder.
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

  let existingNames: string[] = [];
  try {
    existingNames = vrDir
      .list()
      .filter(item => !item.isDirectory)
      .map(item => item.uri.split('/').pop() ?? '');
  } catch { /* empty directory */ }

  const filename = generateSafeFilename(title, existingNames);
  const destFile = new File(vrDir, filename);
  new File(cacheUri).copy(destFile);

  console.log(`[Save] documents fallback → ${FOLDER_NAME}/${filename}`);
  return destFile.uri;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Copies a cache-directory recording to permanent storage and returns its URI.
 *
 * Tries three storage tiers in order:
 *  1. Direct write to /storage/emulated/0/Music/VoiceRecorder/ (Android 9–10)
 *  2. expo-media-library / MediaStore (Android 10+, iOS)
 *  3. App private documents directory (guaranteed fallback)
 *
 * The file is named from `title` with conflict resolution (1), (2), …
 * Requires a new native build for `requestLegacyExternalStorage` to take effect.
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
