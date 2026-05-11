import { Audio } from 'expo-av';

// Module-level singleton used to pass an in-progress Audio.Recording
// from Screen 1 to Screen 2 without stopping it.
let _recording: Audio.Recording | null = null;

export function setActiveRecording(r: Audio.Recording | null) { _recording = r; }
export function getActiveRecording(): Audio.Recording | null { return _recording; }
export function clearActiveRecording() { _recording = null; }
