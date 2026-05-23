import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  addCustomField,
  clearBuiltInFieldData,
  countRecordingsWithBuiltInFieldData,
  deleteCustomField,
  FieldConfig,
  getAllFields,
  getAllRecordings,
  MAX_FIELDS,
  moveFieldDown,
  moveFieldUp,
  parseCustomData,
  updateFieldVisibility,
} from '@/lib/db';
import { S } from '@/lib/strings';

export default function FieldsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  const [fields, setFields] = useState<FieldConfig[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLabel, setNewLabel] = useState('');

  function reload() {
    setFields(getAllFields());
  }

  useFocusEffect(useCallback(() => { reload(); }, []));

  function toggleVisibility(key: string, current: boolean) {
    updateFieldVisibility(key, !current);
    reload();
  }

  function handleMoveUp(key: string) {
    moveFieldUp(key);
    reload();
  }

  function handleMoveDown(key: string) {
    moveFieldDown(key);
    reload();
  }

  function handleLongPress(field: FieldConfig) {
    if (field.isBuiltIn) {
      if (field.key === 'name') {
        Alert.alert(field.label, S.titleFieldRequired);
        return;
      }
      if (!field.isVisible) {
        Alert.alert(field.label, S.removeBuiltInConfirm, [
          { text: S.cancel, style: 'cancel' },
          {
            text: S.restoreField,
            onPress: () => { updateFieldVisibility(field.key, true); reload(); },
          },
        ]);
        return;
      }
      // Visible non-title built-in field: offer permanent deletion with data warning
      const builtInCount = countRecordingsWithBuiltInFieldData(field.key);
      const builtInMessage = builtInCount > 0
        ? builtInCount === 1
          ? `1 inspelning har data i fältet "${field.label}". Om du raderar fältet tas denna data bort permanent.`
          : `${builtInCount} inspelningar har data i fältet "${field.label}". Om du raderar fältet tas all denna data bort permanent.`
        : `Radera fältet "${field.label}"?`;
      Alert.alert(field.label, builtInMessage, [
        { text: S.cancel, style: 'cancel' },
        {
          text: S.delete,
          style: 'destructive',
          onPress: () => {
            clearBuiltInFieldData(field.key);
            updateFieldVisibility(field.key, false);
            reload();
          },
        },
      ]);
      return;
    }

    // Count how many recordings have data stored in this custom field.
    const count = getAllRecordings().filter(r => {
      const data = parseCustomData(r.customData);
      return data[field.key] != null && String(data[field.key]).trim() !== '';
    }).length;

    const message = count > 0
      ? count === 1
        ? `1 inspelning har data i fältet "${field.label}". Om du raderar fältet tas denna data bort permanent.`
        : `${count} inspelningar har data i fältet "${field.label}". Om du raderar fältet tas all denna data bort permanent.`
      : `${S.deleteField}?`;

    Alert.alert(field.label, message, [
      { text: S.cancel, style: 'cancel' },
      {
        text: S.delete,
        style: 'destructive',
        onPress: () => {
          deleteCustomField(field.key);
          reload();
        },
      },
    ]);
  }

  function confirmAddField() {
    const label = newLabel.trim();
    if (!label) return;
    const key = addCustomField(label);
    if (key === null) {
      setShowAddModal(false);
      Alert.alert(S.maxFieldsTitle, S.maxFieldsMessage);
      return;
    }
    setNewLabel('');
    setShowAddModal(false);
    reload();
  }

  function renderRow({ item, index }: { item: FieldConfig; index: number }) {
    const isFirst = index === 0;
    const isLast = index === fields.length - 1;

    return (
      <TouchableOpacity
        style={[styles.row, { borderBottomColor: colors.icon + '33' }]}
        onLongPress={() => handleLongPress(item)}
        activeOpacity={0.7}
        delayLongPress={400}
      >
        <View style={styles.rowLeft}>
          <Text style={[styles.rowLabel, { color: colors.text }]}>{item.label}</Text>
          {!item.isBuiltIn && (
            <Text style={[styles.rowSub, { color: colors.icon }]}>Anpassat fält</Text>
          )}
          {item.isBuiltIn && !item.isVisible && (
            <Text style={[styles.rowSub, { color: colors.icon }]}>Dolt från formuläret</Text>
          )}
        </View>

        <View style={styles.rowRight}>
          <Switch
            value={item.isVisible}
            onValueChange={() => toggleVisibility(item.key, item.isVisible)}
            trackColor={{ false: colors.icon + '44', true: '#00A878' }}
            thumbColor="white"
          />
          <TouchableOpacity
            style={[styles.arrowBtn, { opacity: isFirst ? 0.2 : 1 }]}
            onPress={() => !isFirst && handleMoveUp(item.key)}
            disabled={isFirst}
          >
            <Ionicons name="chevron-up" size={18} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.arrowBtn, { opacity: isLast ? 0.2 : 1 }]}
            onPress={() => !isLast && handleMoveDown(item.key)}
            disabled={isLast}
          >
            <Ionicons name="chevron-down" size={18} color={colors.text} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <FlatList
        data={fields}
        keyExtractor={f => f.key}
        renderItem={({ item, index }) => renderRow({ item, index })}
        contentContainerStyle={{ paddingBottom: insets.bottom }}
        ListFooterComponent={
          <TouchableOpacity
            style={[styles.addBtn, { borderColor: fields.length >= MAX_FIELDS ? colors.icon + '44' : '#00A878' }]}
            onPress={() => {
              if (fields.length >= MAX_FIELDS) {
                Alert.alert(S.maxFieldsTitle, S.maxFieldsMessage);
                return;
              }
              setNewLabel('');
              setShowAddModal(true);
            }}
          >
            <Ionicons name="add-circle-outline" size={20} color={fields.length >= MAX_FIELDS ? colors.icon : '#00A878'} />
            <Text style={[styles.addBtnText, { color: fields.length >= MAX_FIELDS ? colors.icon : '#00A878' }]}>{S.addField}</Text>
          </TouchableOpacity>
        }
      />

      {/* Add custom field modal */}
      <Modal visible={showAddModal} transparent animationType="fade" onRequestClose={() => setShowAddModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.background }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{S.addField}</Text>
            <TextInput
              style={[styles.modalInput, { color: colors.text, borderColor: colors.icon + '55', backgroundColor: colors.background }]}
              placeholder={S.newFieldPlaceholder}
              placeholderTextColor={colors.icon}
              value={newLabel}
              onChangeText={setNewLabel}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={confirmAddField}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalBtn, { borderColor: colors.icon + '55' }]} onPress={() => setShowAddModal(false)}>
                <Text style={[styles.modalBtnText, { color: colors.icon }]}>{S.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#00A878' }]} onPress={confirmAddField}>
                <Text style={[styles.modalBtnText, { color: 'white' }]}>{S.save}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLeft: { flex: 1 },
  rowLabel: { fontSize: 16, fontWeight: '500' },
  rowSub: { fontSize: 12, marginTop: 2 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  arrowBtn: { padding: 6 },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
  },
  addBtnText: { fontSize: 16, fontWeight: '500' },

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
});
