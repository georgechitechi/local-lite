import { useState } from 'react';

export function useVersionCheck() {
  const [showPrompt, setShowPrompt] = useState(false);

  const onUpdate = async () => {};
  const onDismiss = () => {
    setShowPrompt(false);
  };

  return {
    showPrompt,
    isUpdateAvailable: false,
    onUpdate,
    onDismiss,
  };
}
