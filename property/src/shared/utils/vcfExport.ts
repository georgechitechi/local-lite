import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type * as T from '@/shared/types/types';
import { formatDateForDB } from '@/shared/utils/formatters';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';

export type Tenant = T.VCFTenant;
export type ExportResult = T.ExportResult;

const generateVCard = (tenant: Tenant, businessName: string): string => {
  const lines: string[] = [];

  lines.push('BEGIN:VCARD');
  lines.push('VERSION:2.1');

  const uniqueId = `tenant_${tenant.id}_${Date.now()}`;
  lines.push(`UID:${uniqueId}`);

  if (tenant.name) {
    const escapedName = tenant.name
      .trim()
      .replace(/[,;\\]/g, '\\$&')
      .trim();
    lines.push(`FN:${escapedName}`);

    const firstName = tenant.name
      .trim()
      .replace(/[,;\\]/g, '\\$&')
      .trim();
    const businessNameParts = businessName
      ? businessName
          .trim()
          .split(' ')
          .filter(part => part.trim())
      : [];
    const surname =
      businessNameParts.length > 0
        ? businessNameParts[0]
            .trim()
            .replace(/[,;\\]/g, '\\$&')
            .trim()
        : 'Tenant';

    lines.push(`N:${surname};${firstName};;;`);
    lines.push(`GIVEN:${firstName}`);
    lines.push(`FAMILY:${surname}`);
    lines.push(`NICKNAME:${surname} ${firstName}`);
  }

  if (tenant.phone) {
    const cleanPhone = tenant.phone
      .trim()
      .replace(/[\s\-()]/g, '')
      .trim();
    lines.push(`TEL:${cleanPhone}`);
  }

  if (tenant.email) {
    lines.push(`EMAIL:${tenant.email.trim()}`);
  }

  if (tenant.address) {
    const escapedAddress = tenant.address
      .trim()
      .replace(/[,;\\]/g, '\\$&')
      .trim();
    lines.push(`ADR:;;${escapedAddress};;;;`);
  }

  const orgName = businessName ? businessName.trim() : 'Property Management';
  lines.push(`ORG:${orgName}`);
  lines.push('TITLE:Tenant');

  if (businessName) {
    const businessNameParts = businessName
      .trim()
      .split(' ')
      .filter(part => part.trim());
    const surname = businessNameParts.length > 0 ? businessNameParts[0].trim() : '';
    if (surname) {
      lines.push(`X-SURNAME:${surname}`);
    }
  }

  if (tenant.contracts && tenant.contracts.length > 0) {
    const activeContract = tenant.contracts.find(c => isActiveContractStatus(c.status));
    if (activeContract?.house) {
      const propertyInfo = activeContract.house.property?.name
        ? `${activeContract.house.property.name} - Room ${activeContract.house.house_number}`
        : `Room ${activeContract.house.house_number}`;
      const escapedNote = propertyInfo.replace(/[,;\\]/g, '\\$&').trim();
      lines.push(`NOTE:Property: ${escapedNote}`);
    }
  }

  lines.push('END:VCARD');

  return lines.join('\r\n');
};

/**
 * Export tenants as VCF (vCard) format using local data
 * @param tenants - Array of tenant objects from local store
 * @param businessName - Business name for VCF organization field
 * @param excludedTenantIds - Array of tenant IDs to exclude from export
 * @returns VCF content string or null if no valid tenants
 */
const exportTenantsAsVCF = (
  tenants: Tenant[],
  businessName: string,
  excludedTenantIds: string[] = [],
): string | null => {
  try {
    if (!tenants || tenants.length === 0) {
      return null;
    }

    // Filter out excluded tenants and inactive ones
    const filteredTenants = tenants.filter(
      tenant =>
        !excludedTenantIds.includes(tenant.id) &&
        tenant.name &&
        tenant.name.trim() &&
        (tenant.phone || tenant.email),
    );

    if (filteredTenants.length === 0) {
      return null;
    }

    const vcfCards = filteredTenants
      .map(tenant => {
        try {
          return generateVCard(tenant, businessName);
        } catch (cardError) {
          console.warn(
            `Failed to generate VCF card for tenant ${tenant.name}:`,
            cardError,
          );
          return null;
        }
      })
      .filter((card): card is string => card !== null);

    if (vcfCards.length === 0) {
      return null;
    }

    const vcfContent = vcfCards.join('\r\n\r\n');

    return vcfContent;
  } catch (error) {
    console.error('Error exporting tenants as VCF:', error);
    throw error;
  }
};

const downloadVCF = async (
  vcfContent: string,
  filename: string = 'tenant_contacts.vcf',
): Promise<string> => {
  try {
    if (!vcfContent || vcfContent.trim().length === 0) {
      throw new Error('VCF content is empty');
    }

    const cleanFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!cleanFilename.endsWith('.vcf')) {
      throw new Error('Filename must end with .vcf extension');
    }

    const file = new File(Paths.document, cleanFilename);
    await file.write(vcfContent);

    if (!file.exists) {
      throw new Error('Failed to create VCF file');
    }

    const isAvailable = await Sharing.isAvailableAsync();
    if (isAvailable) {
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/vcard',
        dialogTitle: 'Export Tenant Contacts',
        UTI: 'public.vcard',
      });
    } else {
      throw new Error('Sharing is not available on this device');
    }

    return file.uri;
  } catch (error) {
    console.error('Error downloading VCF file:', error);
    throw error;
  }
};

export const exportAndDownloadTenantsVCF = async (
  tenants: Tenant[],
  businessName: string,
  filename?: string,
  excludedTenantIds: string[] = [],
): Promise<ExportResult> => {
  try {
    const vcfContent = exportTenantsAsVCF(tenants, businessName, excludedTenantIds);

    if (!vcfContent) {
      return { success: false, message: 'No active tenants found to export' };
    }

    const defaultFilename =
      filename || `tenant_contacts_${formatDateForDB(new Date())}.vcf`;

    const fileUri = await downloadVCF(vcfContent, defaultFilename);

    return { success: true, fileUri };
  } catch (error) {
    console.error('Error in complete VCF export process:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};
