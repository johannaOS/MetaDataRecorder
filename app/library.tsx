import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as Sentry from '@sentry/react-native';
import { File } from 'expo-file-system';
import { hidePlaybackNotification, showPlaybackNotification } from '@/lib/backgroundRecording';
import { router, Stack, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteAudioFile } from 'save-to-music';
import {
  Alert,
  BackHandler,
  FlatList,
  Modal,
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
import { addKeyword, deleteKeyword, deleteRecording, getAllKeywords, getAllRecordings, Keyword, Recording } from '@/lib/db';
import { requestAutoRecord } from '@/lib/autoRecord';
import { S } from '@/lib/strings';

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

function buildMeta(r: Recording): string {
  // Show: Of/after · Who's playing · date — skip empty fields
  return [r.ofAfter, r.performer, formatDate(r.createdAt)].filter(Boolean).join(' · ');
}

export default function LibraryScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [sheetItem, setSheetItem] = useState<Recording | null>(null);
  const playerRef = useRef<Audio.Sound | null>(null);
  const [showAddKeyword, setShowAddKeyword] = useState(false);
  const [newKeywordLabel, setNewKeywordLabel] = useState('');

  // ── Multi-select state ────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const isSelecting = selectedIds.size > 0;

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function cancelSelection() { setSelectedIds(new Set()); }

  // ── Header options — selection mode vs normal ─────────────────────────────────
  // useNavigation().setOptions() is more reliable than passing dynamic options
  // to <Stack.Screen> — it updates immediately when state changes.
  useEffect(() => {
    if (isSelecting) {
      navigation.setOptions({
        headerLeft: () => (
          <TouchableOpacity onPress={cancelSelection} hitSlop={8} style={{ padding: 4 }}>
            <Text style={{ color: colors.tint, fontSize: 16 }}>{S.cancelSelection}</Text>
          </TouchableOpacity>
        ),
        headerTitle: `${selectedIds.size} ${selectedIds.size === 1 ? 'vald' : 'valda'}`,
        headerRight: () => (
          <TouchableOpacity onPress={handleMultiDelete} hitSlop={8} style={{ padding: 4 }}>
            <Text style={{ color: '#e53935', fontSize: 16, fontWeight: '600' }}>{S.deleteSelected}</Text>
          </TouchableOpacity>
        ),
      });
    } else {
      navigation.setOptions({
        headerLeft: undefined,
        headerTitle: undefined,
        headerRight: () => (
          <TouchableOpacity onPress={() => router.push('/settings')} hitSlop={8} style={{ padding: 4 }}>
            <Ionicons name="settings-outline" size={22} color={colors.text} />
          </TouchableOpacity>
        ),
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelecting, selectedIds.size]);

  // ── Hardware back button — cancel selection instead of navigating back ────────
  useFocusEffect(
    useCallback(() => {
      if (!isSelecting) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        cancelSelection();
        return true; // prevent default back navigation
      });
      return () => sub.remove();
    }, [isSelecting])
  );

  function reload(q: string, tf: string | null) {
    setKeywords(getAllKeywords());
    const results = getAllRecordings(q || undefined);
    // Fix 14: filter keyword matches songType OR recording title
    setRecordings(
      tf
        ? results.filter(r =>
            r.songType === tf ||
            r.name.toLowerCase().includes(tf.toLowerCase())
          )
        : results
    );
  }

  function handleAddKeyword() {
    const label = newKeywordLabel.trim();
    if (!label) return;
    addKeyword(label);
    setNewKeywordLabel('');
    setShowAddKeyword(false);
    setKeywords(getAllKeywords());
  }

  function handleDeleteKeyword(kw: Keyword) {
    Alert.alert(kw.label, `${S.deleteField}?`, [
      { text: S.cancel, style: 'cancel' },
      {
        text: S.delete,
        style: 'destructive',
        onPress: () => {
          deleteKeyword(kw.id);
          if (typeFilter === kw.label) setTypeFilter(null);
          setKeywords(getAllKeywords());
        },
      },
    ]);
  }

  // Reload when search / filter change
  useEffect(() => {
    reload(search, typeFilter);
  }, [search, typeFilter]);

  // Reload when navigating back to this screen; clean up audio on leave
  useFocusEffect(
    useCallback(() => {
      reload(search, typeFilter);
      return () => {
        if (playerRef.current) {
          playerRef.current.pauseAsync().catch(() => {});
          playerRef.current.unloadAsync().catch(() => {});
          playerRef.current = null;
        }
        setPlayingId(null);
        setSelectedIds(new Set());
        hidePlaybackNotification().catch(() => {});
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  async function togglePlay(item: Recording) {
    if (playingId === item.id) {
      await playerRef.current?.pauseAsync().catch(() => {});
      await playerRef.current?.unloadAsync().catch(() => {});
      playerRef.current = null;
      setPlayingId(null);
      hidePlaybackNotification().catch(() => {});
      return;
    }
    if (playerRef.current) {
      await playerRef.current.unloadAsync().catch(() => {});
      playerRef.current = null;
    }
    try {
      // content:// URIs (saved via MediaStore) cannot be checked with expo-file-system's
      // File class — it only handles file:// URIs. For content:// URIs, skip the check
      // and let Audio.Sound.createAsync handle missing files via its own error path.
      if (!item.filePath.startsWith('content://')) {
        const fileRef = new File(item.filePath);
        console.log('[Library] file check —', item.filePath, '— exists:', fileRef.exists, fileRef.exists ? `size: ${fileRef.size} bytes` : '(missing)');
        if (!fileRef.exists) {
          Alert.alert(S.fileNotFound, S.fileNoLongerExists + item.filePath);
          return;
        }
      } else {
        console.log('[Library] MediaStore URI — skipping file system check:', item.filePath);
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri: item.filePath },
        undefined,
        (status) => {
          if (status.isLoaded && status.didJustFinish) {
            playerRef.current?.unloadAsync().catch(() => {});
            playerRef.current = null;
            setPlayingId(null);
            hidePlaybackNotification().catch(() => {});
          }
        },
      );
      await sound.playAsync();
      playerRef.current = sound;
      setPlayingId(item.id);
      showPlaybackNotification(item.name || S.appTitle).catch(() => {});
    } catch (e) {
      Sentry.captureException(e, { tags: { flow: 'createAsync', uriType: item.filePath.startsWith('content://') ? 'content' : 'file' } });
      console.error('[Library] playback error for URI', item.filePath, ':', e);
      Alert.alert(S.playbackError, String(e));
    }
  }

  function handleEditFromSheet() {
    if (!sheetItem) return;
    const item = sheetItem;
    setSheetItem(null);
    router.push({ pathname: '/detail/[id]', params: { id: String(item.id), openEdit: '1' } });
  }

  // ── Deletion helpers ──────────────────────────────────────────────────────────

  async function deleteRecordingFiles(ids: number[], deleteFiles: boolean) {
    // Stop playback if the currently playing item is being deleted
    if (playingId !== null && ids.includes(playingId)) {
      await playerRef.current?.pauseAsync().catch(() => {});
      await playerRef.current?.unloadAsync().catch(() => {});
      playerRef.current = null;
      setPlayingId(null);
      hidePlaybackNotification().catch(() => {});
    }
    for (const id of ids) {
      const rec = recordings.find(r => r.id === id);
      if (!rec) continue;
      if (deleteFiles) {
        try {
          if (rec.filePath.startsWith('content://')) {
            await deleteAudioFile(rec.filePath);
          } else {
            new File(rec.filePath).delete();
          }
        } catch (e) { console.warn('[Library] file delete error:', e); }
      }
      try { deleteRecording(id); } catch (e) { console.error('[Library] DB delete error:', e); }
    }
    cancelSelection();
    reload(search, typeFilter);
  }

  function promptDelete(ids: number[]) {
    const hasExternal = ids.some(id =>
      recordings.find(r => r.id === id)?.filePath.startsWith('content://')
    );
    const title = ids.length === 1 ? S.deleteRecording : S.deleteRecordingPlural;

    if (hasExternal) {
      Alert.alert(title, S.deleteAlsoFromMusicFolder, [
        { text: S.cancel, style: 'cancel' },
        { text: S.deleteAppOnly, onPress: () => deleteRecordingFiles(ids, false) },
        { text: S.deleteAppAndDevice, style: 'destructive', onPress: () => deleteRecordingFiles(ids, true) },
      ]);
    } else {
      Alert.alert(title, S.deleteRecordingMessage, [
        { text: S.cancel, style: 'cancel' },
        { text: S.delete, style: 'destructive', onPress: () => deleteRecordingFiles(ids, true) },
      ]);
    }
  }

  function handleDeleteFromSheet() {
    if (!sheetItem) return;
    const id = sheetItem.id;
    setSheetItem(null);
    promptDelete([id]);
  }

  function handleMultiDelete() {
    promptDelete([...selectedIds]);
  }

  function renderRow({ item }: { item: Recording }) {
    const meta = buildMeta(item);
    const isPlaying = playingId === item.id;
    const isSelected = selectedIds.has(item.id);

    return (
      <TouchableOpacity
        style={[
          styles.row,
          { borderBottomColor: colors.icon + '33' },
          isSelected && { backgroundColor: colors.icon + '18' },
        ]}
        onPress={async () => {
          if (isSelecting) {
            toggleSelect(item.id);
            return;
          }
          // Navigate to detail, handing off playback position if playing
          let playFrom = 0;
          const wasPlaying = playingId === item.id;
          if (wasPlaying && playerRef.current) {
            try {
              const st = await playerRef.current.getStatusAsync();
              if (st.isLoaded) playFrom = st.positionMillis;
            } catch { }
            await playerRef.current.pauseAsync().catch(() => {});
            await playerRef.current.unloadAsync().catch(() => {});
            playerRef.current = null;
            setPlayingId(null);
            hidePlaybackNotification().catch(() => {});
          }
          router.push({
            pathname: '/detail/[id]',
            params: {
              id: String(item.id),
              ...(wasPlaying ? { playFrom: String(playFrom) } : {}),
            },
          });
        }}
        onLongPress={() => { toggleSelect(item.id); }}
        delayLongPress={400}
        activeOpacity={0.6}
      >
        {/* Selection checkbox (selection mode only) */}
        {isSelecting && (
          <Ionicons
            name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={isSelected ? colors.tint : colors.icon}
            style={{ marginRight: 12 }}
          />
        )}

        {/* Left: name + meta */}
        <View style={styles.rowLeft}>
          <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
            {item.name || 'Untitled'}
          </Text>
          <Text style={[styles.rowMeta, { color: colors.icon }]} numberOfLines={1}>
            {meta}
          </Text>
        </View>

        {/* Right: play button + duration (hidden in selection mode) */}
        {!isSelecting && (
          <View style={styles.rowRight}>
            <TouchableOpacity onPress={() => togglePlay(item)} hitSlop={10}>
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={20}
                color="white"
              />
            </TouchableOpacity>
            <Text style={[styles.duration, { color: colors.icon }]}>
              {formatDuration(item.duration)}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{}} />

      {/* Search bar */}
      <View style={[styles.searchBar, { backgroundColor: colors.icon + '22' }]}>
        <Ionicons name="search" size={15} color={colors.icon} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder={S.placeholderSearch}
          placeholderTextColor={colors.icon}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.icon} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter row — user-managed keywords with + button */}
      <View style={styles.filterWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          style={styles.filterScroll}
        >
          <Text style={[styles.filterLabel, { color: colors.icon }]}>{S.filterLabel}</Text>
          {keywords.map(kw => {
            const active = typeFilter === kw.label;
            return (
              <TouchableOpacity
                key={kw.id}
                onPress={() => setTypeFilter(active ? null : kw.label)}
                onLongPress={() => handleDeleteKeyword(kw)}
                delayLongPress={500}
                activeOpacity={0.6}
              >
                <Text style={[styles.filterWord, { color: colors.text }, active && styles.filterWordActive]}>
                  {kw.label}
                </Text>
              </TouchableOpacity>
            );
          })}
          {/* Plus button — always at the end of the scrollable row */}
          <TouchableOpacity
            onPress={() => { setNewKeywordLabel(''); setShowAddKeyword(true); }}
            style={[styles.addKwBtn, { borderColor: colors.icon + '66' }]}
            hitSlop={6}
          >
            <Ionicons name="add" size={16} color={colors.icon} />
          </TouchableOpacity>
        </ScrollView>
        {typeFilter !== null && (
          <TouchableOpacity
            onPress={() => setTypeFilter(null)}
            style={[styles.clearBtn, { borderColor: colors.tint, backgroundColor: colors.tint + '18' }]}
          >
            <Text style={[styles.clearText, { color: colors.tint }]}>{S.clearFilter}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Add keyword modal */}
      <Modal visible={showAddKeyword} transparent animationType="fade" onRequestClose={() => setShowAddKeyword(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.background }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{S.addKeyword}</Text>
            <TextInput
              style={[styles.modalInput, { color: colors.text, borderColor: colors.icon + '55', backgroundColor: colors.background }]}
              placeholder={S.keywordPlaceholder}
              placeholderTextColor={colors.icon}
              value={newKeywordLabel}
              onChangeText={setNewKeywordLabel}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleAddKeyword}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalBtn, { borderColor: colors.icon + '55' }]} onPress={() => setShowAddKeyword(false)}>
                <Text style={[styles.modalBtnText, { color: colors.icon }]}>{S.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#00A878' }]} onPress={handleAddKeyword}>
                <Text style={[styles.modalBtnText, { color: 'white' }]}>{S.save}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <FlatList
        data={recordings}
        keyExtractor={item => String(item.id)}
        renderItem={renderRow}
        contentContainerStyle={{ paddingBottom: 96 + insets.bottom }}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.icon }]}>{S.noRecordingsYet}</Text>
        }
      />

      {/* Long-press bottom sheet */}
      <Modal
        visible={sheetItem !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetItem(null)}
      >
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setSheetItem(null)}>
          <TouchableOpacity
            style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: 16 + insets.bottom }]}
            activeOpacity={1}
            onPress={() => {}}
          >
            <Text style={[styles.sheetTitle, { color: colors.icon, borderBottomColor: colors.icon + '33' }]} numberOfLines={1}>
              {sheetItem?.name || S.untitled}
            </Text>
            <TouchableOpacity style={styles.sheetBtn} onPress={handleEditFromSheet}>
              <Ionicons name="pencil-outline" size={20} color={colors.text} />
              <Text style={[styles.sheetBtnText, { color: colors.text }]}>{S.editScreenTitle}</Text>
            </TouchableOpacity>
            <View style={[styles.sheetDivider, { backgroundColor: colors.icon + '33' }]} />
            <TouchableOpacity style={styles.sheetBtn} onPress={handleDeleteFromSheet}>
              <Ionicons name="trash-outline" size={20} color="#e53935" />
              <Text style={[styles.sheetBtnText, { color: '#e53935' }]}>{S.delete}</Text>
            </TouchableOpacity>
            <View style={[styles.sheetDivider, { backgroundColor: colors.icon + '33' }]} />
            <TouchableOpacity style={styles.sheetBtn} onPress={() => setSheetItem(null)}>
              <Text style={[styles.sheetBtnText, { color: colors.icon }]}>{S.cancel}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Floating record button — hidden in selection mode */}
      {!isSelecting && (
        <View style={[styles.fabContainer, { bottom: 24 + insets.bottom }]} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.fab}
            onPress={() => { requestAutoRecord(); router.replace('/'); }}
            activeOpacity={0.8}
          >
            <Ionicons name="mic" size={32} color="white" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 4,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchInput: { flex: 1, fontSize: 16 },

  filterWrapper: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 8,
  },
  filterScroll: {
    flex: 1,
  },
  clearBtn: {
    paddingHorizontal: 12,
    height: 28,
    justifyContent: 'center',
    alignSelf: 'center',
    borderRadius: 14,
    borderWidth: 1,
    marginRight: 12,
  },
  clearText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 14,
  },
  filterLabel: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
  },
  filterWord: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '400',
  },
  filterWordActive: {
    fontWeight: '700',
    textDecorationLine: 'underline',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLeft: { flex: 1, marginRight: 16 },
  rowName: { fontSize: 16, fontWeight: '500' },
  rowMeta: { fontSize: 13, marginTop: 3 },

  rowRight: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 42,
  },
  duration: { fontSize: 13, fontVariant: ['tabular-nums'] },

  empty: {
    textAlign: 'center',
    marginTop: 60,
    fontSize: 16,
  },

  addKwBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalBox: {
    width: '100%',
    borderRadius: 16,
    padding: 20,
    gap: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '600' },
  modalInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
  },
  modalButtons: { flexDirection: 'row', gap: 10 },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modalBtnText: { fontSize: 16, fontWeight: '500' },

  fabContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  fab: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#e53935',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#e53935',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },

  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
  },
  sheetTitle: {
    fontSize: 13,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  sheetBtnText: {
    fontSize: 17,
  },
  sheetDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 20,
  },
});
