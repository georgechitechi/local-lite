import * as Location from 'expo-location';
import type React from 'react';
import { useState } from 'react';
import { Linking } from 'react-native';
import { useIdleLock } from '@/providers/LockScreenProvider';
import BaseModal from '@/shared/components/BaseModal';

export const usePermission = (): {
  checkPermission: () => Promise<boolean>;
  PermissionModal: React.FC;
} => {
  const { pauseAutoLock, resumeAutoLock } = useIdleLock();
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  const checkPermission = async (): Promise<boolean> => {
    pauseAutoLock();
    try {
      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (!canAskAgain) {
          setShowSettingsModal(true);
        } else {
          resumeAutoLock();
        }
        return false;
      }
      resumeAutoLock();
      return true;
    } catch (error) {
      console.error('Error requesting location permission:', error);
      resumeAutoLock();
      return false;
    }
  };

  const PermissionModal = () => (
    <BaseModal
      mode="confirm"
      visible={showSettingsModal}
      title="Permission Required"
      message="Location permission is needed to pick a location. Please enable it in your device settings."
      icon="map-marker-off"
      cancelText="Cancel"
      confirmText="Open Settings"
      onCancel={() => {
        setShowSettingsModal(false);
        resumeAutoLock();
      }}
      onConfirm={() => {
        setShowSettingsModal(false);
        Linking.openSettings();
        resumeAutoLock();
      }}
      onDismiss={() => {
        setShowSettingsModal(false);
        resumeAutoLock();
      }}
    />
  );

  return { checkPermission, PermissionModal };
};
