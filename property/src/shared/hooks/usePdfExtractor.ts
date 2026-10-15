import * as DocumentPicker from 'expo-document-picker';
import { extractText, isAvailable } from 'expo-pdf-text-extract';
import { useState } from 'react';
import { useSnackbar } from '@/context/SnackbarContext';

export const usePdfExtractor = () => {
  const [loading, setLoading] = useState(false);
  const { showSnackbar } = useSnackbar();

  const extractTextFromUri = async (uri: string): Promise<string | null> => {
    try {
      if (!isAvailable()) {
        showSnackbar(
          'PDF extraction is not available in Expo Go. Use a development build.',
          'error',
        );
        return null;
      }

      setLoading(true);
      const text = await extractText(uri);
      return text;
    } catch (error: any) {
      console.error('PDF Extraction Error:', error);
      showSnackbar(`Failed to extract text: ${error.message}`, 'error');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const pickAndExtract = async (): Promise<string | null> => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return null;
      }

      const { uri } = result.assets[0];
      return await extractTextFromUri(uri);
    } catch (error) {
      console.error('Document Picker Error:', error);
      showSnackbar('Failed to select document', 'error');
      return null;
    }
  };

  return {
    loading,
    extractTextFromUri,
    pickAndExtract,
  };
};
