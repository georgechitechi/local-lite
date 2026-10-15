import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import type React from 'react';
import { StyleSheet, View } from 'react-native';
import { IconButton, Menu, Surface, Text } from 'react-native-paper';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

interface ReportType {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  pdfOnly?: boolean;
  adminOnly?: boolean;
}

interface ReportCardProps {
  report: ReportType;
  onDownloadPress: (reportId: string) => void;
  showFormatMenu: boolean;
  onDismissMenu: () => void;
  onExportPress: (reportId: string, format: 'pdf' | 'csv') => void;
  exportLoading: boolean;
}

export const ReportCard: React.FC<ReportCardProps> = ({
  report,
  onDownloadPress,
  showFormatMenu,
  onDismissMenu,
  onExportPress,
  exportLoading,
}) => {
  const colors = useThemeColors();

  return (
    <Surface style={styles.reportCard} elevation={1}>
      <View style={styles.reportContent}>
        <View style={[styles.reportIcon, { backgroundColor: report.color }]}>
          <MaterialCommunityIcons
            name={report.icon as any}
            size={24}
            color={colors.onPrimary}
          />
        </View>
        <View style={styles.reportInfo}>
          <Text variant="titleMedium">{report.title}</Text>
          <Text variant="bodySmall" style={styles.reportDescription}>
            {report.description}
          </Text>
        </View>
        <Menu
          visible={showFormatMenu}
          onDismiss={onDismissMenu}
          anchor={
            <IconButton icon="file-download" onPress={() => onDownloadPress(report.id)} />
          }
        >
          <Menu.Item
            onPress={() => onExportPress(report.id, 'pdf')}
            title="Export as PDF"
            leadingIcon="file-pdf-box"
            disabled={exportLoading}
          />
          {!report.pdfOnly && (
            <Menu.Item
              onPress={() => onExportPress(report.id, 'csv')}
              title="Export as CSV"
              leadingIcon="file-delimited"
              disabled={exportLoading}
            />
          )}
        </Menu>
      </View>
    </Surface>
  );
};

const styles = StyleSheet.create({
  reportCard: {
    borderRadius: 12,
    marginBottom: 12,
  },
  reportContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  reportIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  reportInfo: {
    flex: 1,
  },
  reportDescription: {
    opacity: 0.7,
  },
});
