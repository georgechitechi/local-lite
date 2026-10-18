/**
 * Utility script to initialize default settings for existing businesses
 * This can be run to set up default settings for businesses that were created
 * before the automatic settings initialization was implemented
 */

import { getUser, OFFLINE_USER_ID } from '@/shared/services/auth';
import { getSyncClient } from '@/shared/services/sync/client';
import { initializeAllMissingSettings } from './settingsHelper';

interface MissingSettingsResult {
  success: boolean;
  totalBusinesses?: number;
  businessesWithMissingSettings?: {
    id: string;
    name: string;
    missingSettings: number;
  }[];
  needsInitialization?: boolean;
  error?: string;
}

interface InitializationResult {
  success: boolean;
  message: string;
  results?: unknown;
  error?: string;
  businessId?: string;
}

/**
 * Initialize settings for all businesses that don't have default settings
 */
const runSettingsInitialization = async (): Promise<InitializationResult> => {
  try {
    console.log('Starting settings initialization for all businesses...');

    const result = await initializeAllMissingSettings();

    console.log('Settings initialization completed successfully!');
    console.log('Results:', result);

    return {
      success: true,
      message: 'Settings initialization completed successfully',
      results: result,
    };
  } catch (error) {
    console.error('Settings initialization failed:', error);
    return {
      success: false,
      message: 'Settings initialization failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

/**
 * Initialize settings for a specific business
 */
export const initializeBusinessSettings = async (
  businessId: string,
): Promise<InitializationResult> => {
  try {
    // Rely on the local sync helper to initialize settings for a specific business
    await initializeAllMissingSettings(businessId);

    return {
      success: true,
      message: 'Settings initialization requested successfully',
      businessId,
    };
  } catch (error) {
    console.error('Settings initialization failed for business:', businessId, error);
    return {
      success: false,
      message: 'Settings initialization failed',
      businessId,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

/**
 * Check which businesses are missing default settings
 */
const checkMissingSettings = async (): Promise<MissingSettingsResult> => {
  try {
    const user = await getUser();

    if (!user) {
      throw new Error('User not authenticated');
    }

    const client = await getSyncClient();
    const allBusinesses = (await client.findMany('businesses')) || [];
    const userBusinesses = allBusinesses.filter(
      (b: any) => b.user_id === user.id || user.id === OFFLINE_USER_ID,
    );

    const businessesWithMissingSettings: {
      id: string;
      name: string;
      missingSettings: number;
    }[] = [];

    for (const business of userBusinesses) {
      const allSettings =
        (await client.findMany('settings', {
          where: { business_id: business.id },
        })) || [];
      const settings = allSettings;

      let foundEssential = 0;
      if (settings.some((s: any) => s.setting_key === 'house_types')) foundEssential++;
      if (settings.some((s: any) => s.setting_key === 'amenities')) foundEssential++;
      if (settings.some((s: any) => s.setting_key === 'currency_settings'))
        foundEssential++;

      if (foundEssential < 3) {
        businessesWithMissingSettings.push({
          id: business.id,
          name: business.name,
          missingSettings: 3 - foundEssential,
        });
      }
    }

    return {
      success: true,
      totalBusinesses: userBusinesses.length,
      businessesWithMissingSettings,
      needsInitialization: businessesWithMissingSettings.length > 0,
    };
  } catch (error) {
    console.error('Error checking missing settings:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

/**
 * Main function to run the initialization process
 */
const main = async (): Promise<void> => {
  try {
    console.log('=== Settings Initialization Utility ===');

    // First, check what needs to be initialized
    const checkResult = await checkMissingSettings();

    if (!checkResult.success) {
      console.error('Failed to check missing settings:', checkResult.error);
      return;
    }

    console.log(
      `Found ${checkResult.businessesWithMissingSettings?.length || 0} businesses with missing settings out of ${checkResult.totalBusinesses || 0} total businesses`,
    );

    if ((checkResult.businessesWithMissingSettings?.length || 0) === 0) {
      console.log(
        'All businesses already have default settings. No initialization needed.',
      );
      return;
    }

    // Show which businesses need initialization
    console.log('\nBusinesses needing initialization:');
    checkResult.businessesWithMissingSettings?.forEach(business => {
      console.log(
        `- ${business.name} (ID: ${business.id}) - Missing ${business.missingSettings} settings`,
      );
    });

    // Run the initialization
    console.log('\nStarting initialization...');
    const initResult = await runSettingsInitialization();

    if (initResult.success) {
      console.log('\n✅ Settings initialization completed successfully!');
    } else {
      console.error('\n❌ Settings initialization failed:', initResult.message);
    }
  } catch (error) {
    console.error('Unexpected error during initialization:', error);
  }
};

// Export for use in other modules
export default {
  runSettingsInitialization,
  initializeBusinessSettings,
  checkMissingSettings,
  main,
};
