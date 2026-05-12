import { Directory, File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

import { generateSafeFilename } from './filename';

const ALBUM_NAME = 'Voice Recorder';

/**
 * Copies a cache-directory recording to permanent storage and returns its URI.
 *
 * Primary: saves into the public "Voice Recorder" album in the Music library.
 * Fallback: saves into documents/recordings/Voice Recorder/ when MediaLibrary
 *           is unavailable (simulator, restricted permission, etc.).
 *
 * The file is named from `title` — sanitised, spaces replaced with underscores,
 * conflict-resolved with (1)/(2)/… suffixes.
 */
export async function copyToPermanentStorage(
  cacheUri: string,
  title = 'Untitled',
): Promise<string> {
  try {
    const { granted } = await MediaLibrary.requestPermissionsAsync();
    if (!granted) throw new Error('MediaLibrary permission not granted');

    // Collect existing filenames in the album for conflict resolution.
    const album = await MediaLibrary.getAlbumAsync(ALBUM_NAME);
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

    // Create a temp file with the correct name so MediaLibrary preserves it.
    const cacheDir = new Directory(Paths.cache);
    const tempFile = new File(cacheDir, filename);
    new File(cacheUri).copy(tempFile);

    let asset: MediaLibrary.Asset;
    try {
      asset = await MediaLibrary.createAssetAsync(tempFile.uri);
    } finally {
      try { tempFile.delete(); } catch { /* best-effort cleanup */ }
    }

    if (!album) {
      await MediaLibrary.createAlbumAsync(ALBUM_NAME, asset, false);
    } else {
      await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
    }

    console.log(`[Save] saved to Music/${ALBUM_NAME}/${filename}`);
    return asset.uri;
  } catch (mediaErr) {
    console.log('[Save] MediaLibrary unavailable, saving to documents:', mediaErr);

    const recordingsDir = new Directory(Paths.document, 'recordings');
    const voiceRecorderDir = new Directory(recordingsDir, ALBUM_NAME);
    voiceRecorderDir.create({ intermediates: true, idempotent: true });

    let existingNames: string[] = [];
    try {
      existingNames = voiceRecorderDir
        .list()
        .filter(item => !item.isDirectory)
        .map(item => item.uri.split('/').pop() ?? '');
    } catch { /* directory may be empty or list may fail */ }

    const filename = generateSafeFilename(title, existingNames);
    const destFile = new File(voiceRecorderDir, filename);
    new File(cacheUri).copy(destFile);

    console.log(`[Save] saved to documents/${ALBUM_NAME}/${filename}`);
    return destFile.uri;
  }
}
