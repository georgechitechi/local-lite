import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {
  type Currency,
  formatWithCurrency,
  getDefaultCurrency,
} from '@/shared/utils/formatters';

interface Business {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
}

interface Promotion {
  id: string;
  code: string;
  amount: number | null;
  type: 'fixed' | 'percentage' | 'full_month';
  scope: 'business' | 'property' | 'tenant';
  property_id?: string | null;
  tenant_id?: string | null;
  description: string;
  valid_from?: string | null;
  valid_until?: string | null;
  is_active: boolean;
}

interface VoucherDetails {
  tenantName?: string;
  tenantPhone?: string | null;
  propertyName?: string;
  houseNumber?: string;
}

const formatPromoAmount = (promo: Promotion, currency: Currency) => {
  switch (promo.type) {
    case 'full_month':
      return 'Full Month Rent Waiver';
    case 'percentage':
      return `${promo.amount}% Discount`;
    default:
      return formatWithCurrency(promo.amount || 0, currency);
  }
};

export const generateAndSharePromoVoucher = async (
  promo: Promotion,
  business: Business | null,
  details?: VoucherDetails,
): Promise<void> => {
  try {
    if (!business) {
      throw new Error(
        'Business profile not found. Please set up business profile first.',
      );
    }

    const currency = await getDefaultCurrency(business.id);
    const { uri } = await Print.printToFileAsync({
      html: generatePromoVoucherHTML(promo, business, currency, details),
    });

    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: `Promo Voucher - ${promo.code}`,
      UTI: 'com.adobe.pdf',
    });
  } catch (error) {
    console.error('Error sharing promo voucher:', error);
    throw error;
  }
};

const generatePromoVoucherHTML = (
  promo: Promotion,
  business: Business,
  currency: Currency,
  details?: VoucherDetails,
): string => {
  const formattedAmount = formatPromoAmount(promo, currency);

  return `
    <html>
      <head>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&family=Playfair+Display:wght@700&family=JetBrains+Mono:wght@700&display=swap');
          
          :root {
            /* Variables removed for WebView compatibility */
          }

          body { 
            padding: 25px 40px; 
            font-family: 'Inter', Arial, sans-serif;
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
            font-family: Arial, sans-serif;
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

          .voucher-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 12px;
            line-height: 1.0;
            position: relative;
            overflow: hidden;
            padding: 10px;
            background: rgba(98, 0, 238, 0.02);
            border-radius: 8px;
          }

          .text-center {
            text-align: center;
          }

          .voucher-section {
            flex: 1;
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

          .voucher-card {
            background: linear-gradient(135deg, #6200ee 0%, #3700b3 100%);
            border-radius: 20px;
            padding: 30px 40px;
            color: white;
            position: relative;
            box-shadow: 0 10px 25px rgba(98, 0, 238, 0.15);
            margin: 20px 0;
            overflow: hidden;
            text-align: left;
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
            letter-spacing: 2px;
            font-size: 10px;
            font-weight: 700;
            opacity: 0.8;
            margin-bottom: 15px;
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
            font-size: 12px;
            opacity: 0.9;
            margin-bottom: 2px;
          }

          .amount-value {
            font-size: 32px;
            font-weight: 900;
            text-transform: uppercase;
          }

          .code-section {
            background: rgba(255, 255, 255, 0.15);
            padding: 10px 20px;
            border-radius: 10px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            text-align: center;
          }

          .code-label {
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 2px;
          }

          .code-value {
            font-family: 'JetBrains Mono', monospace;
            font-size: 24px;
            letter-spacing: 2px;
            margin: 0;
          }

          .voucher-description {
            margin-top: 20px;
            font-size: 13px;
            border-top: 1px dashed rgba(255, 255, 255, 0.3);
            padding-top: 15px;
            font-style: italic;
            opacity: 0.9;
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

        </style>
      </head>
      <body>
        
        <div class="business-header">
          <div class="business-name">${business.name}</div>
          ${
            details?.propertyName
              ? `<div class="bold" style="font-size: 14px; margin-bottom: 3px;">
                  ${details.propertyName}
                </div>`
              : ''
          }
          <div class="business-details">
            ${business.address || ''}<br>
            Phone: ${business.phone || ''}<br>
            Email: ${business.email || ''}
          </div>
        </div>

        <h2>ADJUSTMENT VOUCHER</h2>

        <div class="voucher-header">
          <div class="voucher-section" style="position: relative; z-index: 1;">
            <div class="row">
              <span class="label">Voucher No:</span>
              <span class="bold">#${promo.id.slice(-6).toUpperCase()}</span>
            </div>
            <div class="row">
              <span class="label">Issue Date:</span>
              <span>${new Date().toDateString()}</span>
            </div>
            ${
              promo.valid_until
                ? `
              <div class="row">
                <span class="label">Expires On:</span>
                <span class="bold" style="color: #f44336;">${new Date(promo.valid_until).toLocaleDateString()}</span>
              </div>
            `
                : ''
            }
          </div>

          <div class="voucher-section" style="position: relative; z-index: 1;">
            ${
              promo.scope === 'tenant'
                ? `
              <div class="row">
                <span class="label">Tenant:</span>
                <span class="bold">${details?.tenantName || 'N/A'}</span>
              </div>
              <div class="row">
                <span class="label">Room:</span>
                <span>${details?.houseNumber || 'N/A'}</span>
              </div>
              <div class="row">
                <span class="label">Phone:</span>
                <span>${details?.tenantPhone || 'N/A'}</span>
              </div>
            `
                : `
              <div class="row">
                <span class="label">Scope:</span>
                <span class="bold" style="text-transform: capitalize;">${promo.scope} Wide</span>
              </div>
              <div class="row">
                <span class="label">Target:</span>
                <span class="bold">${promo.scope === 'property' ? details?.propertyName || 'Selected Property' : 'Entire Business'}</span>
              </div>
              <div class="row">
                <span class="label">Validity:</span>
                <span class="bold">${promo.is_active ? 'ACTIVE' : 'INACTIVE'}</span>
              </div>
            `
            }
          </div>
        </div>

        <div class="voucher-card">
          <div class="card-header text-center">Official Rent Credit Voucher</div>
          <div class="card-main">
            <div class="amount-section">
              <div class="amount-label">Voucher Value</div>
              <div class="amount-value">${formattedAmount}</div>
            </div>
            <div class="code-section">
              <div class="code-label">Promo Code</div>
              <div class="code-value">${promo.code}</div>
            </div>
          </div>
          ${promo.description ? `<div class="voucher-description">“${promo.description}”</div>` : ''}
        </div>

        <div class="signatures">
          <div class="signature">
            <p class="bold">${business.name}</p>
            <div class="signature-line"></div>
            <p>Authorized By</p>
          </div>
          <div class="signature">
            <p class="bold">${details?.tenantName || 'Tenant Name'}</p>
            <div class="signature-line"></div>
            <p>Tenant Signature</p>
          </div>
        </div>

        <div class="footer">
          <p>This is a computer-generated voucher and does not require a physical signature.</p>
          <p>For any queries regarding this voucher, please contact ${business.phone || ''} or email ${business.email || ''}</p>
          <p>© ${new Date().getFullYear()} ${business.name}. All rights reserved.</p>
        </div>
      </body>
    </html>
  `;
};
