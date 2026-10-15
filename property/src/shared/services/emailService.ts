import { supabase } from '@/shared/services/supabase';
import { formatDate } from '@/shared/utils/formatters';
import { properCase, snakeCaseToTitleCase } from '@/shared/utils/helper';
import { getAuthStateSnapshot } from '@/stores/authStore';

interface Booking {
  id?: string;
  name: string;
  email?: string | null;
  phone?: string | null;
}

interface Tenant {
  id?: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  gender?: string | null;
  nationality?: string | null;
}

interface Business {
  id?: string;
  name: string;
  email?: string | null;
  phone?: string | null;
}

interface BackupData {
  version: string;
  timestamp: string;
}

interface Receipt {
  id?: string;
  business_id: string;
  created_at: string;
  amount: number;
  payment_method: string;
  type: string;
}

const getBusinessWebsiteLink = async (
  businessId: string | undefined,
): Promise<string> => {
  if (!businessId) return '';

  try {
    const { data: settings } = await supabase
      .from('settings')
      .select('setting_value')
      .eq('business_id', businessId)
      .eq('setting_key', 'links')
      .maybeSingle();

    if (settings?.setting_value) {
      try {
        const linksData =
          typeof settings.setting_value === 'string'
            ? JSON.parse(settings.setting_value)
            : settings.setting_value;

        if (linksData?.website) {
          return linksData.website;
        }
      } catch (parseError) {
        console.warn('Failed to parse links setting:', parseError);
      }
    }
  } catch (settingsError) {
    console.warn('Failed to fetch business settings:', settingsError);
  }

  return '';
};

export const invokeSendMessage = async (
  payload: any,
  logContext: string,
): Promise<boolean> => {
  try {
    const { error } = await supabase.functions.invoke('send-message', {
      headers: getAuthStateSnapshot().session
        ? { Authorization: `Bearer ${getAuthStateSnapshot().session?.access_token}` }
        : undefined,
      body: payload,
    });

    if (error) {
      console.error(`Error ${logContext}:`, error);
      throw error;
    }

    return true;
  } catch (error) {
    console.error(`Failed to ${logContext}:`, error);
    throw error;
  }
};

export const sendBookingConfirmationEmail = async (
  booking: Booking,
  business: Business,
): Promise<boolean> => {
  if (!booking?.email) {
    console.warn('No email provided for booking confirmation');
    return false;
  }

  if (!business) {
    console.warn('No business data provided for booking confirmation');
    return false;
  }

  const refNumber = booking.id
    ? `${booking.id.substring(0, 8).toUpperCase()}`
    : 'PENDING';

  const htmlContent = [
    `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.4;">`,
    `  <p>Dear ${booking.name},</p>`,
    `  <p>Thank you for submitting your booking request to ${business.name}. We have received your application and our team will review it shortly.</p>`,
    `  <h4 style="margin-bottom: 4px;">Your Request Details</h4>`,
    `  <ul style="margin-top: 0; padding-left: 20px;">`,
    `    <li><strong>Name:</strong> ${booking.name}</li>`,
    `    <li><strong>Email:</strong> ${booking.email}</li>`,
    `    <li><strong>Phone:</strong> ${booking.phone || 'N/A'}</li>`,
    `    <li><strong>Reference Number:</strong> <strong>${refNumber}</strong></li>`,
    `    <li><strong>Status:</strong> PENDING REVIEW</li>`,
    `    <li><strong>Submitted:</strong> ${formatDate(new Date())}</li>`,
    `  </ul>`,
    `  <h4 style="margin-bottom: 4px;">What Happens Next?</h4>`,
    `  <ul style="margin-top: 0; padding-left: 20px;">`,
    `    <li>Our team will review your booking request</li>`,
    `    <li>You will receive an email notification once your request is reviewed</li>`,
    `    <li>If approved, you'll receive further instructions for move-in</li>`,
    `    <li>Keep your reference number (${refNumber}) for future communication</li>`,
    `  </ul>`,
    `  <h4 style="margin-bottom: 4px;">Contact Information</h4>`,
    `  <ul style="list-style: none; padding: 0; margin: 0;">`,
    `    <li>Phone: ${business.phone || 'N/A'}</li>`,
    `    <li>Email: ${business.email || 'N/A'}</li>`,
    `  </ul>`,
    `  <p>Thank you for choosing ${business.name} for your accommodation needs.</p>`,
    `  <p>Best regards,<br><strong>The ${business.name} Team</strong></p>`,
    `</div>`,
  ].join('\n');

  const emailData = {
    channel: 'email',
    to: booking.email,
    subject: `📋 Booking Request Received - ${business.name} (${refNumber})`,
    html: htmlContent,
  };

  return await invokeSendMessage(emailData, 'send booking confirmation email');
};

