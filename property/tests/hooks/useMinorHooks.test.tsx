import NetInfo from '@react-native-community/netinfo';
import { act, renderHook } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import { extractText, isAvailable } from 'expo-pdf-text-extract';
import { useCurrency } from '@/shared/hooks/useCurrency';
import { useNetworkStatus } from '@/shared/hooks/useNetworkStatus';
import { usePdfExtractor } from '@/shared/hooks/usePdfExtractor';

jest.mock('@/context/SnackbarContext', () => ({
  useSnackbar: () => ({ showSnackbar: jest.fn() }),
}));

jest.mock('@/shared/hooks/useStore', () => ({
  useSettings: jest.fn().mockImplementation(id => {
    if (id === 'biz-1') {
      return [
        {
          setting_key: 'currency_settings',
          setting_value: [{ code: 'EUR', symbol: '€', default: true }],
        },
      ];
    }
    return [];
  }),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn().mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file://test.pdf' }],
  }),
}));

jest.mock('expo-pdf-text-extract', () => ({
  isAvailable: jest.fn().mockReturnValue(true),
  extractText: jest.fn().mockResolvedValue('Extracted PDF Text'),
}));

jest.mock('@react-native-community/netinfo', () => {
  let mockState = { isConnected: true, isInternetReachable: true };
  let listeners: Array<any> = [];
  return {
    fetch: jest.fn(() => Promise.resolve(mockState)),
    addEventListener: jest.fn(cb => {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter(l => l !== cb);
      };
    }),
    __fireState: (state: any) => {
      mockState = state;
      listeners.forEach(cb => {
        cb(state);
      });
    },
  };
});

// Removed delay
describe('usePdfExtractor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('extractTextFromUri works correctly', async () => {
    const { result } = await renderHook(() => usePdfExtractor());

    let text;
    await act(async () => {
      text = await result.current.extractTextFromUri('file://test.pdf');
    });

    expect(text).toBe('Extracted PDF Text');
    expect(extractText).toHaveBeenCalledWith('file://test.pdf');
  });

  it('pickAndExtract works correctly', async () => {
    const { result } = await renderHook(() => usePdfExtractor());

    let text;
    await act(async () => {
      text = await result.current.pickAndExtract();
    });

    expect(text).toBe('Extracted PDF Text');
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalled();
  });

  it('handles isAvailable false', async () => {
    (isAvailable as jest.Mock).mockReturnValueOnce(false);
    const { result } = await renderHook(() => usePdfExtractor());

    let text;
    await act(async () => {
      text = await result.current.extractTextFromUri('file://test.pdf');
    });

    expect(text).toBeNull();
  });
});

describe('useCurrency', () => {
  it('returns default currency when no settings found', async () => {
    const { result } = await renderHook(() => useCurrency('biz-2'));
    expect(result.current.defaultCurrency).toBeDefined();
    expect(result.current.defaultCurrency.code).toBe('KES'); // Assuming KES is the default fallback
  });

  it('returns custom currency when settings exist', async () => {
    const { result } = await renderHook(() => useCurrency('biz-1'));
    expect(result.current.defaultCurrency.code).toBe('EUR');
    expect(result.current.defaultCurrency.symbol).toBe('€');
  });
});

describe('useNetworkStatus', () => {
  it('returns network status', async () => {
    const { result } = await renderHook(() => useNetworkStatus());

    // Default mock state is true
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toBe(true);

    // Fire state change to false
    await act(async () => {
      (NetInfo as any).__fireState({ isConnected: false, isInternetReachable: false });
    });

    expect(result.current).toBe(false);
  });
});
