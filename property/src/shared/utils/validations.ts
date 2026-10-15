import { isValidPhoneNumber } from 'libphonenumber-js';

type Validator = (value: unknown) => string;
type CustomValidator = (value: unknown) => string;

interface Validations {
  required: Validator;
  email: Validator;
  phone: Validator;
  number: Validator;
  minLength: (min: number) => Validator;
  maxLength: (max: number) => Validator;
  password: Validator;
  date: Validator;
  futureDate: Validator;
  pastDate: Validator;
  amount: Validator;
  url: Validator;
  custom: (validator: CustomValidator) => Validator;
  combine: (...validators: Validator[]) => Validator;
}

export const validations: Validations = {
  required: (value: unknown): string => {
    if (value === undefined || value === null || value === '') {
      return 'This field is required';
    }
    return '';
  },

  email: (value: unknown): string => {
    if (!value) return '';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z0-9-]{2,}$/;
    return emailRegex.test(String(value).trim())
      ? ''
      : 'Please enter a valid email address';
  },

  phone: (value: unknown): string => {
    if (!value) return '';
    const strValue = String(value);
    const isInternational = strValue.startsWith('+');
    const isValid = isInternational
      ? isValidPhoneNumber(strValue)
      : isValidPhoneNumber(strValue, 'KE');
    return isValid ? '' : 'Please enter a valid phone number';
  },

  number: (value: unknown): string => {
    if (value === undefined || value === null || value === '') return '';
    const str = String(value).trim();
    if (!str) return 'Please enter a valid number';
    const numRegex = /^-?\d+(\.\d+)?$/;
    return numRegex.test(str) ? '' : 'Please enter a valid number';
  },

  minLength:
    (min: number) =>
    (value: unknown): string => {
      if (!value) return '';
      return String(value).length >= min ? '' : `Must be at least ${min} characters`;
    },

  maxLength:
    (max: number) =>
    (value: unknown): string => {
      if (!value) return '';
      return String(value).length <= max ? '' : `Must be at most ${max} characters`;
    },

  password: (value: unknown): string => {
    if (!value) return '';
    const str = String(value);
    const hasUpperCase = /[A-Z]/.test(str);
    const hasLowerCase = /[a-z]/.test(str);
    const hasNumbers = /\d/.test(str);
    const hasMinLength = str.length >= 8;

    if (!hasMinLength) return 'Password must be at least 8 characters';
    if (!hasUpperCase) return 'Password must contain at least one uppercase letter';
    if (!hasLowerCase) return 'Password must contain at least one lowercase letter';
    if (!hasNumbers) return 'Password must contain at least one number';

    return '';
  },

  date: (value: unknown): string => {
    if (!value) return '';
    const date = new Date(String(value));
    return date instanceof Date && !Number.isNaN(date.getTime())
      ? ''
      : 'Please enter a valid date';
  },

  futureDate: (value: unknown): string => {
    if (!value) return '';
    const date = new Date(String(value));
    date.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date > today ? '' : 'Date must be in the future';
  },

  pastDate: (value: unknown): string => {
    if (!value) return '';
    const date = new Date(String(value));
    date.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today ? '' : 'Date must be in the past';
  },

  amount: (value: unknown): string => {
    if (value === undefined || value === null || value === '') return '';
    const str = String(value).trim();
    const amountRegex = /^\d+(\.\d+)?$/;
    if (!amountRegex.test(str)) return 'Please enter a valid amount';
    return parseFloat(str) > 0 ? '' : 'Amount must be greater than zero';
  },

  url: (value: unknown): string => {
    if (!value) return '';
    try {
      new URL(String(value));
      return '';
    } catch {
      return 'Please enter a valid URL';
    }
  },

  custom:
    (validator: CustomValidator) =>
    (value: unknown): string => {
      return validator(value);
    },

  combine:
    (...validators: Validator[]) =>
    (value: unknown): string => {
      for (const validator of validators) {
        const error = validator(value);
        if (error) return error;
      }
      return '';
    },
};

export const validateField = (
  value: unknown,
  validators: Validator | Validator[],
): string => {
  const validatorArray = Array.isArray(validators) ? validators : [validators];

  for (const validator of validatorArray) {
    const error = validator(value);
    if (error) return error;
  }

  return '';
};

export const validateFields = <T extends Record<string, any>>(
  fields: T,
  validators: Record<string, Validator | Validator[]>,
): { isValid: boolean; errors: Record<string, string> } => {
  const errors: Record<string, string> = {};

  for (const [field, value] of Object.entries(fields)) {
    if (validators[field]) {
      const error = validateField(value, validators[field]);
      if (error) {
        errors[field] = error;
      }
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};
