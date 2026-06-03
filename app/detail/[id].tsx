import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { Audio } from 'expo-av';
import * as Sentry from '@sentry/react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { cacheDirectory, copyAsync, deleteAsync } from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { hidePlaybackNotification, showPlaybackNotification } from '@/lib/backgroundRecording';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
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
import { Attachment, Bookmark, deleteAttachment, deleteBookmark, deleteRecording, getAllKeywords, getAllUniqueTags, getAttachmentsByRecording, getBookmarksByRecording, getRecordingById, insertAttachment, insertBookmark, Keyword, parseCustomData, parseTags, Recording, updateBookmarkLabel, updateRecording } from '@/lib/db';
import { tagColor } from '@/lib/tagColors';
import { useFieldConfig } from '@/hooks/useFieldConfig';
import { saveAudioFile } from 'save-to-music';
import { generateSafeFilename } from '@/lib/filename';
import { S } from '@/lib/strings';

const SAVE_COLOR = '#00A878';

// ── Waveform constants ────────────────────────────────────────────────────────
const WAVEFORM_BARS = 200;
const BAR_W = 4;
const BAR_GAP = 2;
const WAVEFORM_TOTAL_W = WAVEFORM_BARS * (BAR_W + BAR_GAP); // 1200
const WAVEFORM_H = 100;
const WAVEFORM_BAR_MAX = 46;
const WAVEFORM_BAR_MIN = 4;

