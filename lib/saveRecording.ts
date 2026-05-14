import * as MediaLibrary from 'expo-media-library';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { generateSafeFilename } from './filename';

const FOLDER_NAME = 'VoiceRecorder';

// ── Tier 1: MediaStore via expo-media-library (Android 11+) ───────────────────
// Uses the proper Android MediaStore API, which works on all Android versions
// and places files in Music/VoiceRecorder/ where they're visible to file managers.

async function tryMediaLibrarySave(cacheUri: string, title: string): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  console.log('[Save:Tier1] MediaLibrary save — cacheUri:', cacheUri);

  let tempFile: File | null = null;
  try {
    // Only proceed if the user already granted permission at startup.
    // Never request permissions here — that would show a dialog mid-flow.
    const { status } = await MediaLibrary.getPermissionsAsync();
    if (status !== 'granted') {
      console.warn('[Save:Tier1] MediaLibrary permission not granted — status:', status);
      return null;
    }

    // createAssetAsync uses the source filename as the MediaStore display name.
    // Copy the cache file to a temp file with the title-based name so the
    // asset in Music/VoiceRecorder/ gets the user's title, not a UUID.
    const filename = generateSafeFilename(title, []);
    tempFile = new File(new Directory(Paths.cache), filename);
    new File(cacheUri).copy(tempFile);
    console.log('[Save:Tier1] temp file with correct name:', tempFile.uri);

    // Insert into MediaStore (creates a copy in external storage)
    const asset = await MediaLibrary.createAssetAsync(tempFile.uri);
    console.log('[Save:Tier1] asset created:', asset.filename, 'id:', asset.id);

    // Temp file no longer needed — MediaStore owns its own copy
    try { tempFile.delete(); } catch { /* best-effort */ }
    tempFile = null;

    // Move the asset into the VoiceRecorder album = Music/VoiceRecorder/ on Android
    const album = await MediaLibrary.getAlbumAsync(FOLDER_NAME);
    if (album) {
      await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
    } else {
      await MediaLibrary.createAlbumAsync(FOLDER_NAME, asset, false);
    }
    console.log('[Save:Tier1] asset moved to', FOLDER_NAME, 'album');

    // Retrieve the file:// path after the album move (falls back to content:// URI)
    const info = await MediaLibrary.getAssetInfoAsync(asset);
    const finalUri = info.localUri ?? asset.uri;
    console.log('[Save:Tier1] final URI:', finalUri);
    return finalUri;

  } catch (e) {
    console.warn('[Save:Tier1] MediaLibrary failed:', String(e));
    try { tempFile?.delete(); } catch { /* best-effort */ }
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

// ── Tier 2: app documents directory (fallback, all platforms) ─────────────────

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
 * Tier 1 (Android): MediaStore via expo-media-library → Music/VoiceRecorder/
 *   Requires READ_MEDIA_AUDIO permission granted at startup.
 * Tier 2 (all platforms): app private documents/recordings/VoiceRecorder/
 *   Always succeeds; used when Tier 1 is unavailable or permission denied.
 */
export async function copyToPermanentStorage(
  cacheUri: string,
  title = 'Untitled',
): Promise<string> {
  console.log('[Save] copyToPermanentStorage — title:', title, 'cacheUri:', cacheUri);

  if (Platform.OS === 'android') {
    const media = await tryMediaLibrarySave(cacheUri, title);
    if (media) {
      console.log('[Save] saved via Tier 1 (Music/VoiceRecorder):', media);
      return media;
    }
  }

  const docs = writeToDocuments(cacheUri, title);
  console.log('[Save] saved via Tier 2 (documents):', docs);
  return docs;
}
