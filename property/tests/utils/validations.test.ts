import { validateField, validateFields, validations } from '@/shared/utils/validations';

describe('Validations Utility', () => {
  describe('required', () => {
    it('returns an error for undefined, null, or empty string', () => {
      expect(validations.required(undefined)).toBe('This field is required');
      expect(validations.required(null)).toBe('This field is required');
      expect(validations.required('')).toBe('This field is required');
    });

    it('returns empty string for valid inputs', () => {
      expect(validations.required('hello')).toBe('');
      expect(validations.required(0)).toBe(''); // 0 is valid
      expect(validations.required(false)).toBe(''); // false is valid
    });
  });

  describe('email', () => {
    it('returns empty string for empty input', () => {
      expect(validations.email('')).toBe('');
    });

    it('returns error for invalid email', () => {
      expect(validations.email('invalid-email')).toBe(
        'Please enter a valid email address',
      );
      expect(validations.email('test@')).toBe('Please enter a valid email address');
      expect(validations.email('@example.com')).toBe(
        'Please enter a valid email address',
      );
    });

    it('returns empty string for valid email', () => {
      expect(validations.email('test@example.com')).toBe('');
      expect(validations.email('user.name+tag@domain.co.uk')).toBe('');
    });
  });

  describe('phone', () => {
    it('returns empty string for empty input', () => {
      expect(validations.phone('')).toBe('');
    });

    it('returns error for invalid phone number', () => {
      expect(validations.phone('12345')).toBe('Please enter a valid phone number'); // Too short
      expect(validations.phone('abc')).toBe('Please enter a valid phone number');
    });

    it('returns empty string for valid phone numbers', () => {
      expect(validations.phone('0712345678')).toBe('');
      expect(validations.phone('+254712345678')).toBe('');
      expect(validations.phone('254-712-345-678')).toBe('');
      expect(validations.phone('+1 800 555 1234')).toBe('');
    });
  });

  describe('number', () => {
    it('returns empty string for empty input', () => {
      expect(validations.number('')).toBe('');
    });

    it('returns error for invalid numbers', () => {
      expect(validations.number('abc')).toBe('Please enter a valid number');
    });

    it('returns empty string for valid numbers', () => {
      expect(validations.number('123')).toBe('');
      expect(validations.number('-12.5')).toBe('');
      expect(validations.number(0)).toBe('');
    });
  });

  describe('minLength and maxLength', () => {
    it('validates minLength correctly', () => {
      const min3 = validations.minLength(3);
      expect(min3('')).toBe('');
      expect(min3('ab')).toBe('Must be at least 3 characters');
      expect(min3('abc')).toBe('');
    });

    it('validates maxLength correctly', () => {
      const max3 = validations.maxLength(3);
      expect(max3('')).toBe('');
      expect(max3('abcd')).toBe('Must be at most 3 characters');
      expect(max3('abc')).toBe('');
    });
  });

  describe('password', () => {
    it('returns empty string for empty input', () => {
      expect(validations.password('')).toBe('');
    });

    it('validates password requirements', () => {
      expect(validations.password('short')).toBe(
        'Password must be at least 8 characters',
      );
      expect(validations.password('alllowercase1')).toBe(
        'Password must contain at least one uppercase letter',
      );
      expect(validations.password('ALLUPPERCASE1')).toBe(
        'Password must contain at least one lowercase letter',
      );
      expect(validations.password('NoNumbersHere')).toBe(
        'Password must contain at least one number',
      );
      expect(validations.password('Valid1Password')).toBe('');
    });
  });

  describe('amount', () => {
    it('returns empty string for empty input', () => {
      expect(validations.amount('')).toBe('');
    });

    it('validates amount must be positive number', () => {
      expect(validations.amount('abc')).toBe('Please enter a valid amount');
      expect(validations.amount('-10')).toBe('Please enter a valid amount');
      expect(validations.amount('0')).toBe('Amount must be greater than zero');
      expect(validations.amount('10.5')).toBe('');
    });
  });

  describe('combine', () => {
    it('combines multiple validators', () => {
      const combined = validations.combine(validations.required, validations.email);

      expect(combined('')).toBe('This field is required');
      expect(combined('invalid')).toBe('Please enter a valid email address');
      expect(combined('test@example.com')).toBe('');
    });
  });

  describe('date', () => {
    it('returns empty string for empty input', () => {
      expect(validations.date('')).toBe('');
    });

    it('validates date correctness', () => {
      expect(validations.date('invalid-date')).toBe('Please enter a valid date');
      expect(validations.date('2023-15-40')).toBe('Please enter a valid date');
      expect(validations.date('2023-12-01')).toBe('');
      expect(validations.date(new Date())).toBe('');
    });
  });

  describe('futureDate', () => {
    it('returns empty string for empty input', () => {
      expect(validations.futureDate('')).toBe('');
    });

    it('validates date is in the future', () => {
      const past = new Date();
      past.setDate(past.getDate() - 1);
      const future = new Date();
      future.setDate(future.getDate() + 1);
      expect(validations.futureDate(past)).toBe('Date must be in the future');
      expect(validations.futureDate(new Date())).toBe('Date must be in the future'); // Today is not future
      expect(validations.futureDate(future)).toBe('');
    });
  });

  describe('pastDate', () => {
    it('returns empty string for empty input', () => {
      expect(validations.pastDate('')).toBe('');
    });

    it('validates date is in the past', () => {
      const past = new Date();
      past.setDate(past.getDate() - 1);
      const future = new Date();
      future.setDate(future.getDate() + 1);

      expect(validations.pastDate(future)).toBe('Date must be in the past');
      expect(validations.pastDate(new Date())).toBe('Date must be in the past'); // Today is not past
      expect(validations.pastDate(past)).toBe('');
    });
  });

  describe('url', () => {
    it('returns empty string for empty input', () => {
      expect(validations.url('')).toBe('');
    });

    it('validates URL correctly', () => {
      expect(validations.url('invalid-url')).toBe('Please enter a valid URL');
      expect(validations.url('www.example.com')).toBe('Please enter a valid URL'); // Missing protocol
      expect(validations.url('https://example.com')).toBe('');
      expect(validations.url('http://localhost:3000')).toBe('');
    });
  });

  describe('custom', () => {
    it('executes custom validation function', () => {
      const isEven = validations.custom(val => {
        return Number(val) % 2 === 0 ? '' : 'Must be an even number';
      });

      expect(isEven(3)).toBe('Must be an even number');
      expect(isEven(4)).toBe('');
    });
  });

  describe('validateField and validateFields', () => {
    it('validateField checks single value against multiple validators', () => {
      expect(validateField('', [validations.required])).toBe('This field is required');
      expect(validateField('valid', [validations.required])).toBe('');
    });

    it('validateFields checks multiple fields and returns valid state', () => {
      const fields = {
        name: 'John',
        email: 'invalid',
        age: 25,
      };

      const rules = {
        name: validations.required,
        email: [validations.required, validations.email],
        age: validations.number,
      };

      const result = validateFields(fields, rules);
      expect(result.isValid).toBe(false);
      expect(result.errors.email).toBe('Please enter a valid email address');
      expect(result.errors.name).toBeUndefined();
    });

    it('validateFields returns isValid true when all pass', () => {
      const fields = { name: 'John', email: 'test@example.com' };
      const rules = {
        name: validations.required,
        email: [validations.required, validations.email],
      };

      const result = validateFields(fields, rules);
      expect(result.isValid).toBe(true);
      expect(Object.keys(result.errors).length).toBe(0);
    });
  });
});
