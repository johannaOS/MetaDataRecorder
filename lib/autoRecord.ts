// One-shot flag: set by the Library FAB, read and cleared by Screen 1 on focus.
let _pending = false;
export function requestAutoRecord() { _pending = true; }
export function consumeAutoRecord(): boolean {
  const v = _pending;
  _pending = false;
  return v;
}
