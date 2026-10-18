import { forwardRef } from 'react';
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

interface SlightPressableProps extends PressableProps {
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  activeOpacity?: number;
}

/**
 * A wrapper around React Native's Pressable that provides a slight, consistent visual feedback.
 * Default activeOpacity is 0.9 to keep it subtle.
 */
const SlightPressableInternal = forwardRef<any, SlightPressableProps>(
  ({ style, activeOpacity = 0.9, children, ...props }, ref) => {
    return (
      <Pressable
        {...props}
        ref={ref}
        android_ripple={undefined}
        style={state => {
          const baseStyle = typeof style === 'function' ? style(state) : style;
          return [
            baseStyle,
            {
              opacity: state.pressed ? activeOpacity : 1,
            },
          ];
        }}
      >
        {children}
      </Pressable>
    );
  },
);

SlightPressableInternal.displayName = 'SlightPressable';

export default SlightPressableInternal;
