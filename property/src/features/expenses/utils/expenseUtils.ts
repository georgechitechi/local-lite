/**
 * Expense Utilities - Local-First
 *
 * This file contains type definitions, constants, and helper functions for expenses.
 * All CRUD operations are handled through local-lite store in UI components.
 */

export interface ExpenseCategory {
  key: string;
  label: string;
  description: string;
  icon: string;
  color: string;
}

export const EXPENSE_CATEGORY: ExpenseCategory[] = [
  {
    key: 'Utilities',
    label: 'Utilities',
    description: 'Electricity, water, gas, and other utility bills',
    icon: 'flash',
    color: 'primary',
  },
  {
    key: 'Maintenance',
    label: 'Maintenance',
    description: 'Repairs, renovations, and general property maintenance',
    icon: 'wrench',
    color: 'warning',
  },
  {
    key: 'Other',
    label: 'Other',
    description: 'Miscellaneous expenses not covered by other categories',
    icon: 'tag-multiple',
    color: 'secondary',
  },
];

/**
 * Helper function to get category details by key
 * @param key - The category key to look up
 * @returns The category details or the last category as fallback
 */
export const getCategoryDetails = (key: string): ExpenseCategory => {
  return (
    EXPENSE_CATEGORY.find(category => category.key === key) ||
    EXPENSE_CATEGORY[EXPENSE_CATEGORY.length - 1]
  );
};

/**
 * Normalizes tokens by stripping non-numeric characters.
 */
export const normalizeToken = (token: string): string => token.replace(/[^0-9]/g, '');

/**
 * Extracts a token number (e.g. 20-digit KPLC prepaid token or 16-20 digits) from text/remarks.
 */
export const extractTokenNumber = (text?: string | null): string | null => {
  if (!text) return null;

  // 1. Look for explicit Token prefix: e.g. Token: 1234... or Token# 1234...
  const explicitMatch = text.match(/(?:token|tkn)[\s:#*-]*([0-9\s-]{11,25})/i);
  if (explicitMatch) {
    const cleaned = normalizeToken(explicitMatch[1]);
    if (cleaned.length >= 11 && cleaned.length <= 20) {
      return cleaned;
    }
  }

  // 2. Look for 20-digit pattern with optional spaces/hyphens (e.g., 4x5 groups or continuous)
  const pattern20 = text.match(/\b(?:\d{4}[-\s]?){4}\d{4}\b|\b\d{20}\b/);
  if (pattern20) {
    const cleaned = normalizeToken(pattern20[0]);
    if (cleaned.length === 20) return cleaned;
  }

  // 3. Look for 16-digit pattern with optional spaces/hyphens
  const pattern16 = text.match(/\b(?:\d{4}[-\s]?){3}\d{4}\b|\b\d{16}\b/);
  if (pattern16) {
    const cleaned = normalizeToken(pattern16[0]);
    if (cleaned.length === 16) return cleaned;
  }

  return null;
};

/**
 * Extracts transaction reference (e.g. M-Pesa 10-char alphanumeric code).
 */
export const extractTransactionRef = (text?: string | null): string | null => {
  if (!text) return null;
  const explicit = text.match(/(?:ref|receipt|code|trn|tx)[\s:#*-]*([A-Z0-9]{8,12})/i);
  if (explicit) return explicit[1].toUpperCase();

  // Standard Kenyan M-Pesa format (e.g. 10 alphanumeric characters starting with letter)
  const mpesaMatch = text.match(/\b([A-Z][A-Z0-9]{9})\b/);
  if (mpesaMatch) return mpesaMatch[1].toUpperCase();

  return null;
};

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  type?: 'token' | 'reference' | 'exact_match';
  existingExpense?: any;
  message?: string;
}

/**
 * Checks if an expense candidate is a duplicate against existing expenses.
 */
export const checkExpenseDuplicate = (
  candidate: {
    id?: string | null;
    amount: number;
    category?: string;
    date?: string;
    remarks?: string;
  },
  existingExpenses: any[],
): DuplicateCheckResult => {
  if (!existingExpenses || !Array.isArray(existingExpenses)) {
    return { isDuplicate: false };
  }

  const otherExpenses = existingExpenses.filter(
    e => e && !e.deleted && e.id !== candidate.id,
  );

  const candidateRemarks = candidate.remarks || '';
  const candidateToken = extractTokenNumber(candidateRemarks);

  // 1. Check for duplicate token (Highest confidence)
  if (candidateToken) {
    const match = otherExpenses.find(e => {
      const existingToken = extractTokenNumber(e.remarks);
      return existingToken === candidateToken;
    });

    if (match) {
      const formattedToken = candidateToken.replace(/(.{4})/g, '$1-').replace(/-$/, '');
      return {
        isDuplicate: true,
        type: 'token',
        existingExpense: match,
        message: `Token #${formattedToken} was already recorded on ${match.date} for ${match.amount}.`,
      };
    }
  }

  // 2. Check for duplicate transaction reference
  const candidateRef = extractTransactionRef(candidateRemarks);
  if (candidateRef) {
    const match = otherExpenses.find(e => {
      const existingRef = extractTransactionRef(e.remarks);
      return existingRef === candidateRef;
    });

    if (match) {
      return {
        isDuplicate: true,
        type: 'reference',
        existingExpense: match,
        message: `Transaction reference "${candidateRef}" was already recorded on ${match.date} for ${match.amount}.`,
      };
    }
  }

  // 3. Exact match check: same category, date, and amount with identical remarks
  if (candidate.category && candidate.date && candidate.amount > 0) {
    const match = otherExpenses.find(e => {
      const sameCategory = e.category === candidate.category;
      const sameDate = e.date === candidate.date;
      const sameAmount = Math.abs(Number(e.amount) - Number(candidate.amount)) < 0.01;
      if (!sameCategory || !sameDate || !sameAmount) return false;

      const normCandidateRemarks = candidateRemarks.trim().toLowerCase();
      const normExistingRemarks = (e.remarks || '').trim().toLowerCase();
      return (
        normCandidateRemarks === normExistingRemarks ||
        (!normCandidateRemarks && !normExistingRemarks)
      );
    });

    if (match) {
      return {
        isDuplicate: true,
        type: 'exact_match',
        existingExpense: match,
        message: `An identical expense (${candidate.category}, ${candidate.amount}) on ${candidate.date} already exists.`,
      };
    }
  }

  return { isDuplicate: false };
};
