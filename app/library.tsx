import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as Sentry from '@sentry/react-native';
import * as DocumentPicker from 'expo-document-picker';
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
import { addKeyword, deleteKeyword, deleteRecording, getAllKeywords, getAllRecordings, getAllTagColors, getAllUniqueTags, insertRecording, Keyword, parseTags, Recording, renameTag, setTagColor, deleteTagColor, updateRecording } from '@/lib/db';
import { copyToPermanentStorage } from '@/lib/saveRecording';
import { PALETTE, tagColor } from '@/lib/tagColors';
import { exportRecordingsAsZip } from '@/lib/exportZip';
import { requestAutoRecord } from '@/lib/autoRecord';
import { S } from '@/lib/strings';

async function probeAudioDuration(uri: string): Promise<number> {
  try {
    const { sound, status } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false });
    const dur = status.isLoaded && status.durationMillis ? Math.round(status.durationMillis / 1000) : 0;
    await sound.unloadAsync();
    return dur;
  } catch {
    return 0;
  }
}

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
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [sheetItem, setSheetItem] = useState<Recording | null>(null);
  const playerRef = useRef<Audio.Sound | null>(null);
  const [showAddKeyword, setShowAddKeyword] = useState(false);
  const [newKeywordLabel, setNewKeywordLabel] = useState('');

  const [viewMode, setViewMode] = useState<'list' | 'tags'>('list');
  const [customTagColors, setCustomTagColors] = useState<Record<string, string>>({});

  // ── Tag editor state ──────────────────────────────────────────────────────────
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [tagEditName, setTagEditName] = useState('');
  const [tagEditColor, setTagEditColor] = useState<string | null>(null);

  // ── Multi-select state ────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const isSelecting = selectedIds.size > 0;
  const [showTagModal, setShowTagModal] = useState(false);
  const [tagModalInput, setTagModalInput] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function cancelSelection() { setSelectedIds(new Set()); }

  function toggleSelectAll() {
    if (selectedIds.size === recordings.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(recordings.map(r => r.id)));
    }
  }

  async function handleExport() {
    const selected = recordings.filter(r => selectedIds.has(r.id));
    if (!selected.length) return;
    setIsExporting(true);
    try {
      await exportRecordingsAsZip(selected);
      cancelSelection();
    } catch (e) {
      Sentry.captureException(e, { tags: { flow: 'exportZip' } });
      Alert.alert(S.error, String(e));
    } finally {
      setIsExporting(false);
    }
  }

  function openTagEditor(tag: string) {
    setEditingTag(tag);
    setTagEditName(tag);
    setTagEditColor(customTagColors[tag] ?? null);
  }

  function saveTagEdit() {
    if (!editingTag) return;
    const newName = tagEditName.trim();
    if (!newName) return;
    if (newName !== editingTag) renameTag(editingTag, newName);
    if (tagEditColor !== null) setTagColor(newName, tagEditColor);
    else deleteTagColor(newName);
    setEditingTag(null);
    reload(search, typeFilter, tagFilter === editingTag ? newName : tagFilter);
    if (tagFilter === editingTag) setTagFilter(newName);
  }

  function applyTagToSelected(tag: string) {
    const trimmed = tag.trim();
    if (!trimmed) return;
    for (const id of selectedIds) {
      const rec = recordings.find(r => r.id === id);
      if (!rec) continue;
      const existing = parseTags(rec.tags);
      if (!existing.includes(trimmed)) {
        updateRecording(id, { tags: JSON.stringify([...existing, trimmed]) });
      }
    }
    setTagModalInput('');
    setShowTagModal(false);
    cancelSelection();
    reload(search, typeFilter, tagFilter);
  }

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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <TouchableOpacity onPress={() => { setTagModalInput(''); setShowTagModal(true); }} hitSlop={8} style={{ padding: 4 }}>
              <Ionicons name="pricetag-outline" size={22} color={colors.tint} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleExport} hitSlop={8} style={{ padding: 4 }} disabled={isExporting}>
              <Ionicons name="share-outline" size={22} color={isExporting ? colors.icon : colors.tint} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleMultiDelete} hitSlop={8} style={{ padding: 4 }}>
              <Text style={{ color: '#e53935', fontSize: 16, fontWeight: '600' }}>{S.deleteSelected}</Text>
            </TouchableOpacity>
          </View>
        ),
      });
    } else {
      navigation.setOptions({
        headerLeft: undefined,
        headerTitle: undefined,
        headerRight: () => (
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <TouchableOpacity onPress={handleImportAudio} hitSlop={8} style={{ padding: 4 }}>
              <MaterialCommunityIcons name="folder-download" size={24} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/settings')} hitSlop={8} style={{ padding: 4 }}>
              <Ionicons name="settings-outline" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>
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

  function reload(q: string, tf: string | null, tagF: string | null = tagFilter) {
    setKeywords(getAllKeywords());
    setAllTags(getAllUniqueTags());
    setCustomTagColors(getAllTagColors());
    let results = getAllRecordings(q || undefined);
    if (tf) results = results.filter(r => r.songType === tf || r.name.toLowerCase().includes(tf.toLowerCase()));
    if (tagF) {
      results = results.filter(r => {
        try { return (JSON.parse(r.tags || '[]') as string[]).includes(tagF); } catch { return false; }
      });
    }
    setRecordings(results);
  }

  async function handleImportAudio() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/*'],
        // copyToCacheDirectory: true gives us a file:// URI directly — no manual
        // copy needed, and it handles content:// URIs on Android reliably.
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled) return;
      const { assets } = result;

      if (assets.length === 1) {
        // Single file → open metadata form so user can fill in details
        const asset = assets[0];
        router.push({
          pathname: '/metadata',
          params: {
            filePath: asset.uri,
            duration: '0',
            preFilledName: asset.name?.replace(/\.[^.]+$/, '') ?? '',
            isImport: '1',
          },
        });
      } else {
        // Multiple files → batch import with filename as title, then reload library
        let count = 0;
        for (const asset of assets) {
          try {
            const name = (asset.name?.replace(/\.[^.]+$/, '') ?? S.untitled).trim() || S.untitled;
            const finalUri = await copyToPermanentStorage(asset.uri, name);
            const duration = await probeAudioDuration(finalUri);
            insertRecording({
              name, filePath: finalUri, duration,
              createdAt: new Date().toISOString(),
              ofAfter: '', origin: '', songType: '', performer: '', notes: '',
              customData: '{}', tags: '[]',
            });
            count++;
          } catch (e) {
            Sentry.captureException(e, { tags: { flow: 'importAudioBatch' } });
          }
        }
        reload(search, typeFilter, tagFilter);
        if (count > 0) Alert.alert(`${count} ${count === 1 ? 'fil importerad' : S.importedMultiple}`, S.importedMessage);
        else Alert.alert(S.error, S.couldNotImport);
      }
    } catch (e) {
      Sentry.captureException(e, { tags: { flow: 'importAudio' } });
      Alert.alert(S.error, S.couldNotImport);
    }
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
    reload(search, typeFilter, tagFilter);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, typeFilter, tagFilter]);

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
    const itemTags = parseTags(item.tags);

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
          {itemTags.length > 0 && (
            <View style={styles.tagDots}>
              {itemTags.slice(0, 5).map(t => (
                <View key={t} style={[styles.tagDot, { backgroundColor: tagColor(t, customTagColors[t]).text }]} />
              ))}
            </View>
          )}
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

      {/* View mode toggle — Lista / Taggar */}
      <View style={[styles.viewModeBar, { backgroundColor: colors.icon + '15' }]}>
        <TouchableOpacity
          style={[styles.viewModeBtn, viewMode === 'list' && { backgroundColor: colors.tint + '28' }]}
          onPress={() => setViewMode('list')}
        >
          <Ionicons name="list-outline" size={15} color={viewMode === 'list' ? colors.tint : colors.icon} />
          <Text style={[styles.viewModeBtnText, { color: viewMode === 'list' ? colors.tint : colors.icon }]}>{S.listView}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.viewModeBtn, viewMode === 'tags' && { backgroundColor: colors.tint + '28' }]}
          onPress={() => { setViewMode('tags'); setTagFilter(null); }}
        >
          <Ionicons name="pricetags-outline" size={15} color={viewMode === 'tags' ? colors.tint : colors.icon} />
          <Text style={[styles.viewModeBtnText, { color: viewMode === 'tags' ? colors.tint : colors.icon }]}>{S.tagsLabel}</Text>
        </TouchableOpacity>
      </View>

      {/* Filter row — user-managed keywords with + button (list mode only) */}
      {viewMode === 'list' && <View style={styles.filterWrapper}>
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
      </View>}

      {/* Active tag indicator — appears in list mode when a tag is filtering */}
      {viewMode === 'list' && tagFilter !== null && (() => {
        const tc = tagColor(tagFilter, customTagColors[tagFilter]);
        return (
          <View style={styles.activeTagRow}>
            <View style={[styles.tagChip, { backgroundColor: tc.bg, borderColor: tc.text + 'cc', borderWidth: 1.5 }]}>
              <Text style={[styles.tagChipText, { color: tc.text, fontWeight: '700' }]}>{tagFilter}</Text>
            </View>
            <TouchableOpacity onPress={() => setTagFilter(null)} style={[styles.clearBtn, { borderColor: colors.tint, backgroundColor: colors.tint + '18' }]}>
              <Text style={[styles.clearText, { color: colors.tint }]}>{S.clearFilter}</Text>
            </TouchableOpacity>
          </View>
        );
      })()}

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

      {/* Select-all row — only in list mode selection */}
      {isSelecting && viewMode === 'list' && (
        <TouchableOpacity
          style={[styles.selectAllRow, { borderBottomColor: colors.icon + '22' }]}
          onPress={toggleSelectAll}
          activeOpacity={0.6}
        >
          <Ionicons
            name={selectedIds.size === recordings.length ? 'checkmark-circle' : 'ellipse-outline'}
            size={20}
            color={colors.tint}
          />
          <Text style={[styles.selectAllText, { color: colors.tint }]}>
            {selectedIds.size === recordings.length
              ? S.deselectAll
              : `${S.selectAll} (${recordings.length})`}
          </Text>
        </TouchableOpacity>
      )}

      {viewMode === 'list' ? (
        <FlatList
          data={recordings}
          keyExtractor={item => String(item.id)}
          renderItem={renderRow}
          contentContainerStyle={{ paddingBottom: 96 + insets.bottom }}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: colors.icon }]}>{S.noRecordingsYet}</Text>
          }
        />
      ) : (
        // Tag overview — vertical list, tap to filter into list view
        <ScrollView contentContainerStyle={{ paddingBottom: 96 + insets.bottom }}>
          {allTags.length === 0 ? (
            <Text style={[styles.empty, { color: colors.icon }]}>{S.noRecordingsYet}</Text>
          ) : allTags.map(tag => {
            const tc = tagColor(tag, customTagColors[tag]);
            return (
              <TouchableOpacity
                key={tag}
                style={[styles.tagListRow, { borderBottomColor: colors.icon + '22' }]}
                onPress={() => { setTagFilter(tag); setViewMode('list'); }}
                onLongPress={() => openTagEditor(tag)}
                delayLongPress={400}
                activeOpacity={0.6}
              >
                <View style={[styles.tagListDot, { backgroundColor: tc.text }]} />
                <Text style={[styles.tagListName, { color: colors.text }]}>{tag}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.icon} />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

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

      {/* Batch tag modal — opened from selection-mode header tag icon */}
      <Modal visible={showTagModal} transparent animationType="fade" onRequestClose={() => setShowTagModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.background }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{S.tagSelected}</Text>
            {allTags.length > 0 && (
              <View style={styles.tagModalChips}>
                {allTags.map(tag => {
                  const tc = tagColor(tag);
                  return (
                    <TouchableOpacity
                      key={tag}
                      style={[styles.tagModalChip, { backgroundColor: tc.bg, borderColor: tc.text + '55' }]}
                      onPress={() => applyTagToSelected(tag)}
                    >
                      <Text style={[styles.tagModalChipText, { color: tc.text }]}>{tag}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            <TextInput
              style={[styles.modalInput, { color: colors.text, borderColor: colors.icon + '55', backgroundColor: colors.background }]}
              placeholder={S.addTagPlaceholder}
              placeholderTextColor={colors.icon}
              value={tagModalInput}
              onChangeText={setTagModalInput}
              autoFocus={allTags.length === 0}
              returnKeyType="done"
              onSubmitEditing={() => applyTagToSelected(tagModalInput)}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalBtn, { borderColor: colors.icon + '55' }]} onPress={() => setShowTagModal(false)}>
                <Text style={[styles.modalBtnText, { color: colors.icon }]}>{S.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#00A878' }]} onPress={() => applyTagToSelected(tagModalInput)}>
                <Text style={[styles.modalBtnText, { color: 'white' }]}>{S.applyTag}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Tag edit modal — long-press on any tag chip */}
      <Modal visible={editingTag !== null} transparent animationType="fade" onRequestClose={() => setEditingTag(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.background }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{S.editTag}</Text>
            <TextInput
              style={[styles.modalInput, { color: colors.text, borderColor: colors.icon + '55', backgroundColor: colors.background }]}
              value={tagEditName}
              onChangeText={setTagEditName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveTagEdit}
            />
            <Text style={[styles.modalSubtitle, { color: colors.icon }]}>{S.tagColorLabel}</Text>
            <View style={styles.colorPicker}>
              {/* Auto — no custom colour */}
              <TouchableOpacity
                style={[styles.colorSwatch, { backgroundColor: tagColor(tagEditName || editingTag || '').bg, borderWidth: tagEditColor === null ? 2.5 : 1, borderColor: tagEditColor === null ? colors.tint : colors.icon + '44' }]}
                onPress={() => setTagEditColor(null)}
              >
                <Text style={{ fontSize: 8, color: tagColor(tagEditName || editingTag || '').text, fontWeight: '700' }}>{S.autoColorLabel}</Text>
              </TouchableOpacity>
              {PALETTE.map(hex => (
                <TouchableOpacity
                  key={hex}
                  style={[styles.colorSwatch, { backgroundColor: hex, borderWidth: tagEditColor === hex ? 2.5 : 0, borderColor: 'white' }]}
                  onPress={() => setTagEditColor(hex)}
                >
                  {tagEditColor === hex && <Ionicons name="checkmark" size={14} color="white" />}
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalBtn, { borderColor: colors.icon + '55' }]} onPress={() => setEditingTag(null)}>
                <Text style={[styles.modalBtnText, { color: colors.icon }]}>{S.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#00A878' }]} onPress={saveTagEdit}>
                <Text style={[styles.modalBtnText, { color: 'white' }]}>{S.save}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
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
  tagChip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  tagChipText: { fontSize: 13 },

  viewModeBar: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginTop: 6,
    marginBottom: 2,
    borderRadius: 9,
    overflow: 'hidden',
  },
  viewModeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 6,
    borderRadius: 9,
  },
  viewModeBtnText: { fontSize: 13, fontWeight: '500' },

  selectAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  selectAllText: { fontSize: 15, fontWeight: '500' },

  activeTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 8,
  },

  tagListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 15,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tagListDot: { width: 12, height: 12, borderRadius: 6 },
  tagListName: { flex: 1, fontSize: 17, fontWeight: '500' },

  colorPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  colorSwatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSubtitle: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },

  tagDots: { flexDirection: 'row', gap: 4, marginTop: 5 },
  tagDot: { width: 7, height: 7, borderRadius: 3.5 },

  tagModalChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagModalChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1 },
  tagModalChipText: { fontSize: 14, fontWeight: '500' },

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
