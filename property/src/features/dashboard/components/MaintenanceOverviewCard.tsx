import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Card, Text } from 'react-native-paper';
import EmptyState from '@/shared/components/EmptyState';
import SectionGroup from '@/shared/components/SectionGroup';
import SPressable from '@/shared/components/SlightPressable';
import type { House, MaintenanceRequest, Property, Tenant } from '@/stores/types';
import DashboardCardHeader from './DashboardCardHeader';

interface MaintenanceOverviewCardProps {
  loading: boolean;
  requests: MaintenanceRequest[];
  properties: Property[];
  houses: House[];
  tenants: Tenant[];
  colors: any;
}

const MaintenanceOverviewCard: React.FC<MaintenanceOverviewCardProps> = ({
  loading,
  requests,
  properties,
  houses,

  colors,
}) => {
  const router = useRouter();
  const [expandedGroups, setExpandedGroups] = React.useState<Set<string>>(new Set());

  const toggleGroup = (group: string) => {
    const next = new Set(expandedGroups);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    setExpandedGroups(next);
  };

  const getRequestInfo = (request: MaintenanceRequest) => {
    const house = houses.find(h => h.id === request.house_id);
    let property = properties.find(p => p.id === request.property_id);

    if (!property && house) {
      property = properties.find(p => p.id === house?.property_id);
    }

    return {
      propertyName: property?.name || 'General Maintenance',
      houseNumber: house?.house_number || 'N/A',
    };
  };

  const urgentRequests = requests.filter(
    r =>
      (r.priority === 'urgent' || r.priority === 'high') &&
      r.status !== 'completed' &&
      r.status !== 'cancelled',
  );

  const pendingRequests = requests.filter(
    r =>
      (r.priority === 'medium' || r.priority === 'low') &&
      (r.status === 'pending' || r.status === 'in_progress'),
  );

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return colors.error;
      case 'high':
        return colors.warning;
      case 'medium':
        return colors.info;
      case 'low':
        return colors.success;
      default:
        return colors.onSurfaceVariant;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return 'hourglass';
      case 'in_progress':
        return 'wrench';
      case 'completed':
        return 'check-circle';
      case 'cancelled':
        return 'close-circle';
      default:
        return 'help-circle-outline';
    }
  };

  return (
    <Card mode="elevated" style={[styles.card, { backgroundColor: colors.surface }]}>
      <DashboardCardHeader
        title="Maintenance Overview"
        subtitle={`${
          requests.filter(r => r.status !== 'completed' && r.status !== 'cancelled')
            .length
        } Active Issues`}
      />

      <Card.Content style={{ paddingHorizontal: 0, paddingBottom: 0 }}>
        {loading ? (
          <ActivityIndicator style={{ padding: 20 }} color={colors.primary} />
        ) : urgentRequests.length === 0 && pendingRequests.length === 0 ? (
          <EmptyState title="No Active Issues" />
        ) : (
          <View>
            {/* URGENT & HIGH PRIORITY GROUP */}
            {urgentRequests.length > 0 && (
              <>
                <SectionGroup
                  title="URGENT & HIGH PRIORITY"
                  subtitle={`${urgentRequests.length} Critical Issues`}
                  isExpanded={expandedGroups.has('urgent')}
                  onToggle={() => toggleGroup('urgent')}
                  backgroundColor={colors.surfaceVariant}
                  titleColor={colors.error}
                />

                {expandedGroups.has('urgent') && (
                  <View style={styles.listContainer}>
                    {urgentRequests.map((request, index) => {
                      const info = getRequestInfo(request);
                      return (
                        <SPressable
                          key={request.id || index}
                          onPress={() => router.push(`/maintenance`)}
                          style={[
                            styles.item,
                            { borderBottomColor: colors.outlineVariant },
                            index === urgentRequests.length - 1 && {
                              borderBottomWidth: 0,
                            },
                          ]}
                        >
                          <View style={styles.itemRow}>
                            <View style={styles.itemMain}>
                              <Text
                                style={[styles.itemTitle, { color: colors.onSurface }]}
                                numberOfLines={1}
                              >
                                {request.description || 'No description'}
                              </Text>
                              <Text
                                style={[
                                  styles.itemSubtitle,
                                  { color: colors.onSurfaceVariant },
                                ]}
                              >
                                {info.propertyName} • House {info.houseNumber}
                              </Text>
                              <View style={styles.itemMeta}>
                                <MaterialCommunityIcons
                                  name={getStatusIcon(request.status) as any}
                                  size={12}
                                  color={colors.onSurfaceVariant}
                                />
                                <Text
                                  style={[
                                    styles.metaText,
                                    { color: colors.onSurfaceVariant },
                                  ]}
                                >
                                  {request.status.replace('_', ' ')}
                                </Text>
                              </View>
                            </View>
                            <View style={styles.itemRight}>
                              <Text
                                style={{
                                  fontSize: 10,
                                  color: getPriorityColor(request.priority),
                                  fontWeight: 'bold',
                                }}
                              >
                                {request.priority.toUpperCase()}
                              </Text>
                              <Text
                                style={[
                                  styles.dateText,
                                  { color: colors.onSurfaceVariant },
                                ]}
                              >
                                {request.event_date
                                  ? new Date(request.event_date).toLocaleDateString()
                                  : 'N/A'}
                              </Text>
                            </View>
                          </View>
                        </SPressable>
                      );
                    })}
                  </View>
                )}
              </>
            )}

            {/* PENDING & IN PROGRESS GROUP */}
            {pendingRequests.length > 0 && (
              <>
                <SectionGroup
                  title="ACTIVE TASKS"
                  subtitle={`${pendingRequests.length} Tasks in Progress`}
                  isExpanded={expandedGroups.has('pending')}
                  onToggle={() => toggleGroup('pending')}
                  backgroundColor={colors.surfaceVariant}
                  titleColor={colors.primary}
                />

                {expandedGroups.has('pending') && (
                  <View style={styles.listContainer}>
                    {pendingRequests.map((request, index) => {
                      const info = getRequestInfo(request);
                      return (
                        <SPressable
                          key={request.id || index}
                          onPress={() => router.push(`/maintenance`)}
                          style={[
                            styles.item,
                            { borderBottomColor: colors.outlineVariant },
                            index === pendingRequests.length - 1 && {
                              borderBottomWidth: 0,
                            },
                          ]}
                        >
                          <View style={styles.itemRow}>
                            <View style={styles.itemMain}>
                              <Text
                                style={[styles.itemTitle, { color: colors.onSurface }]}
                                numberOfLines={1}
                              >
                                {request.description || 'No description'}
                              </Text>
                              <Text
                                style={[
                                  styles.itemSubtitle,
                                  { color: colors.onSurfaceVariant },
                                ]}
                              >
                                {info.propertyName} • House {info.houseNumber}
                              </Text>
                              <View style={styles.itemMeta}>
                                <MaterialCommunityIcons
                                  name={getStatusIcon(request.status) as any}
                                  size={12}
                                  color={colors.onSurfaceVariant}
                                />
                                <Text
                                  style={[
                                    styles.metaText,
                                    { color: colors.onSurfaceVariant },
                                  ]}
                                >
                                  {request.status.replace('_', ' ')}
                                </Text>
                              </View>
                            </View>
                            <View style={styles.itemRight}>
                              <Text
                                style={{
                                  fontSize: 10,
                                  color: getPriorityColor(request.priority),
                                  fontWeight: 'bold',
                                }}
                              >
                                {request.priority.toUpperCase()}
                              </Text>
                              <Text style={styles.dateText}>
                                {request.event_date
                                  ? new Date(request.event_date).toLocaleDateString()
                                  : 'N/A'}
                              </Text>
                            </View>
                          </View>
                        </SPressable>
                      );
                    })}
                  </View>
                )}
              </>
            )}
          </View>
        )}
      </Card.Content>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 0,
    overflow: 'hidden',
  },
  listContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  item: {
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemMain: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  itemSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  itemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  metaText: {
    fontSize: 10,
    marginLeft: 4,
  },
  itemRight: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  dateText: {
    fontSize: 10,
    marginTop: 4,
  },
});

export default MaintenanceOverviewCard;
