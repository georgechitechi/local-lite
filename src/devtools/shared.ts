let RN: any;
try {
  RN = require('react-native');
} catch {
  // Web / DOM environment
}

let RNSafeArea: any;
try {
  RNSafeArea = require('react-native-safe-area-context');
} catch {
  // Web / DOM environment or not installed
}

export { RN, RNSafeArea };

export const devtoolsBaseRNStyles = {
  fullScreenSafe: {
    flex: 1,
    height: '100%',
  },
  topBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  topBarTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
  },
  topBarSub: {
    fontSize: 11,
    marginTop: 2,
  },
};
