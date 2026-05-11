import { Ionicons } from '@expo/vector-icons';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { File } from 'expo-file-system';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { deleteRecording, FieldConfig, getRecordingById, getVisibleFields, parseCustomData, Recording, updateRecording } from '@/lib/db';
import { S } from '@/lib/strings';

const SAVE_COLOR = '#00A878';

function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };
  return d.toLocaleDateString(undefined, opts);
}

export default function DetailScreen() {
  const { id, autoPlay, openEdit } = useLocalSearchParams<{ id: string; autoPlay?: string; openEdit?: string }>();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const [recording, setRecording] = useState<Recording | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Edit field state
  const [editName, setEditName] = useState('');
  const [editOfAfter, setEditOfAfter] = useState('');
  const [editOrigin, setEditOrigin] = useState('');
  const [editSongType, setEditSongType] = useState('');
  const [editPerformer, setEditPerformer] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editCustomValues, setEditCustomValues] = useState<Record<string, string>>({});
  const [fieldConfigs, setFieldConfigs] = useState<FieldConfig[]>([]);

  // Player state
  const soundRef = useRef<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const isSeekingRef = useRef(false);
  const wasPlayingRef = useRef(false);
  const hasFinishedRef = useRef(false);

  // Load recording and field config on mount
  useEffect(() => {
    setFieldConfigs(getVisibleFields());
    const r = getRecordingById(Number(id));
    setRecording(r);
    if (r) {
      setDurationMs(r.duration * 1000);
      if (openEdit === '1') {
        setEditName(r.name);
        setEditOfAfter(r.ofAfter);
        setEditOrigin(r.origin);
        setEditSongType(r.songType);
        setEditPerformer(r.performer);
        setEditNotes(r.notes);
        setEditCustomValues(parseCustomData(r.customData));
        setIsEditing(true);
      }
    }
  }, [id]);

  // Load audio when recording is ready
  useEffect(() => {
    if (!recording) return;
    let mounted = true;

    async function loadSound() {
      try {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
        const { sound } = await Audio.Sound.createAsync(
          { uri: recording!.filePath },
          { shouldPlay: autoPlay === '1' },
          (status: AVPlaybackStatus) => {
            if (!mounted || !status.isLoaded) return;
            if (!isSeekingRef.current) setPositionMs(status.positionMillis ?? 0);
            if (status.durationMillis) setDurationMs(status.durationMillis);
            setIsPlaying(status.isPlaying);
            if (status.didJustFinish) {
              hasFinishedRef.current = true;
              setIsPlaying(false);
              setPositionMs(0);
            }
          }
        );
        if (!mounted) { sound.unloadAsync().catch(() => {}); return; }
        soundRef.current = sound;
      } catch (e) {
        console.error('[Detail] loadSound error:', e);
        Alert.alert(S.playbackError, String(e));
      }
    }

    loadSound();

    return () => {
      mounted = false;
      soundRef.current?.unloadAsync().catch(e => console.log('[Detail] unload cleanup:', e));
      soundRef.current = null;
      setIsPlaying(false);
      setPositionMs(0);
    };
  }, [recording?.id]);

  // ── Player controls ────────────────────────────────────────────────────────

  async function togglePlay() {
    if (!soundRef.current) return;
    try {
      if (isPlaying) {
        await soundRef.current.pauseAsync();
      } else {
        if (hasFinishedRef.current || (durationMs > 0 && positionMs >= durationMs - 200)) {
          hasFinishedRef.current = false;
          await soundRef.current.setPositionAsync(0);
        }
        await soundRef.current.playAsync();
      }
    } catch (e) {
      console.error('[Detail] togglePlay error:', e);
      Alert.alert(S.playbackError, String(e));
    }
  }

  function onSeekStart() {
    isSeekingRef.current = true;
    wasPlayingRef.current = isPlaying;
    soundRef.current?.pauseAsync().catch(e => console.log('[Detail] pause during seek:', e));
  }

  async function onSeekComplete(value: number) {
    isSeekingRef.current = false;
    setPositionMs(value);
    try {
      await soundRef.current?.setPositionAsync(Math.round(value));
      if (wasPlayingRef.current) await soundRef.current?.playAsync();
    } catch (e) {
      console.error('[Detail] seek error:', e);
    }
  }

  // ── Edit mode ──────────────────────────────────────────────────────────────

  function startEditing() {
    if (!recording) return;
    setEditName(recording.name);
    setEditOfAfter(recording.ofAfter);
    setEditOrigin(recording.origin);
    setEditSongType(recording.songType);
    setEditPerformer(recording.performer);
    setEditNotes(recording.notes);
    setEditCustomValues(parseCustomData(recording.customData));
    setIsEditing(true);
  }

  function saveEditing() {
    if (!recording) return;
    try {
      updateRecording(recording.id, {
        name: editName.trim() || S.untitled,
        ofAfter: editOfAfter.trim(),
        origin: editOrigin.trim(),
        songType: editSongType.trim(),
        performer: editPerformer.trim(),
        notes: editNotes.trim(),
        customData: JSON.stringify(editCustomValues),
      });
      if (openEdit === '1') {
        router.back();
      } else {
        setRecording(getRecordingById(recording.id));
        setIsEditing(false);
      }
    } catch (e) {
      console.error('[Detail] saveEditing error:', e);
      Alert.alert(S.error, S.couldNotSaveChanges);
    }
  }

  function cancelEditing() {
    if (openEdit === '1') {
      router.back();
    } else {
      setIsEditing(false);
    }
  }

  function prependToEditOfAfter(word: string) {
    const prefix = word + ' ';
    setEditOfAfter(prev => {
      const stripped = prev.startsWith('efter ') ? prev.slice(6)
                     : prev.startsWith('av ') ? prev.slice(3)
                     : prev.startsWith('Trad. ') ? prev.slice(6)
                     : prev;
      return prefix + stripped;
    });
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  function handleDelete() {
    if (!recording) return;
    Alert.alert(
      S.deleteRecording,
      S.deleteRecordingMessage,
      [
        { text: S.cancel, style: 'cancel' },
        {
          text: S.delete,
          style: 'destructive',
          onPress: () => {
            try { new File(recording.filePath).delete(); } catch (e) { console.warn('[Detail] file delete error:', e); }
            try {
              deleteRecording(recording.id);
            } catch (e) {
              console.error('[Detail] DB delete error:', e);
              Alert.alert(S.error, S.couldNotDelete);
              return;
            }
            router.replace('/library');
          },
        },
      ]
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!recording) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.icon }}>{S.recordingNotFound}</Text>
      </View>
    );
  }

  const inputStyle = [
    styles.editInput,
    { color: colors.text, borderColor: colors.icon + '55', backgroundColor: colors.background },
  ];

  return (
    <>
      <Stack.Screen
        options={{
          title: isEditing ? S.editScreenTitle : (recording.name || S.recordingScreenTitle),
          headerRight: () => (
            <View style={styles.headerBtns}>
              {isEditing ? (
                <TouchableOpacity onPress={() => router.push('/fields')} style={styles.headerBtn} hitSlop={8}>
                  <Ionicons name="create-outline" size={22} color={colors.text} />
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity onPress={startEditing} style={styles.headerBtn} hitSlop={8}>
                    <Ionicons name="pencil-outline" size={22} color={colors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleDelete} style={styles.headerBtn} hitSlop={8}>
                    <Ionicons name="trash-outline" size={22} color="#e53935" />
                  </TouchableOpacity>
                </>
              )}
            </View>
          ),
        }}
      />

      <KeyboardAvoidingView
        style={[styles.flex, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Player ─────────────────────────────────────────────────────── */}
          <View style={[styles.player, { borderBottomColor: colors.icon + '28' }]}>
            <View style={styles.timeRow}>
              <Text style={[styles.timeText, { color: colors.icon }]}>{formatMs(positionMs)}</Text>
              <Text style={[styles.timeText, { color: colors.icon }]}>{formatMs(durationMs)}</Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={Math.max(durationMs, 1)}
              value={positionMs}
              minimumTrackTintColor={colors.text}
              maximumTrackTintColor={colors.icon + '44'}
              thumbTintColor={colors.text}
              onSlidingStart={onSeekStart}
              onSlidingComplete={onSeekComplete}
            />
            <TouchableOpacity onPress={togglePlay} style={styles.playBtn} activeOpacity={0.7}>
              <Ionicons
                name={isPlaying ? 'pause-circle' : 'play-circle'}
                size={68}
                color={colors.text}
              />
            </TouchableOpacity>
          </View>

          {/* ── Metadata display ───────────────────────────────────────────── */}
          {!isEditing ? (
            <View style={styles.section}>
              {/* Name heading */}
              <Text style={[styles.recordingTitle, { color: colors.text }]}>
                {recording.name || S.untitled}
              </Text>

              {/* Dynamic fields */}
              {fieldConfigs
                .filter(f => f.key !== 'name') // name shown as heading above
                .map(field => {
                  const customVals = parseCustomData(recording.customData);
                  const value = field.isBuiltIn
                    ? (recording as unknown as Record<string, string>)[field.key] || ''
                    : customVals[field.key] || '';
                  if (!value) return null;
                  return (
                    <View key={field.key} style={[styles.metaRow, { borderBottomColor: colors.icon + '22' }]}>
                      <Text style={[styles.metaLabel, { color: colors.icon }]}>{field.label}</Text>
                      <Text style={[styles.metaValue, { color: colors.text }]}>{value}</Text>
                    </View>
                  );
                })}

              {/* Recorded date always shown */}
              <View style={[styles.metaRow, { borderBottomColor: colors.icon + '22' }]}>
                <Text style={[styles.metaLabel, { color: colors.icon }]}>{S.fieldRecorded}</Text>
                <Text style={[styles.metaValue, { color: colors.text }]}>{formatDate(recording.createdAt)}</Text>
              </View>
            </View>
          ) : (
            /* ── Edit form ─────────────────────────────────────────────────── */
            <View style={styles.section}>
              {/* Dynamic edit fields */}
              {fieldConfigs.map(field => {
                if (field.isBuiltIn) {
                  if (field.key === 'name') return (
                    <View key="name" style={styles.editField}>
                      <Text style={[styles.editLabel, { color: colors.icon }]}>{S.fieldTitle}</Text>
                      <TextInput style={inputStyle} value={editName} onChangeText={setEditName} placeholderTextColor={colors.icon} />
                    </View>
                  );
                  if (field.key === 'ofAfter') return (
                    <View key="ofAfter" style={styles.editField}>
                      <View style={styles.shortcutRow}>
                        {(['efter', 'av', 'Trad.'] as const).map(word => (
                          <TouchableOpacity key={word} style={[styles.shortcutBtn, { borderColor: colors.text }]} onPress={() => prependToEditOfAfter(word)}>
                            <Text style={[styles.shortcutBtnText, { color: colors.text }]}>{word}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <TextInput style={inputStyle} value={editOfAfter} onChangeText={setEditOfAfter} placeholderTextColor={colors.icon} />
                    </View>
                  );
                  if (field.key === 'notes') return (
                    <View key="notes" style={styles.editField}>
                      <Text style={[styles.editLabel, { color: colors.icon }]}>{field.label}</Text>
                      <TextInput style={[inputStyle, styles.notesInput]} value={editNotes} onChangeText={setEditNotes}
                        multiline textAlignVertical="top" placeholderTextColor={colors.icon} />
                    </View>
                  );
                  // Remaining built-in text fields
                  const builtInMap: Record<string, [string, (v: string) => void]> = {
                    origin: [editOrigin, setEditOrigin],
                    songType: [editSongType, setEditSongType],
                    performer: [editPerformer, setEditPerformer],
                  };
                  const entry = builtInMap[field.key];
                  if (!entry) return null;
                  return (
                    <View key={field.key} style={styles.editField}>
                      <Text style={[styles.editLabel, { color: colors.icon }]}>{field.label}</Text>
                      <TextInput style={inputStyle} value={entry[0]} onChangeText={entry[1]} placeholderTextColor={colors.icon} />
                    </View>
                  );
                }
                // Custom field
                return (
                  <View key={field.key} style={styles.editField}>
                    <Text style={[styles.editLabel, { color: colors.icon }]}>{field.label}</Text>
                    <TextInput
                      style={inputStyle}
                      placeholderTextColor={colors.icon}
                      value={editCustomValues[field.key] || ''}
                      onChangeText={v => setEditCustomValues(prev => ({ ...prev, [field.key]: v }))}
                    />
                  </View>
                );
              })}

              <View style={styles.editActions}>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: SAVE_COLOR }]}
                  onPress={saveEditing}
                >
                  <Ionicons name="checkmark" size={18} color="white" />
                  <Text style={styles.actionBtnPrimaryText}>{S.save}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnSecondary, { borderColor: colors.icon + '66' }]}
                  onPress={cancelEditing}
                >
                  <Text style={[styles.actionBtnSecondaryText, { color: colors.icon }]}>{S.cancel}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 48 },

  // Header
  headerBtns: { flexDirection: 'row', gap: 4 },
  headerBtn: { padding: 6 },

  // Player
  player: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 2,
  },
  timeText: { fontSize: 13, fontVariant: ['tabular-nums'] },
  slider: { width: '100%', height: 40 },
  playBtn: { marginTop: 4 },

  // Metadata display
  section: { paddingHorizontal: 20 },
  recordingTitle: {
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 16,
    marginTop: 4,
  },
  metaRow: {
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  metaValue: { fontSize: 16 },

  // Edit form
  editField: { marginBottom: 18 },
  shortcutRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  shortcutBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  shortcutBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },
  editLabel: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  editInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
  },
  notesInput: { minHeight: 90 },
  editActions: { gap: 10, marginTop: 8 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  actionBtnSecondary: { borderWidth: 1 },
  actionBtnPrimaryText: { color: 'white', fontSize: 16, fontWeight: '600' },
  actionBtnSecondaryText: { fontSize: 16, fontWeight: '500' },
});
