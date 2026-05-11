import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { extractOfAfter, extractOrigin, extractSongType } from '@/lib/autoFill';
import { consumeAutoRecord } from '@/lib/autoRecord';
import { FieldConfig, getVisibleFields, insertRecording } from '@/lib/db';
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
}

const SAVE_COLOR = '#00A878';

// Height of the compact recorder strip at the bottom of the split layout
const COMPACT_RECORDER_HEIGHT = 52;

export default function RecorderScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  // ── Recording state ───────────────────────────────────────────────────────────
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [bars, setBars] = useState<number[]>(() => Array(BAR_COUNT).fill(BAR_MIN));

  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meterRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

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
  const [formCustomValues, setFormCustomValues] = useState<Record<string, string>>({});
  const [fieldConfigs, setFieldConfigs] = useState<FieldConfig[]>([]);

  // ── Auto-record when arriving from Library; reload field config on focus ────────
  useFocusEffect(
    useCallback(() => {
      setFieldConfigs(getVisibleFields());
      if (consumeAutoRecord() && state === 'idle') startRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state])
  );

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
      recordingRef.current?.stopAndUnloadAsync().catch(e =>
        console.log('[Recorder] unmount cleanup error (likely already stopped):', e));
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
  function startTimer() { timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000); }
  function stopTimer() { clearInterval(timerRef.current!); timerRef.current = null; }
  function startMeterPolling() {
    meterRef.current = setInterval(async () => {
      const rec = recordingRef.current;
      if (!rec) return;
      try {
        const status = await rec.getStatusAsync();
        if (status.isRecording) setBars(prev => [...prev.slice(1), meterToHeight(status.metering)]);
      } catch {
        // Recording may have been stopped concurrently — ignore
      }
    }, POLL_MS);
  }
  function stopMeterPolling() { clearInterval(meterRef.current!); meterRef.current = null; }

  function resetRecorderState() {
    recordingRef.current = null;
    setState('idle');
    setElapsed(0);
    setBars(Array(BAR_COUNT).fill(BAR_MIN));
  }

  // ── Recording actions ─────────────────────────────────────────────────────────
  async function startRecording() {
    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) { Alert.alert(S.permissionRequired, S.microphonePermissionMessage); return; }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    try {
      const { recording } = await Audio.Recording.createAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      recordingRef.current = recording;
      setBars(Array(BAR_COUNT).fill(BAR_MIN));
      setElapsed(0);
      setSavedMeta(null);
      setIsFormExpanded(false);
      setState('recording');
      startTimer();
      startMeterPolling();
    } catch (e) {
      console.error('[Recorder] startRecording error:', e);
      Alert.alert(S.error, S.couldNotStartRecording);
    }
  }

  async function pauseRecording() {
    if (!recordingRef.current) return;
    try {
      await recordingRef.current.pauseAsync();
      stopTimer(); stopMeterPolling(); setState('paused');
    } catch (e) {
      console.error('[Recorder] pauseRecording error:', e);
      Alert.alert(S.error, S.couldNotPauseRecording);
    }
  }

  async function resumeRecording() {
    if (!recordingRef.current) return;
    try {
      await recordingRef.current.startAsync();
      setState('recording'); startTimer(); startMeterPolling();
    } catch (e) {
      console.error('[Recorder] resumeRecording error:', e);
      Alert.alert(S.error, S.couldNotResumeRecording);
    }
  }

  // Stop is ALWAYS called before any navigation. Never passes a live recording anywhere.
  async function handleStop() {
    if (!recordingRef.current) return;
    setIsFormExpanded(false);
    stopTimer();
    stopMeterPolling();
    const duration = elapsed;

    try {
      const cacheUri = recordingRef.current.getURI();
      await recordingRef.current.stopAndUnloadAsync();
      console.log('[Recorder] stopped — URI:', cacheUri);
      console.log('[Recorder] format: .m4a (MPEG-4 / AAC, 44100 Hz, 2ch, 128 kbps)');

      if (!cacheUri) {
        Alert.alert(S.recordingError, S.recordingUriNull);
        resetRecorderState();
        return;
      }

      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const finalUri = await copyToPermanentStorage(cacheUri);
      console.log('[Recorder] permanent path saved to DB:', finalUri);

      resetRecorderState();

      if (savedMeta !== null) {
        // Metadata pre-filled via inline form → save directly and go to Library
        insertRecording({
          name: savedMeta.name || S.untitled,
          ofAfter: savedMeta.ofAfter, origin: savedMeta.origin,
          songType: savedMeta.songType, performer: savedMeta.performer, notes: savedMeta.notes,
          filePath: finalUri, duration, createdAt: new Date().toISOString(),
          customData: JSON.stringify(formCustomValues),
        });
        setSavedMeta(null);
        router.replace('/library');
      } else {
        // No pre-saved metadata → navigate to Screen 2, passing any form data the user typed
        // so nothing is lost even if Save was never pressed.
        router.push({
          pathname: '/metadata',
          params: {
            filePath: finalUri,
            duration: String(duration),
            preFilledName: formName.trim(),
            preFilledOfAfter: formOfAfter.trim(),
            preFilledOrigin: formOrigin.trim(),
            preFilledSongType: formSongType.trim(),
            preFilledPerformer: formPerformer.trim(),
            preFilledNotes: formNotes.trim(),
            focusedField: lastFocusedFieldRef.current,
            preFilledCustomData: JSON.stringify(formCustomValues),
          },
        });
      }
    } catch (e) {
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
    });
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
            {/* Title */}
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

            {/* Of/after chips — extra top margin so they don't crowd the Title input */}
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

            <Text style={[styles.formLabel, styles.formLabelSpaced, { color: colors.icon }]}>{S.fieldFrom}</Text>
            <TextInput ref={formOriginRef} style={formInputStyle} placeholder={S.placeholderFrom}
              placeholderTextColor={colors.icon} value={formOrigin}
              onChangeText={t => { formOriginLockedRef.current = true; setFormOrigin(t); }}
              onFocus={() => { lastFocusedFieldRef.current = 'origin'; }}
              returnKeyType="next" onSubmitEditing={() => formSongTypeRef.current?.focus()} />

            <Text style={[styles.formLabel, styles.formLabelSpaced, { color: colors.icon }]}>{S.fieldSongType}</Text>
            <TextInput ref={formSongTypeRef} style={[formInputStyle, formSongTypeIsAuto && { color: colors.icon }]}
              placeholder={S.placeholderSongType} placeholderTextColor={colors.icon}
              value={formSongType} onChangeText={t => { formSongTypeLockedRef.current = true; setFormSongTypeIsAuto(false); setFormSongType(t); }}
              onFocus={() => { lastFocusedFieldRef.current = 'songType'; }}
              returnKeyType="next" onSubmitEditing={() => formPerformerRef.current?.focus()} />

            <Text style={[styles.formLabel, styles.formLabelSpaced, { color: colors.icon }]}>{S.fieldWhosPlaying}</Text>
            <TextInput ref={formPerformerRef} style={formInputStyle} placeholder={S.placeholderPerformer}
              placeholderTextColor={colors.icon} value={formPerformer} onChangeText={setFormPerformer}
              onFocus={() => { lastFocusedFieldRef.current = 'performer'; }}
              returnKeyType="next" onSubmitEditing={() => formNotesRef.current?.focus()} />

            <Text style={[styles.formLabel, styles.formLabelSpaced, { color: colors.icon }]}>{S.fieldNotes}</Text>
            <TextInput ref={formNotesRef} style={[formInputStyle, styles.formNotesInput]}
              placeholder={S.placeholderNotes} placeholderTextColor={colors.icon}
              value={formNotes} onChangeText={setFormNotes}
              onFocus={() => { lastFocusedFieldRef.current = 'notes'; }}
              multiline textAlignVertical="top" returnKeyType="default" blurOnSubmit />

            {/* Custom fields */}
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

          {/* Compact recorder strip — fixed height, single tight row */}
          <View style={[styles.recorderStrip, { height: COMPACT_RECORDER_HEIGHT, borderTopColor: colors.icon + '33' }]}>
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
          onPress={() => router.push('/library')}
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
