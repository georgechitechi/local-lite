import * as Print from 'expo-print';
import { formatDate, numberToOrdinal } from '@/shared/utils/formatters';
import { properCase } from '@/shared/utils/helper';

interface Tenant {
  name?: string;
  phone?: string;
  email?: string;
  gender?: string;
  marital_status?: string;
  next_of_kin?: {
    name?: string;
    phone?: string;
    relationship?: string;
    is_primary?: boolean;
  }[];
}

interface Property {
  name?: string;
  location?: string;
}

interface House {
  house_number?: string;
}

interface Contract {
  start_date: string;
  end_date: string;
  rent_amount: number;
  house?: House;
}

interface Business {
  id: string;
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
}

interface ContractSettings {
  securityDeposit?: {
    required?: boolean;
    amount?: number;
    refundable?: boolean;
  };
  paymentTerms?: {
    dueDate?: number;
    gracePeriod?: number;
    lateFee?: number;
  };
  restrictions?: {
    pets?: { allowed?: boolean; details?: string };
    subletting?: { allowed?: boolean; details?: string };
    modifications?: { allowed?: boolean; details?: string };
  };
  maintenance?: {
    utilities?: {
      id: string;
      label: string;
      tenant: boolean;
      landlord: boolean;
    }[];
    extras?: {
      id: string;
      label: string;
      tenant: boolean;
      landlord: boolean;
    }[];
  };
  appendSignature?: boolean;
  customSignatureSVG?: string;
  termination?: {
    noticePeriod?: number;
  };
}

interface ContractData {
  tenant?: Tenant;
  property?: Property;
  contract: Contract;
}

interface GenerateContractParams {
  tenant?: Tenant;
  property?: Property;
  business: Business;
  contract: Contract;
  formattedStartDate: string;
  formattedEndDate: string;
  settings: ContractSettings;
}

export const generateContractPDF = async (
  contractData: ContractData,
  business: Business | null,
  settings: ContractSettings = {},
): Promise<string> => {
  const { tenant, property, contract } = contractData;

  if (!business) {
    throw new Error('Business profile not found. Please set up business profile first.');
  }

  const formattedStartDate = formatDate(contract.start_date);
  const formattedEndDate = formatDate(contract.end_date);

  const html = generateContractHTML({
    tenant,
    property,
    business,
    contract,
    formattedStartDate,
    formattedEndDate,
    settings,
  });

  const { uri } = await Print.printToFileAsync({ html });
  return uri;
};

