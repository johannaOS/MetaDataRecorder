import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { File } from 'expo-file-system';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
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
import { clearActiveRecording, getActiveRecording } from '@/lib/activeRecording';
import { FieldConfig, getVisibleFields, insertRecording } from '@/lib/db';
import { copyToPermanentStorage } from '@/lib/saveRecording';
import { S } from '@/lib/strings';

import { extractOfAfter, extractOrigin, extractSongType } from '@/lib/autoFill';

const SAVE_COLOR = '#00A878';

function formatTime(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

export default function MetadataScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const {
    filePath: filePathParam, duration: durationParam, mode, elapsedAtStart,
    preFilledName, preFilledOfAfter, preFilledOrigin, preFilledSongType, preFilledPerformer, preFilledNotes,
    focusedField, preFilledCustomData,
  } = useLocalSearchParams<{
    filePath?: string; duration?: string; mode?: string; elapsedAtStart?: string;
    preFilledName?: string; preFilledOfAfter?: string; preFilledOrigin?: string;
    preFilledSongType?: string; preFilledPerformer?: string; preFilledNotes?: string;
    focusedField?: string; preFilledCustomData?: string;
  }>();

  const isLiveMode = mode === 'live';

  // ── Form fields — initialised with any pre-filled values from Screen 1 ───────
  const [name, setName] = useState(preFilledName || '');
  const [ofAfter, setOfAfter] = useState(preFilledOfAfter || '');
  const [ofAfterIsAuto, setOfAfterIsAuto] = useState(false);
  const ofAfterLockedRef = useRef(Boolean(preFilledOfAfter));
  const [origin, setOrigin] = useState(preFilledOrigin || '');
  const originLockedRef = useRef(Boolean(preFilledOrigin));
  const [songType, setSongType] = useState(preFilledSongType || '');
  const [songTypeIsAuto, setSongTypeIsAuto] = useState(false);
  const songTypeLockedRef = useRef(Boolean(preFilledSongType));
  const [performer, setPerformer] = useState(preFilledPerformer || '');
  const [notes, setNotes] = useState(preFilledNotes || '');
  const [saving, setSaving] = useState(false);
  const [customValues, setCustomValues] = useState<Record<string, string>>(
    preFilledCustomData ? (() => { try { return JSON.parse(preFilledCustomData); } catch { return {}; } })() : {}
  );
  const [fieldConfigs, setFieldConfigs] = useState<FieldConfig[]>([]);

  // ── Resolved file info (set after stopping live recording, or from params) ──
  const [resolvedFilePath, setResolvedFilePath] = useState<string>(filePathParam ?? '');
  const [resolvedDuration, setResolvedDuration] = useState<number>(Number(durationParam) || 0);

  // ── Live recording state ────────────────────────────────────────────────────
  const [isLive, setIsLive] = useState(isLiveMode);
  const [liveElapsed, setLiveElapsed] = useState(Number(elapsedAtStart) || 0);
  const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  // ── Input refs ───────────────────────────────────────────────────────────────
  const ofAfterRef = useRef<TextInput>(null);
  const originRef = useRef<TextInput>(null);
  const songTypeRef = useRef<TextInput>(null);
  const performerRef = useRef<TextInput>(null);
  const notesRef = useRef<TextInput>(null);

  // ── Live timer + pulse animation ─────────────────────────────────────────────
  useEffect(() => {
    if (isLive) {
      liveTimerRef.current = setInterval(() => setLiveElapsed(e => e + 1), 1000);
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.5, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      pulseLoop.current.start();
    } else {
      if (liveTimerRef.current) { clearInterval(liveTimerRef.current); liveTimerRef.current = null; }
      pulseLoop.current?.stop();
      pulseAnim.setValue(1);
    }
    return () => {
      if (liveTimerRef.current) { clearInterval(liveTimerRef.current); liveTimerRef.current = null; }
      pulseLoop.current?.stop();
    };
  }, [isLive, pulseAnim]);

  // Restore focus to whichever field was active in the inline form when Stop was pressed
  useEffect(() => {
    if (!focusedField || focusedField === 'name') return;
    const map: Record<string, { current: TextInput | null }> = {
      ofAfter: ofAfterRef, origin: originRef,
      songType: songTypeRef, performer: performerRef, notes: notesRef,
    };
    const timer = setTimeout(() => map[focusedField]?.current?.focus(), 250);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload field configuration every time Screen 2 gains focus so changes from
  // the field management screen are reflected immediately without a save.
  useFocusEffect(useCallback(() => { setFieldConfigs(getVisibleFields()); }, []));

  // Safety: stop any orphaned recording if this screen unmounts unexpectedly
  useEffect(() => {
    return () => {
      const rec = getActiveRecording();
      if (rec) {
        console.log('[Metadata] unmount cleanup: stopping orphaned recording');
        clearActiveRecording();
        rec.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  // ── Auto-fill from name ───────────────────────────────────────────────────────
  useEffect(() => {
    if (ofAfterLockedRef.current) return;
    const detected = extractOfAfter(name);
    if (detected) { setOfAfter(detected); setOfAfterIsAuto(true); }
    else { setOfAfter(''); setOfAfterIsAuto(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  useEffect(() => {
    if (originLockedRef.current) return;
    const detected = extractOrigin(name);
    if (detected) setOrigin(detected);
    else setOrigin('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  useEffect(() => {
    if (songTypeLockedRef.current) return;
    const detected = extractSongType(name);
    if (detected) { setSongType(detected); setSongTypeIsAuto(true); }
    else { setSongType(''); setSongTypeIsAuto(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function prependToOfAfter(word: string) {
    ofAfterLockedRef.current = true;
    setOfAfterIsAuto(false);
    const prefix = word + ' ';
    setOfAfter(prev => {
      const stripped = prev.startsWith('efter ') ? prev.slice(6)
                     : prev.startsWith('av ') ? prev.slice(3)
                     : prev.startsWith('Trad. ') ? prev.slice(6)
                     : prev;
      return prefix + stripped;
    });
    ofAfterRef.current?.focus();
  }

  // Stops the live recording, resets audio mode, copies to permanent storage.
  // Returns the permanent URI, or null on failure.
  async function stopLiveRecording(): Promise<string | null> {
    if (liveTimerRef.current) { clearInterval(liveTimerRef.current); liveTimerRef.current = null; }
    const rec = getActiveRecording();
    if (!rec) return null;
    clearActiveRecording();
    try {
      const cacheUri = rec.getURI();
      await rec.stopAndUnloadAsync();
      console.log('[Metadata] live recording stopped — cache URI:', cacheUri);
      if (!cacheUri) { Alert.alert(S.recordingError, S.recordingUriNull); return null; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const finalUri = await copyToPermanentStorage(cacheUri);
      console.log('[Metadata] permanent path:', finalUri);
      return finalUri;
    } catch (e) {
      console.error('[Metadata] stopLiveRecording error:', e);
      Alert.alert(S.error, S.couldNotStopRecording);
      return null;
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────────

  // Stop button: stops the recording but stays on the form so the user can review/edit.
  async function handleStopRecording() {
    const uri = await stopLiveRecording();
    if (uri) {
      setResolvedFilePath(uri);
      setResolvedDuration(liveElapsed);
      setIsLive(false);
    }
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);

    let filePath = resolvedFilePath;
    let duration = resolvedDuration;

    if (isLive) {
      const uri = await stopLiveRecording();
      if (!uri) { setSaving(false); return; }
      filePath = uri;
      duration = liveElapsed;
      setIsLive(false);
    }

    try {
      insertRecording({
        name: name.trim() || S.untitled,
        ofAfter: ofAfter.trim(),
        origin: origin.trim(),
        songType: songType.trim(),
        performer: performer.trim(),
        notes: notes.trim(),
        filePath,
        duration,
        createdAt: new Date().toISOString(),
        customData: JSON.stringify(customValues),
      });
      router.replace('/library');
    } catch (e) {
      console.error('[Metadata] handleSave error:', e);
      setSaving(false);
      Alert.alert(S.error, S.couldNotSaveRecording);
    }
  }

  function handleDiscard() {
    Alert.alert(S.discardRecording, S.discardRecordingMessage, [
      { text: S.keepEditing, style: 'cancel' },
      {
        text: S.discard,
        style: 'destructive',
        onPress: async () => {
          let fileToDelete = resolvedFilePath;
          if (isLive) {
            const uri = await stopLiveRecording();
            fileToDelete = uri ?? '';
            setIsLive(false);
          }
          if (fileToDelete) {
            try { new File(fileToDelete).delete(); } catch (e) { console.warn('[Metadata] discard delete error:', e); }
          }
          router.replace('/');
        },
      },
    ]);
  }

  // ── Render ─────────────────────────────────────────────────────────────────────
  const inputStyle = [
    styles.input,
    { color: colors.text, borderColor: colors.icon + '55', backgroundColor: colors.background },
  ];
  const labelStyle = [styles.label, { color: colors.icon }];

  function renderField(field: FieldConfig, index: number) {
    const isFirst = index === 0;
    const spacedLabel = [labelStyle, !isFirst && styles.labelSpaced];

    if (field.isBuiltIn) {
      switch (field.key) {
        case 'name':
          return (
            <View key="name">
              <Text style={spacedLabel}>{field.label}</Text>
              <TextInput
                style={inputStyle}
                placeholder={S.placeholderUntitled}
                placeholderTextColor={colors.icon}
                value={name}
                onChangeText={setName}
                autoFocus={!focusedField || focusedField === 'name'}
                returnKeyType="next"
              />
            </View>
          );
        case 'ofAfter':
          return (
            <View key="ofAfter">
              <View style={[styles.prependBtns, !isFirst && styles.labelSpaced, styles.prependBtnsLabel]}>
                {(['efter', 'av', 'Trad.'] as const).map(word => (
                  <TouchableOpacity key={word} style={[styles.prependBtn, { borderColor: colors.text }]} onPress={() => prependToOfAfter(word)}>
                    <Text style={[styles.prependBtnText, { color: colors.text }]}>{word}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                ref={ofAfterRef}
                style={[inputStyle, ofAfterIsAuto && { color: colors.icon }]}
                placeholder={S.placeholderOfAfter}
                placeholderTextColor={colors.icon}
                value={ofAfter}
                onChangeText={t => { ofAfterLockedRef.current = true; setOfAfterIsAuto(false); setOfAfter(t); }}
                returnKeyType="next"
              />
            </View>
          );
        case 'origin':
          return (
            <View key="origin">
              <Text style={spacedLabel}>{field.label}</Text>
              <TextInput ref={originRef} style={inputStyle} placeholder={S.placeholderFrom}
                placeholderTextColor={colors.icon} value={origin}
                onChangeText={t => { originLockedRef.current = true; setOrigin(t); }} returnKeyType="next" />
            </View>
          );
        case 'songType':
          return (
            <View key="songType">
              <Text style={spacedLabel}>{field.label}</Text>
              <TextInput ref={songTypeRef} style={[inputStyle, songTypeIsAuto && { color: colors.icon }]}
                placeholder={S.placeholderSongType} placeholderTextColor={colors.icon} value={songType}
                onChangeText={t => { songTypeLockedRef.current = true; setSongTypeIsAuto(false); setSongType(t); }} returnKeyType="next" />
            </View>
          );
        case 'performer':
          return (
            <View key="performer">
              <Text style={spacedLabel}>{field.label}</Text>
              <TextInput ref={performerRef} style={inputStyle} placeholder={S.placeholderPerformer}
                placeholderTextColor={colors.icon} value={performer} onChangeText={setPerformer} returnKeyType="next" />
            </View>
          );
        case 'notes':
          return (
            <View key="notes">
              <Text style={spacedLabel}>{field.label}</Text>
              <TextInput ref={notesRef} style={[inputStyle, styles.notesInput]} placeholder={S.placeholderNotes}
                placeholderTextColor={colors.icon} value={notes} onChangeText={setNotes}
                multiline textAlignVertical="top" returnKeyType="default" blurOnSubmit />
            </View>
          );
        default: return null;
      }
    }

    // Custom field
    return (
      <View key={field.key}>
        <Text style={spacedLabel}>{field.label}</Text>
        <TextInput
          style={inputStyle}
          placeholderTextColor={colors.icon}
          value={customValues[field.key] || ''}
          onChangeText={v => setCustomValues(prev => ({ ...prev, [field.key]: v }))}
          returnKeyType="next"
        />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <TouchableOpacity onPress={() => router.push('/fields')} hitSlop={8} style={{ padding: 6 }}>
              <Ionicons name="create-outline" size={22} color={colors.text} />
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={[styles.flex, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* Live recording indicator */}
        {isLive && (
          <View style={[styles.liveIndicator, { borderColor: colors.icon + '33', backgroundColor: '#e5393511' }]}>
            <Animated.View style={[styles.liveDot, { transform: [{ scale: pulseAnim }] }]} />
            <Text style={[styles.liveTimer, { color: '#e53935' }]}>{formatTime(liveElapsed)}</Text>
          </View>
        )}

        {/* Dynamic fields */}
        {fieldConfigs.map((field, index) => renderField(field, isLive ? index + 1 : index))}

      </ScrollView>

      {/* Buttons fixed below scroll area — always visible, never hidden by keyboard */}
      <View style={[styles.buttons, { borderTopColor: colors.icon + '22' }]}>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: SAVE_COLOR }]}
          onPress={handleSave}
          disabled={saving}
        >
          <Ionicons name="checkmark" size={18} color="white" />
          <Text style={styles.btnSaveText}>{S.save}</Text>
        </TouchableOpacity>

        {isLive && (
          <TouchableOpacity
            style={[styles.btn, styles.btnStop, { borderColor: '#e53935' }]}
            onPress={handleStopRecording}
          >
            <Ionicons name="stop-circle-outline" size={18} color="#e53935" />
            <Text style={[styles.btnStopText]}>{S.stopRecordingBtn}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.btn, styles.btnDiscard, { borderColor: colors.icon + '66' }]}
          onPress={handleDiscard}
        >
          <Ionicons name="trash-outline" size={18} color={colors.icon} />
          <Text style={[styles.btnDiscardText, { color: colors.icon }]}>{S.discard}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 16 },

  // ── Live indicator ────────────────────────────────────────────────────────────
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
  },
  liveDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#e53935',
  },
  liveTimer: {
    fontSize: 18,
    fontWeight: '200',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },

  // ── Labels & inputs ───────────────────────────────────────────────────────────
  label: {
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  labelSpaced: { marginTop: 24 },

  prependBtns: { flexDirection: 'row', gap: 6 },
  prependBtnsLabel: { marginBottom: 8 },
  prependBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1.5 },
  prependBtnText: { fontSize: 13, fontWeight: '500' },

  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
  },
  notesInput: { minHeight: 100 },

  // ── Buttons ───────────────────────────────────────────────────────────────────
  buttons: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  btnSaveText: { color: 'white', fontSize: 16, fontWeight: '600' },
  btnStop: { borderWidth: 1 },
  btnStopText: { color: '#e53935', fontSize: 16, fontWeight: '500' },
  btnDiscard: { borderWidth: 1 },
  btnDiscardText: { fontSize: 16, fontWeight: '500' },
});
