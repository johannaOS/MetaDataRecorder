import * as SQLite from 'expo-sqlite';

// ── Recording ─────────────────────────────────────────────────────────────────

export interface Recording {
  id: number;
  name: string;
  ofAfter: string;
  origin: string;
  songType: string;
  performer: string;
  notes: string;
  filePath: string;
  duration: number;
  createdAt: string;
  customData: string; // JSON: Record<string, string>
  tags: string;       // JSON: string[]
}

// ── FieldConfig ───────────────────────────────────────────────────────────────

export interface FieldConfig {
  id: number;
  key: string;
  label: string;
  isBuiltIn: boolean;
  isVisible: boolean;
  sortOrder: number;
}

const BUILT_IN_FIELDS: Omit<FieldConfig, 'id'>[] = [
  { key: 'name',      label: 'Titel',         isBuiltIn: true, isVisible: true, sortOrder: 0 },
  { key: 'ofAfter',   label: 'Av / efter',     isBuiltIn: true, isVisible: true, sortOrder: 1 },
  { key: 'origin',    label: 'Från',           isBuiltIn: true, isVisible: true, sortOrder: 2 },
  { key: 'songType',  label: 'Låttyp',         isBuiltIn: true, isVisible: true, sortOrder: 3 },
  { key: 'performer', label: 'Vem spelar',     isBuiltIn: true, isVisible: true, sortOrder: 4 },
  { key: 'notes',     label: 'Anteckningar',   isBuiltIn: true, isVisible: true, sortOrder: 5 },
];

// ── Keyword ───────────────────────────────────────────────────────────────────

export interface Keyword {
  id: number;
  label: string;
  sortOrder: number;
}

const DEFAULT_KEYWORDS = ['Schottis', 'Vals', 'Polska', 'Polonäs'];

// ── DB init ───────────────────────────────────────────────────────────────────

const db = SQLite.openDatabaseSync('recordings.db');

export function initDb() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      ofAfter TEXT NOT NULL DEFAULT '',
      origin TEXT NOT NULL DEFAULT '',
      songType TEXT NOT NULL DEFAULT '',
      performer TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      filePath TEXT NOT NULL,
      duration REAL NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      customData TEXT NOT NULL DEFAULT '{}'
    );
  `);
  db.execSync(`
    CREATE TABLE IF NOT EXISTS fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      isBuiltIn INTEGER NOT NULL DEFAULT 0,
      isVisible INTEGER NOT NULL DEFAULT 1,
      sortOrder INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.execSync(`
    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL UNIQUE,
      sortOrder INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.execSync(`
    CREATE TABLE IF NOT EXISTS tag_colors (
      tag TEXT NOT NULL,
      color TEXT NOT NULL
    );
  `);

  db.execSync(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT NOT NULL,
      value TEXT NOT NULL
    );
  `);

  // Column migrations (silent if already present)
  try { db.execSync("ALTER TABLE recordings ADD COLUMN ofAfter TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.execSync("ALTER TABLE recordings ADD COLUMN origin TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.execSync("ALTER TABLE recordings ADD COLUMN customData TEXT NOT NULL DEFAULT '{}'"); } catch {}
  try { db.execSync("ALTER TABLE recordings ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'"); } catch {}

  // Seed default filter keywords
  DEFAULT_KEYWORDS.forEach((label, i) => {
    try { db.runSync('INSERT OR IGNORE INTO keywords (label, sortOrder) VALUES (?, ?)', label, i); } catch {}
  });

  // Seed built-in fields — INSERT OR IGNORE keeps user-modified state intact
  for (const f of BUILT_IN_FIELDS) {
    try {
      db.runSync(
        'INSERT OR IGNORE INTO fields (key, label, isBuiltIn, isVisible, sortOrder) VALUES (?, ?, ?, ?, ?)',
        f.key, f.label, 1, f.isVisible ? 1 : 0, f.sortOrder
      );
    } catch {}
  }
}

// ── Recording CRUD ────────────────────────────────────────────────────────────

