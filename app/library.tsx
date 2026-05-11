import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { File } from 'expo-file-system';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
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

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [sheetItem, setSheetItem] = useState<Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const [showAddKeyword, setShowAddKeyword] = useState(false);
  const [newKeywordLabel, setNewKeywordLabel] = useState('');

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
        soundRef.current?.unloadAsync().catch(e => console.log('[Library] unload on screen-leave error (likely already unloaded):', e));
        soundRef.current = null;
        setPlayingId(null);
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  async function togglePlay(item: Recording) {
    if (playingId === item.id) {
      await soundRef.current?.stopAsync();
      await soundRef.current?.unloadAsync();
      soundRef.current = null;
      setPlayingId(null);
      return;
    }
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    try {
      const fileRef = new File(item.filePath);
      console.log('[Library] file check —', item.filePath, '— exists:', fileRef.exists, fileRef.exists ? `size: ${fileRef.size} bytes` : '(missing)');
      if (!fileRef.exists) {
        Alert.alert(S.fileNotFound, S.fileNoLongerExists + item.filePath);
        return;
      }

      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: item.filePath },
        { shouldPlay: true }
      );
      soundRef.current = sound;
      setPlayingId(item.id);
      sound.setOnPlaybackStatusUpdate(status => {
        if (status.isLoaded && status.didJustFinish) {
          soundRef.current = null;
          setPlayingId(null);
        }
      });
    } catch (e) {
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

  function handleDeleteFromSheet() {
    if (!sheetItem) return;
    const item = sheetItem;
    setSheetItem(null);
    Alert.alert(S.deleteRecording, S.deleteRecordingMessage, [
      { text: S.cancel, style: 'cancel' },
      {
        text: S.delete,
        style: 'destructive',
        onPress: () => {
          try { new File(item.filePath).delete(); } catch (e) { console.warn('[Library] file delete error:', e); }
          try {
            deleteRecording(item.id);
            reload(search, typeFilter);
          } catch (e) {
            console.error('[Library] DB delete error:', e);
            Alert.alert(S.error, S.couldNotDelete);
          }
        },
      },
    ]);
  }

  function renderRow({ item }: { item: Recording }) {
    // Long-press opens the bottom sheet menu
    const meta = buildMeta(item);
    const isPlaying = playingId === item.id;

    return (
      <TouchableOpacity
        style={[styles.row, { borderBottomColor: colors.icon + '33' }]}
        onPress={() =>
          router.push({ pathname: '/detail/[id]', params: { id: String(item.id) } })
        }
        onLongPress={() => setSheetItem(item)}
        delayLongPress={400}
        activeOpacity={0.6}
      >
        {/* Left: name + meta */}
        <View style={styles.rowLeft}>
          <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
            {item.name || 'Untitled'}
          </Text>
          <Text style={[styles.rowMeta, { color: colors.icon }]} numberOfLines={1}>
            {meta}
          </Text>
        </View>

        {/* Right: play button (top) + duration (bottom) */}
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
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
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

      {/* Floating record button — navigates back to the recorder */}
      <View style={[styles.fabContainer, { bottom: 24 + insets.bottom }]} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.fab}
          onPress={() => { requestAutoRecord(); router.replace('/'); }}
          activeOpacity={0.8}
        >
          <Ionicons name="mic" size={32} color="white" />
        </TouchableOpacity>
      </View>
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