export const sendAdminNotification = async (
  booking: Booking,
  business: Business,
): Promise<boolean> => {
  if (!business?.email) {
    console.warn('No business email provided for booking notification');
    return false;
  }

  if (!booking) {
    console.warn('No booking data provided for business notification');
    return false;
  }

  const refNumber = booking.id
    ? `${booking.id.substring(0, 8).toUpperCase()}`
    : 'PENDING';

  const htmlContent = [
    `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.4;">`,
    `  <p>New Booking Request Received</p>`,
    `  <p>A new booking request has been submitted to ${business.name}. Please review the details below and take appropriate action.</p>`,
    `  <h4 style="margin-bottom: 4px;">Applicant Details</h4>`,
    `  <ul style="margin-top: 0; padding-left: 20px;">`,
    `    <li><strong>Name:</strong> ${booking.name}</li>`,
    `    <li><strong>Email:</strong> ${booking.email || 'Not provided'}</li>`,
    `    <li><strong>Phone:</strong> ${booking.phone || 'Not provided'}</li>`,
    `    <li><strong>Reference Number:</strong> <strong>${refNumber}</strong></li>`,
    `    <li><strong>Status:</strong> PENDING REVIEW</li>`,
    `    <li><strong>Submitted:</strong> ${formatDate(new Date())}</li>`,
    `  </ul>`,
    `  <h4 style="margin-bottom: 4px;">Next Steps</h4>`,
    `  <ul style="margin-top: 0; padding-left: 20px;">`,
    `    <li>Log in to your property management system to review the full application</li>`,
    `    <li>Review the applicant's details and documents</li>`,
    `    <li>Approve or reject the booking request</li>`,
    `    <li>The applicant has been notified with reference number: ${refNumber}</li>`,
    `  </ul>`,
    `  <p>Best regards,<br><strong>The ${business.name} Team</strong></p>`,
    `</div>`,
  ].join('\n');

  const emailData = {
    channel: 'email',
    to: business.email,
    subject: `🔔 New Booking Request - ${business.name} (${refNumber})`,
    html: htmlContent,
  };

  return await invokeSendMessage(emailData, 'send business notification email');
};

export const sendBookingApprovalNotification = async (
  booking: Booking,
  business: Business,
): Promise<boolean> => {
  if (!booking?.email) {
    console.warn('No email provided for booking approval notification');
    return false;
  }

  if (!business) {
    console.warn('No business data provided for booking approval notification');
    return false;
  }

  // Fetch business settings to get the link
  const businessLink = await getBusinessWebsiteLink(business.id);

  // Generate email content
  const htmlContent = generateBookingApprovalEmail(booking, business, businessLink);
  const subject = generateBookingApprovalSubject(booking, business);

  // Prepare email data for Edge Function
  const emailData = {
    channel: 'email',
    to: booking.email,
    cc: business.email,
    subject: subject,
    html: htmlContent,
  };

  // Call Supabase Edge Function to send email
  return await invokeSendMessage(emailData, 'send booking approval notification');
};

const generateBookingApprovalEmail = (
  booking: Booking,
  business: Business,
  businessLink: string = '',
): string => {
  const refNumber = booking.id
    ? `${booking.id.substring(0, 8).toUpperCase()}`
    : 'PENDING';

  return [
    `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.4;">`,
    `  <p>Dear ${booking.name},</p>`,
    `  <p>Great news! Your booking request has been approved by ${business.name}. We're excited to have you as our tenant.</p>`,
    `  <h4 style="margin-bottom: 4px;">Your Application Details</h4>`,
    `  <ul style="margin-top: 0; padding-left: 20px;">`,
    `    <li><strong>Name:</strong> ${booking.name}</li>`,
    `    <li><strong>Email:</strong> ${booking.email}</li>`,
    `    <li><strong>Phone:</strong> ${booking.phone || 'N/A'}</li>`,
    `    <li><strong>Reference Number:</strong> <strong>${refNumber}</strong></li>`,
    `    <li><strong>Status:</strong> APPROVED</li>`,
    `    <li><strong>Approved:</strong> ${formatDate(new Date())}</li>`,
    `  </ul>`,
    `  <p>Please present this reference number during move-in.</p>`,
    `  <h4 style="margin-bottom: 4px;">Contact Information</h4>`,
    `  <ul style="list-style: none; padding: 0; margin: 0;">`,
    `    <li>Phone: ${business.phone || 'N/A'}</li>`,
    `    <li>Email: ${business.email || 'N/A'}</li>`,
    businessLink
      ? `    <li>Manage Your Tenancy: <a href="${businessLink}">${business.name}</a></li>`
      : '',
    `  </ul>`,
    `  <p>Thank you for choosing ${business.name} for your accommodation needs.</p>`,
    `  <p>Best regards,<br><strong>The ${business.name} Team</strong></p>`,
    `</div>`,
  ].join('\n');
};

