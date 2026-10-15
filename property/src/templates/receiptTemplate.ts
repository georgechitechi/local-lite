import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { PaymentMessage } from '@/shared/types/types';
import {
  type Currency,
  formatPeriod,
  formatWithCurrency,
  getDefaultCurrency,
  numberToWords,
} from '@/shared/utils/formatters';
import { maskPhoneNumber, properCase, snakeCaseToTitleCase } from '@/shared/utils/helper';

type ReceiptStatus = 'paid' | 'partial' | 'pending';

const getWatermarkColor = (status: string, isPromo: boolean = false): string => {
  if (isPromo) return '#9C27B0'; // Purple for Promos
  switch (status) {
    case 'paid':
      return '#4CAF50';
    case 'partial':
      return '#FF9800';
    case 'pending':
      return '#F44336';
    default:
      return '#999999';
  }
};

interface Business {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
}

interface Receipt {
  id: string;
  amount: number | string;
  payment_date: string;
  payment_period: { month: number; year: number };
  status: ReceiptStatus;
  type?: string;
  payment_method?: string;
  notes?: string;
  tenantName?: string;
  tenantPhone?: string;
  linked_payment_messages?: PaymentMessage[];
  target_rent?: number | string;
  contract?: {
    rent_amount?: number | string;
    house?: {
      house_number?: string;
    };
  };
}

export const generateAndShareReceipt = async (
  receipt: Receipt,
  business: Business | null,
): Promise<void> => {
  try {
    if (!business) {
      throw new Error(
        'Business profile not found. Please set up business profile first.',
      );
    }

    const currency = await getDefaultCurrency(business.id);
    const { uri } = await Print.printToFileAsync({
      html: generateReceiptHTML(receipt, business, currency),
    });

    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: `Receipt #${receipt.id}`,
      UTI: 'com.adobe.pdf',
    });
  } catch (error) {
    console.error('Error sharing receipt:', error);
    throw error;
  }
};

