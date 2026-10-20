import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, ImageBackground, Platform, PermissionsAndroid, StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer, DarkTheme, type LinkingOptions, type NavigatorScreenParams } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import HomeScreen from './src/screens/HomeScreen';
import TrackListScreen from './src/screens/TrackList';
import AlbumDetailScreen from './src/screens/AlbumDetail';
import ProfileScreen from './src/screens/ProfileScreen';
import JamScreen from './src/screens/JamScreen';
import JamRoomScreen from './src/screens/JamRoomScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import PlayerWidget from './src/components/PlayerWidget';
import FloatingTabBar from './src/components/FloatingTabBar';
import { SongMenuProvider } from './src/components/SongMenu';
import ExploreScreen, { MoodGenrePlaylistsScreen } from './src/screens/ExploreScreen';
import LibraryScreen, { LibraryGridPage } from './src/screens/LibraryScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import EqualizerScreen from './src/screens/EqualizerScreen';
import ReplayScreen from './src/screens/ReplayScreen';
import { restoreEqualizer } from './src/store/equalizer';

// Push the saved equaliser tuning into the native processor before playback.
void restoreEqualizer();
import UpdatePrompt from './src/components/UpdatePrompt';
import BrandIntro from './src/components/BrandIntro';
import DeviceAccessGate from './src/components/DeviceAccessGate';
import { PlayerProvider, usePlayerSummary } from './src/context/PlayerContext';
import { JamProvider, useJam } from './src/context/JamContext';
import { getPrefs } from './src/store/preferences';
import { AppResetContext } from './src/context/AppContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { DialogProvider } from './src/context/DialogContext';
import { statusBarStyleForDevice } from './src/hooks/useScreenStatusBar';
import { API } from './src/api';
import { JAM_LINK_PREFIX } from './src/services/jamLinks';

type MainTabParams = {
  ListenNow: undefined;
  Explore: undefined;
  Library: undefined;
  Search: undefined;
  Jam: { code?: string } | undefined;
  Profile: { importUrl?: string; initialTab?: 'downloads' | 'playlists' | 'preferences'; openPlaylistId?: string; openImport?: boolean; openEditProfile?: boolean } | undefined;
};
type RootStackParams = {
  MainTabs: NavigatorScreenParams<MainTabParams> | undefined;
};

const Stack = createNativeStackNavigator<RootStackParams>();
const Tab = createBottomTabNavigator<MainTabParams>();
const ListenNowStack = createNativeStackNavigator();
const SearchStack = createNativeStackNavigator();
const ExploreStack = createNativeStackNavigator();
const LibraryStack = createNativeStackNavigator();
const linking: LinkingOptions<RootStackParams> = {
  prefixes: [JAM_LINK_PREFIX, 'groovix://'],
  config: {
    screens: {
      MainTabs: {
        screens: {
          Jam: 'jam/:code',
          Profile: 'playlist-import',
        },
      },
    },
  },
};