const generateBookingApprovalSubject = (booking: Booking, business: Business): string => {
  const refNumber = booking.id
    ? `${booking.id.substring(0, 8).toUpperCase()}`
    : 'PENDING';
  return `🎉 Booking Request Approved - ${business.name} (${refNumber})`;
};
export const sendShareRequestEmail = async (
  shareEmail: string,
  business: Business,
  userEmail: string,
): Promise<{ success: boolean; error?: unknown }> => {
  try {
    const { error: emailError } = await supabase.functions.invoke('send-message', {
      headers: getAuthStateSnapshot().session
        ? { Authorization: `Bearer ${getAuthStateSnapshot().session?.access_token}` }
        : undefined,
      body: {
        channel: 'email',
        to: shareEmail,
        subject: `Business Share Request - ${business.name}`,
        html: `
          <div style="font-family: sans-serif; font-size: 14px; line-height: 1.4;">
            <p>Dear ${shareEmail},</p>
            <p>You have been invited to share the business <strong>${business.name}</strong> by <strong>${userEmail}</strong></p>
            <p>You can reach them on <strong>${business.phone || 'N/A'}</strong></p>
            <p>Please login to the app to accept or decline this share request.</p>
            <p>Best regards,<br><strong>${business.name}</strong><br>${userEmail}</p>
          </div>
        `,
      },
    });

    if (emailError) throw emailError;
    return { success: true };
  } catch (error) {
    console.error('Error sending share request email:', error);
    return { success: false, error };
  }
};

export const sendAcceptanceEmail = async (
  business: Business,
  user: { email: string },
): Promise<{ success: boolean; error?: unknown }> => {
  try {
    const { error: emailError } = await supabase.functions.invoke('send-message', {
      headers: getAuthStateSnapshot().session
        ? { Authorization: `Bearer ${getAuthStateSnapshot().session?.access_token}` }
        : undefined,
      body: {
        channel: 'email',
        to: business.email || '',
        subject: `Business Share Request Accepted - ${business.name}`,
        html: `
          <div style="font-family: sans-serif; font-size: 14px; line-height: 1.4;">
            <p>Dear ${business.name},</p>
            <p><strong>${user.email}</strong> has accepted your share request to share the business <strong>${business.name}</strong></p>
            <p>Best regards,<br><strong>${business.name}</strong><br>${business.email || ''}</p>
          </div>
        `,
      },
    });

    if (emailError) throw emailError;
    return { success: true };
  } catch (error) {
    console.error('Error sending acceptance email:', error);
    return { success: false, error };
  }
};

export const sendShareRemovalEmail = async (
  shareEmail: string,
  business: Business,
  userEmail: string,
): Promise<{ success: boolean; error?: unknown }> => {
  try {
    const { error: emailError } = await supabase.functions.invoke('send-message', {
      headers: getAuthStateSnapshot().session
        ? { Authorization: `Bearer ${getAuthStateSnapshot().session?.access_token}` }
        : undefined,
      body: {
        channel: 'email',
        to: shareEmail,
        subject: `Access Revoked - ${business.name}`,
        html: `
          <div style="font-family: sans-serif; font-size: 14px; line-height: 1.4;">
            <p>Dear ${shareEmail},</p>
            <p>Your access to the business <strong>${business.name}</strong> has been revoked by <strong>${userEmail}</strong>.</p>
            <p>If you feel this was done in error, please contact <strong>${userEmail}</strong> to resolve the issue.</p>
            <p>Best regards,<br><strong>${business.name} Team</strong></p>
          </div>
        `,
      },
    });

    if (emailError) throw emailError;
    return { success: true };
  } catch (error) {
    console.error('Error sending share removal email:', error);
    return { success: false, error };
  }
};

export const sendBackupEmail = async (
  business: Business,
  backupData: BackupData,
  backupBase64: string,
): Promise<{ success: boolean; error?: unknown }> => {
  try {
    const { error: emailError } = await supabase.functions.invoke('send-message', {
      headers: getAuthStateSnapshot().session
        ? { Authorization: `Bearer ${getAuthStateSnapshot().session?.access_token}` }
        : undefined,
      body: {
        channel: 'email',
        to: business.email || '',
        subject: `Business Data Backup - ${business.name}`,
        html: `
          <div style="font-family: sans-serif; font-size: 14px; line-height: 1.4;">
            <p>Dear ${business.name},</p>
            <p>Your business data has been deleted.<br> Please find attached a backup of all your business data before deletion.</p>
            <p><strong>Backup Details:</strong></p>
            <ul style="margin-top: 0; padding-left: 20px;">
              <li>Version: ${backupData.version}</li>
              <li>Date: ${new Date(backupData.timestamp).toLocaleString()}</li>
            </ul>
            <p>Best regards,<br><strong>Property Admin</strong></p>
          </div>
        `,
        attachments: [
          {
            filename: `Backup - ${business.name}.json`,
            content: backupBase64,
            contentType: 'application/json',
            encoding: 'base64',
          },
        ],
      },
    });

    if (emailError) throw emailError;
    return { success: true };
  } catch (error) {
    console.error('Error sending backup email:', error);
    return { success: false, error };
  }
};