function generateWaveformBars(seed: number): number[] {
  const bars: number[] = [];
  let s = (Math.abs(seed) || 1) >>> 0;
  for (let i = 0; i < WAVEFORM_BARS; i++) {
    s = Math.imul(s, 1664525) + 1013904223 >>> 0;
    bars.push(WAVEFORM_BAR_MIN + (s / 0xffffffff) * (WAVEFORM_BAR_MAX - WAVEFORM_BAR_MIN));
  }
  return bars;
}

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
  const toastAnim = useRef(new Animated.Value(0)).current;

  function showToast() {
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(2000),
      Animated.timing(toastAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }

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
  const [allKeywords, setAllKeywords] = useState<Keyword[]>([]);
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

  const [playbackRate, setPlaybackRate] = useState(1.0);
  const playbackRateRef = useRef(1.0);
  const [showSpeedPanel, setShowSpeedPanel] = useState(false);

  const waveformBars = useMemo(
    () => generateWaveformBars(recording?.id ?? 1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recording?.id],
  );

  // Bookmarks + A/B loop
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const loopARef = useRef<number | null>(null);
  const loopBRef = useRef<number | null>(null);
  const [waveformContainerWidth, setWaveformContainerWidth] = useState(0);
  const waveformScrollRef = useRef<ScrollView>(null);
  const [showBookmarkList, setShowBookmarkList] = useState(false);
  const [renamingBookmark, setRenamingBookmark] = useState<Bookmark | null>(null);
  const [renameLabel, setRenameLabel] = useState('');

  // Attachments
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

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
        setEditTags(parseTags(r.tags));
        setAllTags(getAllUniqueTags());
        setAllKeywords(getAllKeywords());
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
    playbackRateRef.current = 1.0;
    setPlaybackRate(1.0);
    loopARef.current = null; loopBRef.current = null;
    setLoopA(null); setLoopB(null);
    setBookmarks(getBookmarksByRecording(Number(id)));
    setAttachments(getAttachmentsByRecording(Number(id)));

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
            // A/B loop — seek back to A when position reaches B
            const a = loopARef.current; const b = loopBRef.current;
            if (status.isPlaying && a !== null && b !== null && b > a && status.positionMillis >= b) {
              soundRef.current?.setPositionAsync(a).catch(() => {});
            }
          },
        );
        if (!mounted) { sound.unloadAsync().catch(() => {}); return; }
        createdSound = sound;
        soundRef.current = sound;

        if (playbackRateRef.current !== 1.0) {
          await sound.setStatusAsync({ rate: playbackRateRef.current, shouldCorrectPitch: true }).catch(() => {});
        }

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

  function applyRate(rate: number) {
    const r = Math.round(rate * 100) / 100;
    playbackRateRef.current = r;
    setPlaybackRate(r);
    soundRef.current?.setStatusAsync({ rate: r, shouldCorrectPitch: true }).catch((e) => {
      console.error('[Detail] setRate error:', e);
    });
  }

  // Scroll waveform so playhead stays centered
  useEffect(() => {
    if (!waveformScrollRef.current || durationMs === 0 || waveformContainerWidth === 0) return;
    const x = Math.max(0, (positionMs_live / durationMs) * WAVEFORM_TOTAL_W - waveformContainerWidth / 2);
    waveformScrollRef.current.scrollTo({ x, animated: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionMs_live, durationMs, waveformContainerWidth]);

  function reloadBookmarks() {
    setBookmarks(getBookmarksByRecording(Number(id)));
  }

  function handleAddBookmark() {
    if (!recording) return;
    const label = formatMs(positionMs_live);
    const result = insertBookmark(recording.id, positionMs_live, label);
    if (result === null) {
      Alert.alert(S.error, 'Max 50 bookmarks per recording.');
      return;
    }
    reloadBookmarks();
  }

  function handleDeleteBookmark(bmId: number) {
    deleteBookmark(bmId);
    reloadBookmarks();
  }

  function handleRenameBookmark() {
    if (!renamingBookmark) return;
    const label = renameLabel.trim();
    if (label) updateBookmarkLabel(renamingBookmark.id, label);
    setRenamingBookmark(null);
    reloadBookmarks();
  }

  function reloadAttachments() {
    if (recording) setAttachments(getAttachmentsByRecording(recording.id));
  }

  async function handlePickImage() {
    if (!recording) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Behörighet saknas', 'Tillåt åtkomst till foton i inställningarna.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, copyToCacheDirectory: true });
      if (result.canceled) return;
      const asset = result.assets[0];
      const fileName = asset.uri.split('/').pop() ?? 'image.jpg';
      const dest = (cacheDirectory ?? '') + fileName;
      await copyAsync({ from: asset.uri, to: dest });
      const finalUri = await (await import('@/lib/saveRecording')).copyToPermanentStorage(dest, fileName.replace(/\.[^.]+$/, ''));
      insertAttachment(recording.id, 'image', finalUri, fileName);
      reloadAttachments();
    } catch (e) {
      Sentry.captureException(e, { tags: { flow: 'pickImage' } });
      Alert.alert(S.error, String(e));
    }
  }

  async function handlePickPdf() {
    if (!recording) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
      if (result.canceled) return;
      const asset = result.assets[0];
      const fileName = asset.name ?? 'document.pdf';
      const finalUri = await (await import('@/lib/saveRecording')).copyToPermanentStorage(asset.uri, fileName.replace(/\.[^.]+$/, ''));
      insertAttachment(recording.id, 'pdf', finalUri, fileName);
      reloadAttachments();
    } catch (e) {
      Sentry.captureException(e, { tags: { flow: 'pickPdf' } });
      Alert.alert(S.error, String(e));
    }
  }

  function handleDeleteAttachment(att: Attachment) {
    Alert.alert(att.file_name, 'Ta bort bilaga?', [
      { text: S.cancel, style: 'cancel' },
      { text: S.delete, style: 'destructive', onPress: () => {
        try { new File(att.uri).delete(); } catch {}
        deleteAttachment(att.id);
        reloadAttachments();
      }},
    ]);
  }

  function setLoop(point: 'A' | 'B', posMs: number) {
    if (point === 'A') { loopARef.current = posMs; setLoopA(posMs); }
    else               { loopBRef.current = posMs; setLoopB(posMs); }
  }

  function clearLoop(point: 'A' | 'B' | 'both') {
    if (point !== 'B') { loopARef.current = null; setLoopA(null); }
    if (point !== 'A') { loopBRef.current = null; setLoopB(null); }
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
    setAllKeywords(getAllKeywords());
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
    let tmpUri: string | null = null;
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) { Alert.alert(S.error, S.shareNotAvailable); return; }

      let uri = recording.filePath;
      if (uri.startsWith('content://')) {
        // expo-sharing only accepts file:// URIs — copy to cache first under the recording's own name
        const ext = uri.replace(/\?.*$/, '').match(/\.([a-z0-9]+)$/i)?.[1] ?? 'm4a';
        const safeName = (recording.name || 'Inspelning').trim()
          .replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-åäöÅÄÖ]/g, '') || 'Inspelning';
        tmpUri = `${cacheDirectory}${safeName}.${ext}`;
        await copyAsync({ from: uri, to: tmpUri });
        uri = tmpUri;
      }

      await Sharing.shareAsync(uri, { mimeType: 'audio/*' });
      showToast();
    } catch (e) {
      Sentry.captureException(e, { tags: { flow: 'shareAudio' } });
      Alert.alert(S.error, String(e));
    } finally {
      if (tmpUri) deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
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

            {/* Large time + total duration */}
            <Text style={[styles.seekTime, { color: colors.text }]}>{formatMs(positionMs)}</Text>
            <Text style={[styles.timeText, { color: colors.icon }]}>{formatMs(durationMs)}</Text>

            {/* ── ABOVE WAVEFORM: bookmark list (left) + add bookmark (right) ── */}
            <View style={styles.aboveWaveRow}>
              <TouchableOpacity onPress={() => setShowBookmarkList(true)} hitSlop={12} activeOpacity={0.7}>
                <Ionicons name="bookmark" size={22} color={bookmarks.length > 0 ? colors.tint : colors.icon + '66'} />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleAddBookmark} hitSlop={12} activeOpacity={0.7}>
                <Ionicons name="bookmark-outline" size={22} color={colors.icon} />
              </TouchableOpacity>
            </View>

            {/* ── WAVEFORM ──────────────────────────────────────────────────── */}
            <View
              style={styles.waveformContainer}
              onLayout={e => setWaveformContainerWidth(e.nativeEvent.layout.width)}
            >
              {/* Bars — programmatically scrolled, user scroll disabled */}
              <ScrollView
                ref={waveformScrollRef}
                horizontal
                scrollEnabled={false}
                showsHorizontalScrollIndicator={false}
                style={StyleSheet.absoluteFill}
                contentContainerStyle={{ paddingHorizontal: waveformContainerWidth / 2 }}
              >
                <View style={styles.waveformInner}>
                  {waveformBars.map((h, i) => {
                    const played = durationMs > 0 && (positionMs_live / durationMs) * WAVEFORM_BARS > i;
                    return (
                      <View
                        key={i}
                        style={[styles.waveBar, {
                          height: h,
                          backgroundColor: played ? colors.text : colors.icon + '44',
                        }]}
                      />
                    );
                  })}
                </View>
              </ScrollView>

              {/* Fixed centre playhead */}
              <View style={styles.wavePlayhead} pointerEvents="none" />

              {/* Bookmark markers */}
              {durationMs > 0 && bookmarks.map((bm, idx) => {
                const x = (bm.position_ms / durationMs) * WAVEFORM_TOTAL_W
                        - Math.max(0, (positionMs_live / durationMs) * WAVEFORM_TOTAL_W - waveformContainerWidth / 2)
                        + waveformContainerWidth / 2 - (bm.position_ms / durationMs) * WAVEFORM_TOTAL_W
                        + (bm.position_ms / durationMs) * WAVEFORM_TOTAL_W
                        - Math.max(0, (positionMs_live / durationMs) * WAVEFORM_TOTAL_W - waveformContainerWidth / 2);
                // Simplify: markerX = barXInContent - scrollOffset, displayed within container
                const scrollOff = Math.max(0, (positionMs_live / durationMs) * WAVEFORM_TOTAL_W - waveformContainerWidth / 2);
                const barX = (bm.position_ms / durationMs) * WAVEFORM_TOTAL_W + waveformContainerWidth / 2;
                const screenX = barX - scrollOff;
                if (screenX < -16 || screenX > waveformContainerWidth + 16) return null;
                return (
                  <TouchableOpacity
                    key={bm.id}
                    style={[styles.waveMarker, { left: screenX }]}
                    onPress={() => onSeekComplete(bm.position_ms)}
                    onLongPress={() => Alert.alert(bm.label, undefined, [
                      { text: S.cancel, style: 'cancel' },
                      { text: 'Byt namn', onPress: () => { setRenameLabel(bm.label); setRenamingBookmark(bm); } },
                      { text: 'Sätt som A', onPress: () => setLoop('A', bm.position_ms) },
                      { text: 'Sätt som B', onPress: () => setLoop('B', bm.position_ms) },
                      { text: S.delete, style: 'destructive', onPress: () => handleDeleteBookmark(bm.id) },
                    ])}
                    hitSlop={10}
                  >
                    <Text style={[styles.waveMarkerLabel, { color: colors.tint }]}>{idx + 1}</Text>
                    <View style={[styles.waveMarkerTick, { backgroundColor: colors.tint }]} />
                  </TouchableOpacity>
                );
              })}

              {/* A/B markers */}
              {durationMs > 0 && [
                { pos: loopA, label: 'A', color: '#00A878', onLp: () => clearLoop('A') },
                { pos: loopB, label: 'B', color: '#e53935', onLp: () => clearLoop('B') },
              ].map(({ pos, label, color, onLp }) => {
                if (pos === null) return null;
                const scrollOff = Math.max(0, (positionMs_live / durationMs) * WAVEFORM_TOTAL_W - waveformContainerWidth / 2);
                const screenX = (pos / durationMs) * WAVEFORM_TOTAL_W + waveformContainerWidth / 2 - scrollOff;
                if (screenX < -16 || screenX > waveformContainerWidth + 16) return null;
                return (
                  <TouchableOpacity
                    key={label}
                    style={[styles.waveMarker, { left: screenX }]}
                    onPress={() => onSeekComplete(pos)}
                    onLongPress={onLp}
                    hitSlop={10}
                  >
                    <Text style={[styles.waveMarkerLabel, { color }]}>{label}</Text>
                    <View style={[styles.waveMarkerTick, { backgroundColor: color }]} />
                  </TouchableOpacity>
                );
              })}

              {/* Invisible slider overlay for touch-to-seek */}
              <Slider
                style={[StyleSheet.absoluteFill, { opacity: 0 }]}
                minimumValue={0}
                maximumValue={Math.max(durationMs, 1)}
                value={positionMs}
                onSlidingStart={onSeekStart}
                onValueChange={v => { if (seekPositionMs !== null) setSeekPositionMs(v); }}
                onSlidingComplete={onSeekComplete}
              />
            </View>

            {/* ── BELOW WAVEFORM: A/B loop + Speed ────────────────────────── */}
            <View style={styles.belowWaveRow}>
              {/* A/B compound button */}
              <TouchableOpacity
                style={[styles.belowBtn, {
                  borderColor: (loopA !== null || loopB !== null) ? colors.tint : colors.icon + '33',
                  backgroundColor: (loopA !== null && loopB !== null) ? colors.tint + '14' : 'transparent',
                }]}
                onPress={() => {
                  if (loopA === null) setLoop('A', positionMs_live);
                  else if (loopB === null) setLoop('B', positionMs_live);
                  else clearLoop('both');
                }}
                onLongPress={() => clearLoop('both')}
                hitSlop={8}
              >
                <View style={styles.abIconWrap}>
                  <Ionicons name="repeat" size={22} color={(loopA !== null || loopB !== null) ? colors.tint : colors.icon} />
                  <Text style={[styles.abOverlay, { color: (loopA !== null || loopB !== null) ? colors.tint : colors.icon }]}>AB</Text>
                </View>
                <Text style={[styles.belowBtnLabel, { color: (loopA !== null || loopB !== null) ? colors.tint : colors.icon }]}>
                  {loopA !== null && loopB !== null
                    ? `${formatMs(loopA)}–${formatMs(loopB)}`
                    : loopA !== null ? `A ${formatMs(loopA)}`
                    : 'A/B-loop'}
                </Text>
              </TouchableOpacity>

              {/* Speed button */}
              <TouchableOpacity
                style={[styles.belowBtn, {
                  borderColor: playbackRate !== 1.0 ? colors.tint : colors.icon + '33',
                }]}
                onPress={() => setShowSpeedPanel(v => !v)}
                hitSlop={8}
              >
                <Text style={[styles.belowBtnValue, { color: playbackRate !== 1.0 ? colors.tint : colors.text }]}>
                  ×{(Math.round(playbackRate * 100) / 100).toFixed(2).replace(/\.?0+$/, '')}
                </Text>
                <Text style={[styles.belowBtnLabel, { color: colors.icon }]}>Hastighet</Text>
              </TouchableOpacity>
            </View>

            {/* Speed panel (expandable) */}
            {showSpeedPanel && (
              <View style={[styles.speedPanel, { borderTopColor: colors.icon + '22' }]}>
                <View style={styles.speedPresets}>
                  {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map(r => (
                    <TouchableOpacity
                      key={r}
                      style={[styles.speedPreset, { borderColor: colors.icon + '44' },
                        playbackRate === r && { backgroundColor: colors.tint + '22', borderColor: colors.tint }]}
                      onPress={() => applyRate(r)}
                    >
                      <Text style={[styles.speedPresetText, { color: playbackRate === r ? colors.tint : colors.text }]}>
                        ×{r % 1 === 0 ? r.toFixed(0) : r}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.speedSliderRow}>
                  <TouchableOpacity
                    style={[styles.speedStepBtn, { borderColor: colors.icon + '44', opacity: playbackRate <= 0.5 ? 0.3 : 1 }]}
                    onPress={() => applyRate(Math.max(0.5, playbackRate - 0.05))}
                    disabled={playbackRate <= 0.5}
                  >
                    <Text style={[styles.speedStepText, { color: colors.text }]}>−</Text>
                  </TouchableOpacity>
                  <Slider
                    style={styles.speedSlider}
                    minimumValue={0.5}
                    maximumValue={2.0}
                    step={0.01}
                    value={playbackRate}
                    minimumTrackTintColor={colors.tint}
                    maximumTrackTintColor={colors.icon + '44'}
                    thumbTintColor={colors.text}
                    onSlidingComplete={applyRate}
                  />
                  <TouchableOpacity
                    style={[styles.speedStepBtn, { borderColor: colors.icon + '44', opacity: playbackRate >= 2.0 ? 0.3 : 1 }]}
                    onPress={() => applyRate(Math.min(2.0, playbackRate + 0.05))}
                    disabled={playbackRate >= 2.0}
                  >
                    <Text style={[styles.speedStepText, { color: colors.text }]}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* ── TRANSPORT: skip-5 · play/pause · skip+5 ──────────────────── */}
            <View style={styles.transportRow}>
              <TouchableOpacity
                onPress={() => soundRef.current?.setPositionAsync(Math.max(0, positionMs - 5000)).catch(() => {})}
                hitSlop={12} activeOpacity={0.6}
              >
                <MaterialIcons name="replay-5" size={36} color={colors.icon} />
              </TouchableOpacity>
              <TouchableOpacity onPress={togglePlay} activeOpacity={0.7}>
                <Ionicons name={isPlaying ? 'pause-circle' : 'play-circle'} size={72} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => soundRef.current?.setPositionAsync(Math.min(durationMs, positionMs + 5000)).catch(() => {})}
                hitSlop={12} activeOpacity={0.6}
              >
                <MaterialIcons name="forward-5" size={36} color={colors.icon} />
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

              {/* Attachments section */}
              <View style={[styles.metaRow, { borderBottomColor: colors.icon + '22', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }]}>
                <Text style={[styles.metaLabel, { color: colors.icon }]}>Bilagor</Text>

                {/* Images */}
                {attachments.filter(a => a.type === 'image').length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {attachments.filter(a => a.type === 'image').map(att => (
                      <TouchableOpacity
                        key={att.id}
                        onPress={() => setPreviewImage(att.uri)}
                        onLongPress={() => handleDeleteAttachment(att)}
                        activeOpacity={0.8}
                      >
                        <Image source={{ uri: att.uri }} style={styles.attachmentThumb} />
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}

                {/* PDFs */}
                {attachments.filter(a => a.type === 'pdf').map(att => (
                  <TouchableOpacity
                    key={att.id}
                    style={[styles.pdfChip, { borderColor: colors.icon + '44', backgroundColor: colors.icon + '10' }]}
                    onPress={() => Linking.openURL(att.uri).catch(() => Sharing.shareAsync(att.uri, { mimeType: 'application/pdf' }))}
                    onLongPress={() => handleDeleteAttachment(att)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="document-text-outline" size={18} color={colors.tint} />
                    <Text style={[styles.pdfChipText, { color: colors.text }]} numberOfLines={1}>{att.file_name}</Text>
                  </TouchableOpacity>
                ))}

                {/* Add buttons */}
                <View style={styles.attachAddRow}>
                  <TouchableOpacity
                    style={[styles.attachAddBtn, { borderColor: colors.icon + '44' }]}
                    onPress={handlePickImage}
                  >
                    <Ionicons name="image-outline" size={18} color={colors.tint} />
                    <Text style={[styles.attachAddText, { color: colors.tint }]}>Foto</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.attachAddBtn, { borderColor: colors.icon + '44' }]}
                    onPress={handlePickPdf}
                  >
                    <Ionicons name="document-outline" size={18} color={colors.tint} />
                    <Text style={[styles.attachAddText, { color: colors.tint }]}>PDF</Text>
                  </TouchableOpacity>
                </View>
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
                  // Song type — same text input but with keyword chips above
                  if (field.key === 'songType') return (
                    <View key="songType" style={styles.editField}>
                      <Text style={[styles.editLabel, { color: colors.icon }]}>{field.label}</Text>
                      {allKeywords.length > 0 && (
                        <View style={[styles.shortcutRow, { marginBottom: 8 }]}>
                          {allKeywords.map(kw => (
                            <TouchableOpacity
                              key={kw.id}
                              style={[styles.shortcutBtn, editSongType === kw.label
                                ? { borderColor: colors.tint, backgroundColor: colors.tint + '18' }
                                : { borderColor: colors.text }]}
                              onPress={() => setEditSongType(kw.label)}
                            >
                              <Text style={[styles.shortcutBtnText, { color: editSongType === kw.label ? colors.tint : colors.text }]}>{kw.label}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                      <TextInput style={inputStyle} value={editSongType} onChangeText={setEditSongType} placeholderTextColor={colors.icon} />
                    </View>
                  );
                  // Remaining built-in text fields
                  const builtInMap: Record<string, [string, (v: string) => void]> = {
                    origin: [editOrigin, setEditOrigin],
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
                {/* Suggestions — horizontal scroll handles many tags without layout explosion */}
                {allTags.filter(t => !editTags.includes(t)).length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}
                    style={{ marginBottom: 6 }}
                    contentContainerStyle={{ gap: 6, paddingRight: 8 }}>
                    {allTags.filter(t => !editTags.includes(t)).map(tag => {
                      const tc = tagColor(tag);
                      return (
                        <TouchableOpacity key={tag} onPress={() => addTag(tag)}
                          style={[styles.tag, { backgroundColor: tc.bg + '88' }]}>
                          <Text style={[styles.tagText, { color: tc.text }]}>+ {tag}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
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

      {/* Bookmark list modal */}
      <Modal visible={showBookmarkList} transparent animationType="slide" onRequestClose={() => setShowBookmarkList(false)}>
        <TouchableOpacity style={styles.overlayDismiss} activeOpacity={1} onPress={() => setShowBookmarkList(false)}>
          <TouchableOpacity
            style={[styles.bookmarkSheet, { backgroundColor: colors.background, paddingBottom: 16 + insets.bottom }]}
            activeOpacity={1} onPress={() => {}}
          >
            <Text style={[styles.bookmarkSheetTitle, { color: colors.icon, borderBottomColor: colors.icon + '33' }]}>
              Bokmärken
            </Text>
            {bookmarks.length === 0 ? (
              <Text style={[styles.bookmarkEmpty, { color: colors.icon }]}>Inga bokmärken ännu</Text>
            ) : (
              bookmarks.map((bm, idx) => (
                <TouchableOpacity
                  key={bm.id}
                  style={[styles.bookmarkRow, { borderBottomColor: colors.icon + '22' }]}
                  onPress={() => { setShowBookmarkList(false); onSeekComplete(bm.position_ms); }}
                  onLongPress={() => {
                    setShowBookmarkList(false);
                    Alert.alert(bm.label, undefined, [
                      { text: S.cancel, style: 'cancel' },
                      { text: 'Byt namn', onPress: () => { setRenameLabel(bm.label); setRenamingBookmark(bm); } },
                      { text: S.delete, style: 'destructive', onPress: () => handleDeleteBookmark(bm.id) },
                    ]);
                  }}
                >
                  <Text style={[styles.bookmarkRowNum, { color: colors.tint }]}>{idx + 1}</Text>
                  <Text style={[styles.bookmarkRowLabel, { color: colors.text }]}>{bm.label}</Text>
                  <Text style={[styles.bookmarkRowTime, { color: colors.icon }]}>{formatMs(bm.position_ms)}</Text>
                </TouchableOpacity>
              ))
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Image preview modal */}
      <Modal visible={previewImage !== null} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <TouchableOpacity style={styles.previewOverlay} activeOpacity={1} onPress={() => setPreviewImage(null)}>
          {previewImage && (
            <Image source={{ uri: previewImage }} style={styles.previewImage} resizeMode="contain" />
          )}
        </TouchableOpacity>
      </Modal>

      {/* Rename bookmark modal */}
      {renamingBookmark !== null && (
        <View style={[styles.renameOverlay]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setRenamingBookmark(null)} />
          <View style={[styles.renameBox, { backgroundColor: colors.background }]}>
            <Text style={[styles.renameTitle, { color: colors.text }]}>Byt namn</Text>
            <TextInput
              style={[styles.renameInput, { color: colors.text, borderColor: colors.icon + '55', backgroundColor: colors.background }]}
              value={renameLabel}
              onChangeText={setRenameLabel}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleRenameBookmark}
            />
            <View style={styles.renameButtons}>
              <TouchableOpacity style={[styles.renameBtn, { borderColor: colors.icon + '55' }]} onPress={() => setRenamingBookmark(null)}>
                <Text style={[styles.renameBtnText, { color: colors.icon }]}>{S.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.renameBtn, { backgroundColor: colors.tint }]} onPress={handleRenameBookmark}>
                <Text style={[styles.renameBtnText, { color: 'white' }]}>{S.save}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Share toast — fades in/out after share sheet closes */}
      <Animated.View
        style={[styles.toast, { opacity: toastAnim, bottom: 32 + insets.bottom }]}
        pointerEvents="none"
      >
        <Text style={styles.toastText}>{S.fileShared}</Text>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {},

  // Header
  headerBtns: { flexDirection: 'row', gap: 4 },
  headerBtn: { padding: 10 },

  // Player
  player: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
    gap: 8,
  },
  seekTime: {
    fontSize: 48,
    fontWeight: '200',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  timeText: { fontSize: 13, fontVariant: ['tabular-nums'] },

  // Above waveform
  aboveWaveRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },

  // Waveform
  waveformContainer: {
    width: '100%',
    height: WAVEFORM_H,
    overflow: 'hidden',
    position: 'relative',
  },
  waveformInner: {
    flexDirection: 'row',
    alignItems: 'center',
    height: WAVEFORM_H,
    gap: BAR_GAP,
  },
  waveBar: { width: BAR_W, borderRadius: 2 },
  wavePlayhead: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    left: '50%',
    marginLeft: -1,
    backgroundColor: '#e53935',
  },
  waveMarker: {
    position: 'absolute',
    bottom: 0,
    alignItems: 'center',
    transform: [{ translateX: -5 }],
  },
  waveMarkerLabel: { fontSize: 9, fontWeight: '800', lineHeight: 11 },
  waveMarkerTick: { width: 2, height: 14, borderRadius: 1 },

  // Below waveform
  belowWaveRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  belowBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 3,
  },
  belowBtnValue: {
    fontSize: 20,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
  },
  belowBtnLabel: { fontSize: 11, fontWeight: '500' },
  abIconWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center', width: 24, height: 24 },
  abOverlay: { position: 'absolute', fontSize: 6, fontWeight: '800', letterSpacing: 0.5 },

  // Transport row
  transportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    width: '100%',
  },
  playBtn: {},

  // Bookmark list sheet
  overlayDismiss: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  bookmarkSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
  },
  bookmarkSheetTitle: {
    fontSize: 13,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bookmarkEmpty: { textAlign: 'center', paddingVertical: 24, fontSize: 15 },
  bookmarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bookmarkRowNum: { fontSize: 14, fontWeight: '700', width: 20, textAlign: 'center' },
  bookmarkRowLabel: { flex: 1, fontSize: 15 },
  bookmarkRowTime: { fontSize: 13, fontVariant: ['tabular-nums'] },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    marginBottom: 4,
  },
  tag: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
  },
  tagRemovable: {},
  tagText: { fontSize: 14, fontWeight: '500' },

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
    fontSize: 12,
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
    paddingVertical: 9,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  shortcutBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },
  editLabel: {
    fontSize: 12,
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
    paddingVertical: 16,
    borderRadius: 12,
  },
  actionBtnSecondary: { borderWidth: 1 },
  actionBtnPrimaryText: { color: 'white', fontSize: 16, fontWeight: '600' },
  actionBtnSecondaryText: { fontSize: 16, fontWeight: '500' },

  speedPanel: {
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  speedPresets: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  speedPreset: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 48,
    alignItems: 'center',
  },
  speedPresetText: {
    fontSize: 14,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  speedSliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  speedSlider: {
    flex: 1,
    height: 40,
  },
  speedStepBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedStepText: {
    fontSize: 24,
    fontWeight: '300',
    lineHeight: 30,
  },

  attachmentThumb: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  pdfChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: '100%',
  },
  pdfChipText: {
    flex: 1,
    fontSize: 14,
  },
  attachAddRow: {
    flexDirection: 'row',
    gap: 10,
  },
  attachAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
  },
  attachAddText: {
    fontSize: 14,
    fontWeight: '500',
  },
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    width: '100%',
    height: '80%',
  },

  renameOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 10,
  },
  renameBox: {
    width: '100%',
    borderRadius: 16,
    padding: 20,
    gap: 14,
  },
  renameTitle: { fontSize: 17, fontWeight: '600' },
  renameInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
  },
  renameButtons: { flexDirection: 'row', gap: 10 },
  renameBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  renameBtnText: { fontSize: 16, fontWeight: '500' },

  toast: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 22,
  },
  toastText: { color: 'white', fontSize: 15, fontWeight: '500' },
});
