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

## Safe area insets (Android navigation bar)

Every screen that places interactive elements (buttons, FABs, list footers) near the bottom of the screen **must** account for the Android gesture/button navigation bar using `useSafeAreaInsets` from `react-native-safe-area-context`.

Standard pattern:

```tsx
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// inside the component:
const insets = useSafeAreaInsets();

// apply to fixed button rows:
<View style={[styles.buttons, { paddingBottom: 16 + insets.bottom }]}>

// apply to ScrollView / FlatList content so the last item isn't hidden:
<ScrollView contentContainerStyle={{ paddingBottom: 48 + insets.bottom }}>
<FlatList contentContainerStyle={{ paddingBottom: insets.bottom }}>

// apply to absolutely-positioned elements (FABs, strips):
<View style={[styles.fab, { bottom: 24 + insets.bottom }]}>
```

Do **not** hardcode a fixed bottom padding and assume it is large enough — use `insets.bottom` on every screen.
