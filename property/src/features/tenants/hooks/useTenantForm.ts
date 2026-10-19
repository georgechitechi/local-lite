import { useCallback, useState } from 'react';
import type { NextOfKin } from '@/shared/types/types';
import {
  capitalizeEachWord,
  generateUUID,
  normalizePhoneNumber,
} from '@/shared/utils/helper';
import { validateFields, validations } from '@/shared/utils/validations';
import type { TenantErrors, TenantFormData } from '../components/TenantForm';

const INITIAL_FORM: TenantFormData = {
  name: '',
  phone: '',
  email: '',
  address: '',
  gender: 'male',
  marital_status: 'single',
  nationality: 'Kenyan',
  status: '',
  next_of_kin: [],
};

export function useTenantForm(initialData?: Partial<TenantFormData>) {
  const [form, setForm] = useState<TenantFormData>(() => ({
    ...INITIAL_FORM,
    ...initialData,
    next_of_kin: initialData?.next_of_kin || [],
  }));
  const [errors, setErrors] = useState<TenantErrors>({});

  const resetForm = useCallback(() => {
    setForm(INITIAL_FORM);
    setErrors({});
  }, []);

  const updateForm = useCallback(
    (field: keyof TenantFormData, value: string | NextOfKin[]) => {
      setForm(prev => ({
        ...prev,
        [field]: value,
      }));
      setErrors(prev => {
        if (!prev[field as keyof TenantErrors]) return prev;
        const newErrors = { ...prev };
        delete newErrors[field as keyof TenantErrors];
        return newErrors;
      });
    },
    [],
  );

  const addNextOfKin = useCallback(() => {
    setForm(prev => ({
      ...prev,
      next_of_kin: [
        ...prev.next_of_kin,
        { id: generateUUID(), name: '', relationship: '', phone: '', is_primary: false },
      ],
    }));
  }, []);

  const removeNextOfKin = useCallback((index: number) => {
    setForm(prev => ({
      ...prev,
      next_of_kin: prev.next_of_kin.filter((_, i) => i !== index),
    }));
  }, []);

  const updateNextOfKin = useCallback(
    (index: number, field: keyof NextOfKin, value: string | boolean) => {
      setForm(prev => {
        const updatedKin = prev.next_of_kin.map((kin, i) => {
          if (i === index) {
            return { ...kin, [field]: value };
          }
          if (field === 'is_primary' && value === true) {
            return { ...kin, is_primary: false };
          }
          return kin;
        });

        return {
          ...prev,
          next_of_kin: updatedKin,
        };
      });
    },
    [],
  );

  const validateForm = useCallback((): boolean => {
    const result = validateFields(form, {
      name: validations.required,
      phone: validations.combine(validations.required, validations.phone),
      email: form.email?.trim() ? validations.email : () => '',
      gender: validations.required,
      marital_status: validations.required,
      nationality: validations.required,
    });
    setErrors(result.errors);
    return result.isValid;
  }, [form]);

  const cleanNextOfKin = useCallback(() => {
    return form.next_of_kin
      .filter(kin => kin.name || kin.phone || kin.relationship)
      .map(({ name, relationship, phone, is_primary }) => ({
        name: capitalizeEachWord(name),
        relationship: capitalizeEachWord(relationship),
        phone: normalizePhoneNumber(phone),
        is_primary,
      }));
  }, [form.next_of_kin]);

  const checkDuplicates = useCallback(
    (tenants: any[], currentId?: string): string | null => {
      if (form.email?.trim()) {
        const emailToCheck = form.email.trim().toLowerCase();
        const existingTenant = tenants.find(
          t =>
            (!currentId || t.id !== currentId) && t.email?.toLowerCase() === emailToCheck,
        );
        if (existingTenant) {
          return currentId
            ? 'Another tenant with this email already exists in this business.'
            : 'A tenant with this email already exists in this business.';
        }
      }

      if (form.phone?.trim()) {
        const phoneToCheck = normalizePhoneNumber(form.phone);
        const existingTenant = tenants.find(
          t =>
            (!currentId || t.id !== currentId) &&
            normalizePhoneNumber(t.phone) === phoneToCheck,
        );
        if (existingTenant) {
          return currentId
            ? 'Another tenant with this phone number already exists in this business.'
            : 'A tenant with this phone number already exists in this business.';
        }
      }

      return null;
    },
    [form.email, form.phone],
  );

  return {
    form,
    setForm,
    errors,
    setErrors,
    resetForm,
    updateForm,
    addNextOfKin,
    removeNextOfKin,
    updateNextOfKin,
    validateForm,
    cleanNextOfKin,
    checkDuplicates,
  };
}
