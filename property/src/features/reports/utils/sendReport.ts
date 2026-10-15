import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import { supabase } from '@/shared/services/supabase';
import { getSyncClient } from '@/shared/services/sync/client';
import { MONTHS } from '@/shared/utils/formatters';
import { properCase } from '@/shared/utils/helper';
import { getAuthStateSnapshot } from '@/stores/authStore';
import { getJoinedReportData } from './dataFetchers';
import { processReportData } from './dataProcessors';
import { generatePDFContent, getPDFPrintOptions } from './pdfGenerators';
import type { ReportType } from './types';
export const sendReport = async (
  businessId: string,
  reportType: ReportType,
  emails: string[],
): Promise<{ success: boolean; recipientCount: number }> => {
  try {
    // Get business details from local-lite SQLite
    const client = await getSyncClient();
    const business = await client.findById('businesses', businessId);
    if (!business) throw new Error('Business not found');

    // Get report data from local-lite / local store
    const data = await getJoinedReportData(reportType, businessId);

    // Process data and generate HTML content
    const { data: processedData } = processReportData(reportType, data as any[]);
    const htmlContent = generatePDFContent(processedData, reportType, business as any);

    // Generate PDF
    const { uri: pdfUri } = await Print.printToFileAsync({
      html: htmlContent,
      base64: false,
      ...getPDFPrintOptions(reportType),
      margins: {
        top: 36,
        bottom: 36,
        left: 36,
        right: 36,
      },
    });

    // Use the new File API
    const pdfFile = new File(pdfUri);
    const pdfContent = await pdfFile.base64();

    // Simple email HTML content
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <p>Dear ${business.name},</p>
        <p>Please find attached your ${properCase(reportType)} Report.</p>
        <p>Best regards,<br>${business.name}</p>
      </div>
    `;

    // Send report via email
    const { error: emailError } = await supabase.functions.invoke('send-message', {
      headers: getAuthStateSnapshot().session
        ? { Authorization: `Bearer ${getAuthStateSnapshot().session?.access_token}` }
        : undefined,
      body: {
        channel: 'email',
        to: emails,
        subject: `${properCase(reportType)} Report - ${new Date().toLocaleDateString()}`,
        html: emailHtml,
        attachments: [
          {
            filename: (() => {
              if (reportType === 'pending_rent' && processedData.length > 0) {
                const firstRow = processedData[0] as {
                  current_month?: number;
                  current_year?: number;
                };
                if (firstRow.current_month && firstRow.current_year) {
                  const monthData = MONTHS.find(m => m.value === firstRow.current_month);
                  const monthName = monthData
                    ? monthData.label
                    : String(firstRow.current_month);
                  return `pending_rent_report_${monthName}_${firstRow.current_year}.pdf`;
                }
              }
              return `${reportType}_report.pdf`;
            })(),
            content: pdfContent,
            contentType: 'application/pdf',
            encoding: 'base64',
          },
        ],
      },
    });

    if (emailError) throw emailError;

    // Clean up temporary file using the new File API
    if (pdfFile.exists) {
      pdfFile.delete();
    }

    return { success: true, recipientCount: emails.length };
  } catch (error) {
    console.error('Error sending report:', error);
    throw error;
  }
};
