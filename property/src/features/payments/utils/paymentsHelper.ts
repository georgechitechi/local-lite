import type * as T from '@/shared/types/types';
import { generateUUID } from '@/shared/utils/helper';

export type PaymentMethod = T.PaymentMethod;
export type PaymentMethodDisplayInfo = T.PaymentMethodDisplayInfo;
export type PaymentMethodType = T.PaymentMethodType;

export const defaultPaymentMethods: PaymentMethod[] = [
  {
    id: generateUUID(),
    type: 'paybill',
    paybill_number: '000000',
    account_number: '0000000000000',
    default: true,
  },
];

const paymentMethodTypes: PaymentMethodType[] = [
  {
    name: 'paybill',
    fields: [
      { key: 'paybill_number', label: 'Paybill Number', type: 'numeric', required: true },
      {
        key: 'account_number',
        label: 'Account Number',
        type: 'text',
        required: true,
      },
      {
        key: 'business_name',
        label: 'Business Name',
        type: 'text',
        required: false,
      },
    ],
  },
  {
    name: 'till',
    fields: [
      { key: 'till_number', label: 'Till Number', type: 'numeric', required: true },
      {
        key: 'business_name',
        label: 'Business Name',
        type: 'text',
        required: false,
      },
    ],
  },
  {
    name: 'bank',
    fields: [
      { key: 'bank_name', label: 'Bank Name', type: 'text', required: true },
      { key: 'account_number', label: 'Account Number', type: 'text', required: true },
      { key: 'account_name', label: 'Account Name', type: 'text', required: true },
    ],
  },
];

export const paymentTypes: Record<string, PaymentMethodType> = {
  paybill: paymentMethodTypes[0],
  till: paymentMethodTypes[1],
  bank: paymentMethodTypes[2],
};
export const getPaymentMethodDisplayInfo = (
  method: PaymentMethod,
): PaymentMethodDisplayInfo => {
  switch (method.type) {
    case 'paybill':
      return {
        title: `Paybill ${method.paybill_number}`,
        description: `Account: ${method.account_number}`,
        type: 'Paybill',
      };
    case 'till':
      return {
        title: `Till ${method.till_number}`,
        description: method.business_name || 'Payment Till',
        type: 'Till',
      };
    case 'bank':
      return {
        title: method.bank_name || 'Bank Transfer',
        description: `${method.account_number} (${method.account_name})`,
        type: 'Bank',
      };
    default:
      return {
        title: 'Payment Method',
        description: 'Unknown',
        type: 'Unknown',
      };
  }
};
