/**
 * Tests for lib/backup.ts
 * Pure functions are tested directly; DB functions use the expo-sqlite mock.
 * File-system functions (saveBackupToFile, readBackupFile, etc.) are not tested here.
 */
jest.mock('expo-sqlite');
// Stub out expo-file-system so the module can be imported without a native runtime.
jest.mock('expo-file-system', () => ({
  Directory: class {
    constructor() {}
    create() {}
    list() { return []; }
  },
  File: class {
    constructor() {}
    get exists() { return false; }
    write() {}
    textSync() { return ''; }
    info() { return { size: 0 }; }
    delete() {}
  },
  Paths: { document: 'file:///documents/', cache: 'file:///cache/' },
}));

import {
  buildBackupData,
  createBackupJson,
  filterBackupsToKeep,
  formatBackupDate,
  formatFileSize,
  generateBackupFilename,
  isBackupFilename,
  parseBackupJson,
  restoreFromBackupData,
} from '../lib/backup';
import { getAllRecordings, initDb, insertRecording } from '../lib/db';

beforeAll(() => { initDb(); });

// ── generateBackupFilename ─────────────────────────────────────────────────────

describe('generateBackupFilename', () => {
  it('produces the correct pattern for a known date', () => {
    expect(generateBackupFilename(new Date('2025-05-15'))).toBe(
      'voicerecorder-backup-2025-05-15.json'
    );
  });

  it('zero-pads month and day', () => {
    expect(generateBackupFilename(new Date('2025-01-07'))).toBe(
      'voicerecorder-backup-2025-01-07.json'
    );
  });

  it('uses today when no date is provided', () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    expect(generateBackupFilename()).toBe(
      `voicerecorder-backup-${y}-${m}-${d}.json`
    );
  });
});

// ── isBackupFilename ───────────────────────────────────────────────────────────

describe('isBackupFilename', () => {
  it('recognises valid backup filenames', () => {
    expect(isBackupFilename('voicerecorder-backup-2025-05-15.json')).toBe(true);
  });

  it('rejects unrelated filenames', () => {
    expect(isBackupFilename('other-file.json')).toBe(false);
    expect(isBackupFilename('voicerecorder-backup-2025-05-15.txt')).toBe(false);
    expect(isBackupFilename('')).toBe(false);
  });
});

// ── filterBackupsToKeep ───────────────────────────────────────────────────────

describe('filterBackupsToKeep', () => {
  const names = [
    'voicerecorder-backup-2025-05-10.json',
    'voicerecorder-backup-2025-05-12.json',
    'voicerecorder-backup-2025-05-14.json',
    'voicerecorder-backup-2025-05-15.json',
  ];

  it('keeps the 3 newest and marks the oldest for discard', () => {
    const { keep, discard } = filterBackupsToKeep(names, 3);
    expect(keep).toEqual([
      'voicerecorder-backup-2025-05-15.json',
      'voicerecorder-backup-2025-05-14.json',
      'voicerecorder-backup-2025-05-12.json',
    ]);
    expect(discard).toEqual(['voicerecorder-backup-2025-05-10.json']);
  });

  it('keeps all when count ≤ max', () => {
    const { keep, discard } = filterBackupsToKeep(names.slice(0, 2), 3);
    expect(keep.length).toBe(2);
    expect(discard.length).toBe(0);
  });

  it('ignores non-backup filenames', () => {
    const { keep } = filterBackupsToKeep(['other.txt', ...names], 3);
    expect(keep.every(n => n.startsWith('voicerecorder-backup-'))).toBe(true);
  });

  it('returns empty arrays for empty input', () => {
    const { keep, discard } = filterBackupsToKeep([]);
    expect(keep).toEqual([]);
    expect(discard).toEqual([]);
  });
});

// ── createBackupJson / parseBackupJson ────────────────────────────────────────

