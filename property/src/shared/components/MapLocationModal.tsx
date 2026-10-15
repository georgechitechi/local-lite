import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { FlatList, Keyboard, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useIdleLock } from '@/providers/LockScreenProvider';
import BaseModal from '@/shared/components/BaseModal';
import LeafletMapPicker from '@/shared/components/LeafletMapPicker';
import SPressable from '@/shared/components/SlightPressable';
import { useLocationSearch } from '@/shared/hooks/useLocationSearch';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

interface MapLocationModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (address: string, lat: number, lng: number) => void;
  initialLocation?: { latitude: number; longitude: number };
  title?: string;
}

export default function MapLocationModal({
  visible,
  onDismiss,
  onSelect,
  initialLocation,
  title = 'Pick Location on Map',
}: MapLocationModalProps) {
  const colors = useThemeColors();
  const { selectedBusiness } = useBusiness();
  const { pauseAutoLock, resumeAutoLock } = useIdleLock();

  const {
    searchQuery,
    locationResults,
    searchingLocation,
    locationLoading,
    selectLocation,
    handleSearchQueryChange,
    clearSearch,
    resetLocationSearch,
  } = useLocationSearch();

  const [mapCenter, setMapCenter] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [loadingMap, setLoadingMap] = useState(false);
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [address, setAddress] = useState<string>('');
  const [loadingAddress, setLoadingAddress] = useState(false);

  // Resolve starting coordinates with order of preference:
  // 1. passed initialLocation prop (editing mode)
  // 2. selectedBusiness location (creation mode)
  // 3. Current GPS location (creation mode, fallback)
  // 4. Nairobi default fallback
  useEffect(() => {
    if (visible) {
      const resolveLocation = async () => {
        if (initialLocation?.latitude && initialLocation?.longitude) {
          setMapCenter(initialLocation);
          return;
        }

        if (selectedBusiness?.latitude && selectedBusiness?.longitude) {
          setMapCenter({
            latitude: Number(selectedBusiness.latitude),
            longitude: Number(selectedBusiness.longitude),
          });
          return;
        }

        setLoadingMap(true);
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            let loc = await Location.getLastKnownPositionAsync({});
            if (!loc) {
              loc = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
              });
            }
            if (loc) {
              setMapCenter({
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
              });
              return;
            }
          }
        } catch (e) {
          console.warn('Failed to obtain default current location:', e);
        } finally {
          setLoadingMap(false);
        }

        // Final fallback to Nairobi coordinates
        setMapCenter({ latitude: -1.286389, longitude: 36.817223 });
      };

      resolveLocation();
    } else {
      setMapCenter(null);
    }
  }, [visible, initialLocation, selectedBusiness]);

  // Pause auto-lock and dismiss keyboard when modal is visible to prevent overlaying the map
  useEffect(() => {
    if (visible) {
      Keyboard.dismiss();
      pauseAutoLock();
    }
    return () => {
      resumeAutoLock();
    };
  }, [visible, pauseAutoLock, resumeAutoLock]);

  // Clear state when modal closes
  useEffect(() => {
    if (!visible) {
      const timer = setTimeout(() => {
        setAddress('');
        setCurrentCoords(null);
        setLoadingAddress(false);
        resetLocationSearch();
      }, 300); // Wait for modal animation to finish
      return () => clearTimeout(timer);
    }
  }, [visible, resetLocationSearch]);

  const handleLocationMove = async (lat: number, lng: number) => {
    setCurrentCoords({ lat, lng });
    setLoadingAddress(true);

    try {
      const [result] = await Location.reverseGeocodeAsync({
        latitude: lat,
        longitude: lng,
      });

      if (result) {
        const fullAddress = [
          result.street,
          result.district || result.subregion,
          result.city,
          result.region,
        ]
          .filter(Boolean)
          .join(', ');
        setAddress(fullAddress || 'Selected Location');
      } else {
        setAddress('Address not found');
      }
    } catch (error) {
      console.error('Reverse geocode error:', error);
      setAddress('Error resolving address');
    } finally {
      setLoadingAddress(false);
    }
  };

  const handleSelectSearchResult = async (location: (typeof locationResults)[0]) => {
    try {
      Keyboard.dismiss();
      await selectLocation(location, (fullAddress, lat, lng) => {
        if (lat !== undefined && lng !== undefined) {
          setMapCenter({ latitude: lat, longitude: lng });
          setAddress(fullAddress);
          setCurrentCoords({ lat, lng });
        }
        clearSearch();
      });
    } catch (error) {
      console.error('Error selecting search result:', error);
    }
  };

  const handleConfirm = () => {
    if (currentCoords) {
      onSelect(address, currentCoords.lat, currentCoords.lng);
      onDismiss();
    }
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title={title}
      subtitle={`📍 ${address || 'Move map to pick location'}`}
      maxHeight="90%"
      edgeToEdge
      search={{
        placeholder: 'Search for an address or city...',
        value: searchQuery,
        onChangeText: handleSearchQueryChange,
        onClear: clearSearch,
        isLoading: locationLoading,
      }}
      actions={[
        {
          label: 'Cancel',
          onPress: onDismiss,
          mode: 'outlined',
        },
        {
          label: 'Select Location',
          onPress: handleConfirm,
          mode: 'contained',
          disabled: !currentCoords || loadingAddress,
        },
      ]}
    >
      <View style={styles.container}>
        {/* Floating search suggestions list overlay */}
        {searchQuery.length > 0 && (
          <View
            style={[
              styles.suggestionsContainer,
              { backgroundColor: colors.surface, borderColor: colors.outlineVariant },
            ]}
          >
            {searchingLocation || locationLoading ? (
              <View style={styles.loadingSuggestions}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={{ marginLeft: 8, color: colors.onSurfaceVariant }}>
                  Searching...
                </Text>
              </View>
            ) : locationResults.length === 0 ? (
              <View style={styles.noSuggestions}>
                <Text style={{ color: colors.onSurfaceVariant }}>No results found</Text>
              </View>
            ) : (
              <FlatList
                data={locationResults}
                keyExtractor={item => `${item.latitude}-${item.longitude}`}
                renderItem={({ item }) => (
                  <SPressable
                    style={[
                      styles.suggestionItem,
                      { borderBottomColor: colors.outlineVariant },
                    ]}
                    onPress={() => handleSelectSearchResult(item)}
                  >
                    <MaterialCommunityIcons
                      name="map-marker-outline"
                      size={20}
                      color={colors.onSurfaceVariant}
                      style={{ marginRight: 12 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.onSurface, fontWeight: '500' }}>
                        {item.name || item.formattedAddress}
                      </Text>
                      {item.details ? (
                        <Text
                          style={{ color: colors.onSurfaceVariant, fontSize: 12 }}
                          numberOfLines={1}
                        >
                          {item.details}
                        </Text>
                      ) : null}
                    </View>
                  </SPressable>
                )}
                keyboardShouldPersistTaps="handled"
                style={{ maxHeight: 220 }}
              />
            )}
          </View>
        )}

        {loadingMap || !mapCenter ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <View style={styles.mapWrapper}>
            <LeafletMapPicker
              initialLocation={mapCenter}
              onLocationSelect={handleLocationMove}
            />
          </View>
        )}
      </View>
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 450,
  },
  mapWrapper: {
    flex: 1,
    minHeight: 350,
  },
  loadingContainer: {
    flex: 1,
    minHeight: 450,
    justifyContent: 'center',
    alignItems: 'center',
  },
  suggestionsContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    borderRadius: 12,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginTop: 8,
    overflow: 'hidden',
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  loadingSuggestions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  noSuggestions: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
});
