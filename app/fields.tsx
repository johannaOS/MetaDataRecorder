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

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  addCustomField,
  deleteCustomField,
  FieldConfig,
  getAllFields,
  moveFieldDown,
  moveFieldUp,
  updateFieldVisibility,
} from '@/lib/db';
import { S } from '@/lib/strings';

export default function FieldsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

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
      Alert.alert(field.label, S.builtInFieldHint);
      return;
    }
    Alert.alert(field.label, S.deleteField + '?', [
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
    addCustomField(label);
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
        ListFooterComponent={
          <TouchableOpacity
            style={[styles.addBtn, { borderColor: '#00A878' }]}
            onPress={() => { setNewLabel(''); setShowAddModal(true); }}
          >
            <Ionicons name="add-circle-outline" size={20} color="#00A878" />
            <Text style={[styles.addBtnText, { color: '#00A878' }]}>{S.addField}</Text>
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
