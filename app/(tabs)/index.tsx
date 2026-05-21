import { Ionicons } from '@expo/vector-icons';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { setAudioModeAsync } from 'expo-audio';
import * as Sentry from '@sentry/react-native';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { extractOfAfter, extractOrigin, extractSongType } from '@/lib/autoFill';
import { consumeAutoRecord } from '@/lib/autoRecord';
import {
  BACKGROUND_RECORDING_TASK,
  hideRecordingNotification,
  onRecordingNotificationStop,
  showRecordingNotification,
} from '@/lib/backgroundRecording';
import * as TaskManager from 'expo-task-manager';
import { insertRecording } from '@/lib/db';
import { useFieldConfig } from '@/hooks/useFieldConfig';
import { tagColor } from '@/lib/tagColors';
import { copyToPermanentStorage } from '@/lib/saveRecording';
import { S } from '@/lib/strings';

// ── Waveform constants ────────────────────────────────────────────────────────
const BAR_COUNT = 40;
const BAR_MIN = 4;
const BAR_MAX = 60;
const POLL_MS = 80;

function meterToHeight(metering: number | null | undefined): number {
  if (metering == null) return BAR_MIN;
  const ratio = Math.max(0, Math.min(1, (metering + 60) / 60));
  return BAR_MIN + ratio * (BAR_MAX - BAR_MIN);
}

