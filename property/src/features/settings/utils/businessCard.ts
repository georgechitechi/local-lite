import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';
import type { PaymentMethod } from '@/features/payments/utils/paymentsHelper';
import { getSyncClient } from '@/shared/services/sync/client';

interface Business {
  id?: string;
  name: string;
  logo_url?: string;
  address?: string;
  phone?: string;
  email?: string;
}

export const generateBusinessCard = async (business: Business): Promise<void> => {
  try {
    let defaultPaymentMethod: PaymentMethod | null = null;
    if (business.id) {
      try {
        const client = await getSyncClient();
        const rows = await client.findMany('settings', {
          where: { business_id: business.id, setting_key: 'payment_methods' },
        });
        const paymentSetting = rows?.[0];
        let methods: PaymentMethod[] = [];
        if (paymentSetting?.setting_value) {
          const val = paymentSetting.setting_value;
          methods = typeof val === 'string' ? JSON.parse(val) : val;
        }
        defaultPaymentMethod = methods.find(m => m.default) || methods[0] || null;
      } catch {}
    }

    const generatePaymentCardHtml = (paymentMethod: PaymentMethod | null): string => {
      if (!paymentMethod) return '';

      if (paymentMethod.type === 'paybill') {
        const paybillNumber = paymentMethod.paybill_number || '';
        const accountNumber = paymentMethod.account_number || '';
        const paybillDigitsHtml = paybillNumber
          .split('')
          .map(digit => `<div class="digit-box">${digit}</div>`)
          .join('');

        return `
          <!-- M-Pesa Paybill Card -->
          <div class="payment-card">
            <div class="payment-top-banner">
              <div class="payment-title-banner">LIPA NA M-PESA</div>
            </div>
            <div class="payment-content">
              <div class="payment-section-label">PAYBILL NUMBER</div>
              <div class="paybill-digits">
                ${paybillDigitsHtml}
              </div>
              <div class="payment-section-label">ACCOUNT NUMBER</div>
              <div class="account-number-box">${accountNumber}</div>
            </div>
          </div>
        `;
      }

      if (paymentMethod.type === 'till') {
        const tillNumber = paymentMethod.till_number || '';
        const businessName = paymentMethod.business_name || '';
        const tillDigitsHtml = tillNumber
          .split('')
          .map(digit => `<div class="digit-box">${digit}</div>`)
          .join('');

        return `
          <!-- M-Pesa Till Card -->
          <div class="payment-card">
            <div class="payment-top-banner">
              <div class="payment-title-banner">M-PESA BUY GOODS</div>
            </div>
            <div class="payment-content">
              <div class="payment-section-label">TILL NUMBER</div>
              <div class="paybill-digits">
                ${tillDigitsHtml}
              </div>
              <div class="payment-section-label">BUSINESS NAME</div>
              <div class="account-number-box">${businessName}</div>
            </div>
          </div>
        `;
      }

      if (paymentMethod.type === 'bank') {
        const bankName = paymentMethod.bank_name || '';
        const accountNumber = paymentMethod.account_number || '';
        const accountName = paymentMethod.account_name || '';

        return `
          <!-- Bank Account Card -->
          <div class="payment-card">
            <div class="payment-top-banner bank-banner">
              <div class="payment-title-banner">BANK ACCOUNT</div>
            </div>
            <div class="payment-content">
              <div class="payment-section-label">BANK DETAILS</div>
              <div class="bank-name-box">${bankName} <br> ${accountName}</div>
              <div class="payment-section-label">ACCOUNT NUMBER</div>
              <div class="account-number-box">${accountNumber}</div>
            </div>
          </div>
        `;
      }

      return '';
    };

    const paymentCardHtml = generatePaymentCardHtml(defaultPaymentMethod);

    const htmlContent = `
      <html>
        <head>
          <style>
            @page {
              size: auto;
              margin: 0;
            }
            body {
              margin: 0;
              padding: 0;
              font-family: Arial, sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              padding: 20px;
            }
            .business-card {
              width: 3.5in;
              height: 2in;
              padding: 0.25in;
              box-sizing: border-box;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              background: white;
              border: 1px solid #ddd;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              margin-bottom: 20px;
            }
            .payment-card {
              width: 3.5in;
              height: 2in;
              box-sizing: border-box;
              display: flex;
              flex-direction: column;
              background: white;
              border: 1px solid #ddd;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .payment-top-banner {
              background: #62B34B; /* Official M-Pesa green */
              padding: 10px 0;
              display: flex;
              align-items: center;
              justify-content: center;
              border-top-left-radius: 5px;
              border-top-right-radius: 5px;
            }
            .bank-banner {
              background: #1E3A8A; /* Bank blue */
            }
            .payment-title-banner {
              font-size: 18px;
              font-weight: bold;
              color: white;
              margin: 0;
            }
            .payment-content {
              flex: 1;
              padding: 10px 15px; /* Reduced padding */
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              gap: 10px; /* Reduced gap */
            }
            .payment-section-label {
              font-size: 11px; /* Slightly reduced font size */
              font-weight: bold;
              color: #666; /* Changed to match rest of app */
              text-align: center;
              margin-bottom: -5px;
            }
            .paybill-digits {
              display: flex;
              gap: 2px;
              margin-bottom: 5px; /* Reduced margin */
            }
            .digit-box {
              width: 28px;
              height: 28px;
              border: 2px solid #62B34B;
              display: flex;
              justify-content: center;
              align-items: center;
              font-size: 18px;
              font-weight: bold;
              color: black;
            }
            .account-number-box {
              border: 2px solid #62B34B;
              padding: 5px 15px;
              font-size: 20px;
              font-weight: bold;
              color: black;
              text-align: center;
              margin-top: -5px;
              word-break: break-all;
            }
            .bank-name-box {
              border: 2px solid #1E3A8A;
              padding: 3px 10px;
              font-size: 14px;
              font-weight: bold;
              color: black;
              text-align: center;
              margin-top: -5px;
              word-break: break-all;
              min-width: 200px;
            }
            .account-name-box {
              border: 2px solid #1E3A8A;
              padding: 3px 10px;
              font-size: 12px;
              font-weight: bold;
              color: black;
              text-align: center;
              margin-top: -5px;
              word-break: break-all;
            }
            .charges-text {
              font-size: 9px;
              color: #888;
              text-align: center;
              margin-top: 5px;
            }
            .header {
              display: flex;
              align-items: center;
              gap: 15px;
            }
            .logo {
              width: 80px;
              height: 80px;
              object-fit: contain;
              border-radius: 50%;
            }
            .business-name {
              font-size: 24px;
              font-weight: bold;
              color: #333;
              margin: 0;
            }
            .contact-info {
              font-size: 12px;
              color: #666;
              line-height: 1.4;
            }
            .footer {
              font-size: 10px;
              color: #999;
              text-align: center;
              margin-top: 10px;
            }
          </style>
        </head>
        <body>
          <!-- Business Card -->
          <div class="business-card">
            <div class="header">
              ${business.logo_url ? `<img src="${business.logo_url}" class="logo" alt="Logo">` : ''}
              <div>
                <h1 class="business-name">${business.name}</h1>
                <div class="contact-info">
                  ${business.address || ''}<br>
                  Phone: ${business.phone || ''}<br>
                  Email: ${business.email || ''}
                </div>
              </div>
            </div>
          </div>
          ${paymentCardHtml}
        </body>
      </html>
    `;

    // Calculate height based on payment method type
    const getCardHeight = (paymentMethod: PaymentMethod | null): number => {
      if (!paymentMethod) return 2 * 96; // Just business card

      return 2 * 96 * 2 + 0.5 * 96; // Standard height for all payment types
    };

    const { uri } = await Print.printToFileAsync({
      html: htmlContent,
      width: 3.5 * 96,
      height: getCardHeight(defaultPaymentMethod),
    });

    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: `Business Card - ${business.name}`,
      UTI: 'com.adobe.pdf',
    });
  } catch (error) {
    console.error('Error generating business card:', error);
    Alert.alert('Error', 'Failed to generate business card');
  }
};