function NetworkBanner() {
  const [msg, setMsg] = useState<{ text: string; offline: boolean } | null>(null);
  const slideY = useRef(new Animated.Value(-80)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevOnline = useRef(true);
  const failedChecks = useRef(0);
  const insets = useSafeAreaInsets();

  const show = (offline: boolean, text: string) => {
    setMsg({ text, offline });
    if (timerRef.current) clearTimeout(timerRef.current);
    Animated.spring(slideY, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 3 }).start();
    if (!offline) {
      timerRef.current = setTimeout(() => {
        Animated.timing(slideY, { toValue: -80, duration: 350, useNativeDriver: true }).start(() => setMsg(null));
      }, 2500);
    }
  };

  useEffect(() => {
    let active = true;
    const check = async () => {
      const probe = async (url: string) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        try {
          const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
          return res.status === 204 || res.ok;
        } catch {
          return false;
        } finally {
          clearTimeout(timeout);
        }
      };
      try {
        const probes = await Promise.all([
          probe('https://connectivitycheck.gstatic.com/generate_204'),
          probe('https://clients3.google.com/generate_204'),
        ]);
        const online = probes.some(Boolean);
        if (!active) return;
        if (online) {
          failedChecks.current = 0;
          if (!prevOnline.current) { prevOnline.current = true; show(false, 'Back online'); }
        } else {
          failedChecks.current += 1;
          if (failedChecks.current >= 2 && prevOnline.current) { prevOnline.current = false; show(true, 'No internet connection'); }
        }
      } catch {
        if (!active) return;
        failedChecks.current += 1;
      }
    };
    check();
    const id = setInterval(check, 4000);
    return () => { active = false; clearInterval(id); if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  if (!msg) return null;

  return (
    <Animated.View style={[
      styles.banner,
      { top: insets.top + 8, transform: [{ translateY: slideY }] },
      msg.offline ? styles.bannerOffline : styles.bannerOnline,
    ]}>
      <Ionicons name={msg.offline ? 'cloud-offline-outline' : 'cloud-done-outline'} size={15} color="#fff" />
      <Text style={styles.bannerText}>{msg.text}</Text>
    </Animated.View>
  );
}

// Jam tab shows the live room when you're in one, otherwise the create/join screen.
// Keeping it as a tab (not a full-screen route) means the bottom bar and the
// player overlay stay visible while jamming.
function JamTab({ route }: { route?: { params?: { code?: string } } }) {
  const { room } = useJam();
  return room ? <JamRoomScreen /> : <JamScreen inviteCode={route?.params?.code} />;
}

// Keep detail screens inside their owning tab so the shared bottom navigation
// and mini-player remain mounted throughout normal browsing.
function ListenNowTab() {
  return (
    <ListenNowStack.Navigator screenOptions={{ headerShown: false }}>
      <ListenNowStack.Screen name="ListenNowHome" component={HomeScreen} />
      <ListenNowStack.Screen name="AlbumDetail" component={AlbumDetailScreen} />
    </ListenNowStack.Navigator>
  );
}

function ExploreTab() {
  return (
    <ExploreStack.Navigator screenOptions={{ headerShown: false }}>
      <ExploreStack.Screen name="ExploreHome" component={ExploreScreen} />
      <ExploreStack.Screen name="MoodGenre" component={MoodGenrePlaylistsScreen} />
      <ExploreStack.Screen name="AlbumDetail" component={AlbumDetailScreen} />
    </ExploreStack.Navigator>
  );
}

function LibraryTab() {
  return (
    <LibraryStack.Navigator screenOptions={{ headerShown: false }}>
      <LibraryStack.Screen name="LibraryHome" component={LibraryScreen} />
      <LibraryStack.Screen name="LibraryGrid" component={LibraryGridPage} />
      <LibraryStack.Screen name="Settings" component={SettingsScreen} />
      <LibraryStack.Screen name="Equalizer" component={EqualizerScreen} />
      <LibraryStack.Screen name="Replay" component={ReplayScreen} />
      <LibraryStack.Screen name="AlbumDetail" component={AlbumDetailScreen} />
    </LibraryStack.Navigator>
  );
}

function SearchTab() {
  return (
    <SearchStack.Navigator screenOptions={{ headerShown: false }}>
      <SearchStack.Screen name="SearchHome" component={TrackListScreen} />
      <SearchStack.Screen name="AlbumDetail" component={AlbumDetailScreen} />
    </SearchStack.Navigator>
  );
}

function TabsWithMiniPlayer() {
  const { room } = useJam();
  const { colors, theme } = useTheme();
  const { currentTrack } = usePlayerSummary();
  const tabArtwork = currentTrack?.album?.cover
    ? API.getCoverUrl(currentTrack.album.cover, 320)
    : '';
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar
        barStyle={statusBarStyleForDevice(theme === 'soundwave' ? 'dark-content' : 'light-content')}
        backgroundColor={colors.background}
        translucent={false}
      />
      <NetworkBanner />
      <SongMenuProvider>
      <Tab.Navigator
        tabBar={props => (
          <FloatingTabBar
            {...props}
            light={theme === 'soundwave'}
            artwork={tabArtwork}
            hidden={['Profile']}
            icons={{ ListenNow: ['home', 'home-outline'], Explore: ['grid', 'grid-outline'], Library: ['albums', 'albums-outline'], Search: ['search', 'search-outline'], Jam: ['radio', 'radio-outline'] }}
          />
        )}
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarStyle: {
            backgroundColor: 'transparent',
            width: '100%',
            marginHorizontal: 0,
            left: 0,
            right: 0,
            borderTopColor: theme === 'soundwave'
              ? 'rgba(23,28,38,0.10)'
              : 'rgba(255,255,255,0.08)',
            borderTopWidth: 0.5,
            height: 80,
            paddingBottom: 20,
            paddingTop: 8,
            elevation: 0,
            shadowOpacity: 0,
          },
          tabBarBackground: () => (
            <View style={StyleSheet.absoluteFill}>
              {tabArtwork ? (
                <ImageBackground
                  source={{ uri: tabArtwork }}
                  resizeMode="cover"
                  blurRadius={28}
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              <View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: theme === 'soundwave'
                      ? 'rgba(255,255,255,0.58)'
                      : 'rgba(10,10,12,0.38)',
                  },
                ]}
              />
            </View>
          ),
          tabBarActiveTintColor: theme === 'soundwave' ? '#171C26' : '#FFFFFF',
          tabBarInactiveTintColor: theme === 'soundwave'
            ? 'rgba(23,28,38,0.72)'
            : 'rgba(255,255,255,0.58)',
          tabBarIcon: ({ focused, color }) => {
            const iconColor = theme === 'soundwave'
              ? (focused ? '#171C26' : 'rgba(23,28,38,0.72)')
              : (focused ? '#FFFFFF' : 'rgba(255,255,255,0.58)');
            const iconName = route.name === 'ListenNow'
              ? (focused ? 'play' : 'play-outline')
              : route.name === 'Search'
                ? (focused ? 'search' : 'search-outline')
                : route.name === 'Jam'
                  ? (focused ? 'radio' : 'radio-outline')
                  : route.name === 'Profile'
                    ? (focused ? 'person' : 'person-outline')
                    : null;
            if (!iconName) return null;
            return (
              <View style={styles.tabIconContainer}>
                <Ionicons
                  name={iconName}
                  size={24}
                  color={iconColor}
                />
              </View>
            );
          },
        })}
      >
        <Tab.Screen name="ListenNow" component={ListenNowTab} options={{ tabBarLabel: 'Home' }} />
        <Tab.Screen name="Explore" component={ExploreTab} />
        <Tab.Screen name="Library" component={LibraryTab} />
        <Tab.Screen name="Search" component={SearchTab} />
        <Tab.Screen
          name="Jam"
          component={JamTab}
          options={{ tabBarLabel: 'Jam', tabBarBadge: room ? '●' : undefined, tabBarBadgeStyle: { backgroundColor: 'transparent', color: '#4caf50', fontSize: 10 } }}
        />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </Tab.Navigator>
      <PlayerWidget />
      </SongMenuProvider>
    </View>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    getPrefs().then(p => {
      setNeedsOnboarding(!p);
      setReady(true);
    });
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)
        .catch(() => { /* playback still works if the user declines */ });
    }
  }, []);

  if (!introDone) {
    return (
      <SafeAreaProvider>
        <BrandIntro onFinish={() => setIntroDone(true)} />
      </SafeAreaProvider>
    );
  }

  if (!ready) return null;

  if (needsOnboarding) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <DeviceAccessGate>
            <OnboardingScreen onDone={() => setNeedsOnboarding(false)} />
          </DeviceAccessGate>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <DeviceAccessGate>
          <AppResetContext.Provider value={() => setNeedsOnboarding(true)}>
            <PlayerProvider>
              <JamProvider>
                <ThemeProvider>
                  <DialogProvider>
                    <ThemedNavigation />
                    <UpdatePrompt />
                  </DialogProvider>
                </ThemeProvider>
              </JamProvider>
            </PlayerProvider>
          </AppResetContext.Provider>
        </DeviceAccessGate>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function ThemedNavigation() {
  const { colors } = useTheme();
  const navigationTheme = {
    ...DarkTheme,
    colors: { ...DarkTheme.colors, background: colors.background, card: colors.surface, text: colors.text, border: colors.border, primary: colors.primary },
  };
  return (
    <NavigationContainer
      theme={navigationTheme}
      linking={linking}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="MainTabs" component={TabsWithMiniPlayer} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute', left: 16, right: 16, zIndex: 999,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 12, shadowColor: '#000', shadowOpacity: 0.3,
    shadowRadius: 8, elevation: 8,
  },
  bannerOffline: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  bannerOnline: { backgroundColor: '#1a3d2b', borderWidth: 1, borderColor: 'rgba(76,175,80,0.4)' },
  bannerText: { fontFamily: 'Inter-SemiBold', color: '#fff', fontSize: 13, flex: 1 },
  tabIconContainer: {
    width: 64,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
