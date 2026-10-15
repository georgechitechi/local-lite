import { useState } from 'react';

export function useSettingsModals() {
  const [currentModal, setCurrentModal] = useState<string | null>(null);
  const [showBusinessModal, setShowBusinessModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showUtilityModal, setShowUtilityModal] = useState(false);
  const [resetAllDataDialogVisible, setResetAllDataDialogVisible] = useState(false);
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [showDashboardModal, setShowDashboardModal] = useState(false);

  // Sync related modals
  const [syncModalVisible, setSyncModalVisible] = useState(false);
  const [exclusionModalVisible, setExclusionModalVisible] = useState(false);
  const [contactOptionsModalVisible, setContactOptionsModalVisible] = useState(false);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [permissionModalVisible, setPermissionModalVisible] = useState(false);

  return {
    currentModal,
    setCurrentModal,
    showBusinessModal,
    setShowBusinessModal,
    showHelpModal,
    setShowHelpModal,
    showUtilityModal,
    setShowUtilityModal,
    resetAllDataDialogVisible,
    setResetAllDataDialogVisible,
    showThemeModal,
    setShowThemeModal,
    showUpdatePrompt,
    setShowUpdatePrompt,
    showSupportModal,
    setShowSupportModal,
    showDashboardModal,
    setShowDashboardModal,
    syncModalVisible,
    setSyncModalVisible,
    exclusionModalVisible,
    setExclusionModalVisible,
    contactOptionsModalVisible,
    setContactOptionsModalVisible,
    exportModalVisible,
    setExportModalVisible,
    permissionModalVisible,
    setPermissionModalVisible,
  };
}
