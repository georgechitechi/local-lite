import { StyleSheet, View } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';

export function ContractDocumentsSection({ flow }: { flow: any }) {
  const { isOnline, saving, form, handleDocumentUpload, removeDocument, handleSubmit } =
    flow;

  return (
    <>
      <View style={styles.documentsSection}>
        <Text variant="titleMedium" style={styles.sectionTitle}>
          Documents
        </Text>
        <Button
          mode="outlined"
          icon="file-upload"
          onPress={handleDocumentUpload}
          style={[styles.uploadButton, !isOnline && { opacity: 0.5 }]}
          disabled={false}
        >
          Upload Document
        </Button>
        {form.documents.map((doc: any, index: number) => (
          <View key={index} style={styles.documentItem}>
            <Text numberOfLines={1} style={styles.documentName}>
              {doc.name}
            </Text>
            <IconButton icon="close" size={20} onPress={() => removeDocument(index)} />
          </View>
        ))}
      </View>

      <Button
        mode="contained"
        onPress={handleSubmit}
        style={styles.submitButton}
        loading={saving}
        disabled={saving}
      >
        Create Contract
      </Button>
    </>
  );
}

const styles = StyleSheet.create({
  documentsSection: {
    marginTop: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    marginBottom: 8,
  },
  uploadButton: {
    marginBottom: 8,
  },
  documentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    marginBottom: 8,
    paddingLeft: 12,
  },
  documentName: {
    flex: 1,
    marginRight: 8,
  },
  submitButton: {
    marginTop: 20,
    marginBottom: 40,
  },
});
