import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { FieldConfig, getVisibleFields } from '@/lib/db';

export function useFieldConfig(): [FieldConfig[], () => void] {
  const [fieldConfigs, setFieldConfigs] = useState<FieldConfig[]>([]);
  const reload = useCallback(() => { setFieldConfigs(getVisibleFields()); }, []);
  useFocusEffect(reload);
  return [fieldConfigs, reload];
}
