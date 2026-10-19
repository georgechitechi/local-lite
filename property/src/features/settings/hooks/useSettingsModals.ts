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
  };
}
