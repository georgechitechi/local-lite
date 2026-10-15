import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { v4 as uuidv4 } from 'uuid';
import { queueImageUpload } from '@/shared/components/CachedImage';
import { supabase } from '@/shared/services/supabase';

interface DocumentAsset {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
}

interface ImageAsset {
  uri: string;
  mimeType?: string;
}

export const pickDocument =
  async (): Promise<DocumentPicker.DocumentPickerAsset | null> => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return null;
      }

      return result.assets[0];
    } catch (error) {
      console.error('Error picking document:', error);
      throw error;
    }
  };

export const uploadContractDocument = async (
  contractId: string,
  file: DocumentAsset,
  options?: { offlineSupport?: boolean },
): Promise<{ publicUrl: string; uploadId?: string }> => {
  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `${contractId}/${uuidv4()}.${fileExt}`;
    const filePath = `contracts/${fileName}`;

    if (options?.offlineSupport) {
      const { localUri, uploadId } = await queueImageUpload(
        { uri: file.uri, mimeType: file.mimeType },
        'private-assets',
        'documents',
        contractId,
      );

      return { publicUrl: localUri, uploadId };
    }

    const fileObj = new File(file.uri);
    const fileContent = await fileObj.bytes();

    const { error } = await supabase.storage
      .from('private-assets')
      .upload(`documents/${filePath}`, fileContent, {
        contentType: file.mimeType || 'application/octet-stream',
        cacheControl: '3600',
      });

    if (error) throw error;

    const {
      data: { publicUrl },
    } = supabase.storage.from('private-assets').getPublicUrl(`documents/${filePath}`);

    return { publicUrl };
  } catch (error) {
    console.error('Error uploading document:', error);
    throw error;
  }
};

export const deleteContractDocument = async (url: string): Promise<void> => {
  try {
    const path = url.split('/').slice(-3).join('/'); // To capture documents/contracts/xxx
    const { error } = await supabase.storage.from('private-assets').remove([path]);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting document:', error);
    throw error;
  }
};

export const uploadBookingDocument = async (
  bookingId: string,
  file: DocumentAsset,
  options?: { offlineSupport?: boolean },
): Promise<{ publicUrl: string; uploadId?: string }> => {
  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `${bookingId}/${uuidv4()}.${fileExt}`;
    const filePath = `bookings/${fileName}`;

    if (options?.offlineSupport) {
      const { localUri, uploadId } = await queueImageUpload(
        { uri: file.uri, mimeType: file.mimeType },
        'private-assets',
        'booking-documents',
        bookingId,
      );

      return { publicUrl: localUri, uploadId };
    }

    const fileObj = new File(file.uri);
    const fileContent = await fileObj.bytes();

    const { error } = await supabase.storage
      .from('private-assets')
      .upload(`booking-documents/${filePath}`, fileContent, {
        contentType: file.mimeType || 'application/octet-stream',
        cacheControl: '3600',
      });

    if (error) throw error;

    const {
      data: { publicUrl },
    } = supabase.storage
      .from('private-assets')
      .getPublicUrl(`booking-documents/${filePath}`);

    return { publicUrl };
  } catch (error) {
    console.error('Error uploading booking document:', error);
    throw error;
  }
};
export const uploadImage = async (
  imageAsset: ImageAsset,
  bucket: string,
  folder: string,
  id: string,
  options?: { offlineSupport?: boolean },
): Promise<{ publicUrl: string; filePath: string; uploadId?: string }> => {
  try {
    const fileExt = imageAsset.uri.split('.').pop();
    const fileName = `${id}/${uuidv4()}.${fileExt}`;
    const filePath = folder ? `${folder}/${fileName}` : fileName;

    if (options?.offlineSupport) {
      const { uploadId, publicUrl } = await queueImageUpload(
        imageAsset,
        bucket,
        folder,
        id,
      );

      return {
        publicUrl,
        filePath,
        uploadId,
      };
    }

    const fileObj = new File(imageAsset.uri);
    const fileContent = await fileObj.bytes();

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, fileContent, {
        contentType: imageAsset.mimeType || 'image/jpeg',
        cacheControl: '3600',
      });

    if (uploadError) throw uploadError;

    const {
      data: { publicUrl },
    } = supabase.storage.from(bucket).getPublicUrl(filePath);

    return { publicUrl, filePath };
  } catch (error) {
    console.error('Error uploading image:', error);
    throw error;
  }
};

export const deleteImage = async (bucket: string, path: string): Promise<void> => {
  try {
    const { error } = await supabase.storage.from(bucket).remove([path]);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting image:', error);
    throw error;
  }
};
