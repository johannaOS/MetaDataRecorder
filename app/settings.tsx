import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  BackupFileInfo,
  buildBackupData,
  formatBackupDate,
  formatFileSize,
  listBackupFiles,
  parseBackupJson,
  readBackupFile,
  restoreFromBackupData,
  saveBackupToFile,
} from '@/lib/backup';
import { S } from '@/lib/strings';

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  const [backups, setBackups] = useState<BackupFileInfo[]>([]);
  const [busy, setBusy] = useState(false);

  function refreshBackups() {
    setBackups(listBackupFiles());
  }

  useFocusEffect(useCallback(() => { refreshBackups(); }, []));

  async function handleBackupNow() {
    if (busy) return;
    setBusy(true);
    try {
      const json = buildBackupData();
      saveBackupToFile(json);
      refreshBackups();
      Alert.alert(S.backupNow, S.backupSuccess);
    } catch (e) {
      console.error('[Settings] backup error:', e);
      Alert.alert(S.error, String(e));
    } finally {
      setBusy(false);
    }
  }

  function handleRestore(info: BackupFileInfo) {
    Alert.alert(
      S.confirmRestore,
      S.restoreConfirmMessage,
      [
        { text: S.cancel, style: 'cancel' },
        {
          text: S.restoreFromBackup,
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            try {
              const json = readBackupFile(info.uri);
              const data = parseBackupJson(json);
              if (!data) {
                Alert.alert(S.error, 'Kunde inte läsa säkerhetskopian.');
                return;
              }
              const count = restoreFromBackupData(data);
              refreshBackups();
              Alert.alert(S.restoreSuccess, `${count} inspelningar återställda.`);
            } catch (e) {
              console.error('[Settings] restore error:', e);
              Alert.alert(S.error, String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  const mostRecent = backups[0] ?? null;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}
    >
      {/* ── Backup & Restore section ─────────────────────────────────────── */}
      <Text style={[styles.sectionHeader, { color: colors.icon }]}>
        {S.backupAndRestore.toUpperCase()}
      </Text>

      {/* Most recent backup info */}
      <View style={[styles.card, { backgroundColor: colors.icon + '11', borderColor: colors.icon + '22' }]}>
        <Text style={[styles.cardLabel, { color: colors.icon }]}>{S.mostRecentBackup}</Text>
        {mostRecent ? (
          <Text style={[styles.cardValue, { color: colors.text }]}>
            {formatBackupDate(mostRecent.date)}{'  '}
            <Text style={{ color: colors.icon }}>{formatFileSize(mostRecent.sizeBytes)}</Text>
          </Text>
        ) : (
          <Text style={[styles.cardValue, { color: colors.icon }]}>{S.noBackup}</Text>
        )}
      </View>

      {/* Backup Now */}
      <TouchableOpacity
        style={[styles.primaryBtn, { backgroundColor: '#00A878', opacity: busy ? 0.6 : 1 }]}
        onPress={handleBackupNow}
        disabled={busy}
      >
        <Ionicons name="cloud-upload-outline" size={18} color="white" />
        <Text style={styles.primaryBtnText}>{S.backupNow}</Text>
      </TouchableOpacity>

      {/* Restore section */}
      <Text style={[styles.sectionHeader, { color: colors.icon, marginTop: 28 }]}>
        {S.restoreFromBackup.toUpperCase()}
      </Text>

      {/* Warning */}
      <View style={[styles.warningBox, { borderColor: '#e5393566', backgroundColor: '#e5393511' }]}>
        <Ionicons name="warning-outline" size={16} color="#e53935" style={{ marginTop: 1 }} />
        <Text style={[styles.warningText, { color: '#e53935' }]}>{S.restoreWarning}</Text>
      </View>

      {/* Available backup files */}
      {backups.length === 0 ? (
        <Text style={[styles.emptyNote, { color: colors.icon }]}>{S.noBackup}</Text>
      ) : (
        backups.map(info => (
          <TouchableOpacity
            key={info.filename}
            style={[styles.backupRow, { borderColor: colors.icon + '33', backgroundColor: colors.icon + '08' }]}
            onPress={() => handleRestore(info)}
            disabled={busy}
            activeOpacity={0.7}
          >
            <View style={styles.backupRowLeft}>
              <Ionicons name="document-text-outline" size={18} color={colors.icon} />
              <Text style={[styles.backupRowDate, { color: colors.text }]}>
                {formatBackupDate(info.date)}
              </Text>
            </View>
            <Text style={[styles.backupRowSize, { color: colors.icon }]}>
              {formatFileSize(info.sizeBytes)}
            </Text>
          </TouchableOpacity>
        ))
      )}

      {/* Audio files note */}
      <Text style={[styles.noteText, { color: colors.icon }]}>
        {S.audioFilesNote}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginHorizontal: 16,
    marginTop: 24,
    marginBottom: 10,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 4,
  },
  cardLabel: { fontSize: 12, fontWeight: '600' },
  cardValue: { fontSize: 15 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryBtnText: { color: 'white', fontSize: 16, fontWeight: '600' },
  warningBox: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  warningText: { flex: 1, fontSize: 13, lineHeight: 18 },
  emptyNote: { marginHorizontal: 16, fontSize: 14, fontStyle: 'italic' },
  backupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  backupRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backupRowDate: { fontSize: 15, fontWeight: '500' },
  backupRowSize: { fontSize: 13 },
  noteText: {
    marginHorizontal: 16,
    marginTop: 20,
    fontSize: 12,
    lineHeight: 18,
    fontStyle: 'italic',
  },
});
