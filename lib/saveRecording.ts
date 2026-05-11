import { Directory, File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

// Copies a cache-directory recording URI to permanent public storage (MediaLibrary)
// or falls back to the app's private documents directory.
export async function copyToPermanentStorage(cacheUri: string): Promise<string> {
  try {
    const { granted } = await MediaLibrary.requestPermissionsAsync();
    if (!granted) throw new Error('MediaLibrary permission not granted');

    const asset = await MediaLibrary.createAssetAsync(cacheUri);
    const albumName = 'Voice Recorder';
    const album = await MediaLibrary.getAlbumAsync(albumName);
    if (!album) {
      await MediaLibrary.createAlbumAsync(albumName, asset, false);
    } else {
      await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
    }
    console.log('[Save] saved to public Music folder:', asset.uri);
    return asset.uri;
  } catch (mediaErr) {
    console.log('[Save] MediaLibrary unavailable, saving to documents directory:', mediaErr);
    const recordingsDir = new Directory(Paths.document, 'recordings');
    recordingsDir.create({ intermediates: true, idempotent: true });
    const destFile = new File(recordingsDir, `recording-${Date.now()}.m4a`);
    new File(cacheUri).copy(destFile);
    return destFile.uri;
  }
}
