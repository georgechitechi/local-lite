import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import EmptyState from '@/shared/components/EmptyState';
import SectionGroup from '@/shared/components/SectionGroup';
import type { Insight } from '@/shared/hooks/useInsights';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

interface InsightsCardProps {
  insights: Insight[];
  onAction?: (action: string, params?: Record<string, any>) => void;
}

export const InsightsCard = ({ insights, onAction }: InsightsCardProps) => {
  const colors = useThemeColors();
  const [isExpanded, setIsExpanded] = useState(false);

  const getIcon = (type: string) => {
    switch (type) {
      case 'success':
        return 'check-circle';
      case 'warning':
        return 'alert';
      case 'error':
        return 'alert-decagram';
      default:
        return 'information';
    }
  };

  const getIconColor = (type: string) => {
    switch (type) {
      case 'success':
        return colors.success;
      case 'warning':
        return colors.warning;
      case 'error':
        return colors.error;
      default:
        return colors.info;
    }
  };

  const isEmpty = insights.length === 0;

  return (
    <View style={styles.container}>
      <SectionGroup
        title="Smart Insights"
        subtitle={
          !isEmpty
            ? `${insights.length} active insight${insights.length > 1 ? 's' : ''}`
            : undefined
        }
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded(!isExpanded)}
        rightContent={
          <MaterialCommunityIcons name="lightbulb-on" size={24} color={colors.warning} />
        }
      />

      {isExpanded && (
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          {isEmpty ? (
            <Card style={styles.card} mode="elevated">
              <EmptyState
                icon="lightbulb-outline"
                title="No New Insights"
                description="We'll notify you when we find ways to optimize your property management."
              />
            </Card>
          ) : (
            insights.map((insight, index) => (
              <Card key={index} style={styles.card} mode="elevated">
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 16,
                    paddingBottom: 8,
                  }}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      flex: 1,
                      paddingRight: 8,
                    }}
                  >
                    <MaterialCommunityIcons
                      name={getIcon(insight.type) as any}
                      size={24}
                      color={getIconColor(insight.type)}
                    />
                    <Text
                      variant="titleMedium"
                      style={{
                        color: colors.onSurface,
                        fontWeight: '700',
                        marginLeft: 8,
                        flexShrink: 1,
                      }}
                    >
                      {insight.title}
                    </Text>
                  </View>
                  {insight.action && (
                    <Button
                      mode="text"
                      compact
                      textColor={colors.primary}
                      onPress={() =>
                        onAction?.(insight.action as string, insight.actionParams)
                      }
                    >
                      {insight.action}
                    </Button>
                  )}
                </View>
                <Card.Content>
                  <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                    {insight.message}
                  </Text>
                </Card.Content>
              </Card>
            ))
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  card: {
    marginBottom: 12,
    borderRadius: 12,
  },
});
