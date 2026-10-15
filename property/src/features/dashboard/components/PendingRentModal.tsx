import type React from 'react';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { RadioButton, SegmentedButtons, Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import { formatDateForDB } from '@/shared/utils/formatters';

interface PendingRentModalProps {
  visible: boolean;
  onDismiss: () => void;
  onGenerate: (date: Date, options: any) => void;
  exportLoading: boolean;
  reportDate: Date;
  setReportDate: (date: Date) => void;
  pendingRentGroupBy: 'none' | 'property' | 'period';
  setPendingRentGroupBy: (val: 'none' | 'property' | 'period') => void;
  pendingRentAllTime: boolean;
  setPendingRentAllTime: (val: boolean) => void;
  pendingRentIsYTD: boolean;
  setPendingRentIsYTD: (val: boolean) => void;
  zIndex?: number;
  initialOrientation?: 'portrait' | 'landscape';
  isPdf?: boolean;
}

export const PendingRentModal: React.FC<PendingRentModalProps> = ({
  visible,
  onDismiss,
  onGenerate,
  exportLoading,
  reportDate,
  setReportDate,
  pendingRentGroupBy,
  setPendingRentGroupBy,
  pendingRentAllTime,
  setPendingRentAllTime,
  pendingRentIsYTD,
  setPendingRentIsYTD,
  zIndex,
  initialOrientation = 'portrait',
  isPdf = true,
}) => {
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>(
    initialOrientation,
  );

  useEffect(() => {
    if (initialOrientation) {
      setOrientation(initialOrientation);
    }
  }, [initialOrientation]);

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Select Report Date"
      subtitle="Manage rent and balances"
      scrollable={true}
      zIndex={zIndex}
      actions={[
        {
          label: 'Cancel',
          onPress: onDismiss,
          mode: 'outlined',
        },
        {
          label: 'Generate Report',
          onPress: () => {
            onGenerate(reportDate, {
              groupByProperty: pendingRentGroupBy === 'property',
              allTime: pendingRentAllTime,
              isYearToDate: pendingRentIsYTD,
              groupByPeriod: pendingRentGroupBy === 'period',
              orientation,
            });
          },
          mode: 'contained',
          loading: exportLoading,
        },
      ]}
    >
      <View style={{ gap: 16 }}>
        <Text variant="bodyMedium">
          Select the reference date for the pending rent report.
        </Text>
        <DatePicker
          label="Report Month"
          mode="month"
          value={formatDateForDB(reportDate)}
          onChange={date => {
            if (date) {
              setReportDate(new Date(date));
              setPendingRentIsYTD(false);
              setPendingRentAllTime(false);
            }
          }}
          maximumDate={null}
          showAllTime={true}
          isAllTime={pendingRentAllTime}
          onAllTimeChange={val => {
            setPendingRentAllTime(val);
            if (val) setPendingRentIsYTD(false);
          }}
          showYearToDate
          isYearToDate={pendingRentIsYTD}
          onYearToDateChange={val => {
            setPendingRentIsYTD(val);
            if (val) {
              setPendingRentAllTime(false);
              setReportDate(new Date());
            }
          }}
        />

        {isPdf && (
          <View style={{ gap: 6 }}>
            <Text variant="labelMedium" style={{ opacity: 0.7 }}>
              Page Orientation
            </Text>
            <SegmentedButtons
              value={orientation}
              onValueChange={val => setOrientation(val as any)}
              buttons={[
                { value: 'portrait', label: 'Portrait', icon: 'crop-portrait' },
                { value: 'landscape', label: 'Landscape', icon: 'crop-landscape' },
              ]}
            />
          </View>
        )}

        <View style={{ gap: 4 }}>
          <Text variant="titleSmall" style={{ marginBottom: 4 }}>
            Group By
          </Text>
          <RadioButton.Group
            onValueChange={value => setPendingRentGroupBy(value as any)}
            value={pendingRentGroupBy}
          >
            <RadioButton.Item
              label="No Grouping"
              value="none"
              position="leading"
              labelStyle={{ textAlign: 'left' }}
              style={{ paddingHorizontal: 2, paddingVertical: 2 }}
            />
            <RadioButton.Item
              label="Group by Property"
              value="property"
              position="leading"
              labelStyle={{ textAlign: 'left' }}
              style={{ paddingHorizontal: 2, paddingVertical: 2 }}
            />
            <RadioButton.Item
              label="Group by Period"
              value="period"
              position="leading"
              labelStyle={{ textAlign: 'left' }}
              style={{ paddingHorizontal: 2, paddingVertical: 2 }}
            />
          </RadioButton.Group>
        </View>
      </View>
    </BaseModal>
  );
};
