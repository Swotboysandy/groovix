/**
 * @format
 */

import 'react-native-url-polyfill/auto';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
// Runs for as long as music plays (started from PlayerContext): keeps JS timers
// alive in the background so the next song can start with the app closed.
AppRegistry.registerHeadlessTask('GroovixKeepAlive', () => () => new Promise(() => {}));
