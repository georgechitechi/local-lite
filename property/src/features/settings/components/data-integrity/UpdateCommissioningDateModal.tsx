import { useEffect, useState } from 'react';
import { SegmentedButtons, Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatDateForDB } from '@/shared/utils/formatters';

interface UpdateCommissioningDateModalProps {
  visible: boolean;
  onDismiss: () => void;
  house: any;
  properties: any[];
  onConfirm: (target: 'house' | 'property', newDate: Date) => Promise<void>;
  processing?: boolean;
}

export default function UpdateCommissioningDateModal({
  visible,
  onDismiss,
  house,
  properties,
  onConfirm,
  processing = false,
}: UpdateCommissioningDateModalProps) {
  const colors = useThemeColors();
  const [target, setTarget] = useState<'house' | 'property'>('house');
  const [commissioningDate, setCommissioningDate] = useState<Date>(new Date());

  const property = properties.find(p => p.id === house?.property_id);

  useEffect(() => {
    if (visible && house) {
      setTarget('house');
      const earliest = house.contracts?.[0]?.start_date;
      if (earliest) {
        setCommissioningDate(new Date(earliest));
      } else if (house.effectiveDate) {
        setCommissioningDate(new Date(house.effectiveDate));
      } else {
        setCommissioningDate(new Date());
      }
    }
  }, [visible, house]);

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Update Commissioning Date"
      subtitle={
        target === 'property'
          ? `Property: ${property?.name || 'Property'}`
          : `House ${house?.house_number || ''}`
      }
      actions={[
        {
          label: 'Cancel',
          onPress: onDismiss,
          mode: 'outlined',
        },
        {
          label: target === 'property' ? 'Update Property' : 'Update House',
          onPress: () => onConfirm(target, commissioningDate),
          mode: 'contained',
          loading: processing,
          disabled: processing,
        },
      ]}
    >
      <Text
        variant="labelMedium"
        style={{ marginBottom: 8, color: colors.onSurfaceVariant }}
      >
        Scope:
      </Text>
      <SegmentedButtons
        value={target}
        onValueChange={val => setTarget(val as 'house' | 'property')}
        buttons={[
          {
            value: 'house',
            label: `House ${house?.house_number || ''}`,
            icon: 'home',
          },
          {
            value: 'property',
            label: 'Entire Property',
            icon: 'office-building',
            disabled: !house?.property_id,
          },
        ]}
        style={{ marginBottom: 16 }}
      />

      <Text variant="bodyMedium" style={{ marginBottom: 16, opacity: 0.8 }}>
        {target === 'property'
          ? `Set commissioning date for "${property?.name || 'Property'}". This date will apply to all houses belonging to this property.`
          : `Set commissioning date specifically for House ${house?.house_number}. Setting this on or before the earliest contract start date will resolve the issue.`}
      </Text>

      <DatePicker
        label="Commissioning Date"
        value={formatDateForDB(commissioningDate)}
        onChange={date => date && setCommissioningDate(new Date(date))}
      />
    </BaseModal>
  );
}
