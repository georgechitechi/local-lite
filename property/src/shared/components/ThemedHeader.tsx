import React from 'react';
import { View } from 'react-native';
import { Appbar, Text } from 'react-native-paper';
import NetworkIndicator from '@/shared/components/NetworkIndicator';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

export interface HeaderAction {
  icon: string;
  onPress: () => void;
  size?: number;
}

export interface ThemedHeaderProps {
  title: string;
  actions?: HeaderAction[];
  onTitlePress?: (() => void) | null;
  subtitle?: string;
  avatar?: React.ReactNode;
  extra?: React.ReactNode;
}

const ThemedHeader = React.memo(
  ({
    title,
    actions = [],
    onTitlePress = null,
    subtitle,
    avatar,
    extra = <NetworkIndicator />,
  }: ThemedHeaderProps) => {
    const colors = useThemeColors();

    return (
      <Appbar.Header style={{ backgroundColor: colors.surface }}>
        {avatar && <View style={{ marginLeft: 8, marginRight: 8 }}>{avatar}</View>}
        <Appbar.Content
          title={
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text
                  variant="titleMedium"
                  style={{ color: colors.onSurface, fontWeight: 'bold', fontSize: 18 }}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  allowFontScaling={false}
                >
                  {title}
                </Text>
              </View>
              {subtitle && (
                <Text
                  variant="bodySmall"
                  style={{ color: colors.onSurfaceVariant, fontSize: 11 }}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  allowFontScaling={false}
                >
                  {subtitle}
                </Text>
              )}
            </View>
          }
          onPress={onTitlePress || undefined}
        />
        {extra && (
          <View style={{ marginRight: 8, justifyContent: 'center' }}>{extra}</View>
        )}
        {actions.map((action, index) => (
          <Appbar.Action
            key={index}
            size={action.size || 28}
            icon={action.icon}
            iconColor={colors.onSurface}
            onPress={action.onPress}
            style={{ marginHorizontal: 0 }}
          />
        ))}
      </Appbar.Header>
    );
  },
);

ThemedHeader.displayName = 'ThemedHeader';

export default ThemedHeader;
