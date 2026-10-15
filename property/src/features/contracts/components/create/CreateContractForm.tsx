import { StyleSheet } from 'react-native';
import { Button, HelperText, Menu, TextInput } from 'react-native-paper';
import DatePicker from '@/shared/components/DatePicker';
import { formatDateForDB, parseLocalDate } from '@/shared/utils/formatters';

export function CreateContractForm({ flow }: { flow: any }) {
  const {
    colors,
    setShowPropertyModal,
    setShowHouseModal,
    setShowTenantModal,
    defaultCurrency,
    statusMenuVisible,
    setStatusMenuVisible,
    form,
    setForm,
    errors,
    CONTRACT_STATUSES,
  } = flow;

  return (
    <>
      <Button
        mode="outlined"
        onPress={() => setShowPropertyModal(true)}
        style={{ ...styles.input, backgroundColor: colors.surface }}
      >
        {form.property_name || 'Select Property'}
      </Button>
      {errors.property && <HelperText type="error">{errors.property}</HelperText>}

      <Button
        mode="outlined"
        onPress={() => setShowHouseModal(true)}
        style={{ ...styles.input, backgroundColor: colors.surface }}
        disabled={!form.property_id}
      >
        {form.house_number ? `House ${form.house_number}` : 'Select House'}
      </Button>
      {errors.house && <HelperText type="error">{errors.house}</HelperText>}

      <Button
        mode="outlined"
        onPress={() => setShowTenantModal(true)}
        style={{ ...styles.input, backgroundColor: colors.surface }}
      >
        {form.tenant_name || 'Select Tenant'}
      </Button>
      {errors.tenant && <HelperText type="error">{errors.tenant}</HelperText>}

      <Menu
        visible={statusMenuVisible}
        onDismiss={() => setStatusMenuVisible(false)}
        anchor={
          <Button
            mode="outlined"
            onPress={() => setStatusMenuVisible(true)}
            style={{ ...styles.input, backgroundColor: colors.surface }}
          >
            Status:{' '}
            {CONTRACT_STATUSES.find((s: any) => s.value === form.status)?.label ||
              'Active'}
          </Button>
        }
      >
        {CONTRACT_STATUSES.map((status: any) => (
          <Menu.Item
            key={status.value}
            onPress={() => {
              setForm((prev: any) => ({ ...prev, status: status.value }));
              setStatusMenuVisible(false);
            }}
            title={status.label}
          />
        ))}
      </Menu>

      <DatePicker
        label="Start Date"
        value={
          form.start_date instanceof Date
            ? formatDateForDB(form.start_date)
            : form.start_date
        }
        onChange={(date: any) => {
          setForm((prev: any) => ({
            ...prev,
            start_date: date ? parseLocalDate(date) : null,
          }));
        }}
        style={styles.input}
        maximumDate={null}
      />

      <DatePicker
        label="End Date"
        value={
          form.end_date instanceof Date ? formatDateForDB(form.end_date) : form.end_date
        }
        onChange={(date: any) => {
          setForm((prev: any) => ({
            ...prev,
            end_date: date ? parseLocalDate(date) : null,
          }));
        }}
        style={styles.input}
        maximumDate={null}
      />

      <TextInput
        label={`Rent Amount (${defaultCurrency?.symbol || '$'})`}
        value={form.rent_amount}
        onChangeText={(text: any) =>
          setForm((prev: any) => ({ ...prev, rent_amount: text }))
        }
        keyboardType="decimal-pad"
        style={{ ...styles.input, backgroundColor: colors.surface }}
        error={!!errors.rent_amount}
      />
      {errors.rent_amount && <HelperText type="error">{errors.rent_amount}</HelperText>}

      <TextInput
        label="Remarks (Optional)"
        value={form.remarks}
        onChangeText={(text: any) => setForm((prev: any) => ({ ...prev, remarks: text }))}
        multiline
        numberOfLines={4}
        style={{
          ...styles.input,
          ...styles.remarksInput,
          backgroundColor: colors.surface,
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  input: {
    marginBottom: 8,
  },
  remarksInput: {
    height: 100,
  },
});