export const sendReceiptEmail = async (
  receipt: Receipt & any,
  tenant: Tenant,
  pdfBase64?: string,
): Promise<boolean> => {
  try {
    // Get business details
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', receipt.business_id)
      .maybeSingle();

    if (businessError) throw new Error(businessError.message);
    if (!business) throw new Error(`Business with ID ${receipt.business_id} not found`);
    if (!tenant.email) throw new Error('Tenant email not found');

    // Get business settings for currency
    const { data: settings } = await supabase
      .from('settings')
      .select('setting_value')
      .eq('business_id', business.id)
      .eq('setting_key', 'currency_settings')
      .maybeSingle();

    const currencySettings = settings?.setting_value as { currency?: string } | undefined;
    const currency = currencySettings?.currency || 'KES';

    // Prepare email content
    const emailContent: any = {
      channel: 'email',
      to: tenant.email,
      bcc: business.email,
      subject: `Payment Receipt - ${business.name}`,
      html: `
        <p>Dear ${tenant.name},</p>
        <p>Thank you for your payment. Here are your receipt details:</p>
        <table>
          <tr><td><strong>Receipt Number:</strong></td><td>${
            receipt.id?.slice(-6).toUpperCase() || 'N/A'
          }</td></tr>
          <tr><td><strong>Date:</strong></td><td>${new Date(
            receipt.created_at || receipt.payment_date,
          ).toLocaleDateString()}</td></tr>
          <tr><td><strong>Amount:</strong></td><td>${receipt.amount} ${currency}</td></tr>
          <tr><td><strong>Payment Method:</strong></td><td>${properCase(
            receipt.payment_method,
          )}</td></tr>
          <tr><td><strong>Type:</strong></td><td>${snakeCaseToTitleCase(receipt.type)}</td></tr>
        </table>
        <p>If you have any questions, please contact us.</p>
        <p>Best regards,<br>${business.name}</p>
      `,
    };

    if (pdfBase64) {
      emailContent.attachments = [
        {
          filename: `Receipt_${receipt.id?.slice(-6).toUpperCase() || 'Payment'}.pdf`,
          content: pdfBase64,
          contentType: 'application/pdf',
          encoding: 'base64',
        },
      ];
    }

    // Call Supabase Edge Function
    const { error } = await supabase.functions.invoke('send-message', {
      headers: getAuthStateSnapshot().session
        ? { Authorization: `Bearer ${getAuthStateSnapshot().session?.access_token}` }
        : undefined,
      body: emailContent,
    });

    if (error) throw error;

    return true;
  } catch (error) {
    console.error('Error sending receipt email:', error);
    throw error;
  }
};
export const sendContractEmail = async (
  tenant: { name: string; email: string },
  business: { name: string; id: string; email?: string; phone?: string },
  contractId: string,
  pdfBase64: string,
): Promise<boolean> => {
  try {
    if (!tenant.email) throw new Error('Tenant has no email address');

    const emailContent: any = {
      channel: 'email',
      to: tenant.email,
      cc: business.email,
      subject: `Lease Agreement - ${business.name}`,
      html: `
        <div style="font-family: sans-serif; line-height: 1.6; color: #333;">
          <h2 style="color: #667eea;">Lease Agreement</h2>
          <p>Dear ${tenant.name},</p>
          <p>Please find attached the Lease Agreement for your unit at <strong>${business.name}</strong>.</p>
          <p>This document contains the terms and conditions of your tenancy. Please review it carefully and keep a copy for your records.</p>
          <div style="margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-left: 4px solid #667eea;">
            <strong>Contract ID:</strong> #${contractId.substring(0, 8).toUpperCase()}
          </div>
          <p>If you have any questions regarding this agreement, please feel free to reach out to us on <strong>${business.phone}</strong> or email us at <strong>${business.email}</strong>.</p>
          <p>Best regards,<br><strong>${business.name} Team</strong></p>
        </div>
      `,
      attachments: [
        {
          filename: `Lease_Agreement_${contractId.substring(0, 8).toUpperCase()}.pdf`,
          content: pdfBase64,
          contentType: 'application/pdf',
          encoding: 'base64',
        },
      ],
    };

    const { error } = await supabase.functions.invoke('send-message', {
      headers: getAuthStateSnapshot().session
        ? { Authorization: `Bearer ${getAuthStateSnapshot().session?.access_token}` }
        : undefined,
      body: emailContent,
    });

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error sending contract email:', error);
    throw error;
  }
};