export function insertRecording(data: Omit<Recording, 'id'>): number {
  const result = db.runSync(
    `INSERT INTO recordings
       (name, ofAfter, origin, songType, performer, notes, filePath, duration, createdAt, customData, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    data.name, data.ofAfter, data.origin, data.songType,
    data.performer, data.notes, data.filePath, data.duration,
    data.createdAt, data.customData ?? '{}', data.tags ?? '[]'
  );
  return result.lastInsertRowId;
}

export function getAllRecordings(search?: string, songTypeFilter?: string): Recording[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (search && search.trim()) {
    conditions.push('(name LIKE ? OR ofAfter LIKE ? OR origin LIKE ? OR performer LIKE ? OR notes LIKE ? OR songType LIKE ?)');
    const s = `%${search.trim()}%`;
    params.push(s, s, s, s, s, s);
  }
  if (songTypeFilter) {
    conditions.push('songType = ?');
    params.push(songTypeFilter);
  }

  const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
  return db.getAllSync(`SELECT * FROM recordings${where} ORDER BY createdAt DESC`, ...params) as Recording[];
}

export function getRecordingById(id: number): Recording | null {
  return db.getFirstSync('SELECT * FROM recordings WHERE id = ?', id) as Recording | null;
}

export function updateRecording(
  id: number,
  data: Partial<Pick<Recording, 'name' | 'ofAfter' | 'origin' | 'songType' | 'performer' | 'notes' | 'customData' | 'filePath' | 'tags'>>
) {
  const fieldsList = Object.keys(data).map(k => `${k} = ?`).join(', ');
  const values = Object.values(data);
  db.runSync(`UPDATE recordings SET ${fieldsList} WHERE id = ?`, ...values, id);
}

export function getAllUniqueTags(): string[] {
  const rows = db.getAllSync(
    "SELECT tags FROM recordings WHERE tags != '[]' AND tags != ''"
  ) as { tags: string }[];
  const tagSet = new Set<string>();
  for (const row of rows) {
    try {
      const arr: string[] = JSON.parse(row.tags);
      arr.forEach(t => { if (t) tagSet.add(t); });
    } catch {}
  }
  return [...tagSet].sort();
}

export function parseTags(raw: string | undefined): string[] {
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

export function deleteRecording(id: number) {
  db.runSync('DELETE FROM recordings WHERE id = ?', id);
}

export function deleteAllRecordings() {
  db.runSync('DELETE FROM recordings');
}

export function getUniqueSongTypes(): string[] {
  const rows = db.getAllSync(
    "SELECT DISTINCT songType FROM recordings WHERE songType != '' ORDER BY songType"
  ) as { songType: string }[];
  return rows.map(r => r.songType);
}

// ── Field config CRUD ─────────────────────────────────────────────────────────

function rowToFieldConfig(r: Record<string, unknown>): FieldConfig {
  return {
    id: r.id as number,
    key: r.key as string,
    label: r.label as string,
    isBuiltIn: (r.isBuiltIn as number) === 1,
    isVisible: (r.isVisible as number) === 1,
    sortOrder: r.sortOrder as number,
  };
}

export function getAllFields(): FieldConfig[] {
  return (db.getAllSync('SELECT * FROM fields ORDER BY sortOrder ASC') as Record<string, unknown>[])
    .map(rowToFieldConfig);
}

export function getVisibleFields(): FieldConfig[] {
  return (db.getAllSync('SELECT * FROM fields WHERE isVisible = 1 ORDER BY sortOrder ASC') as Record<string, unknown>[])
    .map(rowToFieldConfig);
}

export function updateFieldVisibility(key: string, isVisible: boolean) {
  db.runSync('UPDATE fields SET isVisible = ? WHERE key = ?', isVisible ? 1 : 0, key);
}

export function moveFieldUp(key: string) {
  const fields = getAllFields();
  const idx = fields.findIndex(f => f.key === key);
  if (idx <= 0) return;
  const above = fields[idx - 1];
  const curr  = fields[idx];
  db.runSync('UPDATE fields SET sortOrder = ? WHERE key = ?', curr.sortOrder,  above.key);
  db.runSync('UPDATE fields SET sortOrder = ? WHERE key = ?', above.sortOrder, curr.key);
}

export function moveFieldDown(key: string) {
  const fields = getAllFields();
  const idx = fields.findIndex(f => f.key === key);
  if (idx < 0 || idx >= fields.length - 1) return;
  const below = fields[idx + 1];
  const curr  = fields[idx];
  db.runSync('UPDATE fields SET sortOrder = ? WHERE key = ?', curr.sortOrder,  below.key);
  db.runSync('UPDATE fields SET sortOrder = ? WHERE key = ?', below.sortOrder, curr.key);
}

export const MAX_FIELDS = 20;

export function addCustomField(label: string): string | null {
  if (getAllFields().length >= MAX_FIELDS) return null;
  const key = `custom_${Date.now()}`;
  db.runSync(
    `INSERT INTO fields (key, label, isBuiltIn, isVisible, sortOrder)
     VALUES (?, ?, 0, 1, (SELECT COALESCE(MAX(sortOrder), -1) + 1 FROM fields))`,
    key, label
  );
  return key;
}

export function deleteCustomField(key: string) {
  db.runSync('DELETE FROM fields WHERE key = ? AND isBuiltIn = 0', key);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Keyword CRUD ──────────────────────────────────────────────────────────────

export function getAllKeywords(): Keyword[] {
  return db.getAllSync('SELECT * FROM keywords ORDER BY sortOrder ASC') as Keyword[];
}

export function addKeyword(label: string) {
  const row = db.getFirstSync('SELECT MAX(sortOrder) AS m FROM keywords') as { m: number | null };
  const nextOrder = (row?.m ?? -1) + 1;
  db.runSync('INSERT OR IGNORE INTO keywords (label, sortOrder) VALUES (?, ?)', label, nextOrder);
}

export function deleteKeyword(id: number) {
  db.runSync('DELETE FROM keywords WHERE id = ?', id);
}

// ── Install ID ───────────────────────────────────────────────────────────────
// A random UUID generated on first launch and persisted locally.
// Used for Sentry device grouping without sending any personal identifier.

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export function getOrCreateInstallId(): string {
  const row = db.getFirstSync(
    "SELECT value FROM settings WHERE key = 'installId'"
  ) as { value: string } | null;
  if (row) return row.value;
  const id = generateUUID();
  db.runSync("INSERT INTO settings (key, value) VALUES ('installId', ?)", id);
  return id;
}

// ── Tag colour overrides ──────────────────────────────────────────────────────

export function setTagColor(tag: string, color: string) {
  db.runSync('DELETE FROM tag_colors WHERE tag = ?', tag);
  db.runSync('INSERT INTO tag_colors (tag, color) VALUES (?, ?)', tag, color);
}

export function getTagColor(tag: string): string | null {
  const row = db.getFirstSync('SELECT color FROM tag_colors WHERE tag = ?', tag) as { color: string } | null;
  return row?.color ?? null;
}

export function deleteTagColor(tag: string) {
  db.runSync('DELETE FROM tag_colors WHERE tag = ?', tag);
}

export function getAllTagColors(): Record<string, string> {
  const rows = db.getAllSync('SELECT tag, color FROM tag_colors') as { tag: string; color: string }[];
  const map: Record<string, string> = {};
  for (const row of rows) map[row.tag] = row.color;
  return map;
}

// Renames a tag in every recording and moves any custom colour to the new name.
export function renameTag(oldTag: string, newTag: string) {
  const rows = db.getAllSync(
    "SELECT id, tags FROM recordings WHERE tags != '[]' AND tags != ''"
  ) as { id: number; tags: string }[];
  for (const row of rows) {
    const tags = parseTags(row.tags);
    const idx = tags.indexOf(oldTag);
    if (idx === -1) continue;
    tags[idx] = newTag;
    db.runSync('UPDATE recordings SET tags = ? WHERE id = ?', JSON.stringify(tags), row.id);
  }
  db.runSync('UPDATE tag_colors SET tag = ? WHERE tag = ?', newTag, oldTag);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function parseCustomData(raw: string | undefined): Record<string, string> {
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}
