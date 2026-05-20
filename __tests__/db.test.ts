/**
 * Tests for lib/db.ts — all SQLite calls are handled by __mocks__/expo-sqlite.js.
 * Because the module-level `db` is created once on import, all tests share one
 * in-memory store.  Each describe block uses unique identifiers to stay independent.
 */
jest.mock('expo-sqlite');

import {
  initDb,
  insertRecording,
  getAllRecordings,
  getRecordingById,
  updateRecording,
  deleteRecording,
  getUniqueSongTypes,
  MAX_FIELDS,
  getAllFields,
  getVisibleFields,
  updateFieldVisibility,
  moveFieldUp,
  moveFieldDown,
  addCustomField,
  deleteCustomField,
  parseCustomData,
  getAllKeywords,
  addKeyword,
  deleteKeyword,
  setTagColor,
  getTagColor,
  deleteTagColor,
  getAllTagColors,
  renameTag,
} from '../lib/db';

// Shared fixture factory
function makeRecording(overrides = {}) {
  return {
    name: 'Test Polska',
    ofAfter: 'efter Erik',
    origin: 'Dalarna',
    songType: 'Polska',
    performer: 'Anna',
    notes: 'Spelas långsamt',
    filePath: '/tmp/test.m4a',
    duration: 42,
    createdAt: new Date().toISOString(),
    customData: '{}',
    ...overrides,
  };
}

beforeAll(() => {
  initDb();
});

// ── parseCustomData ───────────────────────────────────────────────────────────

describe('parseCustomData', () => {
  it('parses a valid JSON string', () => {
    expect(parseCustomData('{"foo":"bar"}')).toEqual({ foo: 'bar' });
  });

  it('returns empty object for empty string', () => {
    expect(parseCustomData('')).toEqual({});
  });

  it('returns empty object for undefined', () => {
    expect(parseCustomData(undefined)).toEqual({});
  });

  it('returns empty object for invalid JSON', () => {
    expect(parseCustomData('not-json')).toEqual({});
  });
});

// ── Recording CRUD ────────────────────────────────────────────────────────────

describe('insertRecording and getRecordingById', () => {
  it('inserts a recording and retrieves it by id', () => {
    const id = insertRecording(makeRecording({ name: 'Insert test' }));
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);

    const r = getRecordingById(id);
    expect(r).not.toBeNull();
    expect(r!.name).toBe('Insert test');
    expect(r!.ofAfter).toBe('efter Erik');
    expect(r!.origin).toBe('Dalarna');
    expect(r!.songType).toBe('Polska');
    expect(r!.performer).toBe('Anna');
  });

  it('returns null for a non-existent id', () => {
    expect(getRecordingById(999999)).toBeNull();
  });

  it('stores customData as a JSON string', () => {
    const id = insertRecording(makeRecording({ name: 'Custom data test', customData: '{"foo":"bar"}' }));
    const r = getRecordingById(id);
    expect(r!.customData).toBe('{"foo":"bar"}');
    expect(parseCustomData(r!.customData)).toEqual({ foo: 'bar' });
  });
});

