import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import type React from 'react';
import type { ReactNode } from 'react';
import {
  type DimensionValue,
  KeyboardAvoidingView,
  Platform,
  type StyleProp,
  StyleSheet,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import {
  ActivityIndicator,
  Button,
  Modal,
  Portal,
  ProgressBar,
  Surface,
  Text,
} from 'react-native-paper';
import BaseSearch from '@/shared/components/BaseSearch';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

/** Standard horizontal inset for modal header, footer, and default body content. */
export const MODAL_HORIZONTAL_PADDING = 16;

interface ModalAction {
  label: string;
  onPress: () => void;
  mode?: 'text' | 'outlined' | 'contained' | 'elevated' | 'contained-tonal';
  buttonColor?: string;
  textColor?: string;
  loading?: boolean;
  disabled?: boolean;
  icon?: string;
  style?: ViewStyle;
}

interface SearchConfig {
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  onClear?: () => void;
  style?: ViewStyle;
  containerStyle?: ViewStyle;
  rightIcon?: string;
  emptyRightIcon?: string;
  onEmptyRightIconPress?: () => void;
  isLoading?: boolean;
}

interface BaseModalProps {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  actions?: ModalAction[];
  maxHeight?: DimensionValue;
  showCloseButton?: boolean;
  search?: SearchConfig | null;
  scrollable?: boolean;
  rounded?: boolean;
  zIndex?: number;
  /**
   * When true, body content spans the full sheet width (lists, dividers, image viewers).
   * When false (default), body content uses MODAL_HORIZONTAL_PADDING on the sides (forms).
   */
  edgeToEdge?: boolean;
  headerRight?: React.ReactNode;

  // Confirm mode props
  mode?: 'modal' | 'confirm' | 'info';
  icon?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  loadingText?: string;
  destructive?: boolean;
  showCancel?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
  showProgress?: boolean;
  progress?: number; // 0 to 1
  indeterminate?: boolean;
  progressLabel?: string;
  keyboardVerticalOffset?: number;
}

export default function BaseModal({
  visible,
  onDismiss,
  title,
  subtitle,
  children,
  actions = [],
  maxHeight = '75%',
  showCloseButton = true,
  search = null,
  scrollable = false,
  rounded = true,
  zIndex = 1000,
  edgeToEdge = false,
  headerRight,

  mode = 'modal',
  icon,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  loading = false,
  loadingText = '',
  indeterminate = false,
  destructive = false,
  showCancel = true,
  onConfirm,
  onCancel,
  showProgress = false,
  progress = 0,
  progressLabel,
  keyboardVerticalOffset,
}: BaseModalProps) {
  const colors = useThemeColors();
  const bodyHorizontalPadding = edgeToEdge ? 0 : MODAL_HORIZONTAL_PADDING;
  const bodyVerticalPadding = edgeToEdge ? 0 : MODAL_HORIZONTAL_PADDING;

  const overlayStyle = [styles.modalOverlay, { zIndex }];
  const contentZIndex = { zIndex: zIndex + 1 };

  if (mode === 'confirm' || mode === 'info') {
    const isInfo = mode === 'info';
    return (
      <Portal>
        <Modal
          visible={visible}
          onDismiss={onDismiss}
          contentContainerStyle={[
            styles.confirmContainer,
            { backgroundColor: colors.surface },
            rounded ? styles.roundedContainer : styles.flatContainer,
            contentZIndex,
          ]}
          style={overlayStyle}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            enabled={true}
          >
            <View style={styles.confirmContent}>
              {icon && (
                <View style={{ alignItems: 'center', marginBottom: 16 }}>
                  <Surface
                    style={{
                      padding: 12,
                      borderRadius: 30,
                      backgroundColor: colors.primaryContainer,
                    }}
                  >
                    <MaterialCommunityIcons
                      name={icon as any}
                      size={32}
                      color={colors.onPrimaryContainer}
                    />
                  </Surface>
                </View>
              )}

              <Text variant="titleLarge" style={styles.confirmTitle}>
                {title}
              </Text>

              <View style={styles.confirmBody}>
                {loading && loadingText && (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text
                      variant="bodyMedium"
                      style={{ color: colors.primary, marginLeft: 8 }}
                    >
                      {loadingText}
                    </Text>
                  </View>
                )}
                {(message || subtitle) && (
                  <Text variant="bodyMedium" style={styles.confirmMessage}>
                    {message || subtitle}
                  </Text>
                )}
                {children && (
                  <View
                    style={{
                      marginTop: message || subtitle ? 16 : 0,
                      width: '100%',
                    }}
                  >
                    {children}
                  </View>
                )}

                {showProgress && (
                  <View style={styles.progressContainer}>
                    {progressLabel && (
                      <Text variant="bodySmall" style={styles.progressLabel}>
                        {progressLabel}
                      </Text>
                    )}
                    <ProgressBar
                      progress={progress}
                      indeterminate={indeterminate}
                      color={colors.primary}
                      style={styles.progressBar}
                    />
                  </View>
                )}
              </View>

              <View
                style={[
                  styles.confirmFooter,
                  (!showCancel || isInfo) && styles.singleButtonFooter,
                ]}
              >
                {showCancel && !isInfo && (
                  <Button
                    mode="outlined"
                    onPress={onCancel || onDismiss}
                    style={styles.confirmButton}
                    disabled={loading}
                  >
                    {cancelText}
                  </Button>
                )}
                <Button
                  mode="contained"
                  disabled={loading}
                  buttonColor={destructive ? colors.error : undefined}
                  textColor={destructive ? colors.onError : undefined}
                  onPress={onConfirm || onDismiss}
                  style={
                    showCancel && !isInfo
                      ? styles.confirmButton
                      : styles.singleConfirmButton
                  }
                >
                  {isInfo
                    ? confirmText === 'Confirm'
                      ? 'Got it'
                      : confirmText
                    : confirmText}
                </Button>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </Portal>
    );
  }
  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={[
          styles.modalContainer,
          {
            maxHeight,
            backgroundColor: colors.surface,
            ...(rounded ? styles.roundedContainer : styles.flatContainer),
          },
          contentZIndex,
        ]}
        style={overlayStyle}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.modalContent, { maxHeight: '100%' }]}
          keyboardVerticalOffset={keyboardVerticalOffset ?? 0}
          enabled={true}
        >
          <View
            style={[
              styles.modalHeader,
              {
                borderBottomColor: colors.outline,
                backgroundColor: colors.surface,
              },
              rounded && styles.roundedContainer,
              search
                ? { borderBottomWidth: 0, paddingBottom: 8 }
                : { borderBottomWidth: StyleSheet.hairlineWidth },
            ]}
          >
            <View style={styles.titleContainer}>
              <Text variant="titleLarge" style={styles.modalTitleText}>
                {title}
              </Text>
              {subtitle && (
                <Text
                  variant="bodySmall"
                  style={[styles.modalSubtitleText, { color: colors.onSurfaceVariant }]}
                >
                  {subtitle}
                </Text>
              )}
            </View>
            <View style={styles.headerRightContainer}>
              {headerRight}
              {showCloseButton && (
                <MaterialCommunityIcons
                  name="close"
                  size={24}
                  color={colors.onSurfaceVariant}
                  onPress={onDismiss}
                  style={styles.closeButton}
                />
              )}
            </View>
          </View>

          {search && (
            <View
              style={
                bodyHorizontalPadding > 0
                  ? { paddingHorizontal: bodyHorizontalPadding }
                  : undefined
              }
            >
              <BaseSearch
                placeholder={search.placeholder || 'Search...'}
                value={search.value}
                onChangeText={search.onChangeText}
                onClear={search.onClear}
                leftIcon="magnify"
                rightIcon={search.rightIcon || 'close-circle'}
                emptyRightIcon={search.emptyRightIcon}
                onEmptyRightIconPress={search.onEmptyRightIconPress}
                isLoading={search.isLoading}
                style={[
                  { backgroundColor: colors.surface },
                  search.style as StyleProp<TextStyle>,
                ]}
                containerStyle={StyleSheet.flatten([
                  styles.searchContainer,
                  search.containerStyle,
                ])}
              />
            </View>
          )}

          {scrollable ? (
            <KeyboardScroll
              useSafeArea={false}
              style={{ flex: 1 }}
              extraHeight={0}
              disableHeaderOffset={true}
              noAvoidingView={true}
              contentContainerStyle={[
                styles.scrollContent,
                {
                  paddingHorizontal: bodyHorizontalPadding,
                  paddingVertical: bodyVerticalPadding,
                },
                search && !edgeToEdge && { paddingTop: 0 },
              ]}
              showsVerticalScrollIndicator={true}
            >
              {children}
            </KeyboardScroll>
          ) : (
            <View
              style={[
                styles.modalBody,
                {
                  paddingHorizontal: bodyHorizontalPadding,
                  paddingVertical: bodyVerticalPadding,
                },
                search && !edgeToEdge && { paddingTop: 0 },
                { flex: 1 },
              ]}
            >
              {children}
            </View>
          )}

          {actions.length > 0 && (
            <View style={[styles.modalFooter, { borderTopColor: colors.outline }]}>
              {actions.map((action, index) => (
                <Button
                  key={index}
                  mode={action.mode || 'text'}
                  onPress={action.onPress}
                  style={[
                    styles.actionButton,
                    action.style,
                    index === 0 && styles.firstButton,
                    index === actions.length - 1 && styles.lastButton,
                  ]}
                  buttonColor={action.buttonColor}
                  textColor={action.textColor}
                  loading={action.loading}
                  disabled={action.disabled}
                  icon={action.icon}
                >
                  {action.label}
                </Button>
              ))}
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContainer: {
    margin: 0,
    width: '100%',
    alignSelf: 'center',
    elevation: 8,
  },
  roundedContainer: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  flatContainer: {
    borderRadius: 0,
  },
  modalContent: {
    height: '100%',
    flexDirection: 'column',
  },
  confirmContainer: {
    margin: 0,
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'center',
    elevation: 8,
  },
  confirmContent: {
    padding: MODAL_HORIZONTAL_PADDING,
    paddingTop: 20,
    paddingBottom: 20,
  },
  confirmTitle: {
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  confirmBody: {
    marginBottom: 20,
    alignItems: 'center',
    width: '100%',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  confirmMessage: {
    textAlign: 'center',
    lineHeight: 20,
  },
  confirmFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  singleButtonFooter: {
    justifyContent: 'center',
  },
  confirmButton: {
    flex: 1,
  },
  singleConfirmButton: {
    flex: 1,
  },
  progressContainer: {
    width: '100%',
    marginTop: 16,
  },
  progressLabel: {
    marginBottom: 8,
    textAlign: 'center',
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: MODAL_HORIZONTAL_PADDING,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  modalTitleText: {
    fontWeight: 'bold',
  },
  titleContainer: {
    flex: 1,
  },
  modalSubtitleText: {
    marginTop: 2,
  },
  headerRightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  closeButton: {
    padding: 4,
  },
  searchContainer: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  modalBody: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: MODAL_HORIZONTAL_PADDING,
    borderTopWidth: 1,
    gap: 12,
  },
  actionButton: {
    flex: 1,
  },
  firstButton: {
    marginRight: 0,
  },
  lastButton: {
    marginLeft: 0,
  },
});