function formatTime(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

type RecorderState = 'idle' | 'recording' | 'paused';

interface SavedMeta {
  name: string; ofAfter: string; origin: string;
  songType: string; performer: string; notes: string;
  tags: string[];
}

const SAVE_COLOR = '#00A878';

// Height of the compact recorder strip at the bottom of the split layout
const COMPACT_RECORDER_HEIGHT = 52;

export default function RecorderScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  // ── Recording state ───────────────────────────────────────────────────────────
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [bars, setBars] = useState<number[]>(() => Array(BAR_COUNT).fill(BAR_MIN));

  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meterRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Wall-clock tracking — accurate across background/foreground cycles.
  const recordingStartMsRef = useRef(0);
  const pausedAccumulatedMsRef = useRef(0);
  const pauseStartMsRef = useRef(0);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);
  const elapsedRef = useRef(0);
  // Always points to the latest handleStop closure so notification response
  // listener can call it without capturing a stale version.
  const handleStopRef = useRef<() => Promise<void>>(async () => {});

  // ── Inline metadata form state ────────────────────────────────────────────────
  const [isFormExpanded, setIsFormExpanded] = useState(false);
  const [savedMeta, setSavedMeta] = useState<SavedMeta | null>(null);

  const [formName, setFormName] = useState('');
  const [formOfAfter, setFormOfAfter] = useState('');
  const [formOfAfterIsAuto, setFormOfAfterIsAuto] = useState(false);
  const formOfAfterLockedRef = useRef(false);
  const [formOrigin, setFormOrigin] = useState('');
  const formOriginLockedRef = useRef(false);
  const [formSongType, setFormSongType] = useState('');
  const [formSongTypeIsAuto, setFormSongTypeIsAuto] = useState(false);
  const formSongTypeLockedRef = useRef(false);
  const [formPerformer, setFormPerformer] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const formOfAfterRef = useRef<TextInput>(null);
  const formOriginRef = useRef<TextInput>(null);
  const formSongTypeRef = useRef<TextInput>(null);
  const formPerformerRef = useRef<TextInput>(null);
  const formNotesRef = useRef<TextInput>(null);
  // Tracks the last-focused field so we can restore focus on Screen 2
  const lastFocusedFieldRef = useRef<string>('name');
  const [formTags, setFormTags] = useState<string[]>([]);
  const [formTagInput, setFormTagInput] = useState('');
  const [formCustomValues, setFormCustomValues] = useState<Record<string, string>>({});
  const [fieldConfigs, reloadFieldConfigs] = useFieldConfig();

  // ── Auto-record when arriving from Library ────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      if (consumeAutoRecord() && state === 'idle') startRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state])
  );

  // ── Intercept hardware back button during recording (Bug 2) ──────────────────
  useFocusEffect(
    useCallback(() => {
      if (state === 'idle') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        Alert.alert(S.discardRecording, S.discardRecordingMessage, [
          { text: S.keepEditing, style: 'cancel' },
          { text: S.discard, style: 'destructive', onPress: handleDiscardRecording },
        ]);
        return true; // Prevent default back navigation
      });
      return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state])
  );

  // ── Reload field config on focus ──────────────────────────────────────────────
  // Fires every time Screen 1 regains focus, including when returning from
  // /fields while the form is already open (isFormExpanded stays true and the
  // useEffect below does not fire in that case).
  useFocusEffect(useCallback(() => { reloadFieldConfigs(); }, []));

  // ── Reload field config when inline form opens ────────────────────────────────
  // Catches the first open of the form within a focus session, before any
  // navigation has occurred.
  useEffect(() => {
    if (isFormExpanded) reloadFieldConfigs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFormExpanded]);

  // ── Keep handleStopRef pointing to the latest handleStop closure ──────────────
  // handleStop captures state (elapsed, savedMeta, formValues) that changes each
  // render. The notification response listener is set up once and must always
  // call the freshest version to avoid using stale state.
  useLayoutEffect(() => { handleStopRef.current = handleStop; });

  // ── Sync elapsed from wall clock when app returns to foreground ──────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' || !recordingRef.current) return;
      // Wall-clock elapsed is always accurate — recompute and restart timer if needed.
      // Do NOT call Audio.setAudioModeAsync here: it resets the audio session and
      // kills the active MediaRecorder on Android after a full app-switch (onStop cycle).
      const actualMs = Date.now() - recordingStartMsRef.current - pausedAccumulatedMsRef.current;
      const actual = Math.floor(actualMs / 1000);
      elapsedRef.current = actual;
      setElapsed(actual);
      if (state !== 'paused' && !timerRef.current) startTimer();
      Sentry.addBreadcrumb({ category: 'recording', message: 'App foregrounded during recording', level: 'info', data: { elapsedSeconds: actual } });
      console.log('[Recorder] foregrounded — wall-clock elapsed:', actual, 's');
    });
    return () => sub.remove();
  }, []);

  // ── Handle Stop action from the recording notification ────────────────────────
  useEffect(() => {
    return onRecordingNotificationStop(() => {
      if (recordingRef.current) handleStopRef.current();
    });
  }, []);

  // ── Button pulse ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (state === 'recording') {
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.1, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      );
      pulseLoop.current.start();
    } else {
      pulseLoop.current?.stop();
      pulseAnim.setValue(1);
    }
  }, [state, pulseAnim]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearInterval(timerRef.current!);
      clearInterval(meterRef.current!);
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
    };
  }, []);

  // ── Form auto-fill from formName ──────────────────────────────────────────────
  useEffect(() => {
    if (formOfAfterLockedRef.current) return;
    const d = extractOfAfter(formName);
    if (d) { setFormOfAfter(d); setFormOfAfterIsAuto(true); }
    else   { setFormOfAfter(''); setFormOfAfterIsAuto(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formName]);

  useEffect(() => {
    if (formOriginLockedRef.current) return;
    const d = extractOrigin(formName);
    setFormOrigin(d ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formName]);

  useEffect(() => {
    if (formSongTypeLockedRef.current) return;
    const d = extractSongType(formName);
    if (d) { setFormSongType(d); setFormSongTypeIsAuto(true); }
    else   { setFormSongType(''); setFormSongTypeIsAuto(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formName]);

  // ── Timer & meter ─────────────────────────────────────────────────────────────
  // Wall-clock timer: reads Date.now() so it stays accurate even if JS ticks were
  // missed during background or screen lock.
  function getElapsedMs(): number {
    return Date.now() - recordingStartMsRef.current - pausedAccumulatedMsRef.current;
  }

  function startTimer() {
    timerRef.current = setInterval(() => {
      const secs = Math.floor(getElapsedMs() / 1000);
      elapsedRef.current = secs;
      setElapsed(secs);
    }, 1000);
  }
  function stopTimer() { clearInterval(timerRef.current!); timerRef.current = null; }

  function startMeterPolling() {
    meterRef.current = setInterval(async () => {
      const rec = recordingRef.current;
      if (!rec) return;
      try {
        const status = await rec.getStatusAsync();
        if (status.isRecording) setBars(prev => [...prev.slice(1), meterToHeight(status.metering)]);
      } catch { /* recording may have been stopped concurrently */ }
    }, POLL_MS);
  }
  function stopMeterPolling() { clearInterval(meterRef.current!); meterRef.current = null; }

  function resetRecorderState() {
    recordingRef.current = null;
    elapsedRef.current = 0;
    recordingStartMsRef.current = 0;
    pausedAccumulatedMsRef.current = 0;
    setState('idle');
    setElapsed(0);
    setBars(Array(BAR_COUNT).fill(BAR_MIN));
  }

  // ── Recording actions ─────────────────────────────────────────────────────────
  async function startRecording() {
    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) { Alert.alert(S.permissionRequired, S.microphonePermissionMessage); return; }
    Sentry.addBreadcrumb({ category: 'recording', message: 'Setting audio mode', level: 'info', data: { platform: Platform.OS } });
    console.log('[Recorder] setting audio mode — platform:', Platform.OS);
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      shouldDuckAndroid: false,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    });
    try {
      const { recording } = await Audio.Recording.createAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      recordingRef.current = recording;
      recordingStartMsRef.current = Date.now();
      pausedAccumulatedMsRef.current = 0;
      Sentry.addBreadcrumb({ category: 'recording', message: 'Recording started', level: 'info', data: { platform: Platform.OS } });
      console.log('[Recorder] recording started');
      setBars(Array(BAR_COUNT).fill(BAR_MIN));
      setElapsed(0);
      setSavedMeta(null);
      setFormTags([]);
      setFormTagInput('');
      setIsFormExpanded(false);
      setState('recording');
      startTimer();
      startMeterPolling();
      // Pass the start timestamp so the system chronometer counts from zero.
      showRecordingNotification(recordingStartMsRef.current).catch(() => {});
    } catch (e) {
      Sentry.captureException(e, { tags: { flow: 'startRecording' } });
      console.error('[Recorder] startRecording error:', e);
      Alert.alert(S.error, S.couldNotStartRecording);
    }
  }

  async function pauseRecording() {
    if (state !== 'recording') return;
    try {
      stopTimer();
      stopMeterPolling();
      await recordingRef.current!.pauseAsync();
      pauseStartMsRef.current = Date.now();
      setState('paused');
      Sentry.addBreadcrumb({ category: 'recording', message: 'Recording paused', level: 'info', data: { elapsedSeconds: elapsedRef.current } });
    } catch (e) {
      Sentry.captureException(e, { tags: { flow: 'pauseRecording' } });
      console.error('[Recorder] pauseRecording error:', e);
      Alert.alert(S.error, S.couldNotPauseRecording);
    }
  }

  async function resumeRecording() {
    if (state !== 'paused') return;
    try {
      pausedAccumulatedMsRef.current += Date.now() - pauseStartMsRef.current;
      await recordingRef.current!.startAsync();
      setState('recording');
      startTimer();
      startMeterPolling();
      Sentry.addBreadcrumb({ category: 'recording', message: 'Recording resumed', level: 'info', data: { elapsedSeconds: elapsedRef.current } });
      // Virtual start = now − elapsed, so the chronometer shows accumulated time correctly.
      showRecordingNotification(Date.now() - getElapsedMs()).catch(() => {});
    } catch (e) {
      Sentry.captureException(e, { tags: { flow: 'resumeRecording' } });
      console.error('[Recorder] resumeRecording error:', e);
      Alert.alert(S.error, S.couldNotResumeRecording);
    }
  }

  // ── Discard recording (no save, back-button confirmation) ────────────────────
  async function handleDiscardRecording() {
    if (state === 'idle') return;
    Sentry.addBreadcrumb({ category: 'recording', message: 'Recording discarded', level: 'info', data: { elapsedSeconds: elapsedRef.current } });
    setIsFormExpanded(false);
    stopTimer();
    stopMeterPolling();
    hideRecordingNotification().catch(() => {});
    try { await recordingRef.current?.stopAndUnloadAsync(); } catch { /* already stopped */ }
    setSavedMeta(null);
    resetRecorderState();
  }

  // Stop is ALWAYS called before any navigation. Never passes a live recording anywhere.
  async function handleStop() {
    if (state === 'idle') return;
    setIsFormExpanded(false);
    stopTimer();
    stopMeterPolling();
    hideRecordingNotification().catch(() => {});

    // Wall-clock duration — accurate even after background/screen-lock cycles where
    // recorderState.durationMillis resets to 0 on Android.
    const duration = Math.round(getElapsedMs() / 1000);
    Sentry.addBreadcrumb({ category: 'recording', message: 'Stopping recording', level: 'info', data: { duration, platform: Platform.OS } });
    console.log('[Recorder] stopping — wall-clock duration:', duration, 's');

    const rec = recordingRef.current;
    try {
      await rec?.stopAndUnloadAsync();
      const cacheUri = rec?.getURI() ?? null;
      console.log('[Recorder] stopped — URI:', cacheUri);

      if (!cacheUri) {
        Sentry.captureMessage('Recording URI null after stopAndUnloadAsync', 'error');
        Alert.alert(S.recordingError, S.recordingUriNull);
        resetRecorderState();
        return;
      }

      Sentry.addBreadcrumb({ category: 'recording', message: 'Recording stopped, URI obtained', level: 'info', data: { duration } });

      // Switch audio session from recording mode back to playback mode.
      if (Platform.OS === 'ios') {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      } else {
        setAudioModeAsync({ playsInSilentMode: true, staysActiveInBackground: true }).catch(() => {});
      }
      resetRecorderState();

      if (savedMeta !== null) {
        let finalUri: string;
        try {
          finalUri = await copyToPermanentStorage(cacheUri, savedMeta.name || S.untitled);
        } catch (saveErr) {
          Sentry.captureException(saveErr, { tags: { flow: 'copyToPermanentStorage', hasMeta: 'true' } });
          console.error('[Recorder] copyToPermanentStorage error:', saveErr);
          Alert.alert(S.error, `${S.couldNotSaveRecording}\n\n${String(saveErr)}`);
          return;
        }
        console.log('[Recorder] permanent path saved to DB:', finalUri);
        insertRecording({
          name: savedMeta.name || S.untitled,
          ofAfter: savedMeta.ofAfter, origin: savedMeta.origin,
          songType: savedMeta.songType, performer: savedMeta.performer, notes: savedMeta.notes,
          filePath: finalUri, duration, createdAt: new Date().toISOString(),
          customData: JSON.stringify(formCustomValues),
          tags: JSON.stringify(savedMeta.tags),
        });
        setSavedMeta(null);
        router.replace('/library');
      } else {
        router.push({
          pathname: '/metadata',
          params: {
            filePath: cacheUri,
            duration: String(duration),
            preFilledName: formName.trim(),
            preFilledOfAfter: formOfAfter.trim(),
            preFilledOrigin: formOrigin.trim(),
            preFilledSongType: formSongType.trim(),
            preFilledPerformer: formPerformer.trim(),
            preFilledNotes: formNotes.trim(),
            focusedField: lastFocusedFieldRef.current,
            preFilledCustomData: JSON.stringify(formCustomValues),
            preFilledTags: JSON.stringify(formTags),
          },
        });
      }
    } catch (e) {
      Sentry.captureException(e, { tags: { flow: 'handleStop' } });
      console.error('[Recorder] handleStop error:', e);
      Alert.alert(S.error, S.couldNotStopRecording);
    }
  }

  // ── Inline form actions ───────────────────────────────────────────────────────
  function openForm() {
    if (savedMeta) {
      setFormName(savedMeta.name); setFormOfAfter(savedMeta.ofAfter);
      setFormOrigin(savedMeta.origin); setFormSongType(savedMeta.songType);
      setFormPerformer(savedMeta.performer); setFormNotes(savedMeta.notes);
      setFormTags(savedMeta.tags);
      formOfAfterLockedRef.current = true; formOriginLockedRef.current = true;
      formSongTypeLockedRef.current = true;
    } else {
      setFormName(''); setFormOfAfter(''); setFormOrigin('');
      setFormSongType(''); setFormPerformer(''); setFormNotes('');
      formOfAfterLockedRef.current = false; formOriginLockedRef.current = false;
      formSongTypeLockedRef.current = false;
    }
    setIsFormExpanded(true);
  }

  function saveForm() {
    setSavedMeta({
      name: formName.trim(), ofAfter: formOfAfter.trim(), origin: formOrigin.trim(),
      songType: formSongType.trim(), performer: formPerformer.trim(), notes: formNotes.trim(),
      tags: formTags,
    });
    setFormTagInput('');
    setIsFormExpanded(false);
  }

  function discardForm() { setIsFormExpanded(false); }

  function prependFormOfAfter(word: string) {
    formOfAfterLockedRef.current = true; setFormOfAfterIsAuto(false);
    const prefix = word + ' ';
    setFormOfAfter(prev => {
      const stripped = prev.startsWith('efter ') ? prev.slice(6)
                     : prev.startsWith('av ') ? prev.slice(3)
                     : prev.startsWith('Trad. ') ? prev.slice(6) : prev;
      return prefix + stripped;
    });
    formOfAfterRef.current?.focus();
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  const isActive = state !== 'idle';
  const isPaused = state === 'paused';

  const formInputStyle = [
    styles.formInput,
    { color: colors.text, borderColor: colors.icon + '44', backgroundColor: colors.background },
  ];
  // Null while fieldConfigs hasn't loaded yet → show all fields.
  const visibleFieldKeys: Set<string> | null =
    fieldConfigs.length > 0 ? new Set(fieldConfigs.map(f => f.key)) : null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>

      {isActive && isFormExpanded ? (
        // ── SPLIT LAYOUT: form scrollable above, compact recorder strip below ────
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {/* Scrollable form — fills all space above the compact recorder */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.formScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Field management icon — top-right of form, shifted down by top inset */}
            <TouchableOpacity
              style={[styles.formManageBtn, { marginTop: insets.top }]}
              onPress={() => router.push('/fields')}
              hitSlop={8}
            >
              <Ionicons name="create-outline" size={20} color={colors.icon} />
            </TouchableOpacity>

            {/* Built-in fields — each hidden when the field is disabled in field management */}
            {(!visibleFieldKeys || visibleFieldKeys.has('name')) && (<>
              <Text style={[styles.formLabel, { color: colors.icon }]}>{S.fieldTitle}</Text>
              <TextInput
                style={formInputStyle}
                placeholder={S.placeholderUntitled}
                placeholderTextColor={colors.icon}
                value={formName}
                onChangeText={setFormName}
                autoFocus
                returnKeyType="next"
                onFocus={() => { lastFocusedFieldRef.current = 'name'; }}
                onSubmitEditing={() => formOfAfterRef.current?.focus()}
              />
            </>)}

            {(!visibleFieldKeys || visibleFieldKeys.has('ofAfter')) && (<>
              <View style={styles.formChips}>
                {(['efter', 'av', 'Trad.'] as const).map(word => (
                  <TouchableOpacity key={word} style={[styles.chip, { borderColor: colors.text }]} onPress={() => prependFormOfAfter(word)}>
                    <Text style={[styles.chipText, { color: colors.text }]}>{word}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                ref={formOfAfterRef}
                style={[formInputStyle, formOfAfterIsAuto && { color: colors.icon }]}
                placeholder={S.placeholderOfAfter}
                placeholderTextColor={colors.icon}
                value={formOfAfter}
                onChangeText={t => { formOfAfterLockedRef.current = true; setFormOfAfterIsAuto(false); setFormOfAfter(t); }}
                onFocus={() => { lastFocusedFieldRef.current = 'ofAfter'; }}
                returnKeyType="next"
                onSubmitEditing={() => formOriginRef.current?.focus()}
              />
            </>)}

            {(!visibleFieldKeys || visibleFieldKeys.has('origin')) && (<>
              <Text style={[styles.formLabel, styles.formLabelSpaced, { color: colors.icon }]}>{S.fieldFrom}</Text>
              <TextInput ref={formOriginRef} style={formInputStyle} placeholder={S.placeholderFrom}
                placeholderTextColor={colors.icon} value={formOrigin}
                onChangeText={t => { formOriginLockedRef.current = true; setFormOrigin(t); }}
                onFocus={() => { lastFocusedFieldRef.current = 'origin'; }}
                returnKeyType="next" onSubmitEditing={() => formSongTypeRef.current?.focus()} />
            </>)}

            {(!visibleFieldKeys || visibleFieldKeys.has('songType')) && (<>
              <Text style={[styles.formLabel, styles.formLabelSpaced, { color: colors.icon }]}>{S.fieldSongType}</Text>
              <TextInput ref={formSongTypeRef} style={[formInputStyle, formSongTypeIsAuto && { color: colors.icon }]}
                placeholder={S.placeholderSongType} placeholderTextColor={colors.icon}
                value={formSongType} onChangeText={t => { formSongTypeLockedRef.current = true; setFormSongTypeIsAuto(false); setFormSongType(t); }}
                onFocus={() => { lastFocusedFieldRef.current = 'songType'; }}
                returnKeyType="next" onSubmitEditing={() => formPerformerRef.current?.focus()} />
            </>)}

            {(!visibleFieldKeys || visibleFieldKeys.has('performer')) && (<>
              <Text style={[styles.formLabel, styles.formLabelSpaced, { color: colors.icon }]}>{S.fieldWhosPlaying}</Text>
              <TextInput ref={formPerformerRef} style={formInputStyle} placeholder={S.placeholderPerformer}
                placeholderTextColor={colors.icon} value={formPerformer} onChangeText={setFormPerformer}
                onFocus={() => { lastFocusedFieldRef.current = 'performer'; }}
                returnKeyType="next" onSubmitEditing={() => formNotesRef.current?.focus()} />
            </>)}

            {(!visibleFieldKeys || visibleFieldKeys.has('notes')) && (<>
              <Text style={[styles.formLabel, styles.formLabelSpaced, { color: colors.icon }]}>{S.fieldNotes}</Text>
              <TextInput ref={formNotesRef} style={[formInputStyle, styles.formNotesInput]}
                placeholder={S.placeholderNotes} placeholderTextColor={colors.icon}
                value={formNotes} onChangeText={setFormNotes}
                onFocus={() => { lastFocusedFieldRef.current = 'notes'; }}
                multiline textAlignVertical="top" returnKeyType="default" blurOnSubmit />
            </>)}

            {/* Tags */}
            <Text style={[styles.formLabel, styles.formLabelSpaced, { color: colors.icon }]}>{S.tagsLabel}</Text>
            {formTags.length > 0 && (
              <View style={styles.formTagChips}>
                {formTags.map(tag => {
                  const tc = tagColor(tag);
                  return (
                    <TouchableOpacity
                      key={tag}
                      style={[styles.formTagChip, { backgroundColor: tc.bg, borderColor: tc.text + '55' }]}
                      onPress={() => setFormTags(prev => prev.filter(t => t !== tag))}
                    >
                      <Text style={[styles.formTagChipText, { color: tc.text }]}>{tag}</Text>
                      <Ionicons name="close" size={12} color={tc.text} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            <TextInput
              style={formInputStyle}
              placeholder={S.addTagPlaceholder}
              placeholderTextColor={colors.icon}
              value={formTagInput}
              onChangeText={setFormTagInput}
              returnKeyType="done"
              blurOnSubmit={false}
              onSubmitEditing={() => {
                const t = formTagInput.trim();
                if (t && !formTags.includes(t)) setFormTags(prev => [...prev, t]);
                setFormTagInput('');
              }}
            />

            {/* Custom fields — visibility already controlled by fieldConfigs */}
            {fieldConfigs.filter(f => !f.isBuiltIn).map(field => (
              <View key={field.key}>
                <Text style={[styles.formLabel, styles.formLabelSpaced, { color: colors.icon }]}>{field.label}</Text>
                <TextInput
                  style={formInputStyle}
                  placeholderTextColor={colors.icon}
                  value={formCustomValues[field.key] || ''}
                  onChangeText={v => setFormCustomValues(prev => ({ ...prev, [field.key]: v }))}
                  returnKeyType="next"
                />
              </View>
            ))}
          </ScrollView>

          {/* Save/Discard — fixed between scroll area and recorder strip, never hidden */}
          <View style={[styles.formButtonsFixed, { borderTopColor: colors.icon + '22', borderBottomColor: colors.icon + '22' }]}>
            <TouchableOpacity style={[styles.formBtn, { backgroundColor: SAVE_COLOR }]} onPress={saveForm}>
              <Ionicons name="checkmark" size={16} color="white" />
              <Text style={styles.formBtnSaveText}>{S.save}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.formBtn, styles.formBtnDiscard, { borderColor: colors.icon + '66' }]} onPress={discardForm}>
              <Text style={[styles.formBtnDiscardText, { color: colors.icon }]}>{S.cancel}</Text>
            </TouchableOpacity>
          </View>

          {/* Compact recorder strip — fixed height plus bottom inset for nav bar */}
          <View style={[styles.recorderStrip, { height: COMPACT_RECORDER_HEIGHT + insets.bottom, paddingBottom: insets.bottom, borderTopColor: colors.icon + '33' }]}>
            <Text style={[styles.stripTimer, isPaused && { color: colors.icon }]}>
              {formatTime(elapsed)}
            </Text>
            <View style={styles.stripWaveform}>
              {bars.map((h, i) => (
                <View key={i} style={[styles.stripBar, {
                  height: Math.min(h * 0.45, 24),
                  backgroundColor: isPaused ? colors.icon : '#e53935',
                  opacity: isPaused ? 0.35 : 1,
                }]} />
              ))}
            </View>
            <TouchableOpacity
              style={[styles.stripBtn, { borderColor: colors.text }]}
              onPress={isPaused ? resumeRecording : pauseRecording}
              activeOpacity={0.7}
            >
              <Ionicons name={isPaused ? 'play' : 'pause'} size={16} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.stripStopBtn} onPress={handleStop} activeOpacity={0.8}>
              <Ionicons name="stop" size={16} color="white" />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>

      ) : (
        // ── NORMAL LAYOUT: recorder centred, preview field above waveform ─────────
        <View style={styles.top}>
          <Text style={[styles.title, { color: colors.text }]}>{S.appTitle}</Text>

          {/* Preview field — above waveform, only when recording */}
          {isActive && (
            <TouchableOpacity
              style={[styles.metaPreview, { borderColor: colors.icon + '44', backgroundColor: colors.icon + '0d' }]}
              onPress={openForm}
              activeOpacity={0.7}
            >
              <Ionicons name="create-outline" size={16} color={colors.icon} style={{ marginRight: 6 }} />
              <Text style={[styles.metaPreviewText, { color: savedMeta?.name ? colors.text : colors.icon }]} numberOfLines={1}>
                {savedMeta?.name || S.inlineFormPlaceholder}
              </Text>
            </TouchableOpacity>
          )}

          {isActive && (
            <>
              <Text style={[styles.timer, isPaused && { color: colors.icon }]}>
                {formatTime(elapsed)}
              </Text>
              <View style={styles.waveform}>
                {bars.map((h, i) => (
                  <View key={i} style={[styles.bar, {
                    height: h,
                    backgroundColor: isPaused ? colors.icon : '#e53935',
                    opacity: isPaused ? 0.35 : 1,
                  }]} />
                ))}
              </View>
            </>
          )}

          <View style={styles.controls}>
            {isActive && (
              <TouchableOpacity
                style={[styles.secondaryBtn, { borderColor: colors.text }]}
                onPress={isPaused ? resumeRecording : pauseRecording}
                activeOpacity={0.7}
              >
                <Ionicons name={isPaused ? 'play' : 'pause'} size={28} color={colors.text} />
              </TouchableOpacity>
            )}
            <Animated.View style={state === 'recording' ? { transform: [{ scale: pulseAnim }] } : undefined}>
              <TouchableOpacity
                style={[styles.recordButton, isActive && styles.recordButtonActive]}
                onPress={isActive ? handleStop : startRecording}
                activeOpacity={0.8}
              >
                <Ionicons name={isActive ? 'stop' : 'mic'} size={52} color="white" />
              </TouchableOpacity>
            </Animated.View>
          </View>

          <Text style={[styles.hint, { color: colors.icon }]}>
            {state === 'idle' ? S.tapToRecord : isPaused ? S.paused : S.tapToStop}
          </Text>
        </View>
      )}

      {/* Library button — idle only, absolutely positioned at bottom centre */}
      {state === 'idle' && (
        <TouchableOpacity
          style={[styles.libraryButton, { borderColor: colors.text }]}
          onPress={() => router.replace('/library')}
        >
          <Ionicons name="library-outline" size={18} color={colors.text} />
          <Text style={[styles.libraryButtonText, { color: colors.text }]}>{S.library}</Text>
        </TouchableOpacity>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },

  // ── Normal recorder layout ────────────────────────────────────────────────────
  top: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    position: 'absolute',
    top: 56,
  },
  timer: {
    fontSize: 56,
    fontWeight: '200',
    color: '#e53935',
    fontVariant: ['tabular-nums'],
    letterSpacing: 2,
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    height: BAR_MAX + 4,
    gap: 3,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  bar: { width: 4, borderRadius: 2, minHeight: BAR_MIN },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  secondaryBtn: {
    width: 68, height: 68, borderRadius: 34, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  recordButton: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: '#e53935',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#e53935', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  recordButtonActive: { backgroundColor: '#b71c1c', shadowColor: '#b71c1c' },
  hint: { fontSize: 16 },
  metaPreview: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    width: '80%',
  },
  metaPreviewText: { flex: 1, fontSize: 15 },

  // ── Compact recorder strip (split layout) ─────────────────────────────────────
  recorderStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stripTimer: {
    fontSize: 12,
    fontWeight: '300',
    color: '#e53935',
    fontVariant: ['tabular-nums'],
    width: 38,
  },
  stripWaveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 28,
    gap: 2,
    overflow: 'hidden',
  },
  stripBar: { width: 3, borderRadius: 1.5, minHeight: 2 },
  stripBtn: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  stripStopBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#b71c1c',
    alignItems: 'center', justifyContent: 'center',
  },

  // ── Inline form ───────────────────────────────────────────────────────────────
  formScroll: { padding: 16, paddingBottom: 24 },
  formManageBtn: { alignSelf: 'flex-end', padding: 4, marginBottom: 4 },
  formLabel: {
    fontSize: 11, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginBottom: 6,
  },
  formLabelSpaced: { marginTop: 14 },
  // Extra top margin so chips don't crowd the Title input above
  formChips: { flexDirection: 'row', gap: 6, marginTop: 16, marginBottom: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1.5 },
  chipText: { fontSize: 12, fontWeight: '500' },
  formInput: {
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 9,
    fontSize: 15,
  },
  formNotesInput: { minHeight: 60 },
  formTagChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  formTagChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  formTagChipText: { fontSize: 13, fontWeight: '500' },
  formButtonsFixed: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  formBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 10,
  },
  formBtnDiscard: { borderWidth: 1 },
  formBtnSaveText: { color: 'white', fontSize: 15, fontWeight: '600' },
  formBtnDiscardText: { fontSize: 15, fontWeight: '500' },

  // ── Library button ────────────────────────────────────────────────────────────
  libraryButton: {
    position: 'absolute', bottom: 52, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 28, paddingVertical: 12,
    borderRadius: 24, borderWidth: 1.5,
  },
  libraryButtonText: { fontSize: 16, fontWeight: '500' },

});