const generateContractHTML = ({
  tenant,
  property,
  business,
  contract,
  formattedStartDate,
  formattedEndDate,
  settings,
}: GenerateContractParams): string => {
  const securityDeposit = settings.securityDeposit?.required
    ? parseFloat(
        String(contract.rent_amount * (settings.securityDeposit.amount || 0)),
      ).toLocaleString()
    : 0;

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
            counter-reset: section;
          }
          
          .header {
            text-align: center;
            margin-bottom: 15px;
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
            margin: 15px 0 15px 0;
            letter-spacing: 2px;
            border-bottom: 2px solid #1a1a1a;
            display: inline-block;
            width: 100%;
            padding-bottom: 10px;
          }

          .section {
            margin-bottom: 20px;
          }

          .section-title {
            font-weight: bold;
            text-transform: uppercase;
            font-size: 14px;
            margin-bottom: 10px;
            border-bottom: 1px solid #eee;
            padding-bottom: 5px;
          }

          .section-title::before {
            counter-increment: section;
            content: counter(section) ". ";
          }

          .content-block {
            margin-bottom: 14px;
            text-align: justify;
          }

          .data-row {
            display: flex;
            margin-bottom: 8px;
            font-size: 14px;
          }

          .data-label {
            font-weight: bold;
            width: 200px;
            color: #333;
          }

          .data-value {
            flex: 1;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            margin: 15px 0;
            font-size: 13px;
          }

          th, td {
            text-align: left;
            padding: 6px 8px;
            border-bottom: 1px solid #eee;
          }

          th {
            background-color: #f9f9f9;
            text-transform: uppercase;
            font-size: 11px;
            letter-spacing: 1px;
          }

          .signature-area {
            margin-top: 30px;
            page-break-inside: avoid;
          }

          .signature-grid {
            display: flex;
            justify-content: space-between;
            gap: 50px;
            margin-top: 30px;
          }

          .signature-box {
            flex: 1;
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
            margin-top: 30px;
            font-size: 10px;
            color: #666;
            text-align: center;
            border-top: 1px solid #eee;
            padding-top: 20px;
          }

          .bold { font-weight: bold; }
          .page-break { page-break-before: always; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="business-name">${business?.name || 'Property Management'}</div>
          <div class="business-details">
            ${business?.address || ''} | Phone: ${business?.phone || ''} | Email: ${business?.email || ''}
          </div>
        </div>

        <h2>Residential Lease Agreement</h2>

        <div class="section">
          <div class="section-title">Parties & Property</div>
          <div class="content-block">
            This Agreement is made on <span class="bold">${formattedStartDate}</span> between 
            <span class="bold">${business?.name || 'the Landlord'}</span> and 
            <span class="bold">${tenant?.name || 'the Tenant'}</span> for the property:
          </div>
          <div class="data-row">
            <div class="data-label">Property Name:</div>
            <div class="data-value">${property?.name || 'Not Specified'}</div>
          </div>
          <div class="data-row">
            <div class="data-label">Unit Number:</div>
            <div class="data-value">${formatHouseNumber(contract?.house?.house_number)}</div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Term & Rent</div>
          <div class="data-row">
            <div class="data-label">Lease Duration:</div>
            <div class="data-value">${formattedStartDate} to ${formattedEndDate} 
              <br>(unless terminated earlier as provided in this agreement)</div>
          </div>
          <div class="data-row">
            <div class="data-label">Monthly Rent:</div>
            <div class="data-value"><span class="bold">KES ${parseFloat(String(contract.rent_amount)).toLocaleString()}</span></div>
          </div>
          <div class="data-row">
            <div class="data-label">Payment Due Date:</div>
            <div class="data-value">${numberToOrdinal(settings.paymentTerms?.dueDate || 1)} of every month</div>
          </div>
          <div class="data-row">
            <div class="data-label">Grace Period:</div>
            <div class="data-value">${settings.paymentTerms?.gracePeriod || 0} days</div>
          </div>
          <div class="data-row">
            <div class="data-label">Late Payment Fee:</div>
            <div class="data-value">KES ${parseFloat(String(settings.paymentTerms?.lateFee || 0)).toLocaleString()} per day after grace period</div>
          </div>
        </div>

        ${
          settings.securityDeposit?.required
            ? `
        <div class="section">
          <div class="section-title">Security Deposit</div>
          <div class="content-block">
            A security deposit of <span class="bold">KES ${securityDeposit}</span> is required. 
            This deposit is ${settings.securityDeposit.refundable ? 'refundable' : 'non-refundable'} 
            subject to the terms of this agreement.
          </div>
        </div>
        `
            : ''
        }

        <div class="section">
          <div class="section-title">Maintenance & Utilities</div>
          
          <div style="margin-bottom: 15px;">
            <div style="font-weight: bold; font-size: 13px; margin-bottom: 5px;">A. Utilities</div>
            <table>
              <thead>
                <tr>
                  <th style="width: 70%;">Service</th>
                  <th>Responsibility</th>
                </tr>
              </thead>
              <tbody>
                ${settings.maintenance?.utilities
                  ?.map(
                    u => `
                  <tr>
                    <td>${u.label}</td>
                    <td class="bold">${u.tenant ? 'Tenant' : 'Landlord'}</td>
                  </tr>
                `,
                  )
                  .join('')}
              </tbody>
            </table>
          </div>

          <div class="page-break">
            <div style="font-weight: bold; font-size: 13px; margin-bottom: 5px;">B. Maintenance</div>
            <table>
              <thead>
                <tr>
                  <th style="width: 70%;">Item</th>
                  <th>Responsibility</th>
                </tr>
              </thead>
              <tbody>
                ${settings.maintenance?.extras
                  ?.map(
                    e => `
                  <tr>
                    <td>${e.label}</td>
                    <td class="bold">${e.tenant ? 'Tenant' : 'Landlord'}</td>
                  </tr>
                `,
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Restrictions</div>
          <div class="data-row">
            <div class="data-label">Pets:</div>
            <div class="data-value">${settings.restrictions?.pets?.allowed ? 'Permitted' : 'Prohibited'} ${settings.restrictions?.pets?.details ? `(${settings.restrictions.pets.details})` : ''}</div>
          </div>
          <div class="data-row">
            <div class="data-label">Subletting:</div>
            <div class="data-value">${settings.restrictions?.subletting?.allowed ? 'Permitted' : 'Prohibited'} ${settings.restrictions?.subletting?.details ? `(${settings.restrictions.subletting.details})` : ''}</div>
          </div>
          <div class="data-row">
            <div class="data-label">Modifications:</div>
            <div class="data-value">${settings.restrictions?.modifications?.allowed ? 'Permitted' : 'Prohibited'} ${settings.restrictions?.modifications?.details ? `(${settings.restrictions.modifications.details})` : ''}</div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Termination</div>
          <div class="content-block">
            This agreement may be terminated under the following conditions:
            <ul style="padding-left: 20px; font-size: 13px;">
              <li><strong>Notice Period:</strong> Either party may terminate this lease by providing at least ${settings.termination?.noticePeriod || 30} days' written notice to the other party.</li>
              <li><strong>Material Breach:</strong> The Landlord may terminate this agreement immediately if the Tenant fails to pay rent within the grace period or commits a material breach of any terms herein.</li>
              <li><strong>Mutual Agreement:</strong> The parties may terminate this agreement at any time by mutual written consent.</li>
              <li><strong>Legal Compliance:</strong> Termination may occur as required by applicable laws or governing regulations.</li>
            </ul>
          </div>
        </div>

        <div class="signature-area">
          <div class="section-title">Execution</div>
          <div class="content-block">
            By signing below, both parties acknowledge and agree to all terms and conditions 
            stipulated in this Residential Lease Agreement.
          </div>
          <div class="signature-grid">
            <div class="signature-box">
              <div class="signature-line" style="position: relative;">
                ${
                  settings.appendSignature !== false
                    ? `<img src="data:image/svg+xml;base64,${
                        settings.customSignatureSVG ||
                        'PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjYwIiB2aWV3Qm94PSIwIDAgMjAwIDYwIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgogIDxwYXRoIGQ9Ik0yMCw0NSBRMzAsMTUgNTAsMjUgVDgwLDM1IFQxMTAsMTUgVDE0MCwyNSBUMTcwLDM1IiBzdHJva2U9IiMwMDAwODAiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0ibm9uZSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiAvPgogIDx0ZXh0IHg9IjE1IiB5PSI0MiIgZm9udC1mYW1pbHk9IidCcnVzaCBTY3JpcHQgTVQnLCBjdXJzaXZlIiBmb250LXNpemU9IjI4IiBmaWxsPSIjMDAwMDgwIiB0cmFuc2Zvcm09InJvdGF0ZSgtMikiPk9HUyBSZXNpZGVudGlhbHM8L3RleHQ+Cjwvc3ZnPgo='
                      }" style="position: absolute; top: -10px; left: 10px; width: 180px; height: auto;" />`
                    : ''
                }
              </div>
              <div class="signature-label">Landlord Signature</div>
              <div style="font-size: 11px; margin-top: 5px;">${business?.name}</div>
            </div>
            <div class="signature-box">
              <div class="signature-line"></div>
              <div class="signature-label">Tenant Signature</div>
              <div style="font-size: 11px; margin-top: 5px;">${tenant?.name}</div>
            </div>
          </div>
        </div>

        <div class="footer">
          This is a legally binding document. Seek legal advice if any terms are unclear.<br>
          &copy; ${new Date().getFullYear()} ${business?.name || 'Property Management'}
        </div>
      </body>
    </html>
  `;
};
