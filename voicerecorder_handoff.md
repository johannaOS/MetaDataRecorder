# VoiceRecorder — Claude Code Handoff Document

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

## Current status

**Working:**
- Background recording (app switch) ✅
- Foreground service notification ✅
- Playback with speed control ✅
- Database backup/restore ✅
- Search and filter in library ✅
- Field management (20 field max) ✅

**Currently broken (Phase 3 — stabilize):**
- Screen lock stops recording — was working, regressed after expo-audio migration fixes
- Files not saved to Music/VoiceRecorder — recordings appear in library (temp cache file exists) but saveRecording.ts copy is failing. Debug logging added in last commit.
- Timer doesn't catch up after returning from background
- Library shows wrong duration

These all appeared after the expo-av → expo-audio migration and subsequent bug fix iterations. The last build added console.log statements throughout the recording and save flow — use ADB logcat to diagnose.

---

## Phases

**Phase 1 (done):** Core recording + metadata + library + playback

**Phase 2 (done):** Background recording, screen lock recording, file storage, backup/restore

**Phase 3 (current):** Stabilize — fix regressions, make the core workflow reliable

**Phase 4:** Share and export — get recordings out of the app (share sheet, Files app)

**Phase 5:** Sentry breadcrumbs — automatic error reporting so bugs surface without manual ADB logging. This is both a practical improvement AND the main experiment: can the debugging workflow be automated enough that bugs are caught and fixed without the user having to describe what happened? Sentry is already installed and configured (DSN set, auth token as EAS secret `SENTRY_AUTH_TOKEN`).

**Phase 6:** Richer organization — folders with color coding, multi-select

**Phase 7:** Advanced playback — A/B loop, bookmarks, speed with pitch correction

---

## Planned features (ICE priority order)

High:
- Share recording + metadata to another app
- Export audio file to Files app or share sheet

Medium:
- Folders with color coding
- A/B loop playback (loop a section while learning a tune)
- Attach photo or PDF (sheet music)
- Long press multi-select in library
- ±5 second skip buttons in playback

Lower:
- Inline waveform in library list
- Bookmarks on playback waveform
- Audio editing with markers

---

## Working style going forward

- Paste repros and ADB logs directly here — no relay through Claude.ai
- Repro format: steps → expected → actual
- Always run tests before finishing any task
- Ask if anything is unclear before writing code
- Always websearch current documentation before implementing or fixing anything that touches native Android/iOS APIs
- Every bug fix needs a confirmation that it's actually fixed on device

---

## One rule learned the hard way

Always websearch current documentation before writing code that touches native Android/iOS APIs. The expo-audio `interruptionMode` Android cast error, the `setAudioModeAsync` iOS-only regression, and foreground service issues all could have been avoided with a doc check first. Training data goes stale. When in doubt, search first.
