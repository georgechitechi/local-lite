import { Platform, Share } from 'react-native';
import { getStoreUrl, shareApp } from '@/shared/utils/shareApp';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      name: 'Property Admin',
      android: {
        package: 'com.propertyadmin.manager',
      },
    },
  },
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Share: {
    share: jest.fn(),
    sharedAction: 'sharedAction',
    dismissedAction: 'dismissedAction',
  },
}));

describe('shareApp utility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'android';
  });

  describe('getStoreUrl', () => {
    it('returns play store URL on Android', () => {
      Platform.OS = 'android';
      const url = getStoreUrl();
      expect(url).toContain(
        'play.google.com/store/apps/details?id=com.propertyadmin.manager',
      );
    });

    it('returns store URL string on iOS', () => {
      Platform.OS = 'ios';
      const url = getStoreUrl();
      expect(typeof url).toBe('string');
      expect(url).toContain('store');
    });
  });

  describe('shareApp', () => {
    it('calls Share.share with app message and link', async () => {
      (Share.share as jest.Mock).mockResolvedValue({ action: 'sharedAction' });

      const result = await shareApp();
      expect(result).toBe(true);
      expect(Share.share).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('Property Admin'),
          message: expect.stringContaining('play.google.com'),
          url: expect.stringContaining('play.google.com'),
        }),
        expect.anything(),
      );
    });
  });
});
