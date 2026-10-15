import type { LocationGeocodedLocation } from 'expo-location';
import * as Location from 'expo-location';
import { useCallback, useRef, useState } from 'react';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';

interface LocationResult extends LocationGeocodedLocation {
  address?: string;
  formattedAddress?: string;
  name?: string;
  details?: string;
}

interface UseLocationSearchReturn {
  searchQuery: string;
  locationResults: LocationResult[];
  searchingLocation: boolean;
  locationLoading: boolean;
  searchLocation: (query?: string) => Promise<void>;
  selectLocation: (
    location: LocationResult,
    onLocationSelect?: (address: string, lat?: number, lng?: number) => void,
  ) => Promise<string>;
  getCurrentLocation: (
    onLocationSelect?: (address: string, lat?: number, lng?: number) => void,
  ) => Promise<string>;
  handleSearchQueryChange: (text: string) => void;
  clearSearch: () => void;
  resetLocationSearch: () => void;
  setSearchQuery: (query: string) => void;
  setLocationResults: (results: LocationResult[]) => void;
}

export const useLocationSearch = (): UseLocationSearchReturn => {
  const [searchQuery, setSearchQuery] = useState('');
  const [locationResults, setLocationResults] = useState<LocationResult[]>([]);
  const [searchingLocation, setSearchingLocation] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { checkOnline } = useOfflineCheck();

  const searchLocation = async (query: string = searchQuery) => {
    if (!query.trim()) {
      setLocationResults([]);
      return;
    }

    if (!checkOnline('Location Search')) {
      return;
    }

    try {
      setSearchingLocation(true);

      // We use OpenStreetMap's Nominatim API for richer autocomplete results.
      // expo-location's geocodeAsync is too strict and mostly returns 1 generic result.
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        query,
      )}&format=json&addressdetails=1&limit=10`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'PropertyAdminMobileApp/1.0 (Integration)',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (response.ok) {
        const data = await response.json();

        if (data && data.length > 0) {
          const detailedResults = data.map((item: any) => {
            const addressObj = item.address || {};
            // Nominatim separates the exact place name vs the bounding box.
            const placeName =
              item.name ||
              addressObj.amenity ||
              addressObj.village ||
              addressObj.town ||
              addressObj.city ||
              query;

            const components = [
              addressObj.road,
              addressObj.suburb || addressObj.neighbourhood,
              addressObj.village || addressObj.town || addressObj.city,
              addressObj.county || addressObj.state,
              addressObj.country,
            ].filter(Boolean);

            // Hide duplicates and the primary name from the details
            const detailsList = Array.from(new Set(components)).filter(
              c => c !== placeName && c !== item.name,
            );

            return {
              latitude: parseFloat(item.lat),
              longitude: parseFloat(item.lon),
              address: item.display_name,
              formattedAddress: item.display_name,
              name: placeName,
              details: detailsList.join(', '),
            } as LocationResult;
          });

          setLocationResults(detailedResults);
          setSearchingLocation(false);
          return;
        }
      }

      // Fallback to Expo native geocoding if Nominatim fails or finds nothing
      const results = await Location.geocodeAsync(query);

      if (results.length > 0) {
        // Get detailed address information for each result
        const detailedResults = await Promise.all(
          results.slice(0, 5).map(async result => {
            try {
              const [address] = await Location.reverseGeocodeAsync({
                latitude: result.latitude,
                longitude: result.longitude,
              });

              const fullAddress = [
                address.street,
                address.city,
                address.region,
                address.country,
              ]
                .filter(Boolean)
                .join(', ');

              const name = address.name || address.street || address.city || query;
              const details = [
                address.street,
                address.city,
                address.region,
                address.country,
              ]
                .filter(Boolean)
                .filter(item => item !== name)
                .join(', ');

              return {
                ...result,
                address: fullAddress,
                formattedAddress: fullAddress,
                name,
                details,
              } as LocationResult;
            } catch (error) {
              console.error('Error getting address details:', error);
              return {
                ...result,
                address: query,
                formattedAddress: query,
                name: query,
                details: '',
              } as LocationResult;
            }
          }),
        );

        setLocationResults(detailedResults);
      } else {
        setLocationResults([]);
      }
    } catch (error) {
      console.error('Error searching location:', error);
      setLocationResults([]);
    } finally {
      setSearchingLocation(false);
    }
  };

  const selectLocation = async (
    location: LocationResult,
    onLocationSelect?: (address: string, lat?: number, lng?: number) => void,
  ): Promise<string> => {
    try {
      const [address] = await Location.reverseGeocodeAsync({
        latitude: location.latitude,
        longitude: location.longitude,
      });

      const fullAddress = [address.street, address.city, address.region, address.country]
        .filter(Boolean)
        .join(', ');

      if (onLocationSelect) {
        onLocationSelect(fullAddress, location.latitude, location.longitude);
      }

      // Reset state
      setSearchQuery('');
      setLocationResults([]);

      return fullAddress;
    } catch (error) {
      console.error('Error selecting location:', error);
      throw new Error('Failed to select location. Please try again.');
    }
  };

  const getCurrentLocation = async (
    onLocationSelect?: (address: string, lat?: number, lng?: number) => void,
  ): Promise<string> => {
    try {
      setLocationLoading(true);
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        throw new Error('Location permission is required to get your address.');
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const [address] = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      const fullAddress = [address.street, address.city, address.region, address.country]
        .filter(Boolean)
        .join(', ');

      if (onLocationSelect) {
        onLocationSelect(
          fullAddress,
          location.coords.latitude,
          location.coords.longitude,
        );
      }

      return fullAddress;
    } catch (error) {
      console.error('Error getting current location:', error);
      throw error;
    } finally {
      setLocationLoading(false);
    }
  };

  const handleSearchQueryChange = (text: string) => {
    setSearchQuery(text);

    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (text.trim().length > 2) {
      // Debounce the search
      searchTimeoutRef.current = setTimeout(() => {
        searchLocation(text);
      }, 500);
    } else {
      setLocationResults([]);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setLocationResults([]);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
  };

  const resetLocationSearch = useCallback(() => {
    setSearchQuery('');
    setLocationResults([]);
    setSearchingLocation(false);
    setLocationLoading(false);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
  }, []);

  return {
    // State
    searchQuery,
    locationResults,
    searchingLocation,
    locationLoading,

    // Actions
    searchLocation,
    selectLocation,
    getCurrentLocation,
    handleSearchQueryChange,
    clearSearch,
    resetLocationSearch,

    // Setters (for manual control if needed)
    setSearchQuery,
    setLocationResults,
  };
};
