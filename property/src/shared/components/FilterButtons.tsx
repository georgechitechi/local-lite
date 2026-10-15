import React from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { Button } from 'react-native-paper';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

interface FilterOption {
  label: string;
  value: string | null;
  icon?: string;
}

interface FilterButtonsProps {
  options: FilterOption[];
  selectedValue: string | null;
  onValueChange: (value: string | null) => void;
  containerStyle?: ViewStyle;
  horizontal?: boolean;
  selectButton?: {
    label: string;
    onPress: () => void;
    icon?: string;
  };
}

const FilterButtons = ({
  options,
  selectedValue,
  onValueChange,
  containerStyle,
  horizontal = true,
  selectButton,
}: FilterButtonsProps) => {
  const colors = useThemeColors();

  const renderContent = () => (
    <View style={styles.group}>
      {options.map((option, index) => {
        const isSelected = selectedValue === option.value;
        return (
          <React.Fragment key={index}>
            <Button
              mode="text"
              onPress={() => onValueChange(option.value)}
              compact
              icon={option.icon}
              textColor={isSelected ? colors.primary : colors.onSurfaceVariant}
              labelStyle={[
                styles.label,
                {
                  fontWeight: isSelected ? 'bold' : 'normal',
                  color: isSelected ? colors.primary : colors.onSurfaceVariant,
                },
              ]}
            >
              {option.label}
            </Button>
            {index < options.length - 1 && (
              <View
                style={{
                  width: 1,
                  height: 16,
                  backgroundColor: colors.outlineVariant,
                  alignSelf: 'center',
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.outlineVariant,
          backgroundColor: colors.surface,
        },
        containerStyle,
      ]}
    >
      <View style={{ flex: 1 }}>
        {horizontal ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.scrollContainer}
          >
            {renderContent()}
          </ScrollView>
        ) : (
          renderContent()
        )}
      </View>
      {selectButton && (
        <View style={styles.rightContainer}>
          <Button
            mode="text"
            compact
            icon={selectButton.icon}
            onPress={selectButton.onPress}
            labelStyle={{ fontSize: 12 }}
          >
            {selectButton.label}
          </Button>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  label: {
    fontSize: 13,
    marginVertical: 4,
  },
  rightContainer: {
    paddingRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default FilterButtons;