export const generateReceiptHTML = (
  receipt: Receipt,
  business: Business,
  currency: Currency,
): string => {
  const periodText = formatPeriod(receipt.payment_period);
  const roomNumber = receipt.contract?.house?.house_number || 'N/A';
  const formattedAmount = formatWithCurrency(
    parseFloat(String(receipt.amount)),
    currency,
  );

  // Get linked payment messages if available
  const linkedMessages = receipt.linked_payment_messages || [];

  // Calculate balance if not fully paid
  const targetAmount = parseFloat(
    String(receipt.target_rent || receipt.contract?.rent_amount || 0),
  );
  const paidAmount = parseFloat(String(receipt.amount || 0));
  const balance = targetAmount - paidAmount;
  const isFullyPaid = balance <= 0.1;

  const isPromo = receipt.type === 'promo' || receipt.payment_method === 'promo';
  let promoCode = '';
  // Extract promo code from notes structured like "Applied adjustment: CODE_HERE (Amount)"
  if (isPromo && receipt.notes) {
    const match = receipt.notes.match(/Applied adjustment:\s+([^\s]+)/);
    if (match?.[1]) {
      promoCode = match[1];
    }
  }

  return `
    <html>
      <head>
        <style>
          body { 
            padding: 25px 40px; 
            font-family: Arial, sans-serif;
            color: #333;
            line-height: 1.2;
            max-width: 800px;
            margin: 0 auto;
            font-size: 13px;
          }
          
          h2 {
            text-align: center;
            color: #333;
            border-bottom: 1px solid #333;
            padding-bottom: 6px;
            margin-bottom: 12px;
            font-size: 18px;
          }

          .business-header {
            text-align: center;
            margin-bottom: 12px;
          }

          .business-name {
            font-size: 20px;
            font-weight: bold;
            margin-bottom: 3px;
          }

          .business-details {
            font-size: 12px;
            color: #666;
          }

          .receipt-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 12px;
            line-height: 1.0;
          }

          .receipt-section {
            flex: 1;
          }

          .center {
            text-align: center;
          }

          .right {
            text-align: right;
          }

          .bold {
            font-weight: bold;
          }

          .row {
            margin-bottom: 6px;
          }

          .label {
            font-weight: bold;
            display: inline-block;
            width: 85px;
            font-size: 12px;
          }

          .declaration {
            line-height: 1.5;
            text-align: justify;
            padding: 12px;
            margin: 12px 0;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 12px;
          }

          .signatures {
            display: flex;
            justify-content: space-between;
            margin-top: 18px;
            padding-top: 12px;
            border-top: 1px solid #ddd;
          }

          .signature {
            width: 40%;
            text-align: center;
            font-size: 11px;
          }

          .signature-line {
            border-bottom: 1px solid #333;
            margin-bottom: 5px;
          }

          .footer {
            margin-top: 12px;
            padding-top: 6px;
            border-top: 1px solid #ddd;
            text-align: center;
            font-size: 10px;
            color: #666;
            line-height: 1.0;
          }

          .watermark {
            position: fixed;
            top: 35%;
            left: 50%;
            transform: translate(-50%, -20%) rotate(-45deg);
            font-size: 50px;
            font-weight: bold;
            color: ${getWatermarkColor(receipt.status, isPromo)};
            opacity: 0.1;
            z-index: 1000;
            border: 2px solid ${getWatermarkColor(receipt.status, isPromo)};
            border-width: 4;
            border-radius: 8px;
            padding: 8;
          }
          .notes {
            font-size: 11px;
            color: #666;
            line-height: 1.1;
            white-space: pre-line;
            text-align: justify;
            padding: 16px;
            margin: 16px 0;
            border: 1px solid #ddd;
            border-radius: 4px;
          }
          
          .linked-messages {
            margin: 8px 0;
            padding: 8px;
            border: 1px solid #e0e0e0;
            border-radius: 4px;
            background-color: #f9f9f9;
          }
          
          .linked-messages h3 {
            margin: 0 0 6px 0;
            font-size: 11px;
            color: #333;
            border-bottom: 1px solid #ddd;
            padding-bottom: 4px;
          }
          
          .messages-container {
            background-color: white;
            border: 1px solid #e0e0e0;
            border-radius: 3px;
            padding: 6px;
            font-size: 11px;
          }
          
          .message-content {
            margin-bottom: 8px;
            color: #333;
            line-height: 1.2;
          }
          
          .balance-section {
            margin: 8px 0;
            padding: 8px;
            border: 1px solid #ff9800;
            border-radius: 4px;
            background-color: #fff3e0;
          }
          
          .balance-section h3 {
            margin: 0 0 6px 0;
            font-size: 11px;
            color: #e65100;
            border-bottom: 1px solid #ff9800;
            padding-bottom: 4px;
          }
          
          .balance-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 4px;
            font-size: 10px;
          }
          
          .balance-label {
            font-weight: bold;
            color: #333;
          }
          
          .balance-amount {
            font-weight: bold;
            color: #e65100;
          }
          
          .balance-due {
            border-top: 1px solid #ff9800;
            padding-top: 4px;
            margin-top: 4px;
            font-size: 11px;
            font-weight: bold;
            color: #d84315;
          }

          /* PROMO CARD STYLES */
          .promo-card {
            background: #f8f0fc; /* Light purple background */
            border: 1px solid #9C27B0; /* Outline border */
            border-radius: 8px;
            padding: 12px 16px;
            color: #9C27B0; /* Purple text */
            margin: 16px 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }

          .promo-details {
            flex: 1;
            padding-left: 5px;
          }

          .promo-title {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 1px;
            opacity: 0.9;
            margin-bottom: 4px;
            color: #6a1b9a;
          }

          .promo-amount {
            font-size: 18px;
            font-weight: bold;
            color: #4a148c;
          }

          .promo-code-box {
            background: rgba(156, 39, 176, 0.1);
            padding: 6px 12px;
            border-radius: 6px;
            border: 1px dashed #9C27B0;
            text-align: center;
            margin-right: 5px;
          }

          .promo-code-text {
            font-family: monospace;
            font-size: 14px;
            letter-spacing: 2px;
            font-weight: bold;
            color: #4a148c;
          }
        </style>
      </head>
      <body>
        ${isPromo ? '' : `<div class="watermark">${receipt.status.toUpperCase()}</div>`}
        
        <div class="business-header">
          <div class="business-name">${business.name}</div>
          <div class="business-details">
            ${business.address || ''}<br>
            Phone: ${business.phone || ''}<br>
            Email: ${business.email || ''}
          </div>
        </div>

        <h2>${isPromo ? 'ADJUSTMENT RECEIPT' : 'PAYMENT RECEIPT'}</h2>

        <div class="receipt-header">
          <div class="receipt-section">
            <div class="row">
              <span class="label">Receipt No:</span>
              <span class="bold">#${receipt.id.slice(-6).toUpperCase()}</span>
            </div>
            <div class="row">
              <span class="label">Date:</span>
              <span>${new Date(receipt.payment_date).toDateString()}</span>
            </div>
            <div class="row">
              <span class="label">Status:</span>
              <span class="bold">${receipt.status.toUpperCase()}</span>
            </div>
          </div>

          <div class="receipt-section">
            <div class="row">
              <span class="label">Tenant:</span>
              <span class="bold">${receipt.tenantName || 'N/A'}</span>
            </div>
            <div class="row">
              <span class="label">Room:</span>
              <span>${roomNumber}</span>
            </div>
            <div class="row">
              <span class="label">Phone:</span>
              <span>${receipt.tenantPhone || 'N/A'}</span>
            </div>
          </div>
        </div>

        <div class="declaration">
          ${
            isPromo
              ? `Credit and adjustment of <span class="bold">${formattedAmount} (${numberToWords(
                  parseFloat(String(receipt.amount)),
                )} ${currency.name})</span> was applied to <span class="bold">${
                  receipt.tenantName || 'N/A'
                }</span>${receipt.type === 'others' ? '.' : ` for the month of <span class="bold">${periodText}</span>.`}`
              : `Received from <span class="bold">${
                  receipt.tenantName || 'N/A'
                }</span> the sum of <span class="bold">${formattedAmount} (${numberToWords(
                  parseFloat(String(receipt.amount)),
                )} ${currency.name})</span> only being payment of <span class="bold"> ${
                  receipt.type === 'others'
                    ? maskPhoneNumber(receipt.notes) || 'Others'
                    : receipt?.type
                      ? snakeCaseToTitleCase(receipt.type)
                      : ''
                }</span>${
                  receipt.type === 'others'
                    ? '.'
                    : ` for the month of <span class="bold">${periodText}</span>.`
                }`
          }

        ${
          !isFullyPaid && targetAmount > 0
            ? `
          <div class="balance-section">
            <h3>Payment Balance</h3>
            <div class="balance-row">
              <span class="balance-label">Target Rent:</span>
              <span class="balance-amount">${formatWithCurrency(
                targetAmount,
                currency,
              )}</span>
            </div>
            <div class="balance-row">
              <span class="balance-label">Amount Paid:</span>
              <span class="balance-amount">${formattedAmount}</span>
            </div>
            <div class="balance-due">
              <div class="balance-row">
                <span class="balance-label">Balance Due:</span>
                <span class="balance-amount">${formatWithCurrency(
                  balance,
                  currency,
                )}</span>
              </div>
            </div>
          </div>
        `
            : ''
        }

        ${
          linkedMessages.length > 0
            ? `
          <div class="linked-messages">
            <h3>Linked Payment Messages (${linkedMessages.length})</h3>
            <div class="messages-container">
              <div class="message-content">Payment method: <span class="bold">${
                receipt.payment_method ? properCase(receipt.payment_method) : ''
              }</span></div>
              ${linkedMessages
                .map(
                  message => `
                <div class="message-content">${message.message_content}</div>
              `,
                )
                .join('')}
            </div>
          </div>
        `
            : ''
        }

        ${
          receipt.notes && linkedMessages.length === 0
            ? `
          <div class="notes">
            <div class="message-content">Payment method: <span class="bold">${
              receipt.payment_method ? properCase(receipt.payment_method) : ''
            }</span></div>
            ${maskPhoneNumber(receipt.notes)}
          </div>
        `
            : ''
        }

        ${
          isPromo && promoCode
            ? `
          <div class="promo-card">
            <div class="promo-details">
              <div class="promo-title">Adjustment Value</div>
              <div class="promo-amount">${formattedAmount}</div>
            </div>
            <div class="promo-code-box">
              <div class="promo-title">Promo Code</div>
              <div class="promo-code-text">${promoCode}</div>
            </div>
          </div>
        `
            : ''
        }

        <div class="signatures">
          <div class="signature">
            <p class="bold">${business.name}</p>
            <div class="signature-line"></div>
            <p>Received By</p>
          </div>
          <div class="signature">
            <p class="bold">${receipt.tenantName || 'N/A'}</p>
            <div class="signature-line"></div>
            <p>Tenant Signature</p>
          </div>
        </div>

        <div class="footer">
          <p>This is a computer-generated receipt and does not require a physical signature.</p>
          <p>For any queries regarding this receipt, please contact ${
            business.phone || ''
          } or email ${business.email || ''}</p>
          <p>© ${new Date().getFullYear()} ${business.name}. All rights reserved.</p>
        </div>
      </body>
    </html>
  `;
};
