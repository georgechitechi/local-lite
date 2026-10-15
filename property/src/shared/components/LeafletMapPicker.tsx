import * as Location from 'expo-location';
import React, { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { IconButton } from 'react-native-paper';
import WebView from 'react-native-webview';
import { useIdleLock } from '@/providers/LockScreenProvider';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

interface MapPickerProps {
  initialLocation?: { latitude: number; longitude: number };
  onLocationSelect: (lat: number, lng: number) => void;
}

export default function LeafletMapPicker({
  initialLocation,
  onLocationSelect,
}: MapPickerProps) {
  const webViewRef = useRef<WebView>(null);
  const colors = useThemeColors();
  const { pauseAutoLock, resumeAutoLock } = useIdleLock();
  const [gpsLoading, setGpsLoading] = useState(false);
  const lastLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);

  const initLat = initialLocation?.latitude;
  const initLng = initialLocation?.longitude;

  // Smoothly fly to initialLocation coordinates when they are updated from parent
  React.useEffect(() => {
    if (
      initLat !== undefined &&
      initLng !== undefined &&
      (lastLocationRef.current?.latitude !== initLat ||
        lastLocationRef.current?.longitude !== initLng)
    ) {
      lastLocationRef.current = { latitude: initLat, longitude: initLng };
      const js = `
        if (typeof map !== 'undefined') {
          map.flyTo([${initLat}, ${initLng}], 16);
        }
      `;
      webViewRef.current?.injectJavaScript(js);
    }
  }, [initLat, initLng]);

  // Default to Nairobi if no initial location provided
  const lat = initialLocation?.latitude || -1.286389;
  const lng = initialLocation?.longitude || 36.817223;

  const hasBroadcasted = React.useRef(false);

  // Broadcast the default/initial location to the parent immediately
  // so the user doesn't have to interact with the map to have a selection.
  React.useEffect(() => {
    if (!hasBroadcasted.current) {
      onLocationSelect(lat, lng);
      hasBroadcasted.current = true;
    }
  }, [lat, lng, onLocationSelect]);

  const primaryColor = colors.primary || '#3B82F6';

  // Theme-specific styles for the Leaflet HTML content
  const isDark = false;
  const panelBg = '#ffffff';
  const panelText = '#1c1c1e';
  const hoverBg = '#f5f5f7';
  const mapBackground = '#f5f5f7';
  const shadowHaloColor = 'rgba(0, 0, 0, 0.2)';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          body { margin: 0; padding: 0; background-color: ${mapBackground}; }
          #map { height: 100vh; width: 100vw; }
          
          /* Pulsing target halo under the pin */
          .pulse-circle {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 14px;
            height: 6px;
            background: ${shadowHaloColor};
            border-radius: 50%;
            z-index: 999;
            pointer-events: none;
            transition: all 0.25s ease;
          }
          
          /* Interactive Pin with transitions */
          .center-marker {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -100%);
            z-index: 1000;
            pointer-events: none;
            transition: transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            display: flex;
            justify-content: center;
            align-items: center;
          }
          
          /* Airborne state when dragging */
          .center-marker.dragging {
            transform: translate(-50%, -135%) scale(1.15);
          }
          
          /* Shadow pulse and scale down when airborne */
          .center-marker.dragging ~ .pulse-circle {
            transform: translate(-50%, -50%) scale(2.2);
            background: ${isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)'};
          }

          /* Landing squash-stretch animation */
          .center-marker.bounce {
            animation: landingBounce 0.45s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
          }

          @keyframes landingBounce {
            0% { transform: translate(-50%, -135%) scale(1.15); }
            50% { transform: translate(-50%, -85%) scaleY(0.75) scaleX(1.2); }
            70% { transform: translate(-50%, -108%) scaleY(1.1) scaleX(0.9); }
            85% { transform: translate(-50%, -97%) scaleY(0.95) scaleX(1.02); }
            100% { transform: translate(-50%, -100%) scale(1); }
          }
          
          .leaflet-control-attribution {
            display: none;
          }

          /* Modernized Leaflet Control Layers panel */
          .leaflet-control-layers {
            border: none !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, ${isDark ? '0.45' : '0.15'}) !important;
            border-radius: 12px !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: ${panelBg} !important;
            overflow: hidden;
            margin-top: 12px !important;
            margin-left: 12px !important;
          }
          .leaflet-control-layers-toggle {
            width: 40px !important;
            height: 40px !important;
            background-size: 20px 20px !important;
            border-radius: 12px !important;
            transition: background-color 0.2s ease;
            filter: ${isDark ? 'invert(1) hue-rotate(180deg)' : 'none'};
          }
          .leaflet-control-layers-expanded {
            padding: 8px 12px !important;
            background: ${panelBg} !important;
            color: ${panelText} !important;
            font-weight: 500;
            font-size: 13px !important;
            border-radius: 12px !important;
          }
          .leaflet-control-layers-expanded label {
            display: flex;
            align-items: center;
            margin: 6px 0;
            cursor: pointer;
            border-radius: 6px;
            padding: 2px 4px;
            transition: background-color 0.15s ease;
          }
          .leaflet-control-layers-expanded label:hover {
            background-color: ${hoverBg};
          }
          .leaflet-control-layers-expanded input {
            margin-right: 8px !important;
            accent-color: ${primaryColor};
            cursor: pointer;
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <div class="pulse-circle"></div>
        
        <!-- Curated Premium Location Pin -->
        <div class="center-marker">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="pinGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="${primaryColor}" />
                <stop offset="100%" stop-color="${primaryColor}CC" />
              </linearGradient>
              <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="4" stdDeviation="2.5" flood-color="#000" flood-opacity="${isDark ? '0.5' : '0.25'}" />
              </filter>
            </defs>
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="url(#pinGrad)" filter="url(#shadow)"/>
            <circle cx="12" cy="9" r="3.5" fill="#FFFFFF"/>
          </svg>
        </div>

        <script>
          // Google Maps Street Layer
          var googleStreet = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
            maxZoom: 22,
            attribution: '© Google'
          });

          // CartoDB Dark Matter Layer (for premium dark mode styling)
          var darkMatter = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 20,
            attribution: '© CartoDB'
          });

          // Google Maps Satellite Hybrid (Satellite Imagery + Labels)
          var googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
            maxZoom: 22,
            attribution: '© Google'
          });

          var map = L.map('map', {
            zoomControl: false,
            layers: [${isDark ? 'darkMatter' : 'googleStreet'}] // Set Google Street/Dark Matter as default
          }).setView([${lat}, ${lng}], 15);

          // Configure Layers Control Menu
          var baseMaps = {
            "🗺️ Street": ${isDark ? 'darkMatter' : 'googleStreet'},
            "🛰️ Satellite": googleHybrid
          };

          L.control.layers(baseMaps, null, {
            position: 'topleft' // Place top left for elegant access
          }).addTo(map);

          L.control.zoom({ position: 'bottomright' }).addTo(map);

          var marker = document.querySelector('.center-marker');

          map.on('movestart', function() {
            marker.classList.remove('bounce');
            marker.classList.add('dragging');
          });

          map.on('moveend', function() {
            marker.classList.remove('dragging');
            marker.classList.add('bounce');
            
            var center = map.getCenter();
            window.ReactNativeWebView.postMessage(JSON.stringify({
              latitude: center.lat,
              longitude: center.lng
            }));
          });
        </script>
      </body>
    </html>
  `;

  const handleGPSPress = async () => {
    try {
      setGpsLoading(true);
      await pauseAutoLock();
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.warn('Location permission denied');
        return;
      }

      // Try last known location first for near-instant response
      let location = await Location.getLastKnownPositionAsync({});
      if (!location) {
        // Fallback to active GPS fetch if no cached coordinates
        location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
      }

      const { latitude, longitude } = location.coords;

      const js = `
        if (typeof map !== 'undefined') {
          map.flyTo([${latitude}, ${longitude}], 16);
        }
      `;
      webViewRef.current?.injectJavaScript(js);

      onLocationSelect(latitude, longitude);
    } catch (error) {
      console.error('Failed to get current location:', error);
    } finally {
      setGpsLoading(false);
      resumeAutoLock();
    }
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef as any}
        originWhitelist={['*']}
        source={{ html: htmlContent }}
        onMessage={(event: any) => {
          try {
            const data = JSON.parse(event.nativeEvent.data);
            onLocationSelect(data.latitude, data.longitude);
          } catch (e) {
            console.error('Failed to parse map message', e);
          }
        }}
        startInLoadingState={true}
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}
      />
      <View style={styles.gpsButtonContainer}>
        <IconButton
          icon="crosshairs-gps"
          mode="contained"
          containerColor={colors.elevation.level3}
          iconColor={colors.primary}
          size={24}
          onPress={handleGPSPress}
          loading={gpsLoading}
          disabled={gpsLoading}
          style={styles.gpsButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
  },
  loading: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  gpsButtonContainer: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
  },
  gpsButton: {
    margin: 0,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
});
