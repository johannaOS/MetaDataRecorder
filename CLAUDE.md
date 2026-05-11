# VoiceRecorder — Claude Code guidelines

## Tests must pass before any task is done

Run `npm test` before marking any task complete. A task is not done if tests are failing.

If a code change causes test failures, fix them as part of that same task — do not leave failing tests and move on.

If new logic is added that is testable in isolation (pure functions, DB helpers), add tests for it in `__tests__/`.

## Test locations

- `__tests__/autoFill.test.ts` — unit tests for `lib/autoFill.ts`
- `__tests__/db.test.ts` — unit tests for `lib/db.ts` (uses `__mocks__/expo-sqlite.js`)

## Running tests

```
npm test          # run once
npm run test:watch  # watch mode
```
