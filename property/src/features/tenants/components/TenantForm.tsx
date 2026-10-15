import { StyleSheet, View } from 'react-native';
import {
  Button,
  HelperText,
  SegmentedButtons,
  Switch,
  Text,
  TextInput,
} from 'react-native-paper';
import ContactPicker from '@/shared/components/ContactPicker';
import Select from '@/shared/components/Select';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { capitalizeEachWord } from '@/shared/utils/helper';

export interface NextOfKin {
  id?: string;
  name: string;
  relationship: string;
  phone: string;
  is_primary: boolean;
}

export interface TenantFormData {
  name: string;
  phone: string;
  email: string;
  address: string;
  gender: string;
  marital_status: string;
  nationality: string;
  status?: string;
  next_of_kin: NextOfKin[];
}

export interface TenantErrors {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  gender?: string;
  marital_status?: string;
  nationality?: string;
}

interface TenantFormProps {
  form: TenantFormData;
  errors: TenantErrors;
  updateForm: (field: keyof TenantFormData, value: string | NextOfKin[]) => void;
  addNextOfKin: () => void;
  removeNextOfKin: (index: number) => void;
  updateNextOfKin: (
    index: number,
    field: keyof NextOfKin,
    value: string | boolean,
  ) => void;
}

export default function TenantForm({
  form,
  errors,
  updateForm,
  addNextOfKin,
  removeNextOfKin,
  updateNextOfKin,
}: TenantFormProps) {
  const colors = useThemeColors();

  return (
    <>
      <TextInput
        label="Full Name"
        value={form.name}
        onChangeText={text => updateForm('name', text)}
        style={styles.input}
        error={!!errors.name}
      />
      {errors.name && <HelperText type="error">{errors.name}</HelperText>}

      <ContactPicker
        value={form.phone}
        onChangeText={text => updateForm('phone', text)}
        onNameChange={nameData => {
          const fullName = `${nameData.firstName} ${nameData.lastName}`;
          updateForm('name', capitalizeEachWord(fullName) || form.name || '');
        }}
        onEmailChange={email => {
          updateForm('email', email.toLowerCase());
        }}
        error={!!errors.phone}
        errorText={errors.phone}
        style={styles.input}
      />

      <TextInput
        label="Email (Optional)"
        value={form.email}
        onChangeText={text => updateForm('email', text)}
        keyboardType="email-address"
        style={styles.input}
        error={!!errors.email}
      />
      {errors.email && <HelperText type="error">{errors.email}</HelperText>}

      <TextInput
        label="Address"
        value={form.address}
        onChangeText={text => updateForm('address', text)}
        multiline
        numberOfLines={3}
        style={styles.input}
        error={!!errors.address}
      />
      {errors.address && <HelperText type="error">{errors.address}</HelperText>}

      <Text variant="bodyMedium" style={styles.label}>
        Gender
      </Text>
      <SegmentedButtons
        value={form.gender}
        onValueChange={value => updateForm('gender', value)}
        buttons={[
          { value: 'male', label: 'Male' },
          { value: 'female', label: 'Female' },
          { value: 'other', label: 'Other' },
        ]}
        style={styles.segmentedButton}
      />
      {errors.gender && <HelperText type="error">{errors.gender}</HelperText>}

      <Text variant="bodyMedium" style={styles.label}>
        Marital Status
      </Text>
      <SegmentedButtons
        value={form.marital_status}
        onValueChange={value => updateForm('marital_status', value)}
        buttons={[
          { value: 'single', label: 'Single' },
          { value: 'married', label: 'Married' },
          { value: 'other', label: 'Other' },
        ]}
        style={styles.segmentedButton}
      />
      {errors.marital_status && (
        <HelperText type="error">{errors.marital_status}</HelperText>
      )}

      <Select
        label="Nationality"
        value={form.nationality}
        onValueChange={value => updateForm('nationality', value as string)}
        options={[
          { value: 'Kenyan', label: 'Kenyan' },
          { value: 'Ugandan', label: 'Ugandan' },
          { value: 'Tanzanian', label: 'Tanzanian' },
          { value: 'Other', label: 'Other' },
        ]}
        placeholder="Select Nationality"
        error={!!errors.nationality}
        errorText={errors.nationality}
        style={styles.input}
      />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 24,
          marginBottom: 16,
        }}
      >
        <Text variant="titleMedium" style={styles.sectionTitle}>
          Next of Kin Details
        </Text>
        <Button
          mode="outlined"
          onPress={addNextOfKin}
          icon="plus"
          style={{ marginLeft: 8 }}
          compact
        >
          Add Next of Kin
        </Button>
      </View>
      {form.next_of_kin.length === 0
        ? null
        : form.next_of_kin.map((kin, idx) => (
            <View
              key={kin.id || idx.toString()}
              style={{
                marginBottom: 16,
                borderWidth: 1,
                borderColor: colors.outline,
                borderRadius: 8,
                padding: 8,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}
              >
                <Text variant="bodyMedium" style={{ fontWeight: 'bold' }}>
                  Next of Kin #{idx + 1}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text variant="bodySmall" style={{ marginRight: 8 }}>
                    Primary
                  </Text>
                  <Switch
                    value={kin.is_primary}
                    onValueChange={value => updateNextOfKin(idx, 'is_primary', value)}
                  />
                </View>
              </View>
              <TextInput
                label="Full Name"
                value={kin.name}
                onChangeText={text => updateNextOfKin(idx, 'name', text)}
                style={styles.input}
              />
              <TextInput
                label="Relationship"
                value={kin.relationship}
                onChangeText={text => updateNextOfKin(idx, 'relationship', text)}
                style={styles.input}
              />
              <ContactPicker
                value={kin.phone}
                onChangeText={text => updateNextOfKin(idx, 'phone', text)}
                onNameChange={nameData => {
                  const fullName = `${nameData.firstName} ${nameData.lastName}`;
                  updateNextOfKin(idx, 'name', capitalizeEachWord(fullName));
                }}
                label="Next of Kin Phone"
                style={styles.input}
              />
              {form.next_of_kin.length > 1 && (
                <Button
                  mode="outlined"
                  onPress={() => removeNextOfKin(idx)}
                  style={{ marginTop: 4 }}
                  icon="delete"
                >
                  Remove
                </Button>
              )}
            </View>
          ))}
    </>
  );
}

const styles = StyleSheet.create({
  input: {
    marginBottom: 16,
  },
  label: {
    marginBottom: 8,
    opacity: 0.7,
  },
  segmentedButton: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontWeight: 'bold',
  },
});
