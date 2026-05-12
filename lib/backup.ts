import { Directory, File, Paths } from 'expo-file-system';

import {
  deleteAllRecordings,
  getAllRecordings,
  insertRecording,
  Recording,
} from './db';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RecordingBackupRow {
  name: string;
  ofAfter: string;
  origin: string;
  songType: string;
  performer: string;
  notes: string;
  filePath: string;
  duration: number;
  createdAt: string;
  customData: string;
}

export interface BackupData {
  version: 1;
  createdAt: string;
  recordingCount: number;
  recordings: RecordingBackupRow[];
}

export interface BackupFileInfo {
  filename: string;
  uri: string;
  sizeBytes: number;
  date: Date;
}

// ── Pure functions (fully unit-testable) ──────────────────────────────────────

const FILENAME_PREFIX = 'voicerecorder-backup-';
const MAX_BACKUPS = 3;

/** Returns the canonical backup filename for a given date, e.g. voicerecorder-backup-2025-05-15.json */
export function generateBackupFilename(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${FILENAME_PREFIX}${y}-${m}-${d}.json`;
}

/** Returns true when a filename looks like a valid backup file. */
export function isBackupFilename(name: string): boolean {
  return name.startsWith(FILENAME_PREFIX) && name.endsWith('.json');
}

/**
 * Given a list of backup filenames (any order), returns which to keep and which
 * to discard so that at most `max` backups are retained (newest first).
 */
export function filterBackupsToKeep(
  names: string[],
  max: number = MAX_BACKUPS,
): { keep: string[]; discard: string[] } {
  const valid = names.filter(isBackupFilename).sort().reverse(); // lexicographic = chronological
  return { keep: valid.slice(0, max), discard: valid.slice(max) };
}

/** Serialises recordings to the backup JSON format. */
export function createBackupJson(recordings: Recording[]): string {
  const data: BackupData = {
    version: 1,
    createdAt: new Date().toISOString(),
    recordingCount: recordings.length,
    recordings: recordings.map(r => ({
      name: r.name,
      ofAfter: r.ofAfter,
      origin: r.origin,
      songType: r.songType,
      performer: r.performer,
      notes: r.notes,
      filePath: r.filePath,
      duration: r.duration,
      createdAt: r.createdAt,
      customData: r.customData,
    })),
  };
  return JSON.stringify(data, null, 2);
}

/** Parses a backup JSON string. Returns null if the content is invalid. */
export function parseBackupJson(json: string): BackupData | null {
  try {
    const parsed = JSON.parse(json);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.recordings)
    ) return null;
    return parsed as BackupData;
  } catch {
    return null;
  }
}

/** Formats a byte count as a human-readable string (e.g. "23 KB", "1.2 MB"). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Formats a backup Date as "YYYY-MM-DD". */
export function formatBackupDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ── DB functions (testable with the expo-sqlite mock) ─────────────────────────

/** Reads all recordings from the DB and serialises them to backup JSON. */
export function buildBackupData(): string {
  return createBackupJson(getAllRecordings());
}

/**
 * Replaces the entire recordings table with the contents of a BackupData object.
 * Returns the number of rows restored.
 */
export function restoreFromBackupData(data: BackupData): number {
  deleteAllRecordings();
  let count = 0;
  for (const r of data.recordings) {
    insertRecording({
      name: r.name,
      ofAfter: r.ofAfter,
      origin: r.origin,
      songType: r.songType,
      performer: r.performer,
      notes: r.notes,
      filePath: r.filePath,
      duration: r.duration,
      createdAt: r.createdAt,
      customData: r.customData,
    });
    count++;
  }
  return count;
}

// ── File-system functions (not unit-tested) ───────────────────────────────────

function getBackupDir(): Directory {
  const dir = new Directory(Paths.document, 'backups');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Lists available backup files, newest first. */
export function listBackupFiles(): BackupFileInfo[] {
  try {
    const dir = getBackupDir();
    const items = dir.list();
    const infos: BackupFileInfo[] = [];
    for (const item of items) {
      if (item instanceof Directory) continue;
      const file = item as File;
      const filename = file.uri.split('/').pop() ?? '';
      if (!isBackupFilename(filename)) continue;
      const dateStr = filename
        .replace(FILENAME_PREFIX, '')
        .replace('.json', '');
      infos.push({
        filename,
        uri: file.uri,
        sizeBytes: file.info().size ?? 0,
        date: new Date(dateStr),
      });
    }
    return infos.sort((a, b) => b.date.getTime() - a.date.getTime());
  } catch {
    return [];
  }
}

/** Writes backup JSON to the backups directory and prunes old files. Returns the saved file info. */
export function saveBackupToFile(jsonContent: string): BackupFileInfo {
  const dir = getBackupDir();
  const filename = generateBackupFilename();
  const file = new File(dir, filename);
  file.write(jsonContent);

  // Prune: keep only MAX_BACKUPS most recent
  const allNames = dir.list()
    .filter(f => !(f instanceof Directory))
    .map(f => (f as File).uri.split('/').pop() ?? '');
  const { discard } = filterBackupsToKeep(allNames);
  for (const name of discard) {
    try { new File(dir, name).delete(); } catch { /* ignore */ }
  }

  return {
    filename,
    uri: file.uri,
    sizeBytes: file.info().size ?? jsonContent.length,
    date: new Date(),
  };
}

/** Reads a backup file from its URI and returns its JSON string. */
export function readBackupFile(uri: string): string {
  return new File(uri).textSync();
}

/**
 * Performs an automatic backup on app startup.
 * Skips if a backup for today already exists to avoid redundant work.
 */
export function autoBackupOnStartup(): void {
  try {
    const todayFilename = generateBackupFilename();
    const dir = getBackupDir();
    const todayFile = new File(dir, todayFilename);
    if (todayFile.exists) return; // already backed up today
    const json = buildBackupData();
    saveBackupToFile(json);
    console.log('[Backup] auto-backup created:', todayFilename);
  } catch (e) {
    console.log('[Backup] auto-backup failed (non-fatal):', e);
  }
}
