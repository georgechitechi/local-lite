import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {
  type Currency,
  formatWithCurrency,
  getDefaultCurrency,
  numberToWords,
} from '@/shared/utils/formatters';

interface Business {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
}

interface RefundDetails {
  id: string;
  receipt_id: string;
  amount: number;
  reason: string;
  created_at: string;
  tenantName: string;
  tenantPhone?: string;
  propertyName?: string;
  houseNumber?: string;
  originalAmount: number;
  paymentMethod: string;
  linked_payment_messages?: { message_content: string }[];
}

export const generateAndShareRefundVoucher = async (
  refund: RefundDetails,
  business: Business | null,
): Promise<void> => {
  try {
    if (!business) {
      throw new Error('Business profile not found.');
    }

    const currency = await getDefaultCurrency(business.id);
    const { uri } = await Print.printToFileAsync({
      html: generateRefundVoucherHTML(refund, business, currency),
    });

    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: `Refund Voucher - ${refund.id}`,
      UTI: 'com.adobe.pdf',
    });
  } catch (error) {
    console.error('Error sharing refund voucher:', error);
    throw error;
  }
};

const generateRefundVoucherHTML = (
  refund: RefundDetails,
  business: Business,
  currency: Currency,
): string => {
  const formattedAmount = formatWithCurrency(refund.amount, currency);
  const amountInWords = numberToWords(refund.amount);
  const voucherNo = refund.id.slice(-6).toUpperCase();

  return `
    <html>
      <head>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&family=JetBrains+Mono:wght@700&display=swap');
          
          body { 
            padding: 25px 40px; 
            font-family: 'Inter', Arial, sans-serif;
            color: #333;
            line-height: 1.4;
            max-width: 800px;
            margin: 0 auto;
            font-size: 13px;
          }
          
          .business-header {
            text-align: center;
            margin-bottom: 20px;
            border-bottom: 1px solid #eee;
            padding-bottom: 15px;
          }

          .business-name {
            font-size: 22px;
            font-weight: bold;
            margin-bottom: 5px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #cc4b4b;
          }

          .business-details {
            font-size: 12px;
            color: #666;
          }

          h2 {
            text-align: center;
            text-transform: uppercase;
            letter-spacing: 3px;
            margin: 20px 0;
            color: #333;
            font-size: 18px;
          }

          .voucher-meta {
            display: flex;
            justify-content: space-between;
            margin-bottom: 20px;
            padding: 15px;
            background: #fffafa;
            border-radius: 8px;
            border: 1px solid #f9ebeb;
            border-left: 5px solid #cc4b4b;
          }

          .meta-column {
            flex: 1;
          }

          .row {
            margin-bottom: 6px;
          }

          .label {
            font-weight: bold;
            display: inline-block;
            width: 100px;
            font-size: 11px;
            color: #777;
            text-transform: uppercase;
          }

          .value {
            font-weight: bold;
            color: #111;
          }

          /* VOUCHER CARD DESIGN - Softer Red */
          .voucher-card {
            background: linear-gradient(135deg, #cc4b4b 0%, #b03a3a 100%);
            border-radius: 20px;
            padding: 30px 40px;
            color: white;
            position: relative;
            box-shadow: 0 10px 25px rgba(176, 58, 58, 0.15);
            margin: 30px 0;
            overflow: hidden;
          }

          /* TICKET NOTCH DESIGN */
          .voucher-card::before, .voucher-card::after {
            content: '';
            position: absolute;
            width: 30px;
            height: 30px;
            background: white;
            border-radius: 50%;
            top: 50%;
            transform: translateY(-50%);
          }
          .voucher-card::before { left: -15px; }
          .voucher-card::after { right: -15px; }

          .card-header {
            text-transform: uppercase;
            letter-spacing: 3px;
            font-size: 10px;
            font-weight: 700;
            opacity: 0.8;
            margin-bottom: 20px;
            text-align: center;
          }

          .card-main {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }

          .amount-section {
            flex: 1;
          }

          .amount-label {
            font-size: 11px;
            opacity: 0.9;
            margin-bottom: 5px;
            text-transform: uppercase;
          }

          .amount-value {
            font-size: 36px;
            font-weight: 900;
          }

          .voucher-type-label {
            background: rgba(255, 255, 255, 0.2);
            padding: 8px 15px;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.3);
            text-align: center;
          }

          .type-text {
            font-size: 18px;
            font-weight: bold;
            letter-spacing: 2px;
            margin: 0;
          }

          .voucher-description {
            margin-top: 25px;
            font-size: 14px;
            border-top: 1px dashed rgba(255, 255, 255, 0.3);
            padding-top: 15px;
            line-height: 1.6;
          }

          .words-container {
            margin-top: 10px;
            font-size: 11px;
            font-style: italic;
            opacity: 0.8;
          }

          .signatures {
            display: flex;
            justify-content: space-between;
            margin-top: 40px;
            gap: 40px;
          }

          .signature-box {
            flex: 1;
            text-align: center;
          }

          .signature-line {
            border-bottom: 1px solid #333;
            margin-bottom: 8px;
          }

          .sig-label {
            font-size: 10px;
            font-weight: bold;
            text-transform: uppercase;
            color: #777;
          }

          .messages-section {
            margin-top: 20px;
            background: #f9f9f9;
            padding: 15px;
            border-radius: 8px;
            border: 1px solid #eee;
          }

          .message-title {
            font-size: 11px;
            font-weight: bold;
            color: #d32f2f;
            margin-bottom: 10px;
            text-transform: uppercase;
          }

          .message-item {
            font-size: 11px;
            color: #666;
            margin-bottom: 5px;
            padding-left: 10px;
            border-left: 2px solid #d32f2f;
          }

          .footer {
            margin-top: 50px;
            text-align: center;
            font-size: 10px;
            color: #999;
            border-top: 1px solid #eee;
            padding-top: 15px;
          }
        </style>
      </head>
      <body>
        <div class="business-header">
          <div class="business-name">${business.name}</div>
          <div class="business-details">
            ${business.address || ''}<br>
            Phone: ${business.phone || ''} | Email: ${business.email || ''}
          </div>
        </div>

        <h2>REFUND VOUCHER</h2>

        <div class="voucher-meta">
          <div class="meta-column">
            <div class="row">
              <span class="label">Voucher No:</span>
              <span class="value">#${voucherNo}</span>
            </div>
            <div class="row">
              <span class="label">Date:</span>
              <span class="value">${new Date(refund.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
            </div>
            <div class="row">
              <span class="label">Ref. Receipt:</span>
              <span class="value">#${refund.receipt_id.slice(-6).toUpperCase()}</span>
            </div>
          </div>
          <div class="meta-column" style="text-align: right;">
            <div class="row">
              <span class="label">Tenant:</span>
              <span class="value">${refund.tenantName}</span>
            </div>
            <div class="row">
              <span class="label">Property:</span>
              <span class="value">${refund.propertyName || 'N/A'}</span>
            </div>
            <div class="row">
              <span class="label">Unit:</span>
              <span class="value">${refund.houseNumber || 'N/A'}</span>
            </div>
          </div>
        </div>

        <div class="voucher-card">
          <div class="card-header">Official Payment Refund Certificate</div>
          <div class="card-main">
            <div class="amount-section">
              <div class="amount-label">Refund Amount</div>
              <div class="amount-value">${formattedAmount}</div>
              <div class="words-container">
                (${amountInWords} ${currency.name} Only)
              </div>
            </div>
            <div class="voucher-type-label">
              <div class="type-text">REFUND</div>
            </div>
          </div>
          <div class="voucher-description">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
              <strong>Reason for Refund:</strong>
              <span style="font-size: 11px; opacity: 0.8;">
                Original Method: ${refund.paymentMethod.toUpperCase()}
              </span>
            </div>
            “${refund.reason || 'Professional refund for adjustment/overpayment.'}”
          </div>
        </div>

        ${
          refund.linked_payment_messages && refund.linked_payment_messages.length > 0
            ? `
          <div class="messages-section">
            <div class="message-title">Linked Transaction References</div>
            ${refund.linked_payment_messages
              .map(
                msg => `
              <div class="message-item">
                "${msg.message_content}"
              </div>
            `,
              )
              .join('')}
          </div>
        `
            : ''
        }

        <div class="signatures">
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="sig-label">Authorized Signature</div>
            <div class="value" style="font-size: 11px; margin-top: 5px;">${business.name}</div>
          </div>
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="sig-label">Receiver's Signature</div>
            <div class="value" style="font-size: 11px; margin-top: 5px;">${refund.tenantName}</div>
          </div>
        </div>

        <div class="footer">
          <p>This is a computer-generated voucher and does not require a physical signature.</p>
          <p>&copy; ${new Date().getFullYear()} ${business.name}. All rights reserved.</p>
        </div>
      </body>
    </html>
  `;
};
