import ExpoDateTimePickerNative from '@expo/ui/community/datetime-picker';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import React, { useState } from 'react';
import { Modal, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { Button, Checkbox, IconButton, Surface, Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import SlightPressable from '@/shared/components/SlightPressable';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import {
  formatDate,
  formatDateForDB,
  formatDateTime,
  formatMonthYear,
  formatTime,
  parseLocalDate,
  toLocalNoon,
} from '@/shared/utils/formatters';

interface DatePickerProps {
  label?: string;
  value: string | null;
  onChange: (date: string | null) => void;
  description?: string;
  style?: ViewStyle;
  maximumDate?: Date | null;
  minimumDate?: Date | null;
  mode?: 'date' | 'time' | 'month' | 'datetime';
  placeholder?: string;
  showAllTime?: boolean;
  isAllTime?: boolean;
  onAllTimeChange?: (isAllTime: boolean) => void;
  showYearToDate?: boolean;
  isYearToDate?: boolean;
  onYearToDateChange?: (isYTD: boolean) => void;
  disabled?: boolean;
}

export default function DatePicker({
  label,
  value,
  onChange,
  description,
  style,
  maximumDate,
  minimumDate,
  mode = 'date',
  placeholder,
  showAllTime = false,
  isAllTime = false,
  onAllTimeChange,
  showYearToDate = false,
  isYearToDate = false,
  onYearToDateChange,
  disabled = false,
}: DatePickerProps) {
  const colors = useThemeColors();
  const [show, setShow] = useState(false);
  const [androidDatetimeStep, setAndroidDatetimeStep] = useState<'date' | 'time'>('date');

  // Parse the current value into a Date object for the picker.
  // Date-only values use local noon so UTC+ offsets do not show the previous day.
  const initialDate = React.useMemo(() => {
    if (!value) return toLocalNoon(new Date());
    if (mode === 'time' && typeof value === 'string' && !value.includes('T')) {
      return new Date(`2000-01-01T${value}`);
    }
    const parsed = parseLocalDate(value);
    if (Number.isNaN(parsed.getTime())) return toLocalNoon(new Date());
    if (mode === 'datetime' || mode === 'time') return parsed;
    return toLocalNoon(parsed);
  }, [value, mode]);

  const [selectedDate, setSelectedDate] = useState<Date>(initialDate);
  const [viewingYear, setViewingYear] = useState<number>(initialDate.getFullYear());

  // Keep internal state in sync with external value prop, but only when modal is not shown
  // to avoid fighting with user interaction
  React.useEffect(() => {
    if (!show) {
      setSelectedDate(initialDate);
      setViewingYear(initialDate.getFullYear());
    }
  }, [initialDate, show]);

  const handleDateValueChange = (event: any, date?: Date) => {
    if (!date || event.type === 'dismissed') {
      if (Platform.OS === 'android') setShow(false);
      return;
    }

    const nextDate = mode === 'date' || mode === 'month' ? toLocalNoon(date) : date;
    setSelectedDate(nextDate);

    if (Platform.OS === 'android') {
      if (mode === 'datetime') {
        if (androidDatetimeStep === 'date') {
          setShow(false);
          setAndroidDatetimeStep('time');
          setTimeout(() => {
            setShow(true);
          }, 100);
        } else {
          setShow(false);
          onChange(date.toISOString());
        }
      } else {
        setShow(false);
        let finalValue: string;
        if (mode === 'time') {
          finalValue = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:00`;
        } else if (mode === 'date') {
          finalValue = formatDateForDB(nextDate);
        } else {
          finalValue = date.toISOString();
        }
        onChange(finalValue);
      }
    }
  };

  const handleDateDismiss = () => {
    if (Platform.OS === 'android') {
      setShow(false);
    }
  };

  const handlePress = () => {
    const initial = initialDate;
    setSelectedDate(initial);
    setViewingYear(initial.getFullYear());
    if (Platform.OS === 'android' && mode === 'datetime') {
      setAndroidDatetimeStep('date');
    }
    setShow(true);
  };

  const getDisplayValue = () => {
    if (isAllTime) return 'All Time';
    if (!value)
      return (
        placeholder ||
        (mode === 'time'
          ? 'Select Time'
          : mode === 'month'
            ? 'Select Month'
            : mode === 'datetime'
              ? 'Select Date & Time'
              : 'Select Date')
      );

    if (mode === 'time') return formatTime(value);
    if (mode === 'date') return formatDate(value);
    if (mode === 'month') return formatMonthYear(value);
    if (mode === 'datetime') return formatDateTime(value);
    return formatDate(value);
  };

  const renderPicker = () => {
    let pickerMode = mode === 'month' ? 'date' : mode;
    if (Platform.OS === 'android' && mode === 'datetime') {
      pickerMode = androidDatetimeStep;
    }

    return (
      <ExpoDateTimePickerNative
        value={selectedDate}
        mode={pickerMode as any}
        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
        onValueChange={handleDateValueChange}
        onDismiss={handleDateDismiss}
        maximumDate={maximumDate || undefined}
        minimumDate={minimumDate || undefined}
        style={Platform.OS === 'ios' ? styles.iosPicker : undefined}
      />
    );
  };

  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  const renderMonthPicker = () => {
    const today = new Date();
    const isThisYear = viewingYear === today.getFullYear();
    const thisMonth = today.getMonth();

    const maxYear = maximumDate ? maximumDate.getFullYear() : null;
    const minYear = minimumDate ? minimumDate.getFullYear() : null;

    const canGoNextYear = maxYear === null || viewingYear < maxYear;
    const canGoPrevYear = minYear === null || viewingYear > minYear;

    return (
      <View style={{ padding: 10 }}>
        <View style={{ paddingHorizontal: 0, paddingVertical: 2 }}>
          <Surface
            elevation={1}
            style={{
              marginHorizontal: -14,
              padding: 10,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.outlineVariant,
              backgroundColor: colors.surface,
            }}
          >
            {/* Integrated Year Selector */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
                backgroundColor: colors.surfaceVariant,
                borderRadius: 12,
                paddingVertical: 2,
              }}
            >
              <IconButton
                icon="chevron-left"
                onPress={() => setViewingYear(y => y - 1)}
                disabled={!canGoPrevYear}
                iconColor={canGoPrevYear ? colors.primary : colors.onSurfaceDisabled}
                size={24}
              />
              <Text
                variant="titleLarge"
                style={{ fontWeight: '900', color: colors.primary, letterSpacing: 1 }}
              >
                {viewingYear}
              </Text>
              <IconButton
                icon="chevron-right"
                onPress={() => setViewingYear(y => y + 1)}
                disabled={!canGoNextYear}
                iconColor={canGoNextYear ? colors.primary : colors.onSurfaceDisabled}
                size={24}
              />
            </View>

            {/* Premium Month Grid */}
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
              }}
            >
              {months.map((m, i) => {
                const selected = value ? parseLocalDate(value) : null;
                const isSelected =
                  !!selected &&
                  !Number.isNaN(selected.getTime()) &&
                  selected.getMonth() === i &&
                  selected.getFullYear() === viewingYear;

                const isCurrentMonth = isThisYear && i === thisMonth;

                // Month bounds checking
                const monthStart = new Date(viewingYear, i, 1);
                const monthEnd = new Date(viewingYear, i + 1, 0); // Last day of month
                const isTooEarly = minimumDate && monthEnd < minimumDate;
                const isTooLate = maximumDate && monthStart > maximumDate;
                const isMonthDisabled = isTooEarly || isTooLate;

                return (
                  <SlightPressable
                    key={m}
                    disabled={isMonthDisabled}
                    onPress={() => {
                      const newDate = new Date(viewingYear, i, 1);
                      setSelectedDate(newDate);
                      onChange(formatDateForDB(newDate));
                      setShow(false);
                    }}
                    style={{
                      width: '30%',
                      aspectRatio: 1.5,
                      justifyContent: 'center',
                      alignItems: 'center',
                      borderRadius: 10,
                      backgroundColor: isSelected ? colors.primary : 'transparent',
                      marginBottom: 12,
                      borderWidth: isSelected ? 0 : isCurrentMonth ? 2 : 1,
                      borderColor: isSelected
                        ? 'transparent'
                        : isCurrentMonth
                          ? colors.primary
                          : colors.outlineVariant,
                      elevation: isSelected ? 2 : 0,
                      opacity: isMonthDisabled ? 0.3 : 1,
                    }}
                  >
                    <Text
                      style={{
                        color: isSelected
                          ? colors.onPrimary
                          : isCurrentMonth
                            ? colors.primary
                            : colors.onSurface,
                        fontWeight: isSelected || isCurrentMonth ? 'bold' : '400',
                        fontSize: 15,
                      }}
                    >
                      {m}
                    </Text>
                  </SlightPressable>
                );
              })}
            </View>

            {(() => {
              const currentMonthStart = new Date(
                today.getFullYear(),
                today.getMonth(),
                1,
              );
              const currentMonthEnd = new Date(
                today.getFullYear(),
                today.getMonth() + 1,
                0,
              );
              const isCurrentMonthDisabled = !!(
                (minimumDate && currentMonthEnd < minimumDate) ||
                (maximumDate && currentMonthStart > maximumDate)
              );

              return (
                <Button
                  mode="text"
                  disabled={isCurrentMonthDisabled}
                  onPress={() => {
                    const now = new Date();
                    setViewingYear(now.getFullYear());
                    const newDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    setSelectedDate(newDate);
                    onChange(formatDateForDB(newDate));
                    setShow(false);
                  }}
                  style={{ marginTop: 8, alignSelf: 'center' }}
                  labelStyle={{ fontWeight: 'bold' }}
                  icon="calendar-today"
                  textColor={colors.primary}
                >
                  Current Month
                </Button>
              );
            })()}
          </Surface>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, style]}>
      {(label || showAllTime) && (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 6,
            paddingHorizontal: 4,
          }}
        >
          {label ? (
            <Text
              variant="labelMedium"
              style={[
                styles.label,
                { color: colors.onSurfaceVariant, marginBottom: 0, marginLeft: 0 },
              ]}
            >
              {label}
            </Text>
          ) : (
            <View />
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {showYearToDate && (
              <SlightPressable
                activeOpacity={0.7}
                onPress={() => onYearToDateChange?.(!isYearToDate)}
                style={{ flexDirection: 'row', alignItems: 'center' }}
              >
                <Text
                  variant="labelMedium"
                  style={{ color: colors.onSurfaceVariant, marginRight: -4 }}
                >
                  Year to Date
                </Text>
                <Checkbox
                  status={isYearToDate ? 'checked' : 'unchecked'}
                  onPress={() => onYearToDateChange?.(!isYearToDate)}
                />
              </SlightPressable>
            )}

            {showAllTime && (
              <SlightPressable
                activeOpacity={0.7}
                onPress={() => onAllTimeChange?.(!isAllTime)}
                style={{ flexDirection: 'row', alignItems: 'center' }}
              >
                <Text
                  variant="labelMedium"
                  style={{ color: colors.onSurfaceVariant, marginRight: -4 }}
                >
                  All Time
                </Text>
                <Checkbox
                  status={isAllTime ? 'checked' : 'unchecked'}
                  onPress={() => onAllTimeChange?.(!isAllTime)}
                />
              </SlightPressable>
            )}
          </View>
        </View>
      )}

      <Surface
        elevation={0}
        style={[
          styles.inputSurface,
          {
            backgroundColor:
              isAllTime || isYearToDate || disabled
                ? colors.surface
                : colors.surfaceVariant,
            borderColor: show ? colors.primary : colors.outlineVariant,
            borderWidth: show ? 2 : 1,
            opacity: isAllTime || isYearToDate || disabled ? 0.6 : 1,
          },
        ]}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            width: '100%',
            height: '100%',
          }}
        >
          <SlightPressable
            activeOpacity={0.7}
            onPress={handlePress}
            disabled={isAllTime || isYearToDate || disabled}
            style={[styles.touchable, { flex: 1 }]}
          >
            <MaterialCommunityIcons
              name={mode === 'time' ? 'clock-outline' : 'calendar-month-outline'}
              size={22}
              color={value ? colors.primary : colors.onSurfaceVariant}
              style={styles.icon}
            />
            <Text
              variant="bodyLarge"
              style={[
                styles.valueText,
                { color: value ? colors.onSurface : colors.onSurfaceVariant },
              ]}
            >
              {getDisplayValue()}
            </Text>
          </SlightPressable>

          {value && !isAllTime && !isYearToDate && !disabled && (
            <IconButton
              icon="close-circle"
              size={20}
              onPress={() => onChange(null)}
              style={styles.clearButton}
              iconColor={colors.onSurfaceVariant}
            />
          )}
        </View>
      </Surface>

      {description && (
        <Text
          variant="bodySmall"
          style={[
            styles.description,
            {
              color: colors.onSurfaceVariant,
              opacity: isAllTime || isYearToDate || disabled ? 0.5 : 1,
            },
          ]}
        >
          {description}
        </Text>
      )}

      {Platform.OS === 'ios' && show && (
        <Modal
          transparent
          visible={show}
          animationType="fade"
          onRequestClose={() => setShow(false)}
        >
          <SlightPressable
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShow(false)}
          >
            <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
              <View
                style={[styles.modalHeader, { borderBottomColor: colors.outlineVariant }]}
              >
                <Button onPress={() => setShow(false)} textColor={colors.error}>
                  Cancel
                </Button>
                <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>
                  {mode === 'time'
                    ? 'Select Time'
                    : mode === 'datetime'
                      ? 'Select Date & Time'
                      : 'Select Date'}
                </Text>
                <Button
                  onPress={() => {
                    let finalValue: string;
                    if (mode === 'time') {
                      finalValue = `${selectedDate.getHours().toString().padStart(2, '0')}:${selectedDate.getMinutes().toString().padStart(2, '0')}:00`;
                    } else if (mode === 'date') {
                      finalValue = formatDateForDB(selectedDate);
                    } else {
                      finalValue = selectedDate.toISOString();
                    }
                    onChange(finalValue);
                    setShow(false);
                  }}
                  mode="text"
                  textColor={colors.primary}
                  labelStyle={{ fontWeight: 'bold' }}
                >
                  Done
                </Button>
              </View>

              <View style={styles.pickerContainer}>{renderPicker()}</View>
            </View>
          </SlightPressable>
        </Modal>
      )}

      {Platform.OS === 'android' && show && mode !== 'month' && renderPicker()}

      <BaseModal
        visible={show && mode === 'month'}
        onDismiss={() => setShow(false)}
        title={label ? `Select ${label}` : 'Select Month'}
        subtitle="Select date and time"
      >
        {renderMonthPicker()}
      </BaseModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 4,
    width: '100%',
  },
  label: {
    marginBottom: 6,
    marginLeft: 4,
    fontWeight: '500',
  },
  inputSurface: {
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  touchable: {
    flexDirection: 'row',
    alignItems: 'center',
    height: '100%',
    paddingLeft: 16,
    paddingRight: 8,
  },
  icon: {
    marginRight: 12,
  },
  valueText: {
    flex: 1,
  },
  clearButton: {
    marginRight: 4,
  },
  description: {
    marginTop: 6,
    marginLeft: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    width: '100%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  pickerContainer: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  iosPicker: {
    width: '100%',
    height: 220,
  },
});
