/**
 * Tests for hooks/useFieldConfig.ts
 *
 * useFocusEffect is mocked to call its callback immediately (simulating a screen
 * gaining focus), and React's useState/useCallback are mocked so the hook can be
 * invoked directly without a component tree.  State updates are captured via a
 * shared mutable object that the mock setter writes into.
 */
jest.mock('expo-sqlite');

// useFocusEffect → call the callback immediately, as if the screen just gained focus
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => cb(),
}));

// Minimal React mock — enough for the hook to run outside a component context.
// State updates (setFieldConfigs calls) are written into `captured` so tests can
// inspect what the hook would have set.
const mockCaptured: { value: unknown } = { value: undefined };

jest.mock('react', () => ({
  useState: (init: unknown) => [
    init,
    (v: unknown) => { mockCaptured.value = v; },
  ],
  useCallback: (fn: unknown) => fn,
}));

import { addCustomField, deleteCustomField, initDb, updateFieldVisibility } from '../lib/db';
import { useFieldConfig } from '../hooks/useFieldConfig';

beforeAll(() => { initDb(); });
beforeEach(() => { mockCaptured.value = undefined; });

// ── useFieldConfig ─────────────────────────────────────────────────────────────

describe('useFieldConfig — reloads on focus', () => {
  it('sets state to the current visible fields on first focus', () => {
    useFieldConfig();
    const fields = mockCaptured.value as { key: string; isVisible: boolean }[];
    expect(Array.isArray(fields)).toBe(true);
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every(f => f.isVisible)).toBe(true);
  });

  it('reflects a hidden field immediately on next focus', () => {
    updateFieldVisibility('performer', false);

    useFieldConfig(); // simulate screen gaining focus after field change
    const fields = mockCaptured.value as { key: string }[];
    expect(fields.some(f => f.key === 'performer')).toBe(false);

    updateFieldVisibility('performer', true); // restore
  });

  it('reflects a restored field immediately on next focus', () => {
    updateFieldVisibility('notes', false);
    updateFieldVisibility('notes', true);

    useFieldConfig();
    const fields = mockCaptured.value as { key: string }[];
    expect(fields.some(f => f.key === 'notes')).toBe(true);
  });

  it('includes a newly added custom field immediately on next focus', () => {
    const key = addCustomField('HookTestField');
    expect(key).not.toBeNull();

    useFieldConfig();
    const fields = mockCaptured.value as { key: string }[];
    expect(fields.some(f => f.key === key)).toBe(true);

    if (key) deleteCustomField(key);
  });

  it('no longer includes a deleted custom field after next focus', () => {
    const key = addCustomField('ToDeleteHookField');
    if (!key) return;
    deleteCustomField(key);

    useFieldConfig();
    const fields = mockCaptured.value as { key: string }[];
    expect(fields.some(f => f.key === key)).toBe(false);
  });

  it('reflects field changes on re-focus when the inline form was already open (isFormExpanded unchanged)', () => {
    // Simulate Screen 1: form is open, initial load has already happened.
    useFieldConfig(); // first focus — form opens, fields loaded
    const fieldsBefore = mockCaptured.value as { key: string }[];
    expect(fieldsBefore.some(f => f.key === 'performer')).toBe(true);

    // User navigates to field management (form stays open, isFormExpanded stays true).
    updateFieldVisibility('performer', false);

    // User returns to Screen 1 — useFocusEffect fires even though isFormExpanded did not change.
    // This is exactly what the new useFocusEffect(reloadFieldConfigs) in Screen 1 handles.
    useFieldConfig(); // simulates focus event → reloadFieldConfigs called
    const fieldsAfter = mockCaptured.value as { key: string }[];
    expect(fieldsAfter.some(f => f.key === 'performer')).toBe(false);

    updateFieldVisibility('performer', true); // restore
  });
});
