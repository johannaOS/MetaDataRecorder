import { buildZipFilename, buildCsvContent } from '../lib/exportZip';
import type { Recording } from '../lib/db';

function rec(overrides: Partial<Recording> = {}): Recording {
  return {
    id: 1, name: 'Polska efter Erik', ofAfter: 'Erik Jonsson',
    origin: 'Dalarna', songType: 'Polska', performer: 'Anna',
    notes: '', filePath: '/cache/rec.m4a', duration: 204,
    createdAt: '2026-05-15T10:00:00Z', customData: '{}', tags: '[]',
    ...overrides,
  };
}

// ── buildZipFilename ──────────────────────────────────────────────────────────

describe('buildZipFilename', () => {
  it('produces sanitized title + date + extension', () => {
    const name = buildZipFilename(rec(), new Set());
    expect(name).toBe('Polska_efter_Erik_2026-05-15.m4a');
  });

  it('deduplicates by appending _2, _3 when names collide', () => {
    const used = new Set<string>();
    const first  = buildZipFilename(rec(), used);
    const second = buildZipFilename(rec(), used);
    const third  = buildZipFilename(rec(), used);
    expect(first).toBe('Polska_efter_Erik_2026-05-15.m4a');
    expect(second).toBe('Polska_efter_Erik_2026-05-15_2.m4a');
    expect(third).toBe('Polska_efter_Erik_2026-05-15_3.m4a');
  });

  it('preserves the original file extension for imported files', () => {
    const name = buildZipFilename(rec({ filePath: '/cache/import.mp3' }), new Set());
    expect(name).toContain('.mp3');
  });

  it('falls back to .m4a when extension is missing', () => {
    const name = buildZipFilename(rec({ filePath: 'content://media/audio/12345' }), new Set());
    expect(name).toMatch(/\.m4a$/);
  });

  it('uses Namnlös when recording name is empty', () => {
    const name = buildZipFilename(rec({ name: '' }), new Set());
    expect(name).toContain('Namnlös');
  });

  it('records with different dates are distinct without deduplication suffix', () => {
    const used = new Set<string>();
    const a = buildZipFilename(rec({ createdAt: '2026-05-01T00:00:00Z' }), used);
    const b = buildZipFilename(rec({ createdAt: '2026-05-02T00:00:00Z' }), used);
    expect(a).toBe('Polska_efter_Erik_2026-05-01.m4a');
    expect(b).toBe('Polska_efter_Erik_2026-05-02.m4a');
  });
});

// ── buildCsvContent ───────────────────────────────────────────────────────────

describe('buildCsvContent', () => {
  it('first line is a semicolon-delimited header', () => {
    const csv = buildCsvContent([]);
    const header = csv.split('\r\n')[0];
    expect(header).toContain('Titel');
    expect(header).toContain('Filnamn');
    expect(header.split(';').length).toBe(10);
  });

  it('each recording becomes one data row', () => {
    const rows = [
      { rec: rec(), filename: 'Polska_2026-05-15.m4a' },
      { rec: rec({ name: 'Vals' }), filename: 'Vals_2026-05-15.m4a' },
    ];
    const lines = buildCsvContent(rows).split('\r\n');
    expect(lines).toHaveLength(3); // header + 2 rows
  });

  it('duration is formatted as MM:SS', () => {
    const csv = buildCsvContent([{ rec: rec({ duration: 204 }), filename: 'f.m4a' }]);
    expect(csv).toContain('3:24');
  });

  it('date is formatted as YYYY-MM-DD', () => {
    const csv = buildCsvContent([{ rec: rec(), filename: 'f.m4a' }]);
    expect(csv).toContain('2026-05-15');
  });

  it('filename column matches the provided filename', () => {
    const csv = buildCsvContent([{ rec: rec(), filename: 'Polska_2026-05-15.m4a' }]);
    expect(csv).toContain('Polska_2026-05-15.m4a');
  });

  it('tags are joined with comma', () => {
    const csv = buildCsvContent([{ rec: rec({ tags: '["Polska","Vals"]' }), filename: 'f.m4a' }]);
    expect(csv).toContain('Polska, Vals');
  });

  it('values containing semicolons are quoted', () => {
    const csv = buildCsvContent([{ rec: rec({ notes: 'Bra; intressant' }), filename: 'f.m4a' }]);
    expect(csv).toContain('"Bra; intressant"');
  });

  it('values containing quotes are double-escaped', () => {
    const csv = buildCsvContent([{ rec: rec({ name: 'Erik "Spel" Jonsson' }), filename: 'f.m4a' }]);
    expect(csv).toContain('"Erik ""Spel"" Jonsson"');
  });

  it('uses CRLF line endings', () => {
    const csv = buildCsvContent([{ rec: rec(), filename: 'f.m4a' }]);
    expect(csv).toContain('\r\n');
  });
});
