import { HeaderHeightContext } from 'expo-router/react-navigation';
import React from 'react';
import { type ScrollView, type ScrollViewProps, StyleSheet } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

type Props = ScrollViewProps & {
  children: React.ReactNode;
  extraHeight?: number;
  viewIsInsideTabBar?: boolean;
  useSafeArea?: boolean;
  safeAreaBackgroundColor?: string;
  keyboardVerticalOffset?: number;
  disableHeaderOffset?: boolean;
  noAvoidingView?: boolean;
};

/**
 * A reusable component that automatically pushes inputs up when the keyboard opens.
 * Uses react-native-keyboard-controller for high-performance, native keyboard avoiding.
 */
const KeyboardScroll = React.forwardRef<ScrollView, Props>(
  (
    {
      children,
      extraHeight = 10,
      style,
      contentContainerStyle,
      viewIsInsideTabBar = true,
      useSafeArea,
      safeAreaBackgroundColor,
      keyboardVerticalOffset,
      disableHeaderOffset = false,
      noAvoidingView = false,
      ...otherProps
    },
    ref,
  ) => {
    const contextHeaderHeight = React.useContext(HeaderHeightContext) ?? 0;
    const headerHeight = disableHeaderOffset ? 0 : contextHeaderHeight;
    const shouldUseSafeArea = useSafeArea ?? headerHeight === 0;

    const internalRef = React.useRef<ScrollView>(null);
    const scrollViewRef = (ref as React.RefObject<ScrollView>) || internalRef;

    const flattenedStyle = StyleSheet.flatten(style);
    const bgColor = safeAreaBackgroundColor || flattenedStyle?.backgroundColor;

    // Default high-performance KeyboardAwareScrollView
    const defaultBottomOffset = 4;
    const finalBottomOffset =
      keyboardVerticalOffset !== undefined
        ? keyboardVerticalOffset
        : extraHeight > 10
          ? extraHeight
          : defaultBottomOffset;

    const awareContent = (
      <KeyboardAwareScrollView
        ref={scrollViewRef as any}
        style={[styles.container, style]}
        contentContainerStyle={[
          styles.contentContainer,
          contentContainerStyle,
          noAvoidingView ? { paddingBottom: 80 } : undefined, // Safe padding for modals
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="interactive"
        bottomOffset={finalBottomOffset}
        {...otherProps}
      >
        {children}
      </KeyboardAwareScrollView>
    );

    if (shouldUseSafeArea) {
      return (
        <SafeAreaView
          style={[styles.container, bgColor ? { backgroundColor: bgColor } : undefined]}
          edges={['top']}
        >
          {awareContent}
        </SafeAreaView>
      );
    }

    return awareContent;
  },
);

KeyboardScroll.displayName = 'KeyboardScroll';

export default KeyboardScroll;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
  },
});