describe('createBackupJson', () => {
  const sampleRecordings = [
    {
      id: 1,
      name: 'Polska efter Erik',
      ofAfter: 'efter Erik',
      origin: 'Dalarna',
      songType: 'Polska',
      performer: 'Anna',
      notes: 'Spelas långsamt',
      filePath: '/path/to/file.m4a',
      duration: 42,
      createdAt: '2025-05-10T10:00:00.000Z',
      customData: '{"tempo":"andante"}',
    },
  ];

  it('produces valid JSON with version 1', () => {
    const json = createBackupJson(sampleRecordings as any);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
  });

  it('includes all recording fields', () => {
    const json = createBackupJson(sampleRecordings as any);
    const parsed = JSON.parse(json);
    const r = parsed.recordings[0];
    expect(r.name).toBe('Polska efter Erik');
    expect(r.customData).toBe('{"tempo":"andante"}');
    expect(r.duration).toBe(42);
  });

  it('sets recordingCount correctly', () => {
    const json = createBackupJson(sampleRecordings as any);
    expect(JSON.parse(json).recordingCount).toBe(1);
  });

  it('does not include the DB id in output', () => {
    const json = createBackupJson(sampleRecordings as any);
    expect(JSON.parse(json).recordings[0].id).toBeUndefined();
  });
});

describe('parseBackupJson', () => {
  it('parses a valid backup JSON', () => {
    const json = createBackupJson([]);
    expect(parseBackupJson(json)).not.toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseBackupJson('not-json')).toBeNull();
  });

  it('returns null when version is wrong', () => {
    const bad = JSON.stringify({ version: 2, recordings: [] });
    expect(parseBackupJson(bad)).toBeNull();
  });

  it('returns null when recordings array is missing', () => {
    const bad = JSON.stringify({ version: 1 });
    expect(parseBackupJson(bad)).toBeNull();
  });
});

// ── formatFileSize / formatBackupDate ─────────────────────────────────────────

describe('formatFileSize', () => {
  it('formats bytes', () => { expect(formatFileSize(512)).toBe('512 B'); });
  it('formats kilobytes', () => { expect(formatFileSize(23552)).toBe('23 KB'); });
  it('formats megabytes', () => { expect(formatFileSize(1572864)).toBe('1.5 MB'); });
});

describe('formatBackupDate', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(formatBackupDate(new Date('2025-05-15'))).toBe('2025-05-15');
  });
});

// ── buildBackupData / restoreFromBackupData ───────────────────────────────────

describe('buildBackupData and restoreFromBackupData — round-trip', () => {
  beforeEach(() => {
    // Insert a couple of known recordings for backup tests
    insertRecording({
      name: 'BackupTest A',
      ofAfter: '',
      origin: 'Dalarna',
      songType: 'Polska',
      performer: '',
      notes: '',
      filePath: '/test/a.m4a',
      duration: 10,
      createdAt: '2025-01-01T00:00:00.000Z',
      customData: '{}',
    });
    insertRecording({
      name: 'BackupTest B',
      ofAfter: 'av Nils',
      origin: '',
      songType: 'Vals',
      performer: 'Nils',
      notes: 'Anteckning',
      filePath: '/test/b.m4a',
      duration: 25,
      createdAt: '2025-01-02T00:00:00.000Z',
      customData: '{"tempo":"fast"}',
    });
  });

  it('backup JSON contains the inserted recordings', () => {
    const json = buildBackupData();
    const data = parseBackupJson(json)!;
    const names = data.recordings.map(r => r.name);
    expect(names).toContain('BackupTest A');
    expect(names).toContain('BackupTest B');
  });

  it('restore replaces all DB rows with backup data', () => {
    const json = buildBackupData();
    const data = parseBackupJson(json)!;

    // Insert an extra recording that should be wiped by restore
    insertRecording({
      name: 'ShouldBeGone',
      ofAfter: '', origin: '', songType: '', performer: '', notes: '',
      filePath: '/gone.m4a', duration: 1,
      createdAt: new Date().toISOString(), customData: '{}',
    });

    const count = restoreFromBackupData(data);

    const restored = getAllRecordings();
    expect(restored.some(r => r.name === 'ShouldBeGone')).toBe(false);
    expect(count).toBe(data.recordings.length);
  });

  it('restored rows contain correct field values including customData', () => {
    const json = buildBackupData();
    const data = parseBackupJson(json)!;
    restoreFromBackupData(data);

    const rows = getAllRecordings();
    const b = rows.find(r => r.name === 'BackupTest B');
    expect(b).toBeDefined();
    expect(b!.customData).toBe('{"tempo":"fast"}');
    expect(b!.performer).toBe('Nils');
    expect(b!.duration).toBe(25);
  });

  it('restoreFromBackupData returns 0 for an empty backup', () => {
    const json = createBackupJson([]);
    const data = parseBackupJson(json)!;
    const count = restoreFromBackupData(data);
    expect(count).toBe(0);
    expect(getAllRecordings().some(r => r.name.startsWith('BackupTest'))).toBe(false);
  });
});
