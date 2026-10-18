import { getUser, OFFLINE_USER_ID } from '@/shared/services/auth';
import { getSyncClient } from '@/shared/services/sync/client';
import type * as T from '@/shared/types/types';
import { defaultCurrencies } from '@/shared/utils/formatters';
import { generateUUID } from '@/shared/utils/helper';
export type HouseType = T.HouseType;
type Amenity = T.Amenity;
export const DEFAULT_HOUSE_TYPES: HouseType[] = [
  {
    id: '1',
    value: 'single',
    label: 'Single Room',
    active: true,
    amenities: ['water', 'electricity', 'security', 'garbage_collection'],
  },
  {
    id: '2',
    value: 'bedsitter',
    label: 'Bedsitter',
    active: true,
    amenities: ['water', 'electricity', 'security', 'parking', 'garbage_collection'],
  },
  {
    id: '3',
    value: 'other',
    label: 'Other',
    active: true,
    amenities: ['water', 'electricity'],
  },
];

const DEFAULT_AMENITIES: Amenity[] = [
  { id: '1', value: 'water', label: 'Water', active: true },
  { id: '2', value: 'electricity', label: 'Electricity', active: true },
  { id: '3', value: 'security', label: 'Security', active: true },
  { id: '4', value: 'parking', label: 'Parking', active: true },
  {
    id: '5',
    value: 'garbage_collection',
    label: 'Garbage Collection',
    active: true,
  },
];

// Function to initialize default settings for all businesses that don't have them
export const initializeAllMissingSettings = async (
  targetBusinessId?: string,
): Promise<unknown> => {
  try {
    const user = await getUser();
    if (!user) {
      console.log('No user found, cannot initialize settings.');
      return { success: false, message: 'No user authenticated' };
    }

    const client = await getSyncClient();
    const allBusinesses = (await client.findMany('businesses')) || [];
    let userBusinesses = allBusinesses.filter(
      (b: any) => b.user_id === user.id || user.id === OFFLINE_USER_ID,
    );

    if (targetBusinessId) {
      userBusinesses = userBusinesses.filter((b: any) => b.id === targetBusinessId);
    }

    let initializedCount = 0;

    for (const business of userBusinesses) {
      const allSettings =
        (await client.findMany('settings', {
          where: { business_id: business.id },
        })) || [];
      const settings = allSettings;

      const hasHouseTypes = settings.some((s: any) => s.setting_key === 'house_types');
      const hasAmenities = settings.some((s: any) => s.setting_key === 'amenities');
      const hasCurrency = settings.some(
        (s: any) => s.setting_key === 'currency_settings',
      );

      if (!hasHouseTypes) {
        await client.insert('settings', {
          id: generateUUID(),
          business_id: business.id,
          user_id: user.id,
          setting_key: 'house_types',
          setting_value: DEFAULT_HOUSE_TYPES as any,
          deleted: false,
        });
      }

      if (!hasAmenities) {
        await client.insert('settings', {
          id: generateUUID(),
          business_id: business.id,
          user_id: user.id,
          setting_key: 'amenities',
          setting_value: DEFAULT_AMENITIES as any,
          deleted: false,
        });
      }

      if (!hasCurrency) {
        await client.insert('settings', {
          id: generateUUID(),
          business_id: business.id,
          user_id: user.id,
          setting_key: 'currency_settings',
          setting_value: defaultCurrencies as any,
          deleted: false,
        });
      }

      if (!hasHouseTypes || !hasAmenities || !hasCurrency) {
        initializedCount++;
      }
    }

    console.log(
      `Missing settings initialization completed. Initialized ${initializedCount} businesses locally.`,
    );
    return { success: true, initializedCount };
  } catch (error) {
    console.error('Error initializing missing settings locally:', error);
    throw error;
  }
};

export const initializeDefaultSettingsForBusiness = async (
  businessId: string,
  userId: string,
): Promise<void> => {
  try {
    const client = await getSyncClient();

    // Initialize house types
    await client.insert('settings', {
      id: generateUUID(),
      business_id: businessId,
      user_id: userId,
      setting_key: 'house_types',
      setting_value: DEFAULT_HOUSE_TYPES as any,
      deleted: false,
    });

    // Initialize amenities
    await client.insert('settings', {
      id: generateUUID(),
      business_id: businessId,
      user_id: userId,
      setting_key: 'amenities',
      setting_value: DEFAULT_AMENITIES as any,
      deleted: false,
    });

    // Initialize currency settings
    await client.insert('settings', {
      id: generateUUID(),
      business_id: businessId,
      user_id: userId,
      setting_key: 'currency_settings',
      setting_value: defaultCurrencies as any,
      deleted: false,
    });

    console.log(
      `Successfully initialized default settings locally for business: ${businessId}`,
    );
  } catch (error) {
    console.error('Error initializing default settings locally:', error);
  }
};
