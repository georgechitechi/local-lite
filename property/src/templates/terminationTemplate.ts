import * as Print from 'expo-print';
import { formatDate } from '@/shared/utils/formatters';
import { properCase } from '@/shared/utils/helper';

interface TerminationData {
  tenant?: {
    name?: string;
  };
  property?: {
    name?: string;
  };
  contract: {
    start_date: string;
    end_date: string;
    house?: {
      house_number?: string;
    };
  };
}

interface Business {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
}

interface GenerateTerminationParams extends TerminationData {
  business: Business;
  formattedStartDate: string;
  formattedEndDate: string;
  formattedTerminationDate: string;
}

export const generateTerminationPDF = async (
  terminationData: TerminationData,
  business: Business | null,
  terminationDate: string,
): Promise<string> => {
  const { tenant, property, contract } = terminationData;

  if (!business) {
    throw new Error('Business profile not found. Please set up business profile first.');
  }

  const formattedStartDate = formatDate(contract.start_date);
  const formattedEndDate = formatDate(contract.end_date);
  const formattedTerminationDate = formatDate(terminationDate);

  const html = generateTerminationHTML({
    tenant,
    property,
    business,
    contract,
    formattedStartDate,
    formattedEndDate,
    formattedTerminationDate,
  });

  const { uri } = await Print.printToFileAsync({ html });
  return uri;
};

const generateTerminationHTML = ({
  tenant,
  property,
  business,
  contract,
  formattedStartDate,
  formattedEndDate,
  formattedTerminationDate,
}: GenerateTerminationParams): string => {
  // Format house number to proper case
  const formatHouseNumber = (number?: string): string => {
    if (!number) return 'Not Assigned';
    return properCase(number);
  };

  return `
    <html>
      <head>
        <style>
          @page {
            margin: 50px 70px;
            @bottom-right {
              content: "Page " counter(page) " of " counter(pages);
              font-size: 10px;
              color: #718096;
            }
          }
          body { 
            font-family: Georgia, serif;
            color: #1a1a1a;
            line-height: 1.60;
            margin: 0;
            padding: 0;
          }
          
          .header {
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 15px;
            border-bottom: 1px solid #333;
          }

          .business-name {
            font-size: 24px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 5px;
          }

          .business-details {
            font-size: 12px;
            color: #444;
            font-style: italic;
          }

          h2 {
            text-align: center;
            font-size: 20px;
            text-transform: uppercase;
            margin: 15px 0 30px 0;
            letter-spacing: 2px;
            border-bottom: 2px solid #1a1a1a;
            display: inline-block;
            width: 100%;
            padding-bottom: 10px;
          }

          .content-block {
            margin-bottom: 20px;
            text-align: justify;
            font-size: 14px;
          }

          .data-row {
            display: flex;
            margin-bottom: 10px;
            font-size: 14px;
          }

          .data-label {
            font-weight: bold;
            width: 120px;
            color: #333;
          }

          .data-value {
            flex: 1;
          }

          .signature-area {
            margin-top: 50px;
            page-break-inside: avoid;
          }

          .signature-box {
            margin-top: 30px;
            width: 300px;
          }

          .signature-line {
            border-bottom: 1px solid #1a1a1a;
            margin-bottom: 8px;
            height: 38px;
          }

          .signature-label {
            font-size: 12px;
            font-weight: bold;
            text-transform: uppercase;
          }

          .footer {
            margin-top: 50px;
            font-size: 10px;
            color: #666;
            text-align: center;
            border-top: 1px solid #eee;
            padding-top: 20px;
          }

          .bold { font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="business-name">${business?.name || 'Property Management'}</div>
          <div class="business-details">
            ${business?.address || ''} | Phone: ${business?.phone || ''} | Email: ${business?.email || ''}
          </div>
        </div>

        <h2>Notice of Contract Termination</h2>

        <div class="content-block">
          <div class="data-row">
            <div class="data-label">Date:</div>
            <div class="data-value">${formatDate(new Date().toISOString())}</div>
          </div>
          <div class="data-row">
            <div class="data-label">To Tenant:</div>
            <div class="data-value">${tenant?.name || 'Tenant'}</div>
          </div>
          <div class="data-row">
            <div class="data-label">Property:</div>
            <div class="data-value">${property?.name || 'Not Specified'}, Unit ${formatHouseNumber(contract?.house?.house_number)}</div>
          </div>
        </div>

        <div class="content-block" style="margin-top: 30px;">
          Dear <span class="bold">${tenant?.name || 'Tenant'}</span>,
        </div>

        <div class="content-block">
          This letter serves as formal notice that the residential lease agreement for the property located at 
          <span class="bold">${property?.name || 'Not Specified'}</span>, Unit <span class="bold">${formatHouseNumber(contract?.house?.house_number)}</span> 
          is hereby terminated.
        </div>

        <div class="content-block">
          The effective date of this termination is <span class="bold">${formattedTerminationDate}</span>.
        </div>

        <div class="content-block">
          As per our records, your original lease commenced on <span class="bold">${formattedStartDate}</span> and was 
          scheduled to end on <span class="bold">${formattedEndDate}</span>.
        </div>

        <div class="content-block">
          Please ensure that all personal belongings are removed from the premises and the property is left in a clean and undamaged 
          condition by the termination date. All keys must be returned to the management office.
        </div>

        <div class="content-block">
          A final inspection will be conducted upon your departure. Any outstanding rent, utility bills, or necessary repairs for 
          damages beyond normal wear and tear will be deducted from your security deposit (if applicable) in accordance with the 
          terms of your original lease agreement.
        </div>

        <div class="content-block">
          If you have any questions regarding this notice or the move-out process, please contact us immediately.
        </div>

        <div class="signature-area">
          <div class="content-block">Sincerely,</div>
          
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-label">Authorized Signature</div>
            <div style="font-size: 14px; margin-top: 5px;">${business?.name || 'Property Management'}</div>
          </div>
        </div>

        <div class="footer">
          This document is electronically generated and serves as official notice of termination.
        </div>
      </body>
    </html>
  `;
};
