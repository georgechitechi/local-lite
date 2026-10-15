import type React from 'react';
import { View } from 'react-native';
import { Checkbox, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import { formatDateForDB } from '@/shared/utils/formatters';

interface GenericReportModalProps {
  visible: boolean;
  onDismiss: () => void;
  onGenerate: (options: any) => void;
  title: string;
  exportLoading: boolean;
  fields: {
    type:
      | 'date_range'
      | 'status_filter'
      | 'property_select'
      | 'sorting'
      | 'checkbox'
      | 'text'
      | 'month_filter';
    key: string;
    label: string;
    options?: { label: string; value: any }[];
    dependencies?: string[]; // Only show if these fields are present
    showWhen?: (params: Record<string, any>) => boolean; // Conditionally show this field
  }[];
  params: Record<string, any>;
  updateParam: (updates: Record<string, any>) => void;
  properties?: any[];
  zIndex?: number;
}

export const GenericReportModal: React.FC<GenericReportModalProps> = ({
  visible,
  onDismiss,
  onGenerate,
  title,
  exportLoading,
  fields,
  params,
  updateParam,
  properties = [],
  zIndex,
}) => {
  const renderField = (field: any) => {
    switch (field.type) {
      case 'date_range':
        return (
          <View key={field.key} style={{ gap: 16 }}>
            <DatePicker
              label="Start Month"
              mode="month"
              value={params.startDate ? formatDateForDB(params.startDate) : null}
              onChange={date => {
                updateParam({
                  startDate: date ? new Date(date) : null,
                  isYTD: false,
                  allTime: false,
                });
              }}
              showYearToDate
              isYearToDate={params.isYTD}
              onYearToDateChange={val => {
                updateParam({ isYTD: val, allTime: val ? false : params.allTime });
                if (val) {
                  const d = new Date();
                  updateParam({
                    startDate: new Date(d.getFullYear(), 0, 1),
                    endDate: new Date(),
                  });
                }
              }}
              showAllTime
              isAllTime={params.allTime}
              onAllTimeChange={val => {
                updateParam({ allTime: val, isYTD: val ? false : params.isYTD });
              }}
            />
            <DatePicker
              label="End Month"
              mode="month"
              value={params.endDate ? formatDateForDB(params.endDate) : null}
              onChange={date => {
                updateParam({ endDate: date ? new Date(date) : null });
              }}
              maximumDate={new Date()}
              isYearToDate={params.isYTD}
              isAllTime={params.allTime}
            />
          </View>
        );

      case 'month_filter':
        return (
          <DatePicker
            key={field.key}
            label={field.label}
            mode="month"
            value={params[field.key] ? formatDateForDB(params[field.key]) : null}
            onChange={date => {
              updateParam({
                [field.key]: date ? new Date(date) : null,
                allTime: false,
                isYTD: false,
              });
            }}
            showYearToDate
            isYearToDate={params.isYTD}
            onYearToDateChange={val => {
              updateParam({
                isYTD: val,
                allTime: val ? false : params.allTime,
                // Clear the specific month when YTD is enabled — filter will show all of this year
                [field.key]: null,
              });
            }}
            showAllTime
            isAllTime={params.allTime}
            onAllTimeChange={val => {
              updateParam({
                allTime: val,
                isYTD: val ? false : params.isYTD,
                // Clear the specific month when All Time is enabled — filter will show everything
                [field.key]: null,
              });
            }}
          />
        );

      case 'status_filter':
        return (
          <View key={field.key} style={{ gap: 4 }}>
            <Text variant="titleSmall">{field.label}</Text>
            <SegmentedButtons
              value={params[field.key] || field.options?.[0]?.value}
              onValueChange={val => updateParam({ [field.key]: val })}
              buttons={(field.options || []) as any}
            />
          </View>
        );

      case 'property_select':
        return (
          <View key={field.key} style={{ gap: 8 }}>
            <Text variant="titleSmall">{field.label}</Text>
            <SegmentedButtons
              value={params[field.key]}
              onValueChange={val => updateParam({ [field.key]: val })}
              buttons={
                [
                  { value: 'all', label: 'All' },
                  ...properties.map(p => ({
                    value: p.id,
                    label: p.name,
                  })),
                ] as any
              }
            />
          </View>
        );

      case 'checkbox':
        return (
          <Checkbox.Item
            key={field.key}
            label={field.label}
            status={params[field.key] ? 'checked' : 'unchecked'}
            onPress={() => updateParam({ [field.key]: !params[field.key] })}
            position="leading"
            labelStyle={{ textAlign: 'left' }}
            style={{ paddingHorizontal: 0, paddingVertical: 4 }}
          />
        );

      case 'sorting':
        return (
          <View key={field.key} style={{ gap: 12 }}>
            <View style={{ gap: 4 }}>
              <Text variant="titleSmall">Sort By</Text>
              <SegmentedButtons
                value={params.sortBy}
                onValueChange={val => updateParam({ sortBy: val })}
                buttons={(field.options || []) as any}
              />
            </View>
            <View style={{ gap: 4 }}>
              <Text variant="titleSmall">Order</Text>
              <SegmentedButtons
                value={params.sortOrder}
                onValueChange={val => updateParam({ sortOrder: val })}
                buttons={
                  [
                    { label: 'Ascending', value: 'asc' },
                    { label: 'Descending', value: 'desc' },
                  ] as any
                }
              />
            </View>
          </View>
        );

      case 'text':
        return (
          <TextInput
            key={field.key}
            label={field.label}
            value={params[field.key]}
            onChangeText={val => updateParam({ [field.key]: val })}
            mode="outlined"
            keyboardType={field.keyboardType || 'default'}
          />
        );

      default:
        return null;
    }
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title={title}
      subtitle="View property reports"
      scrollable={true}
      zIndex={zIndex}
      actions={[
        { label: 'Cancel', onPress: onDismiss, mode: 'outlined' },
        {
          label: 'Generate',
          onPress: () => onGenerate(params),
          mode: 'contained',
          loading: exportLoading,
        },
      ]}
    >
      <View style={{ gap: 20, paddingVertical: 8 }}>
        {(() => {
          const visible = fields.filter(f => !f.showWhen || f.showWhen(params));
          const result: React.ReactNode[] = [];
          let i = 0;
          while (i < visible.length) {
            if (visible[i].type === 'checkbox') {
              // Group consecutive checkboxes into a compact block
              const group: typeof visible = [];
              while (i < visible.length && visible[i].type === 'checkbox') {
                group.push(visible[i]);
                i++;
              }
              result.push(<View key={`cb-group-${i}`}>{group.map(renderField)}</View>);
            } else {
              result.push(renderField(visible[i]));
              i++;
            }
          }
          return result;
        })()}
      </View>
    </BaseModal>
  );
};
