let cachedRN: any;
let rnResolved = false;

export function getRN(): any {
  if (!rnResolved) {
    rnResolved = true;
    try {
      cachedRN = require('react-native');
    } catch {
      // Web / DOM environment
    }
  }
  return cachedRN;
}

let cachedRNSafeArea: any;
let rnSafeAreaResolved = false;

export function getRNSafeArea(): any {
  if (!rnSafeAreaResolved) {
    rnSafeAreaResolved = true;
    try {
      cachedRNSafeArea = require('react-native-safe-area-context');
    } catch {
      // Web / DOM environment or not installed
    }
  }
  return cachedRNSafeArea;
}

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