describe('getAllRecordings', () => {
  beforeAll(() => {
    insertRecording(makeRecording({ name: 'Query A', songType: 'Schottis', performer: 'Björn' }));
    insertRecording(makeRecording({ name: 'Query B', songType: 'Vals',     performer: 'Clara' }));
    insertRecording(makeRecording({ name: 'Query C', songType: 'Schottis', performer: 'David' }));
  });

  it('returns all recordings without filters', () => {
    const all = getAllRecordings();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  it('filters by songType', () => {
    const schottis = getAllRecordings(undefined, 'Schottis');
    expect(schottis.every(r => r.songType === 'Schottis')).toBe(true);
  });

  it('full-text searches across name, performer, origin, etc.', () => {
    const results = getAllRecordings('Query B');
    expect(results.some(r => r.name === 'Query B')).toBe(true);
  });

  it('search by performer', () => {
    const results = getAllRecordings('Clara');
    expect(results.some(r => r.performer === 'Clara')).toBe(true);
  });

  it('returns empty array when search matches nothing', () => {
    const results = getAllRecordings('XYZ_NOMATCH_12345');
    expect(results).toHaveLength(0);
  });
});

describe('updateRecording', () => {
  it('updates specified fields', () => {
    const id = insertRecording(makeRecording({ name: 'Before update' }));
    updateRecording(id, { name: 'After update', songType: 'Hambo' });
    const r = getRecordingById(id);
    expect(r!.name).toBe('After update');
    expect(r!.songType).toBe('Hambo');
    expect(r!.performer).toBe('Anna'); // unchanged
  });

  it('updates customData', () => {
    const id = insertRecording(makeRecording({ name: 'Custom update' }));
    updateRecording(id, { customData: '{"myField":"hello"}' });
    const r = getRecordingById(id);
    expect(parseCustomData(r!.customData)).toEqual({ myField: 'hello' });
  });
});

describe('deleteRecording', () => {
  it('removes the recording so it can no longer be found', () => {
    const id = insertRecording(makeRecording({ name: 'To be deleted' }));
    expect(getRecordingById(id)).not.toBeNull();
    deleteRecording(id);
    expect(getRecordingById(id)).toBeNull();
  });
});

describe('getUniqueSongTypes', () => {
  it('returns distinct non-empty song types', () => {
    insertRecording(makeRecording({ name: 'Unique ST 1', songType: 'Gånglåt' }));
    insertRecording(makeRecording({ name: 'Unique ST 2', songType: 'Gånglåt' })); // duplicate
    insertRecording(makeRecording({ name: 'Unique ST 3', songType: 'Visa' }));

    const types = getUniqueSongTypes();
    expect(types).toContain('Gånglåt');
    expect(types).toContain('Visa');
    // No duplicates
    const gCount = types.filter(t => t === 'Gånglåt').length;
    expect(gCount).toBe(1);
  });
});

// ── Field management ──────────────────────────────────────────────────────────

describe('getAllFields and built-in seeding', () => {
  it('seeds all six built-in fields', () => {
    const fields = getAllFields();
    const keys = fields.map(f => f.key);
    expect(keys).toContain('name');
    expect(keys).toContain('ofAfter');
    expect(keys).toContain('origin');
    expect(keys).toContain('songType');
    expect(keys).toContain('performer');
    expect(keys).toContain('notes');
  });

  it('marks built-in fields as isBuiltIn = true', () => {
    const fields = getAllFields();
    fields.filter(f => ['name','ofAfter','origin','songType','performer','notes'].includes(f.key))
          .forEach(f => expect(f.isBuiltIn).toBe(true));
  });

  it('all built-in fields are visible by default', () => {
    const visible = getVisibleFields();
    expect(visible.length).toBeGreaterThanOrEqual(6);
    expect(visible.every(f => f.isVisible)).toBe(true);
  });
});

describe('updateFieldVisibility (hide / show)', () => {
  it('hides a built-in field', () => {
    updateFieldVisibility('notes', false);
    const visible = getVisibleFields();
    expect(visible.some(f => f.key === 'notes')).toBe(false);
  });

  it('shows a previously hidden field', () => {
    updateFieldVisibility('notes', true);
    const visible = getVisibleFields();
    expect(visible.some(f => f.key === 'notes')).toBe(true);
  });
});

describe('moveFieldUp and moveFieldDown (reorder)', () => {
  it('moveFieldDown moves a field one position later', () => {
    const before = getAllFields();
    const idx = before.findIndex(f => f.key === 'name');
    const nameOrderBefore = before[idx].sortOrder;
    const nextOrder = before[idx + 1]?.sortOrder;

    moveFieldDown('name');
    const after = getAllFields();
    const nameIdx = after.findIndex(f => f.key === 'name');
    expect(nameIdx).toBeGreaterThan(idx); // moved down in the sorted list
  });

  it('moveFieldUp moves a field one position earlier', () => {
    const before = getAllFields();
    // pick the second field
    const second = before[1];
    moveFieldUp(second.key);
    const after = getAllFields();
    const newIdx = after.findIndex(f => f.key === second.key);
    expect(newIdx).toBe(0); // should now be first
  });
});

describe('addCustomField', () => {
  it('adds a new custom field that appears in getAllFields', () => {
    const key = addCustomField('Spelnummer');
    expect(typeof key).toBe('string');
    expect(key.startsWith('custom_')).toBe(true);

    const fields = getAllFields();
    const added = fields.find(f => f.key === key);
    expect(added).toBeDefined();
    expect(added!.label).toBe('Spelnummer');
    expect(added!.isBuiltIn).toBe(false);
    expect(added!.isVisible).toBe(true);
  });

  it('new custom field is visible by default', () => {
    const key = addCustomField('Tempo');
    const visible = getVisibleFields();
    expect(visible.some(f => f.key === key)).toBe(true);
  });
});

describe('deleteCustomField', () => {
  it('removes a custom field', () => {
    const key = addCustomField('ToDelete');
    expect(getAllFields().some(f => f.key === key)).toBe(true);

    deleteCustomField(key);
    expect(getAllFields().some(f => f.key === key)).toBe(false);
  });

  it('does NOT delete built-in fields', () => {
    deleteCustomField('name'); // attempt to delete built-in
    expect(getAllFields().some(f => f.key === 'name')).toBe(true);
  });
});

// ── Field visibility reflects immediately (Bug 1 regression guard) ────────────

describe('field visibility update is immediately visible to next caller', () => {
  it('getVisibleFields reflects a hide toggle without any additional action', () => {
    // Confirm performer is visible to start
    expect(getVisibleFields().some(f => f.key === 'performer')).toBe(true);

    // Hide it
    updateFieldVisibility('performer', false);

    // Next call immediately returns the updated state — no reload required
    expect(getVisibleFields().some(f => f.key === 'performer')).toBe(false);

    // Restore
    updateFieldVisibility('performer', true);
    expect(getVisibleFields().some(f => f.key === 'performer')).toBe(true);
  });

  it('a newly added custom field is visible immediately', () => {
    const key = addCustomField('ImmediateTest');
    expect(getVisibleFields().some(f => f.key === key)).toBe(true);
    deleteCustomField(key);
  });
});

// ── addCustomField — maximum field limit ──────────────────────────────────────

describe('addCustomField — 20-field maximum', () => {
  const addedKeys: string[] = [];

  afterAll(() => {
    addedKeys.forEach(k => deleteCustomField(k));
  });

  it('accepts fields up to the MAX_FIELDS limit', () => {
    const current = getAllFields().length;
    const toAdd = MAX_FIELDS - current;
    for (let i = 0; i < toAdd; i++) {
      const key = addCustomField(`MaxTest${i}`);
      expect(key).not.toBeNull();
      if (key) addedKeys.push(key);
    }
    expect(getAllFields().length).toBe(MAX_FIELDS);
  });

  it('returns null when total field count is already at MAX_FIELDS', () => {
    expect(getAllFields().length).toBe(MAX_FIELDS);
    const result = addCustomField('OverLimit');
    expect(result).toBeNull();
  });

  it('does not add a field when at the limit — count stays at MAX_FIELDS', () => {
    addCustomField('OverLimit2');
    expect(getAllFields().length).toBe(MAX_FIELDS);
  });

  it('hidden fields still count toward the limit — hiding does not free a slot', () => {
    // We are at MAX_FIELDS. Hide one of the built-in fields.
    updateFieldVisibility('notes', false);

    // The total count (getAllFields) is still MAX_FIELDS — visibility does not change it.
    expect(getAllFields().length).toBe(MAX_FIELDS);

    // Adding another field must still be blocked.
    const result = addCustomField('AfterHide');
    expect(result).toBeNull();

    // Restore visibility.
    updateFieldVisibility('notes', true);
  });
});

// ── Keywords ──────────────────────────────────────────────────────────────────

describe('keyword management', () => {
  it('seeds default keywords on initDb', () => {
    const kws = getAllKeywords();
    const labels = kws.map(k => k.label);
    expect(labels).toContain('Schottis');
    expect(labels).toContain('Vals');
    expect(labels).toContain('Polska');
    expect(labels).toContain('Polonäs');
  });

  it('returns keywords in sortOrder', () => {
    const kws = getAllKeywords();
    for (let i = 1; i < kws.length; i++) {
      expect(kws[i].sortOrder).toBeGreaterThanOrEqual(kws[i - 1].sortOrder);
    }
  });

  it('addKeyword adds a new keyword', () => {
    addKeyword('Hambo');
    const kws = getAllKeywords();
    expect(kws.some(k => k.label === 'Hambo')).toBe(true);
  });

  it('addKeyword ignores duplicates', () => {
    addKeyword('Hambo');
    addKeyword('Hambo'); // duplicate
    const count = getAllKeywords().filter(k => k.label === 'Hambo').length;
    expect(count).toBe(1);
  });

  it('new keyword gets the next sortOrder', () => {
    addKeyword('Reinlender');
    const kws = getAllKeywords();
    const last = kws[kws.length - 1];
    expect(last.label).toBe('Reinlender');
  });

  it('deleteKeyword removes the keyword by id', () => {
    addKeyword('ToDeleteKw');
    const before = getAllKeywords();
    const target = before.find(k => k.label === 'ToDeleteKw')!;
    deleteKeyword(target.id);
    expect(getAllKeywords().some(k => k.label === 'ToDeleteKw')).toBe(false);
  });

  it('deleting a keyword does not affect other keywords', () => {
    const countBefore = getAllKeywords().length;
    addKeyword('TempKw');
    const added = getAllKeywords().find(k => k.label === 'TempKw')!;
    deleteKeyword(added.id);
    const countAfter = getAllKeywords().length;
    expect(countAfter).toBe(countBefore);
    expect(getAllKeywords().some(k => k.label === 'Schottis')).toBe(true);
  });
});

// ── Tag colour overrides ──────────────────────────────────────────────────────

describe('tag colour overrides', () => {
  it('getTagColor returns null when no custom colour is set', () => {
    expect(getTagColor('Vals')).toBeNull();
  });

  it('setTagColor stores a colour and getTagColor retrieves it', () => {
    setTagColor('Vals', '#e53935');
    expect(getTagColor('Vals')).toBe('#e53935');
  });

  it('setTagColor overwrites a previously stored colour', () => {
    setTagColor('Vals', '#2196f3');
    expect(getTagColor('Vals')).toBe('#2196f3');
  });

  it('deleteTagColor removes the custom colour', () => {
    setTagColor('Polska', '#9c27b0');
    deleteTagColor('Polska');
    expect(getTagColor('Polska')).toBeNull();
  });

  it('getAllTagColors returns all stored colours as a map', () => {
    setTagColor('Schottis', '#00897b');
    const colors = getAllTagColors();
    expect(colors['Schottis']).toBe('#00897b');
    expect(colors['Vals']).toBe('#2196f3'); // set above
  });

  it('getAllTagColors returns empty map when no colours are set', () => {
    deleteTagColor('Vals');
    deleteTagColor('Schottis');
    const colors = getAllTagColors();
    expect(Object.keys(colors).length).toBe(0);
  });
});

// ── renameTag ─────────────────────────────────────────────────────────────────

describe('renameTag', () => {
  const base = { ofAfter: '', origin: '', songType: '', performer: '', notes: '',
    filePath: '/f.m4a', duration: 10, createdAt: '2025-01-01T00:00:00Z', customData: '{}' };

  it('replaces the tag in every recording that has it', () => {
    const id1 = insertRecording({ ...base, name: 'R-rename-1', tags: '["Valse","Polska"]' });
    const id2 = insertRecording({ ...base, name: 'R-rename-2', tags: '["Valse"]' });
    const id3 = insertRecording({ ...base, name: 'R-rename-3', tags: '["Polska"]' });

    renameTag('Valse', 'Vals');

    const r1 = getRecordingById(id1)!;
    const r2 = getRecordingById(id2)!;
    const r3 = getRecordingById(id3)!;
    expect(JSON.parse(r1.tags)).toContain('Vals');
    expect(JSON.parse(r1.tags)).not.toContain('Valse');
    expect(JSON.parse(r2.tags)).toEqual(['Vals']);
    expect(JSON.parse(r3.tags)).toEqual(['Polska']); // untouched
  });

  it('moves a custom colour to the new tag name', () => {
    setTagColor('OldColor', '#e91e63');
    renameTag('OldColor', 'NewColor');
    expect(getTagColor('NewColor')).toBe('#e91e63');
    expect(getTagColor('OldColor')).toBeNull();
    deleteTagColor('NewColor');
  });

  it('does nothing to recordings that do not have the tag', () => {
    const id = insertRecording({ ...base, name: 'R-rename-untouched', tags: '["Polska"]' });
    renameTag('Vals', 'Waltz');
    const r = getRecordingById(id)!;
    expect(JSON.parse(r.tags)).toEqual(['Polska']);
  });
});
