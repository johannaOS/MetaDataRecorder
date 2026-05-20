import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { Audio } from 'expo-av';
import * as Sentry from '@sentry/react-native';
import { File } from 'expo-file-system';
import { hidePlaybackNotification, showPlaybackNotification } from '@/lib/backgroundRecording';
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

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { deleteRecording, getAllUniqueTags, getRecordingById, parseCustomData, parseTags, Recording, updateRecording } from '@/lib/db';
import { tagColor } from '@/lib/tagColors';
import { useFieldConfig } from '@/hooks/useFieldConfig';
import { saveAudioFile } from 'save-to-music';
import { generateSafeFilename } from '@/lib/filename';
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
  const { id, autoPlay, openEdit, playFrom } = useLocalSearchParams<{
    id: string; autoPlay?: string; openEdit?: string; playFrom?: string;
  }>();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  const [recording, setRecording] = useState<Recording | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [savingToPhone, setSavingToPhone] = useState(false);

  // Edit field state
  const [editName, setEditName] = useState('');
  const [editOfAfter, setEditOfAfter] = useState('');
  const [editOrigin, setEditOrigin] = useState('');
  const [editSongType, setEditSongType] = useState('');
  const [editPerformer, setEditPerformer] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editCustomValues, setEditCustomValues] = useState<Record<string, string>>({});
  const [editTags, setEditTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [allTags, setAllTags] = useState<string[]>([]);
  const [fieldConfigs] = useFieldConfig();

  // Player — expo-av Sound does not auto-pause on Activity.onPause(), enabling
  // true background playback when the screen locks or the app is switched.
  const soundRef = useRef<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs_live, setPositionMs] = useState(0);
  const [durationMs_loaded, setDurationMs] = useState(0);
  const [didJustFinish, setDidJustFinish] = useState(false);
  // During scrubbing use local state so the slider doesn't jump
  const [seekPositionMs, setSeekPositionMs] = useState<number | null>(null);
  const positionMs = seekPositionMs ?? positionMs_live;
  const durationMs = durationMs_loaded > 0
    ? durationMs_loaded
    : (recording?.duration ?? 0) * 1000;
  const isSeekingRef = useRef(false);
  const wasPlayingRef = useRef(false);
  const hasAutoPlayedRef = useRef(false);

  // Load recording on mount
  useEffect(() => {
    const r = getRecordingById(Number(id));
    setRecording(r);
    if (r) {
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

  // Create / recreate the Sound when the recording file changes.
  // expo-av Sound is unloaded and reloaded on each mount / filePath change.
  useEffect(() => {
    if (!recording?.filePath) return;
    hasAutoPlayedRef.current = false;
    setSeekPositionMs(null);
    setIsPlaying(false);
    setPositionMs(0);
    setDurationMs(0);
    setDidJustFinish(false);

    let mounted = true;
    let createdSound: Audio.Sound | null = null;

    (async () => {
      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri: recording.filePath },
          { progressUpdateIntervalMillis: 100 },
          (status) => {
            if (!mounted || !status.isLoaded) return;
            setIsPlaying(status.isPlaying);
            setPositionMs(status.positionMillis);
            setDurationMs(status.durationMillis ?? 0);
            setDidJustFinish(!!status.didJustFinish);
            if (status.didJustFinish) setIsPlaying(false);
          },
        );
        if (!mounted) { sound.unloadAsync().catch(() => {}); return; }
        createdSound = sound;
        soundRef.current = sound;

        // Auto-play or seek to handoff position once loaded
        if (!hasAutoPlayedRef.current) {
          hasAutoPlayedRef.current = true;
          if (playFrom && Number(playFrom) > 0) {
            await sound.setPositionAsync(Number(playFrom));
            sound.playAsync().catch(() => {});
          } else if (autoPlay === '1') {
            sound.playAsync().catch(() => {});
          }
        }
      } catch (e) {
        Sentry.captureException(e, { tags: { flow: 'createAsync', screen: 'detail' } });
        console.error('[Detail] createAsync error:', e);
      }
    })();

    return () => {
      mounted = false;
      createdSound?.unloadAsync().catch(() => {});
      soundRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording?.filePath]);

  // ── Background playback foreground service ────────────────────────────────
  // expo-av Sound does not auto-pause when the Activity pauses, so isPlaying
  // stays true during screen lock / app-switch. The debounce only fires when
  // the user genuinely pauses or the track finishes.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (isPlaying) {
      showPlaybackNotification(recording?.name ?? S.appTitle).catch(() => {});
    } else {
      timer = setTimeout(() => {
        hidePlaybackNotification().catch(() => {});
      }, 400);
    }
    return () => { if (timer) clearTimeout(timer); };
  }, [isPlaying, recording?.name]);

  // ── Player controls ────────────────────────────────────────────────────────

  async function togglePlay() {
    const sound = soundRef.current;
    if (!sound) return;
    try {
      if (isPlaying) {
        await sound.pauseAsync();
      } else {
        if (didJustFinish || (durationMs > 0 && positionMs >= durationMs - 200)) {
          await sound.setPositionAsync(0);
        }
        await sound.playAsync();
      }
    } catch (e) {
      Sentry.captureException(e, { tags: { flow: 'togglePlay', screen: 'detail' } });
      console.error('[Detail] togglePlay error:', e);
      Alert.alert(S.playbackError, String(e));
    }
  }

  async function onSeekStart(value: number) {
    isSeekingRef.current = true;
    wasPlayingRef.current = isPlaying;
    setSeekPositionMs(value);
    await soundRef.current?.pauseAsync().catch(() => {});
  }

  async function onSeekComplete(value: number) {
    isSeekingRef.current = false;
    try {
      await soundRef.current?.setPositionAsync(value);
      if (wasPlayingRef.current) await soundRef.current?.playAsync();
    } catch (e) {
      console.error('[Detail] seek error:', e);
    }
    setSeekPositionMs(null);
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
    setEditTags(parseTags(recording.tags));
    setAllTags(getAllUniqueTags());
    setTagInput('');
    setIsEditing(true);
  }

  function addTag(tag: string) {
    const t = tag.trim();
    if (!t || editTags.includes(t)) return;
    setEditTags(prev => [...prev, t]);
    setTagInput('');
  }

  function removeTag(tag: string) {
    setEditTags(prev => prev.filter(t => t !== tag));
  }

  async function handleSaveToPhone() {
    if (!recording || !recording.filePath.startsWith('file://')) return;
    setSavingToPhone(true);
    try {
      const displayName = generateSafeFilename(recording.name || S.untitled, []);
      const contentUri = await saveAudioFile(recording.filePath, displayName);
      if (!contentUri) throw new Error('saveAudioFile returned null');
      updateRecording(recording.id, { filePath: contentUri });
      setRecording(r => r ? { ...r, filePath: contentUri } : r);
      Alert.alert(S.savedToPhone, 'Music/VoiceRecorder/' + displayName);
    } catch (e) {
      Sentry.captureException(e, { tags: { flow: 'saveToPhone' } });
      Alert.alert(S.error, S.couldNotSaveRecording + '\n' + String(e));
    } finally {
      setSavingToPhone(false);
    }
  }

  async function handleShare() {
    if (!recording) return;
    const available = await Sharing.isAvailableAsync();
    if (!available) { Alert.alert(S.error, S.shareNotAvailable); return; }
    try {
      await Sharing.shareAsync(recording.filePath, { mimeType: 'audio/*' });
    } catch (e) {
      Sentry.captureException(e, { tags: { flow: 'shareAudio' } });
    }
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
        tags: JSON.stringify(editTags),
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
            router.back(); // pop Screen 4 → Screen 3
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
                  {/* Save to Music folder — only shown for recordings still in app documents */}
                  {recording.filePath.startsWith('file://') && (
                    <TouchableOpacity onPress={handleSaveToPhone} style={styles.headerBtn} hitSlop={8} disabled={savingToPhone}>
                      <Ionicons name="save-outline" size={22} color={colors.tint} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={handleShare} style={styles.headerBtn} hitSlop={8}>
                    <Ionicons name="share-outline" size={22} color={colors.text} />
                  </TouchableOpacity>
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
          contentContainerStyle={[styles.scroll, { paddingBottom: 48 + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Player ─────────────────────────────────────────────────────── */}
          <View style={[styles.player, { borderBottomColor: colors.icon + '28' }]}>
            {/* Time row — large centred time while scrubbing, start/end otherwise */}
            {seekPositionMs !== null ? (
              <Text style={[styles.seekTime, { color: colors.text }]}>{formatMs(positionMs)}</Text>
            ) : (
              <View style={styles.timeRow}>
                <Text style={[styles.timeText, { color: colors.icon }]}>{formatMs(positionMs)}</Text>
                <Text style={[styles.timeText, { color: colors.icon }]}>{formatMs(durationMs)}</Text>
              </View>
            )}
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={Math.max(durationMs, 1)}
              value={positionMs}
              minimumTrackTintColor={colors.text}
              maximumTrackTintColor={colors.icon + '44'}
              thumbTintColor={colors.text}
              onSlidingStart={onSeekStart}
              onValueChange={(v) => { if (seekPositionMs !== null) setSeekPositionMs(v); }}
              onSlidingComplete={onSeekComplete}
            />
            {/* Controls row: skip back · play/pause · skip forward */}
            <View style={styles.controls}>
              <TouchableOpacity
                onPress={() => soundRef.current?.setPositionAsync(Math.max(0, positionMs - 5000)).catch(() => {})}
                hitSlop={12}
                activeOpacity={0.6}
              >
                <MaterialIcons name="replay-5" size={34} color={colors.icon} />
              </TouchableOpacity>
              <TouchableOpacity onPress={togglePlay} style={styles.playBtn} activeOpacity={0.7}>
                <Ionicons name={isPlaying ? 'pause-circle' : 'play-circle'} size={68} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => soundRef.current?.setPositionAsync(Math.min(durationMs, positionMs + 5000)).catch(() => {})}
                hitSlop={12}
                activeOpacity={0.6}
              >
                <MaterialIcons name="forward-5" size={34} color={colors.icon} />
              </TouchableOpacity>
            </View>
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

              {/* Tags section */}
              {parseTags(recording.tags).length > 0 && (
                <View style={[styles.metaRow, { borderBottomColor: colors.icon + '22', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }]}>
                  <Text style={[styles.metaLabel, { color: colors.icon }]}>{S.tagsLabel}</Text>
                  <View style={styles.tagsRow}>
                    {parseTags(recording.tags).map(tag => {
                      const tc = tagColor(tag);
                      return (
                        <View key={tag} style={[styles.tag, { backgroundColor: tc.bg }]}>
                          <Text style={[styles.tagText, { color: tc.text }]}>{tag}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}
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

              {/* Tags editing */}
              <View style={styles.editField}>
                <Text style={[styles.editLabel, { color: colors.icon }]}>{S.tagsLabel}</Text>
                <View style={styles.tagsRow}>
                  {editTags.map(tag => {
                    const tc = tagColor(tag);
                    return (
                      <TouchableOpacity key={tag} onPress={() => removeTag(tag)}
                        style={[styles.tag, styles.tagRemovable, { backgroundColor: tc.bg }]}>
                        <Text style={[styles.tagText, { color: tc.text }]}>{tag} ✕</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {/* Suggestions from existing tags */}
                {allTags.filter(t => !editTags.includes(t)).length > 0 && (
                  <View style={styles.tagsRow}>
                    {allTags.filter(t => !editTags.includes(t)).map(tag => {
                      const tc = tagColor(tag);
                      return (
                        <TouchableOpacity key={tag} onPress={() => addTag(tag)}
                          style={[styles.tag, { backgroundColor: tc.bg + '88' }]}>
                          <Text style={[styles.tagText, { color: tc.text }]}>+ {tag}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
                <TextInput
                  style={[styles.editInput, { color: colors.text, borderColor: colors.icon + '55', backgroundColor: colors.background }]}
                  placeholder={S.addTagPlaceholder}
                  placeholderTextColor={colors.icon}
                  value={tagInput}
                  onChangeText={setTagInput}
                  onSubmitEditing={() => addTag(tagInput)}
                  returnKeyType="done"
                  blurOnSubmit={false}
                />
              </View>

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
  scroll: {},

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
  seekTime: {
    fontSize: 28,
    fontWeight: '200',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    marginBottom: 2,
  },
  slider: { width: '100%', height: 52 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    marginTop: 4,
  },
  playBtn: {},
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    marginBottom: 4,
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  tagRemovable: {},
  tagText: { fontSize: 13, fontWeight: '500' },

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
