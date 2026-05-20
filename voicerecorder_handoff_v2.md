# VoiceRecorder — Claude Code Handoff Document
*Last updated: May 2026*

---

## Why this project exists (beyond the app itself)

Two parallel goals:
1. Build a useful app for Swedish folk music students and teachers
2. Learn to use Claude Code effectively, and test how much of the development workflow can be automated — including monitoring, error reporting, and faster bug resolution cycles

Phase 5 (Sentry) is not just "add error monitoring" — it's an experiment in whether bugs can surface and get fixed faster without manual ADB logging and human repro descriptions. The question is: how much of the debugging relay between user → Claude.ai → Claude Code can be replaced by automated signals?

---

## What went wrong in our previous workflow

We used Claude.ai as a relay — writing prompts for you to paste into Claude Code. This caused:
- Context loss between sessions
- Bugs introduced by incomplete prompt translations
- Wasted build cycles (several EAS builds failed or regressed due to prompt errors)
- Claude.ai giving confident but outdated advice on native APIs (expo-audio) without checking current docs

**The fix:** Work directly in Claude Code. Use Claude.ai only for documentation research, architecture decisions, and feature planning.

---

## The app: VoiceRecorder — for Swedish folk musicians

A mobile app for recording folk music with structured metadata. The core insight: folk musicians need to capture not just the audio but the context — what tune, who played it, where it comes from. Built for classroom and field use by music students and teachers.

**The user:** Swedish folk music students and teachers. They record during lessons, sessions, and fieldwork. They need to start recording fast, add metadata while recording or after, and find recordings later by tune name or type.

**Current status:** Beta — shared with classmates. 3 users tracked in Sentry, 100% crash-free rate.

**Core workflow:**
1. Press record
2. Add metadata while recording (title, of/after who, from where, song type, who's playing, notes)
3. Stop — file saved automatically
4. Find and play back from library

---

## Technical context

**Tech stack:** React Native + Expo SDK (managed workflow) + TypeScript + SQLite + expo-audio + EAS Build

**Package:** `com.johannaos.VoiceRecorder`
**Device:** Samsung A55, device ID `RZCX51WL72D`
**Repo:** GitHub private `MetaDataRecorder`
**Path:** `C:\Users\46736\Projects\MetaDataRecorder`
**ADB path:** `C:\Users\46736\AppData\Local\Android\Sdk\platform-tools\adb.exe`
**Build command:** `eas build --platform android --profile preview`

**Audio:** Fully migrated from expo-av to expo-audio. Critical rules:
- `enableBackgroundRecording: true` and `enableBackgroundPlayback: true` in app.json config plugin
- `setAudioModeAsync` must be called on BOTH platforms with `allowsBackgroundRecording: true` before recording starts
- `interruptionMode: 'doNotMix'` is iOS only — causes a cast error on Android
- Always websearch current expo-audio docs before touching audio API code — training data goes stale

**File storage:** Two-tier — Tier 1 writes to `/storage/emulated/0/Music/VoiceRecorder/`, Tier 2 falls back to app documents directory. MediaLibrary removed entirely (caused duplicate files and permission popups).

**Tests:** 125 passing. Jest + jest-expo. Tests must pass before every commit.

---

## Monitoring (Sentry)

- Package: `@sentry/react-native` (NOT the deprecated `sentry-expo`)
- DSN configured, `SENTRY_AUTH_TOKEN` set as EAS secret
- Source maps uploaded automatically during EAS build
- 85+ sessions tracked, 100% crash-free rate as of beta launch
- Breadcrumbs added to recording flow (recording started, paused, stopped, file save started/succeeded/failed)
- Dashboard: johannaos.sentry.io → Explore → Releases for session health, Issues for crashes

---

## Current status

**Working:**
- Background recording (app switch) ✅
- Screen lock recording ✅
- Foreground service notification ✅
- Playback with speed control ✅
- Database backup/restore ✅
- Search and filter in library ✅
- Field management (20 field max) ✅
- Sentry monitoring ✅

**Known issues:**
- Some recordings made during a period when file storage was broken are stored only in app cache, not in Music/VoiceRecorder. These need a "save to phone storage" feature to rescue them.

---

## ICE Priority Table

| # | Feature | Impact | Confidence | Ease | ICE | Status |
|---|---|---|---|---|---|---|
| 1 | Save recording to phone storage | 8 | 9 | 8 | 576 | ✅ Done |
| 2 | Import audio files (file picker, multiple files) | 9 | 9 | 7 | 567 | ✅ Done |
| 3 | Folders with color coding | 8 | 9 | 4 | 288 | ⬛ Replaced by tags system |
| 4 | Scrub bar time display while dragging | 8 | 9 | 9 | 648 | ✅ Done |
| 5 | Share audio file | 7 | 8 | 7 | 392 | ✅ Done |
| 6 | ±5 sec skip buttons | 6 | 9 | 9 | 486 | ✅ Done |
| 7 | A/B loop playback | 7 | 10 | 3 | 210 | 🟡 Later |
| 8 | Attach photo/PDF | 6 | 7 | 5 | 210 | 🟡 Later |
| 9 | Long press multi-select + batch tag | 6 | 7 | 4 | 168 | ✅ Done |
| 10 | Audio backup (files + DB) | 6 | 8 | 4 | 192 | 🟡 Later |
| 11 | Folder import | 5 | 7 | 3 | 105 | 🟡 Later |
| 12 | ProGuard + resource shrinking (app size) | 6 | 9 | 9 | 486 | 🟡 Later — 2 lines in app.json, do before Play Store release |

---

## Phases

**Phase 1 (done):** Core recording + metadata + library + playback

**Phase 2 (done):** Background recording, screen lock recording, file storage, backup/restore

**Phase 3 (done):** Stabilize — fixed regressions after expo-audio migration

**Phase 4 (done):** Sentry monitoring — sessions, crash-free rate, breadcrumbs in recording flow. This was also an experiment: can the debugging workflow be automated enough that bugs surface without manual ADB logging?

**Phase 5 (current):** Feature expansion based on classmate feedback
- Save to phone storage (rescues orphaned recordings)
- File import (single and multiple files via system file picker)
- Folders with color coding (repeatedly requested)
- Scrub bar time display while dragging

**Phase 6 — Google Play release:**
- Write store listing (description, screenshots, privacy policy — required by Google)
- Configure EAS for AAB format (Play Store requires AAB not APK)
- Submit to internal test track first, then production
- Target: after Phase 5 features are done and another round of classmate feedback with no critical bugs

**Phase 7 (later):** Advanced playback — A/B loop, bookmarks, speed with pitch correction

---

## Google Play notes

- $25 one-time developer account fee
- First review takes several days
- Internal test track = not public, better distribution than sending APK files manually
- Privacy policy required — needs to be hosted at a public URL
- Screenshots required for store listing

---

## Working style

- Paste repros and ADB logs directly here — no relay through Claude.ai
- Repro format: steps → expected → actual
- Always run tests before finishing any task
- Ask if anything is unclear before writing code
- Always websearch current documentation before implementing or fixing anything that touches native Android/iOS APIs
- Every bug fix needs a confirmation that it's actually fixed on device

---

## One rule learned the hard way

Always websearch current documentation before writing code that touches native Android/iOS APIs. The expo-audio `interruptionMode` Android cast error, the `setAudioModeAsync` iOS-only regression, and foreground service issues all could have been avoided with a doc check first. Training data goes stale. When in doubt, search first.
