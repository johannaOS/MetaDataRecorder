import * as FileSystem from 'expo-file-system/legacy';
import JSZip from 'jszip';
import * as Sharing from 'expo-sharing';

import { Recording, parseTags } from './db';

// ── Filename helpers ──────────────────────────────────────────────────────────

function sanitizeTitle(title: string): string {
  const s = title.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-åäöÅÄÖ]/g, '');
  return s || 'Namnlös';
}

function getExtension(filePath: string): string {
  const clean = filePath.replace(/\?.*$/, '').split('/').pop() ?? '';
  const m = clean.match(/\.([a-z0-9]+)$/i);
  return m ? `.${m[1].toLowerCase()}` : '.m4a';
}

// Builds a unique filename for each recording inside the ZIP.
// Format: {sanitized_title}_{YYYY-MM-DD}[_N]{ext}
// The `usedNames` Set is mutated — pass the same Set for all recordings in a batch.
export function buildZipFilename(recording: Recording, usedNames: Set<string>): string {
  const date = recording.createdAt.slice(0, 10);
  const ext = getExtension(recording.filePath);
  const base = sanitizeTitle(recording.name || 'Namnlös') + '_' + date;

  let filename = base + ext;
  let n = 2;
  while (usedNames.has(filename)) {
    filename = `${base}_${n}${ext}`;
    n++;
  }
  usedNames.add(filename);
  return filename;
}

// ── CSV builder ───────────────────────────────────────────────────────────────

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function csvEscape(val: string): string {
  if (val.includes(';') || val.includes('"') || val.includes('\n')) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

// Pure function — testable without file I/O.
export function buildCsvContent(rows: { rec: Recording; filename: string }[]): string {
  const headers = [
    'Titel', 'Av/efter', 'Från', 'Låttyp', 'Vem spelar',
    'Längd', 'Inspelad', 'Taggar', 'Anteckningar', 'Filnamn',
  ];
  const lines = [headers.join(';')];

  for (const { rec: r, filename } of rows) {
    const cols = [
      r.name || '',
      r.ofAfter || '',
      r.origin || '',
      r.songType || '',
      r.performer || '',
      fmtDuration(r.duration),
      r.createdAt.slice(0, 10),
      parseTags(r.tags).join(', '),
      r.notes || '',
      filename,
    ].map(v => csvEscape(String(v)));
    lines.push(cols.join(';'));
  }

  return lines.join('\r\n'); // CRLF for Excel/Sheets compatibility
}

// ── File reader ───────────────────────────────────────────────────────────────

// content:// URIs can't always be read directly — copy to cache first.
async function readBase64(uri: string): Promise<string> {
  if (uri.startsWith('content://')) {
    const tmp = `${FileSystem.cacheDirectory}export_tmp_${Date.now()}`;
    await FileSystem.copyAsync({ from: uri, to: tmp });
    const data = await FileSystem.readAsStringAsync(tmp, { encoding: FileSystem.EncodingType.Base64 });
    await FileSystem.deleteAsync(tmp, { idempotent: true });
    return data;
  }
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

// ── Public API ────────────────────────────────────────────────────────────────

// Share audio files only — no CSV.
// Single file: shares the audio directly (no ZIP). Multiple files: audio-only ZIP.
export async function exportAudioFilesOnly(
  recordings: Recording[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (recordings.length === 1) {
    const rec = recordings[0];
    let uri = rec.filePath;
    let tmpUri: string | null = null;
    try {
      if (uri.startsWith('content://')) {
        const ext = uri.replace(/\?.*$/, '').match(/\.([a-z0-9]+)$/i)?.[1] ?? 'm4a';
        const safeName = (rec.name || 'Inspelning').trim()
          .replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-åäöÅÄÖ]/g, '') || 'Inspelning';
        tmpUri = `${FileSystem.cacheDirectory}${safeName}.${ext}`;
        await FileSystem.copyAsync({ from: uri, to: tmpUri });
        uri = tmpUri;
      }
      await Sharing.shareAsync(uri, { mimeType: 'audio/*' });
    } finally {
      if (tmpUri) FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
    }
    return;
  }

  const zip = new JSZip();
  const audioFolder = zip.folder('audio')!;
  const usedNames = new Set<string>();

  for (let i = 0; i < recordings.length; i++) {
    const { filePath } = recordings[i];
    const filename = buildZipFilename(recordings[i], usedNames);
    try {
      audioFolder.file(filename, await readBase64(filePath), { base64: true });
    } catch { /* skip unreadable */ }
    onProgress?.(i + 1, recordings.length);
  }

  const zipBase64 = await zip.generateAsync({ type: 'base64' });
  const date = new Date().toISOString().slice(0, 10);
  const zipPath = `${FileSystem.cacheDirectory}VoiceRecorder_ljud_${date}.zip`;
  await FileSystem.writeAsStringAsync(zipPath, zipBase64, { encoding: FileSystem.EncodingType.Base64 });
  await Sharing.shareAsync(zipPath, { mimeType: 'application/zip', dialogTitle: 'Exportera ljud' });
}

export async function exportRecordingsAsZip(
  recordings: Recording[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const zip = new JSZip();
  const audioFolder = zip.folder('audio')!;
  const usedNames = new Set<string>();

  const rows: { rec: Recording; filename: string }[] = recordings.map(rec => ({
    rec,
    filename: buildZipFilename(rec, usedNames),
  }));

  // Add audio files
  for (let i = 0; i < rows.length; i++) {
    const { rec, filename } = rows[i];
    try {
      const data = await readBase64(rec.filePath);
      audioFolder.file(filename, data, { base64: true });
    } catch {
      // File unreadable — still included in CSV so the row isn't silently dropped
    }
    onProgress?.(i + 1, rows.length);
  }

  // Add CSV index
  zip.file('inspelningar.csv', buildCsvContent(rows));

  // Write and share
  const zipBase64 = await zip.generateAsync({ type: 'base64' });
  const date = new Date().toISOString().slice(0, 10);
  const zipPath = `${FileSystem.cacheDirectory}VoiceRecorder_${date}.zip`;
  await FileSystem.writeAsStringAsync(zipPath, zipBase64, { encoding: FileSystem.EncodingType.Base64 });
  await Sharing.shareAsync(zipPath, { mimeType: 'application/zip', dialogTitle: 'Exportera inspelningar' });
}
