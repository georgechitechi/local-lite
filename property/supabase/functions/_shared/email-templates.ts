export function createExpirationReminderEmail(data: {
  tenantName: string;
  propertyName: string;
  houseNumber: string;
  endDate: string;
  daysUntilExpiry: number;
  rentAmount: number;
  renewalUrl: string;
  business?: { name?: string; email?: string; phone?: string } | null;
}): string {
  const {
    tenantName,
    propertyName,
    houseNumber,
    endDate,
    daysUntilExpiry,
    rentAmount,
    renewalUrl,
    business,
  } = data;

  const businessName = business?.name || 'Property Management';
  const formattedDate = new Date(endDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return [
    `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.4;">`,
    `  <p>Dear ${tenantName},</p>`,
    `  <p>This is a friendly reminder that your rental contract at ${businessName} is expiring soon.</p>`,
    `  <p>Your contract expires in <strong>${daysUntilExpiry} days</strong>.</p>`,
    `  <h4 style="margin-bottom: 4px;">Contract Details</h4>`,
    `  <ul style="margin-top: 0; padding-left: 20px;">`,
    `    <li><strong>Property:</strong> ${propertyName}</li>`,
    `    <li><strong>Unit:</strong> ${houseNumber}</li>`,
    `    <li><strong>Current Rent:</strong> KSh ${rentAmount.toLocaleString()}/month</li>`,
    `    <li><strong>Expiration Date:</strong> ${formattedDate}</li>`,
    `  </ul>`,
    `  <p>Click the link below to renew your contract online (expires in 7 days):</p>`,
    `  <p><a href="${renewalUrl}">Renew Contract</a></p>`,
    `  <p>If you have any questions or concerns, please contact us.</p>`,
    `  <ul style="list-style: none; padding: 0; margin: 0;">`,
    `    <li>Phone: ${business?.phone || 'N/A'}</li>`,
    `    <li>Email: ${business?.email || 'N/A'}</li>`,
    `  </ul>`,
    `  <p>Best regards,<br><strong>The ${businessName} Team</strong></p>`,
    `</div>`,
  ].join('');
}

export function createInfoRequestEmail(data: {
  tenantName: string;
  businessName: string;
  missingFields: string[];
  requestUrl: string;
}): string {
  const { tenantName, businessName, missingFields, requestUrl } = data;
  const hasMissing = missingFields && missingFields.length > 0;

  return [
    `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.4;">`,
    `  <p>Dear ${tenantName},</p>`,
    hasMissing
      ? `  <p>We are currently updating our records and noticed that some of your contact information is missing or incomplete.</p>`
      : `  <p>We are currently updating our records and want to ensure we have your latest contact information.</p>`,
    hasMissing ? `  <h4 style="margin-bottom: 4px;">Missing Details:</h4>` : '',
    hasMissing ? `  <ul style="margin-top: 0; padding-left: 20px;">` : '',
    ...(hasMissing ? missingFields.map(field => `    <li>${field}</li>`) : []),
    hasMissing ? `  </ul>` : '',
    `  <p>Please click the link below to securely ${hasMissing ? 'update' : 'review and confirm'} your details (link expires in 7 days):</p>`,
    `  <p><a href="${requestUrl}">${hasMissing ? 'Update My Information' : 'Review My Information'}</a></p>`,
    `  <p>Best regards,<br><strong>The ${businessName} Team</strong></p>`,
    `</div>`,
  ]
    .filter(Boolean)
    .join('');
}

export function createTenantInfoUpdatedEmail(data: {
  tenantName: string;
  email?: string;
  phone?: string;
  next_of_kin?: any;
}): string {
  const { tenantName, email, phone, next_of_kin } = data;

  let kinDisplay = '';
  if (next_of_kin && Array.isArray(next_of_kin) && next_of_kin.length > 0) {
    const kin = next_of_kin[0];
    kinDisplay = `<li><strong>Next of Kin:</strong> ${kin.name || ''} ${kin.relationship ? `(${kin.relationship})` : ''} - ${kin.phone || ''}</li>`;
  }

  return [
    `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.4;">`,
    `  <p>Your tenant has updated their contact information via the request link.</p>`,
    `  <h4 style="margin-bottom: 4px;">Tenant Information:</h4>`,
    `  <ul style="margin-top: 0; padding-left: 20px;">`,
    `    <li><strong>Tenant:</strong> ${tenantName}</li>`,
    `    ${email ? `<li><strong>New Email:</strong> <a href="mailto:${email}">${email}</a></li>` : ''}`,
    `    ${phone ? `<li><strong>New Phone:</strong> ${phone}</li>` : ''}`,
    `    ${kinDisplay}`,
    `  </ul>`,
    `  <p>This update was submitted on ${new Date().toLocaleString()}.</p>`,
    `  <p>Best regards,<br><strong>Property Manager - Data Cleanup Service</strong></p>`,
    `</div>`,
  ].join('');
}

export function createTenantAcknowledgementEmail(data: {
  tenantName: string;
  businessName: string;
  email?: string;
  phone?: string;
  next_of_kin?: any;
}): string {
  const { tenantName, businessName, email, phone, next_of_kin } = data;

  let kinDisplay = '';
  if (next_of_kin && Array.isArray(next_of_kin) && next_of_kin.length > 0) {
    const kin = next_of_kin[0];
    kinDisplay = `<li><strong>Next of Kin:</strong> ${kin.name || ''} ${kin.relationship ? `(${kin.relationship})` : ''} - ${kin.phone || ''}</li>`;
  }

  return [
    `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.4;">`,
    `  <p>Hi ${tenantName},</p>`,
    `  <p>Thank you for updating your contact information with <strong>${businessName}</strong>.</p>`,
    `  <p>We have received and saved the following details:</p>`,
    `  <ul style="padding-left: 20px;">`,
    `    ${email ? `<li><strong>Email:</strong> ${email}</li>` : ''}`,
    `    ${phone ? `<li><strong>Phone:</strong> ${phone}</li>` : ''}`,
    `    ${kinDisplay}`,
    `  </ul>`,
    `  <p>If any of this information is incorrect, please contact us immediately.</p>`,
    `  <p>Best regards,<br><strong>The ${businessName} Team</strong></p>`,
    `</div>`,
  ].join('');
}

export function createContractExpiryEmail(contractData: any, business: any): string {
  const daysUntilExpiry = contractData.days_until_expiry;
  return [
    `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.4;">`,
    `  <p>Dear ${contractData.tenant_name},</p>`,
    `  <p>This is to notify you that your rental contract at ${business.name} is expiring soon. We hope you've had a great experience with us and would like to continue our relationship.</p>`,
    `  <h4 style="margin-bottom: 4px;">Contract Details:</h4>`,
    `  <ul style="margin-top: 0; padding-left: 20px;">`,
    `    <li><strong>Property:</strong> ${contractData.property_name || 'N/A'}</li>`,
    `    <li><strong>Unit:</strong> ${contractData.house_number || 'N/A'}</li>`,
    `    <li><strong>Monthly Rent:</strong> KSh ${contractData.rent_amount || 'N/A'}</li>`,
    `    <li><strong>Expiry Date:</strong> ${new Date(contractData.end_date).toLocaleDateString()}</li>`,
    `  </ul>`,
    `  <p><strong>Your contract expires in ${daysUntilExpiry} days.</strong></p>`,
    `  <h4 style="margin-bottom: 4px;">What's Next?</h4>`,
    `  <ul style="margin-top: 0; padding-left: 20px;">`,
    `    <li><strong>Renew Your Contract:</strong> Contact us to discuss renewal terms and sign a new agreement.</li>`,
    `    <li><strong>Move Out:</strong> If you choose not to renew, please arrange for move-out by the expiry date.</li>`,
    `  </ul>`,
    `  <p>Best regards,<br><strong>The ${business.name} Team</strong></p>`,
    `</div>`,
  ].join('');
}

export function createContractRenewalInvitationEmail(
  contractData: any,
  business: any,
): string {
  return [
    `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.4;">`,
    `  <p>Dear ${contractData.tenant_name},</p>`,
    `  <p>We hope you've been enjoying your stay with us! Your current contract is expiring soon, and we'd love to have you continue as our valued tenant.</p>`,
    `  <h4 style="margin-bottom: 4px;">Current Contract Summary:</h4>`,
    `  <ul style="margin-top: 0; padding-left: 20px;">`,
    `    <li><strong>Property:</strong> ${contractData.property_name || 'N/A'}</li>`,
    `    <li><strong>Unit:</strong> ${contractData.house_number || 'N/A'}</li>`,
    `    <li><strong>Monthly Rent:</strong> KSh ${contractData.rent_amount || 'N/A'}</li>`,
    `    <li><strong>Expiry Date:</strong> ${new Date(contractData.end_date).toLocaleDateString()}</li>`,
    `  </ul>`,
    `  <p>Best regards,<br><strong>The ${business.name} Team</strong></p>`,
    `</div>`,
  ].join('');
}

export function generateContractExpirySubject(contractData: any, business: any): string {
  const daysUntilExpiry = contractData.days_until_expiry;
  const urgency =
    daysUntilExpiry <= 3 ? 'URGENT' : daysUntilExpiry <= 7 ? 'SOON' : 'NOTICE';
  return `📅 Contract Expires in ${daysUntilExpiry} Day${daysUntilExpiry !== 1 ? 's' : ''} - ${business.name} (${urgency})`;
}

export function createContractTerminationEmail(data: {
  tenantName: string;
  propertyName: string;
  houseNumber: string;
  terminationDate: string;
  business?: { name?: string; email?: string; phone?: string } | null;
}): string {
  const { tenantName, propertyName, houseNumber, terminationDate, business } = data;
  const businessName = business?.name || 'Property Management';
  const formattedDate = new Date(terminationDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return [
    `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.4;">`,
    `  <p>Dear ${tenantName},</p>`,
    `  <p>This email is to formally notify you that your rental contract at ${businessName} is being terminated effective <strong>${formattedDate}</strong>.</p>`,
    `  <h4 style="margin-bottom: 4px;">Contract Details</h4>`,
    `  <ul style="margin-top: 0; padding-left: 20px;">`,
    `    <li><strong>Property:</strong> ${propertyName}</li>`,
    `    <li><strong>Unit:</strong> ${houseNumber}</li>`,
    `  </ul>`,
    `  <p>If you have any questions or need to discuss the handover process, please contact us.</p>`,
    `  <ul style="list-style: none; padding: 0; margin: 0;">`,
    `    <li>Phone: ${business?.phone || 'N/A'}</li>`,
    `    <li>Email: ${business?.email || 'N/A'}</li>`,
    `  </ul>`,
    `  <p>Attached is the original contract document for your reference. Please carefully review the terms and conditions outlined in the document.</p>`,
    `  <p>Best regards,<br><strong>The ${businessName} Team</strong></p>`,
    `</div>`,
  ].join('');
}

export function createholidayRequestEmail(data: {
  tenantName: string;
  businessName: string;
  requestUrl: string;
}): string {
  const { tenantName, businessName, requestUrl } = data;
  return [
    `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.4;">`,
    `  <p>Dear ${tenantName},</p>`,
    `  <p>Please let us know if you'll be away during the upcoming holiday period.</p>`,
    `  <p>Marking your holiday status helps us keep an eye on your property and schedule your return to be seamless.</p>`,
    `  <p>Click the link below to securely submit your holiday status:</p>`,
    `  <p><a href="${requestUrl}">Mark holiday</a></p>`,
    `  <p>Best regards,<br><strong>The ${businessName} Team</strong></p>`,
    `</div>`,
  ].join('');
}

export function createTenantholidayUpdatedEmail(data: {
  tenantName: string;
  moveoutDate: string | null;
  returnDate: string | null;
  doorOpen: boolean;
  belongingsCleared: boolean;
  keyHandedOver: boolean;
  isMovingOut: boolean;
  isStaying: boolean;
}): string {
  const {
    tenantName,
    moveoutDate,
    returnDate,
    doorOpen,
    belongingsCleared,
    keyHandedOver,
    isMovingOut,
    isStaying,
  } = data;

  let title = 'Holiday Details';
  let description =
    'A tenant has marked their holiday and their contract has been updated with a holiday waiver.';

  if (isMovingOut) {
    title = 'Move Out Notice';
    description =
      'A tenant has notified you they are moving out permanently. Their contract end date has been updated.';
  } else if (isStaying) {
    title = 'Staying Notice';
    description =
      'A tenant has confirmed they are staying at the property during the holiday period.';
  }

  const dateDetails = !isStaying
    ? [
        `  <h4 style="margin-bottom: 4px;">${title}:</h4>`,
        `  <ul style="margin-top: 0; padding-left: 20px;">`,
        `    <li><strong>Tenant:</strong> ${tenantName}</li>`,
        `    <li><strong>${isMovingOut ? 'Move Out Date' : 'Departure Date'}:</strong> ${moveoutDate}</li>`,
        !isMovingOut ? `    <li><strong>Return Date:</strong> ${returnDate}</li>` : '',
        `  </ul>`,
        `  <h4 style="margin-bottom: 4px;">Checklist:</h4>`,
        `  <ul style="margin-top: 0; padding-left: 20px;">`,
        `    <li>Left house door open: <strong>${doorOpen ? 'Yes' : 'No'}</strong></li>`,
        `    <li>Cleared belongings: <strong>${belongingsCleared ? 'Yes' : 'No'}</strong></li>`,
        `    <li>Handed over gate key: <strong>${keyHandedOver ? 'Yes' : 'No'}</strong></li>`,
        `  </ul>`,
      ].join('\n')
    : [
        `  <h4 style="margin-bottom: 4px;">${title}:</h4>`,
        `  <ul style="margin-top: 0; padding-left: 20px;">`,
        `    <li><strong>Tenant:</strong> ${tenantName}</li>`,
        `  </ul>`,
      ].join('\n');

  return [
    `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.4;">`,
    `  <p>${description}</p>`,
    dateDetails,
    `  <p>This update was submitted on ${new Date().toLocaleString()}.</p>`,
    `  <p>Best regards,<br><strong>Property Manager - Automated System</strong></p>`,
    `</div>`,
  ].join('');
}
