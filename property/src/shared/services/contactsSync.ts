import {
  Contact,
  ContactField,
  type CreateContactRecord,
  type NewEmail,
  type NewPhone,
  type NewRelation,
  requestPermissionsAsync,
} from 'expo-contacts';
import { isActiveTenantStatus } from '@/shared/utils/statusHelper';

export type SyncNextOfKin = {
  id?: string;
  name: string;
  relationship?: string;
  phone?: string;
  email?: string;
  is_primary?: boolean;
};

export type SyncContact = {
  id?: string;
  firstName: string;
  lastName?: string;
  phone?: string;
  email?: string;
  notes?: string;
  nextOfKin?: SyncNextOfKin[];
  relations?: NewRelation[];
};

export type SyncResult = {
  success: boolean;
  permissionDenied?: boolean;
  permanentlyDenied?: boolean;
  message?: string;
  created: number;
  updated: number;
  failed: number;
  errors: string[];
};

export type SyncProgressData = {
  currentStep: number;
  totalSteps: number;
  currentTenant: string;
  stats: {
    created: number;
    updated: number;
    replaced: number;
    duplicates: number;
    errors: number;
  };
  progress: number;
};

/**
 * Safely parse next of kin data from either an array or a JSON string.
 */
export function parseNextOfKin(rawNextOfKin: any): SyncNextOfKin[] {
  if (!rawNextOfKin) return [];
  let parsed = rawNextOfKin;
  if (typeof rawNextOfKin === 'string') {
    try {
      parsed = JSON.parse(rawNextOfKin);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      item =>
        item &&
        typeof item === 'object' &&
        typeof item.name === 'string' &&
        item.name.trim().length > 0,
    )
    .map(item => ({
      id: item.id,
      name: item.name.trim(),
      relationship:
        typeof item.relationship === 'string' && item.relationship.trim().length > 0
          ? item.relationship.trim()
          : undefined,
      phone:
        typeof item.phone === 'string' && item.phone.trim().length > 0
          ? item.phone.trim()
          : undefined,
      email:
        typeof item.email === 'string' && item.email.trim().length > 0
          ? item.email.trim()
          : undefined,
      is_primary:
        item.is_primary === true || item.is_primary === 1 || item.is_primary === 'true',
    }))
    .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
}

// Request permission to access contacts
export async function requestContactsPermission(): Promise<boolean> {
  const { status } = await requestPermissionsAsync();
  return status === 'granted';
}

// Helper: find a matching contact by phone or email
async function findExistingContact(
  syncContact: SyncContact,
  businessName: string,
): Promise<Contact | undefined> {
  const contacts = await Contact.getAll({
    name: syncContact.firstName,
  });

  const queryPhone = syncContact.phone ? syncContact.phone.replace(/\D/g, '') : null;
  const queryEmail = syncContact.email ? syncContact.email.toLowerCase() : null;

  for (const c of contacts) {
    const details = await c.getDetails([
      ContactField.NOTE,
      ContactField.PHONES,
      ContactField.EMAILS,
      ContactField.GIVEN_NAME,
      ContactField.FAMILY_NAME,
      ContactField.RELATIONS,
    ]);

    const isOurContact = details.note?.includes(`${businessName} tenant`);

    const matchesPhone =
      queryPhone &&
      details.phones?.some(
        (p: any) => p.number && p.number.replace(/\D/g, '') === queryPhone,
      );
    const matchesEmail =
      queryEmail &&
      details.emails?.some(
        (e: any) => e.address && e.address.toLowerCase() === queryEmail,
      );

    if (isOurContact) {
      const phoneMatch = matchesPhone;
      const emailMatch = matchesEmail;

      const nameMatch =
        details.givenName?.toLowerCase().includes(syncContact.firstName.toLowerCase()) ||
        details.familyName?.toLowerCase().includes(syncContact.firstName.toLowerCase()) ||
        false;

      if (phoneMatch || emailMatch || nameMatch) {
        return c;
      }
    }
  }

  return undefined;
}

/**
 * Sync contacts to device - Local-First Version
 *
 * @param tenants - Array of tenant objects from local-lite store
 * @param businessName - Name of the business for contact notes
 * @param onProgress - Progress callback function
 * @param isCancelled - Function to check if sync was cancelled
 * @param excludedIds - Array of tenant IDs to exclude from sync
 * @param pauseAutoLock - Optional function to pause auto-lock during sync
 * @param resumeAutoLock - Optional function to resume auto-lock after sync
 * @returns SyncResult with statistics
 */
export async function directSyncContacts(
  tenants: {
    id: string;
    name: string;
    phone?: string;
    email?: string;
    address?: string | null;
    status?: string | null;
    next_of_kin?: any;
  }[],
  businessName: string,
  onProgress: (data: SyncProgressData) => void,
  isCancelled: () => boolean,
  excludedIds: string[] = [],
  pauseAutoLock?: () => void,
  resumeAutoLock?: () => void,
): Promise<SyncResult> {
  if (pauseAutoLock) pauseAutoLock();

  const { status, canAskAgain } = await requestPermissionsAsync();
  if (status !== 'granted') {
    if (resumeAutoLock) resumeAutoLock();
    return {
      success: false,
      permissionDenied: true,
      permanentlyDenied: !canAskAgain,
      message: 'Contacts permission is required to sync tenants.',
      created: 0,
      updated: 0,
      failed: 0,
      errors: [],
    };
  }

  try {
    // Filter active tenants and exclude specified IDs
    const activeTenants = tenants.filter(
      t => isActiveTenantStatus(t.status) && !excludedIds.includes(t.id),
    );

    if (!activeTenants || activeTenants.length === 0) {
      if (resumeAutoLock) resumeAutoLock();
      return {
        success: true,
        message: 'No active tenants found.',
        created: 0,
        updated: 0,
        failed: 0,
        errors: [],
      };
    }

    const totalSteps = activeTenants.length;

    let created = 0;
    let updated = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < totalSteps; i++) {
      if (isCancelled()) {
        break;
      }

      const tenant = activeTenants[i];
      const nameParts = tenant.name.trim().split(' ');
      const firstName = nameParts[0];
      const businessSuffix = businessName.trim().split(' ')[0];
      const nameRest = nameParts.slice(1).join(' ');
      const lastName = nameRest ? `${nameRest} ${businessSuffix}` : businessSuffix;

      onProgress({
        currentStep: i + 1,
        totalSteps,
        currentTenant: tenant.name,
        stats: { created, updated, replaced: 0, duplicates: 0, errors: failed },
        progress: i + 1,
      });

      const nextOfKin = parseNextOfKin(tenant.next_of_kin);

      // Build relations for expo-contacts modern API
      const relations: NewRelation[] = nextOfKin.map(k => {
        const rel = k.relationship?.trim().toLowerCase();
        const isBlankOrNA = !rel || rel === 'n/a' || rel === 'na' || rel === 'none';
        return {
          name: k.name,
          label: isBlankOrNA ? 'relative' : rel,
        };
      });

      // Build structured notes linking tenant with business and next of kin details
      let notes = `${businessName} tenant`;
      if (nextOfKin.length > 0) {
        const kinNotes = nextOfKin
          .map(k => {
            const parts = [
              k.name,
              k.phone ? `Phone: ${k.phone}` : '',
              k.email ? `Email: ${k.email}` : '',
              k.is_primary ? 'Primary' : '',
            ]
              .filter(Boolean)
              .join(' - ');
            return `• ${parts}`;
          })
          .join('\n');
        notes += `\n\nNext of Kin:\n${kinNotes}`;
      }

      const syncContact: SyncContact = {
        id: tenant.id,
        firstName,
        lastName,
        phone: tenant.phone,
        email: tenant.email,
        notes,
        nextOfKin,
        relations,
      };

      try {
        const existing = await findExistingContact(syncContact, businessName);

        // Populate phone numbers
        const phones: NewPhone[] = [];
        if (tenant.phone) {
          phones.push({ label: 'mobile', number: tenant.phone });
        }

        // Populate email addresses
        const emails: NewEmail[] = [];
        if (tenant.email) {
          emails.push({ label: 'work', address: tenant.email });
        }

        const baseContactFields: CreateContactRecord = {
          givenName: firstName,
          familyName: lastName,
          phones,
          emails,
          addresses: tenant.address ? [{ label: 'home', street: tenant.address }] : [],
          company: businessName,
          jobTitle: 'Tenant',
          note: syncContact.notes,
          relations:
            syncContact.relations && syncContact.relations.length > 0
              ? syncContact.relations
              : undefined,
        };

        if (existing) {
          await existing.patch(baseContactFields);
          updated++;
        } else {
          await Contact.create(baseContactFields);
          created++;
        }
      } catch (err: any) {
        console.error(`Error syncing tenant ${tenant.name}:`, err);
        failed++;
        errors.push(`${tenant.name}: ${err.message}`);
      }
    }

    if (resumeAutoLock) resumeAutoLock();
    return {
      success: true,
      created,
      updated,
      failed,
      errors,
    };
  } catch (error: any) {
    console.error('Sync failed:', error);
    if (resumeAutoLock) resumeAutoLock();
    return {
      success: false,
      message: error.message,
      created: 0,
      updated: 0,
      failed: 0,
      errors: [error.message],
    };
  }
}
