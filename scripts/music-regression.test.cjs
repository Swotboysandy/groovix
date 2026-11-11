// Runs source logic in memory: no Metro, Android build, services or device required.
// npm run test:music; optionally set GROOVIX_TYPESCRIPT to an existing compiler path.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.GROOVIX_TYPESCRIPT || 'typescript');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Native and private-config modules every load may reach; a test's own mocks win.
function baseMocks() {
    const privateConfig = { HIFI_API_URL: '', TIDAL_SEGMENT_PROXY_URL: '', ACCESS_HOSTS: [], SUPABASE_URL: '', SUPABASE_ANON_KEY: '' };
    return {
        '@react-native-async-storage/async-storage': storage(),
        '@react-native-community/netinfo': { addEventListener: () => () => {}, fetch: async () => ({ type: 'wifi' }) },
        react: { useEffect: () => {}, useState: value => [value, () => {}] },
        './config/private': privateConfig,
        '../config/private': privateConfig,
    };
}

function loader(testMocks = {}, globals = {}) {
    const mocks = { ...baseMocks(), ...testMocks };
    const cache = new Map();
    function load(file) {
        const absolute = path.resolve(root, file);
        if (cache.has(absolute)) return cache.get(absolute).exports;
        const module = { exports: {} };
        cache.set(absolute, module);
        const js = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
            fileName: absolute,
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.React },
        }).outputText;
        const localRequire = specifier => {
            if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
            if (!specifier.startsWith('.')) throw new Error(`Unmocked dependency: ${specifier}`);
            const base = path.resolve(path.dirname(absolute), specifier);
            const file = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find(candidate => fs.existsSync(candidate)) ?? `${base}.ts`;
            return load(file);
        };
        vm.runInNewContext(`(function(require,module,exports){${js}\n})`, {
            console, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, atob,
            fetch: async () => { throw new Error('Unexpected network request in test'); }, ...globals,
        }, { filename: absolute })(localRequire, module, module.exports);
        return module.exports;
    }
    return load;
}

function track(id, title = `Song ${id}`, artist = 'Arijit Singh', duration = 240) {
    return { id, title, artist: { id: 1, name: artist }, album: { id: 1, title: 'Album', cover: '' }, duration, source: 'tidal' };
}
function storage() {
    const values = new Map();
    return {
        async getItem(key) { await delay(1); return values.get(key) || null; },
        async setItem(key, value) { await delay(1); values.set(key, value); },
    };
}

// Minimal deterministic hook harness for queue/session logic. Native rendering
// remains a device check; effects are deliberately not auto-started here.
function playerHarness(apiOverrides = {}, fsOverrides = {}, radio = async () => []) {
    const slots = [];
    let cursor = 0;
    let writes = 0;
    const react = {
        createContext: () => ({ Provider: Symbol('Provider') }),
        createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } }),
        useState: initial => {
            const index = cursor++;
            if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
            return [slots[index], value => { writes++; slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
        },
        useRef: initial => {
            const index = cursor++;
            if (!(index in slots)) slots[index] = { current: initial };
            return slots[index];
        },
        useCallback: callback => callback,
        useMemo: factory => factory(),
        useEffect: () => {},
    };
    const api = { getCoverUrl: () => 'https://image.example/cover.jpg', getTrackStreamData: async () => ({ url: 'https://stream.example/song.mp3', isDash: false }), getFreeFallbackStream: async () => null, ...apiOverrides };
    const { PlayerProvider } = loader({
        react, 'react-native': { StyleSheet: { create: styles => styles } }, 'react-native-video': 'Video',
        'react-native-fs': { CachesDirectoryPath: '/cache', exists: async () => false, ...fsOverrides },
        '../api': { API: api },
        '../store/preferences': { getPrefs: async () => null, savePrefs: async () => {}, ARTIST_LIST: [] },
        '../store/listeningProfile': { recordPlayedTrack: async () => {}, getListeningProfile: async () => ({ artistPlays: {}, trackPlays: {}, likedTrackIds: [] }), topArtists: () => [] },
        '../services/recommendations': { getRadioRecommendations: radio },
    })('src/context/PlayerContext.tsx');
    return {
        render() {
            cursor = 0;
            const outer = PlayerProvider({ children: null });
            const inner = outer.props.children;
            return { player: inner.props.value, video: inner.props.children.find(child => child?.type === 'Video') };
        },
        writes: () => writes,
    };
}

test('Indian scripts keep vowel signs and cannot collapse to the same title', () => {
    const { normalizeMusicText, sameRecording } = loader()('src/services/musicMatching.ts');
    assert.notEqual(normalizeMusicText('क'), normalizeMusicText('कि'));
    assert.notEqual(normalizeMusicText('பாட்டு'), normalizeMusicText('பட்டு'));
    assert.equal(sameRecording({ title: 'तुम ही हो', artist: 'अरिजीत सिंह', duration: 240 }, track(1, 'तुम ही हो', 'अरिजीत सिंह')), true);
    assert.equal(sameRecording({ title: 'तुम ही हो', artist: 'अरिजीत सिंह' }, track(1, 'चलेया', 'अरिजीत सिंह')), false);
});

test('fallback requires artist + original recording + compatible duration', () => {
    const { sameRecording } = loader()('src/services/musicMatching.ts');
    const source = { title: 'Tum Hi Ho (From "Aashiqui 2")', artist: 'Arijit Singh, Mithoon', duration: 240 };
    assert.equal(sameRecording(source, track(1, 'Tum Hi Ho')), true);
    assert.equal(sameRecording(source, track(1, 'Tum Hi Ho', 'Singh')), false);
    assert.equal(sameRecording(source, track(1, 'Tum Hi Ho', 'Unknown artist')), false);
    assert.equal(sameRecording(source, track(1, 'Tum Hi Ho (Remix)')), false);
    assert.equal(sameRecording(source, track(1, 'Tum Hi Ho', 'Arijit Singh', 30)), false);
    assert.equal(sameRecording({ title: 'Intro', artist: 'Arijit Singh', duration: 28 }, track(2, 'Intro', 'Arijit Singh', 28)), true);
});

test('radio appends without reshuffling visible queue, replaying current song or duplicate ISRC', () => {
    const { appendRadioTracks } = loader()('src/services/musicMatching.ts');
    const first = { ...track(1), isrc: 'INABC1234567' };
    const next = appendRadioTracks([first, track(2)], [track(2), track(3), { ...track(4), isrc: first.isrc }, track(5)], new Set([5]));
    assert.deepEqual(Array.from(next, item => item.id), [1, 2, 3]);
});

test('300-song playlist starts atomically without hundreds of queue state updates', async () => {
    const harness = playerHarness();
    harness.render().player.playPlaylist(Array.from({ length: 300 }, (_, index) => track(index + 1)));
    await delay(1);
    const { player } = harness.render();
    assert.equal(player.currentTrack.id, 1);
    assert.equal(player.queue.length, 299);
    assert.equal(player.queue.at(-1).id, 300);
    assert.ok(harness.writes() < 40);
});

test('playback does not wait for notification artwork to download', async () => {
    const harness = playerHarness({}, { exists: () => new Promise(() => {}) });
    harness.render().player.playTrack({ ...track(1), album: { id: 1, title: 'Album', cover: 'cover-id' } });
    await delay(1);
    const { video } = harness.render();
    assert.equal(video.props.source.uri, 'https://stream.example/song.mp3');
});

test('old next-track lookup cannot override a new manual selection', async () => {
    let finishRadio;
    const harness = playerHarness({}, {}, () => new Promise(resolve => { finishRadio = resolve; }));
    harness.render().player.playTrack(track(1));
    await delay(1);
    harness.render().player.playNext();
    await delay(1);
    assert.equal(typeof finishRadio, 'function');
    harness.render().player.playTrack(track(99));
    finishRadio([track(2)]);
    await delay(1);
    assert.equal(harness.render().player.currentTrack.id, 99);
});

test('explicit song queued during async radio lookup keeps priority', async () => {
    let finishRadio;
    const harness = playerHarness({}, {}, () => new Promise(resolve => { finishRadio = resolve; }));
    harness.render().player.playTrack(track(1));
    await delay(1);
    harness.render().player.playNext();
    await delay(1);
    harness.render().player.addToQueue(track(50));
    finishRadio([track(2)]);
    await delay(1);
    assert.equal(harness.render().player.currentTrack.id, 50);
});

test('bounded workers preserve input order and never exceed requested concurrency', async () => {
    const { mapConcurrent } = loader()('src/services/asyncTools.ts');
    let active = 0; let peak = 0;
    const output = await mapConcurrent([1, 2, 3, 4, 5, 6], 3, async value => {
        peak = Math.max(peak, ++active);
        await delay(7 - value);
        active--;
        return value * 2;
    });
    assert.equal(peak, 3);
    assert.deepEqual(Array.from(output), [2, 4, 6, 8, 10, 12]);
});

test('playlist saves are serialized and never silently evict playlist 51', async () => {
    const store = loader({ '@react-native-async-storage/async-storage': storage() })('src/store/importedPlaylists.ts');
    await Promise.all(Array.from({ length: 51 }, (_, id) => store.saveImportedPlaylist({ id: String(id), title: `List ${id}`, sourceUrl: `https://example.com/${id}`, tracks: [] })));
    assert.equal((await store.getImportedPlaylists()).length, 51);
    await Promise.all([store.renameImportedPlaylist('0', ' My playlist '), store.deleteImportedPlaylist('1')]);
    const saved = await store.getImportedPlaylists();
    assert.equal(saved.length, 50);
    assert.equal(saved.find(item => item.id === '0').title, 'My playlist');
});

test('simultaneous likes and play events do not overwrite each other', async () => {
    const profile = loader({ '@react-native-async-storage/async-storage': storage() })('src/store/listeningProfile.ts');
    const a = await profile.getListeningProfile();
    const b = await profile.getListeningProfile();
    assert.notEqual(a, b);
    await Promise.all([profile.recordPlayedTrack(track(1)), profile.toggleLikedTrack(track(2))]);
    const saved = await profile.getListeningProfile();
    assert.equal(saved.trackPlays['1'], 1);
    assert.equal(saved.likedTrackIds[0], 2);
    assert.equal(saved.artistPlays['Arijit Singh'], 4);
});

test('imports all 205 exposed songs, preserves unmatched rows/order and reports accurate progress', async () => {
    const songs = Array.from({ length: 205 }, (_, id) => ({ name: `Song ${id}`, byArtist: { name: 'Arijit Singh' } }));
    const api = { search: async query => {
        const id = Number(query.match(/Song (\d+)/)[1]);
        if (id === 7) throw new Error('temporary provider failure');
        return [track(id + 1, `Song ${id}`)];
    } };
    const progress = [];
    const { importPlaylistLink } = loader({ '../api': { API: api } }, {
        fetch: async () => new Response(`<script type="application/ld+json">${JSON.stringify({ name: 'My India Mix', track: songs })}</script>`),
    })('src/services/playlistImport.ts');
    const result = await importPlaylistLink('https://music.apple.com/in/playlist/example/pl.123', (done, total) => progress.push([done, total]));
    assert.equal(result.title, 'My India Mix');
    assert.equal(result.tracks.length, 205);
    assert.equal(result.tracks[204].title, 'Song 204');
    assert.equal(result.tracks[7].resolved, undefined);
    assert.deepEqual(progress[0], [0, 205]);
    assert.deepEqual(progress.at(-1), [205, 205]);
});

test('TIDAL imports read once; deceptive and non-HTTPS playlist hosts are rejected', async () => {
    let calls = 0;
    const { importPlaylistLink } = loader({ '../api': { API: { getPlaylist: async () => {
        calls++; return { playlist: { title: 'Saved title' }, tracks: [track(1)] };
    } } } })('src/services/playlistImport.ts');
    const result = await importPlaylistLink('https://tidal.com/playlist/abc-123');
    assert.equal(calls, 1);
    assert.equal(result.tracks[0].resolved.id, 1);
    await assert.rejects(importPlaylistLink('https://open.spotify.com.evil.test/playlist/123'));
    await assert.rejects(importPlaylistLink('http://open.spotify.com/playlist/123'));
});

test('concurrent searches share requests; sparse failures do not poison search cache', async () => {
    let calls = 0; let offline = false; let time = 100;
    const rows = Array.from({ length: 15 }, (_, i) => track(i + 1));
    const { API } = loader({ 'crypto-js': {} }, {
        Date: { now: () => time },
        fetch: async url => {
            calls++;
            await delay(1);
            if (offline) throw new Error('offline');
            return new Response(JSON.stringify(url.includes('/tracks?q=') ? { items: rows } : { data: { items: rows } }));
        },
    })('src/api.ts');
    const results = await Promise.all(Array.from({ length: 10 }, () => API.search('Arijit Singh')));
    assert.equal(calls, 2);
    assert.ok(results.every(items => items.length === 15));
    time += 180_000;
    offline = true;
    assert.equal((await API.search('Arijit Singh')).length, 15);
    offline = false;
    const before = calls;
    await API.search('Arijit Singh');
    assert.equal(calls, before + 2);
});

test('native Audius tracks report lossy HIGH even when the requested tier is FLAC', async () => {
    const { API } = loader({ 'crypto-js': {} })('src/api.ts');
    const result = await API.getTrackStreamData({ ...track(1), source: 'audius', providerId: 'real-id' }, 'HI_RES_LOSSLESS');
    assert.equal(result.resolvedQuality, 'HIGH');
    assert.equal(result.format.codec, 'MP3');
});

test('full 24-bit FLAC stays primary and does not call a lossy fallback', async () => {
    const requests = [];
    const { API } = loader({ 'crypto-js': {} }, { fetch: async url => {
        requests.push(url);
        if (url.includes('hifi.rhythmax.workers.dev/manifests')) return new Response(JSON.stringify({ data: { attributes: { uri: 'https://audio.example/full.mpd' } } }));
        if (url === 'https://audio.example/full.mpd') return new Response('<MPD mediaPresentationDuration="PT4M"><Representation id="FLAC_HIRES,96000,24" codecs="flac"/></MPD>');
        throw new Error('Unexpected fallback');
    } })('src/api.ts');
    const result = await API.getTrackStreamData(track(1), 'HI_RES_LOSSLESS');
    assert.equal(requests.length, 2);
    assert.equal(result.resolvedQuality, 'HI_RES_LOSSLESS');
    assert.equal(result.format.codec, 'FLAC');
    assert.equal(result.format.bitDepth, 24);
});

test('a downgraded AAC manifest is never labelled FLAC just because Hi-Res was requested', async () => {
    const { API } = loader({ 'crypto-js': {} }, { fetch: async url => url.includes('/manifests?')
        ? new Response(JSON.stringify({ data: { attributes: { uri: 'https://audio.example/aac.mpd' } } }))
        : new Response('<MPD mediaPresentationDuration="PT4M"><Representation id="AAC,44100,0" codecs="mp4a.40.2" bandwidth="320000"/></MPD>'),
    })('src/api.ts');
    const result = await API.getTrackStreamData(track(1), 'HI_RES_LOSSLESS');
    assert.equal(result.format.codec, 'AAC');
    assert.equal(result.resolvedQuality, 'HIGH');
});

test('catalog deadline includes stalled JSON body, without retrying authentication or 429', async () => {
    let calls = 0;
    const { catalogRequest } = loader({}, { fetch: async () => {
        calls++; return { ok: true, json: () => new Promise(() => {}) };
    } })('src/services/catalogRequest.ts');
    await assert.rejects(catalogRequest('https://catalog.example/search', 10), /timed out/);
    assert.equal(calls, 1);
    for (const status of [401, 403, 429]) {
        let count = 0;
        const request = loader({}, { fetch: async () => { count++; return new Response('', { status }); } })('src/services/catalogRequest.ts');
        await assert.rejects(request.catalogRequest('https://catalog.example/search'));
        assert.equal(count, 1);
    }
});

test('catalog retries transient 503 once and then succeeds', async () => {
    let calls = 0;
    const { catalogRequest } = loader({}, { fetch: async () => ++calls === 1
        ? new Response('', { status: 503 }) : new Response('{"items":[1]}'),
    })('src/services/catalogRequest.ts');
    const value = await catalogRequest('https://catalog.example/search');
    assert.equal(calls, 2);
    assert.equal(value.items[0], 1);
});

test('chart cursor uses catalog positions, not the number of successfully matched recordings', async () => {
    const { API } = loader({ 'crypto-js': {} }, { fetch: async url => new Response(JSON.stringify({
        feed: { results: Array.from({ length: 8 }, (_, i) => ({ name: `${url.includes('/in/') ? 'India' : 'Global'} ${i}`, artistName: 'Artist' })) },
    })) })('src/api.ts');
    API.search = async () => [];
    const page = await API.getGlobalChartPage(4, 0);
    assert.equal(page.tracks.length, 0);
    assert.equal(page.nextIndex, 4);
    assert.equal(page.hasMore, true);
});

test('playback recovery cannot substitute an unrelated Audius artist or preview', async () => {
    const { API } = loader({ 'crypto-js': {} }, { fetch: async url => new Response(JSON.stringify(
        url.includes('api.audius') ? { data: [
            { id: 'wrong', title: 'Tum Hi Ho', user: { name: 'Cover Singer' }, duration: 240 },
            { id: 'preview', title: 'Tum Hi Ho', user: { name: 'Arijit Singh' }, duration: 30 },
        ] } : { results: [] },
    )) })('src/api.ts');
    assert.equal(await API.getFreeFallbackStream(track(1, 'Tum Hi Ho')), null);
});

test('all source TypeScript and TSX parse without emitting files', () => {
    const files = fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter(file => /\.tsx?$/.test(file) && !/\.d\.ts$/.test(file));
    for (const file of files) {
        const result = ts.transpileModule(fs.readFileSync(path.join(root, 'src', file), 'utf8'), {
            fileName: file, reportDiagnostics: true,
            compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
        });
        const errors = (result.diagnostics || []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
        assert.equal(errors.length, 0, `${file}: ${errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, ' ')).join('; ')}`);
    }
});

test('search ranks full title and artist above partial matches and unwanted versions', () => {
    const { searchTrackScore, matchesSearch } = loader()('src/services/searchRanking.ts');
    const correct = track(1, 'Tum Hi Ho', 'Arijit Singh');
    const wrong = track(2, 'Tum Hi Ho', 'Someone Else');
    const remix = track(3, 'Tum Hi Ho Remix', 'Arijit Singh');
    assert.ok(searchTrackScore('tum hi ho arijit', correct) > searchTrackScore('tum hi ho arijit', wrong));
    assert.ok(searchTrackScore('tum hi ho', correct) > searchTrackScore('tum hi ho', remix));
    assert.ok(searchTrackScore('tum hi ho remix', remix) > searchTrackScore('tum hi ho remix', correct));
    assert.ok(matchesSearch('Tum Hi Ho Arijit Singh', 'arijit tum hi'));
    assert.ok(matchesSearch('अरिजीत सिंह तुम ही हो', 'तुम अरिजीत'));
    assert.equal(matchesSearch('Heartless', 'art'), false);
    assert.equal(matchesSearch('Anything', '  '), false);
});


function searchRow(videoId, title, artist = 'Arijit Singh') {
    return { musicResponsiveListItemRenderer: {
        playlistItemData: { videoId },
        flexColumns: [
            { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
            { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: `${artist} • Album • 3:20` }] } } },
        ],
    } };
}

test('BitChord song search preserves provider order and deduplicates by video id', async () => {
    let body;
    const { searchSongs } = loader({ '../api': { API: {} } }, { fetch: async (_url, options) => {
        body = JSON.parse(options.body);
        return new Response(JSON.stringify({ contents: { tabbedSearchResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [
            { musicShelfRenderer: { contents: [searchRow('first', 'Provider first'), searchRow('second', 'Exact query'), searchRow('first', 'Duplicate')], continuations: [{ nextContinuationData: { continuation: 'page-2' } }] } },
        ] } } } }] } } }));
    } })('src/services/ytmusic.ts');
    const page = await searchSongs('Exact query');
    assert.equal(body.params, 'EgWKAQIIAWoKEAkQChAFEAMQBA==');
    assert.equal(body.context.client.clientName, 'WEB_REMIX');
    assert.deepEqual(Array.from(page.tracks, item => item.ytVideoId), ['first', 'second']);
    assert.ok(page.tracks.every(item => item.id < 0));
    assert.equal(page.tracks[0].duration, 200);
    assert.equal(page.continuation, 'page-2');
});

test('BitChord continuation parses the next shelf and excludes nested menu tracks', async () => {
    let body;
    const { searchSongs } = loader({ '../api': { API: {} } }, { fetch: async (_url, options) => {
        body = JSON.parse(options.body);
        return new Response(JSON.stringify({ continuationContents: { musicShelfContinuation: {
            contents: [searchRow('third', 'Next song')],
            menu: { contents: [searchRow('wrong', 'Not a result')] },
        } } }));
    } })('src/services/ytmusic.ts');
    const page = await searchSongs('query', 'page-2');
    assert.equal(body.continuation, 'page-2');
    assert.equal(body.query, undefined);
    assert.deepEqual(Array.from(page.tracks, item => item.ytVideoId), ['third']);
    assert.equal(page.continuation, null);
});

test('YouTube song search propagates outages rather than caching a false empty result', async () => {
    const { searchSongs } = loader({ '../api': { API: {} } }, { fetch: async () => new Response('', { status: 503 }) })('src/services/ytmusic.ts');
    await assert.rejects(searchSongs('test'), /503/);
    assert.equal((await searchSongs('  ')).tracks.length, 0);
});

function browseRow(kind, id, title) {
    return { musicResponsiveListItemRenderer: {
        navigationEndpoint: { browseEndpoint: { browseId: id, browseEndpointContextSupportedConfigs: {
            browseEndpointContextMusicConfig: { pageType: `MUSIC_PAGE_TYPE_${kind}` },
        } } },
        // Album overlays can carry a song id. Browse classification must win.
        playlistItemData: { videoId: 'overlay-not-a-track' },
        flexColumns: [
            { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
            { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: `${kind} • Test Artist` }] } } },
        ],
    } };
}
function searchResponse(items, token) {
    return { contents: { tabbedSearchResultsRenderer: { tabs: [{ tabRenderer: { content: {
        sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [{ musicShelfRenderer: {
            contents: items, ...(token ? { continuations: [{ nextContinuationData: { continuation: token } }] } : {}),
        } }] } }] },
    } } }] } } };
}

test('mixed BitChord search parses nested albums, artists and playlists before their play overlays', () => {
    const { parseMusicSearch } = loader({ '../api': { API: {} } })('src/services/ytmusic.ts');
    const response = searchResponse([
        browseRow('ALBUM', 'MPRE-album', 'Album'), browseRow('ARTIST', 'UC-artist', 'Artist'),
        browseRow('PLAYLIST', 'VL-playlist', 'Playlist'), searchRow('song', 'Song'),
        browseRow('ALBUM', 'MPRE-album', 'Duplicate album'),
    ]);
    const result = parseMusicSearch(response);
    assert.equal(result.tracks.length, 1);
    assert.equal(result.albums.length, 1);
    assert.equal(result.artists.length, 1);
    assert.equal(result.playlists.length, 1);
    assert.equal(result.albums[0].ytBrowseId, 'MPRE-album');
    assert.equal(result.playlists[0].id, 'VL-playlist');
});

test('every BitChord filter sends the correct params; All stays unfiltered and anonymous', async () => {
    const bodies = [];
    const { searchMusic, SEARCH_FILTERS } = loader({ '../api': { API: {} } }, { fetch: async (_url, options) => {
        assert.equal(options.headers.Cookie, undefined);
        bodies.push(JSON.parse(options.body));
        return new Response(JSON.stringify(searchResponse([])));
    } })('src/services/ytmusic.ts');
    for (const category of ['all', 'songs', 'albums', 'artists', 'playlists']) {
        await searchMusic('query', category);
        assert.equal(bodies.at(-1).params ?? null, SEARCH_FILTERS[category]);
    }
    assert.equal(bodies[2].params, 'EgWKAQIYAWoKEAkQChAFEAMQBA==');
    assert.equal(bodies[3].params, 'EgWKAQIgAWoKEAkQChAFEAMQBA==');
    assert.equal(bodies[4].params, 'EgWKAQIoAWoKEAkQChAFEAMQBA==');
});

test('browse identity and provider order survive same-name results and category continuations', async () => {
    let body;
    const { searchMusic } = loader({ '../api': { API: {} } }, { fetch: async (_url, options) => {
        body = JSON.parse(options.body);
        return new Response(JSON.stringify({ continuationContents: { musicShelfContinuation: {
            contents: [browseRow('ALBUM', 'MPRE-second', 'Same title'), browseRow('ALBUM', 'MPRE-first', 'Same title')],
            continuations: [{ nextContinuationData: { continuation: 'next' } }],
        } } }));
    } })('src/services/ytmusic.ts');
    const result = await searchMusic('query', 'albums', 'token');
    assert.equal(body.continuation, 'token');
    assert.equal(body.params, undefined);
    assert.deepEqual(Array.from(result.albums, item => item.ytBrowseId), ['MPRE-second', 'MPRE-first']);
    assert.equal(result.continuation, 'next');
});

test('YouTube browse routes never pass negative hashes into catalog detail IDs', () => {
    const { parseMusicSearch, youtubeBrowseParams } = loader({ '../api': { API: {} } })('src/services/ytmusic.ts');
    const page = parseMusicSearch(searchResponse([browseRow('ALBUM', 'MPRE-a', 'Album'), browseRow('ARTIST', 'UC-a', 'Artist'), browseRow('PLAYLIST', 'VL-a', 'Playlist')]));
    const album = youtubeBrowseParams(page.albums[0]);
    const artist = youtubeBrowseParams(page.artists[0]);
    const playlist = youtubeBrowseParams(page.playlists[0]);
    assert.equal(album.ytAlbumId, 'MPRE-a'); assert.equal(album.albumId, undefined);
    assert.equal(artist.ytArtistId, 'UC-a'); assert.equal(artist.artistId, undefined);
    assert.equal(playlist.ytPlaylistId, 'VL-a'); assert.equal(playlist.playlistId, undefined);
});

test('promoted artist cards stay the Top result rather than becoming an unrelated top song', () => {
    const { parseMusicSearch } = loader({ '../api': { API: {} } })('src/services/ytmusic.ts');
    const row = browseRow('ARTIST', 'UC-top', 'Top Artist').musicResponsiveListItemRenderer;
    const card = { title: row.flexColumns[0].musicResponsiveListItemFlexColumnRenderer.text, navigationEndpoint: row.navigationEndpoint, contents: [searchRow('preview', 'Preview song')] };
    const response = searchResponse([]);
    response.contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents.unshift({ musicCardShelfRenderer: card });
    const page = parseMusicSearch(response);
    assert.equal(page.topBrowse.name, 'Top Artist');
    assert.equal(page.artists[0].ytBrowseId, 'UC-top');
    assert.equal(page.tracks[0].ytVideoId, 'preview');
});

test('album/playlist browse preserves order, durations, continuation and excludes recommendations as songs', () => {
    const { parseMusicBrowse } = loader({ '../api': { API: {} } })('src/services/ytmusic.ts');
    const page = parseMusicBrowse({ contents: { twoColumnBrowseResultsRenderer: {
        tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ musicResponsiveHeaderRenderer: { title: { runs: [{ text: 'Release' }] } } }] } } } }],
        secondaryContents: { sectionListRenderer: { contents: [{ musicPlaylistShelfRenderer: { contents: [searchRow('a', 'First'), searchRow('b', 'Second'), browseRow('ALBUM', 'MPRE-other', 'Other album')], continuations: [{ nextContinuationData: { continuation: 'more' } }] } }] } },
    } } });
    assert.equal(page.title, 'Release');
    assert.deepEqual(Array.from(page.songs, song => song.videoId), ['a', 'b']);
    assert.equal(page.songs[0].durationSec, 200);
    assert.equal(page.continuation, 'more');
});

test('artist browse follows the authoritative Songs playlist before exposing its tracks', async () => {
    const requested = [];
    const { musicBrowse } = loader({ '../api': { API: {} } }, { fetch: async (_url, options) => {
        const body = JSON.parse(options.body); requested.push(body.browseId);
        const contents = body.browseId === 'UC-artist'
            ? [{ musicShelfRenderer: { contents: [searchRow('preview', 'Preview')], bottomEndpoint: { browseEndpoint: { browseId: 'VL-top-songs' } } } }]
            : [{ musicShelfRenderer: { contents: [searchRow('full-a', 'First'), searchRow('full-b', 'Second')] } }];
        return new Response(JSON.stringify({ contents: { singleColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents } } } }] } } }));
    } })('src/services/ytmusic.ts');
    const page = await musicBrowse('UC-artist');
    assert.deepEqual(requested, ['UC-artist', 'VL-top-songs']);
    assert.deepEqual(Array.from(page.songs, song => song.videoId), ['full-a', 'full-b']);
});

// Execute the real search screen's handlers with inert native views. No device,
// Metro or browser is needed; async provider results remain controllable.
function searchScreenHarness(searchMusic) {
    const slots = []; let cursor = 0;
    const react = {
        createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
        useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
        useMemo: fn => fn(), useCallback: fn => fn, useEffect: () => {},
    };
    const native = Object.fromEntries(['View', 'Text', 'TextInput', 'TouchableOpacity', 'Image', 'ScrollView'].map(name => [name, name]));
    native.StyleSheet = { create: value => value }; native.Keyboard = { dismiss() {} };
    const noOp = () => {};
    const navigation = { navigate: noOp, setParams: noOp };
    const load = loader({
        react, 'react-native': native,
        '@react-navigation/native': { useNavigation: () => navigation, useRoute: () => ({ params: {} }), useFocusEffect: noOp },
        'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
        'react-native-vector-icons/Ionicons': 'Icon',
        '../services/haptics': { haptic: noOp },
        '../components/GlassHeader': { ProfileCircle: 'ProfileCircle' },
        '../components/SongMenu': { useSongMenu: () => noOp },
        '../services/search': { searchWithPlaybackFallback: async (...args) => ({ ...await searchMusic(...args), provider: 'youtube' }) },
        '../services/ytmusic': { searchMusic, searchSuggestions: async () => [], youtubeBrowseParams: item => ({ ytAlbumId: item.ytBrowseId }) },
        '../api': { API: { getCoverUrl: value => value } },
        '../store/searchHistory': {}, '../store/listeningProfile': {}, '../store/preferences': {},
        '../context/PlayerContext': { usePlayerSummary: () => ({ playTrack: noOp, addToQueue: noOp }) },
        '../context/ThemeContext': { useTheme: () => ({ colors: {}, theme: 'dark' }) },
        '../context/DialogContext': { useAppDialog: () => ({ showDialog: noOp }) },
        '../services/recommendations': { getRadioRecommendations: async () => [] },
        '../hooks/useScreenStatusBar': { useScreenStatusBar: noOp },
        '../components/SkeletonPulse': 'SkeletonPulse',
    });
    const Screen = load('src/screens/TrackList.tsx').default;
    const render = () => { cursor = 0; return Screen(); };
    const nodes = (node, found = []) => {
        if (Array.isArray(node)) node.forEach(item => nodes(item, found));
        else if (node && typeof node === 'object') { found.push(node); nodes(node.props?.children, found); }
        return found;
    };
    const text = node => {
        if (Array.isArray(node)) return node.map(text).join('');
        if (node && typeof node === 'object') return text(node.props?.children);
        return node == null || typeof node === 'boolean' ? '' : String(node);
    };
    return { render, nodes, text };
}
const emptySearch = () => ({ tracks: [], albums: [], artists: [], playlists: [], continuation: null });

test('real search-screen tabs request their own BitChord filter instead of filtering the Songs page', async () => {
    const calls = [];
    const h = searchScreenHarness(async (query, category) => { calls.push([query, category]); return emptySearch(); });
    let tree = h.render();
    h.nodes(tree).find(node => node.type === 'TextInput').props.onChangeText('query');
    tree = h.render();
    await h.nodes(tree).find(node => node.props?.accessibilityLabel === 'Search').props.onPress();
    for (const [label, expected] of [['Albums', 'albums'], ['Artists', 'artists'], ['Playlists', 'playlists'], ['Songs', 'songs'], ['All', 'all']]) {
        tree = h.render();
        const tab = h.nodes(tree).find(node => node.type === 'TouchableOpacity' && node.props.accessibilityState && h.text(node) === label);
        assert.ok(tab, `${label} tab exists`);
        tab.props.onPress(); await delay(0);
        assert.deepEqual(calls.at(-1), ['query', expected]);
    }
});

test('real search screen ignores an older category response and clearing invalidates pending results', async () => {
    const pending = [];
    const h = searchScreenHarness((query, category) => new Promise(resolve => pending.push({ query, category, resolve })));
    let tree = h.render();
    h.nodes(tree).find(node => node.type === 'TextInput').props.onChangeText('query');
    tree = h.render();
    const first = h.nodes(tree).find(node => node.props?.accessibilityLabel === 'Search').props.onPress();
    tree = h.render();
    const albumTab = h.nodes(tree).find(node => node.type === 'TouchableOpacity' && node.props.accessibilityState && h.text(node) === 'Albums');
    albumTab.props.onPress();
    pending[1].resolve({ ...emptySearch(), albums: [{ id: -1, ytBrowseId: 'MPRE-new', title: 'Current album', cover: '' }] });
    await delay(0);
    pending[0].resolve({ ...emptySearch(), albums: [{ id: -2, ytBrowseId: 'MPRE-old', title: 'Stale album', cover: '' }] });
    await first;
    tree = h.render();
    assert.ok(h.text(tree).includes('Current album'));
    assert.ok(!h.text(tree).includes('Stale album'));
    h.nodes(tree).find(node => node.props?.accessibilityLabel === 'Search').props.onPress();
    tree = h.render();
    h.nodes(tree).find(node => node.props?.accessibilityLabel === 'Clear search').props.onPress();
    pending[2].resolve({ ...emptySearch(), albums: [{ id: -3, title: 'Late album', cover: '' }] });
    await delay(0);
    tree = h.render();
    assert.ok(!h.text(tree).includes('Late album'));
    assert.equal(h.nodes(tree).find(node => node.type === 'TextInput').props.value, '');
});

test('successful BitChord results retain their ranking without querying the playback catalog', async () => {
    let catalogCalls = 0;
    const { searchWithPlaybackFallback } = loader({
        './ytmusic': { searchMusic: async () => ({ ...emptySearch(), tracks: [track(2), track(1)] }) },
        '../api': { API: { search: async () => { catalogCalls++; return []; } } },
    })('src/services/search.ts');
    const page = await searchWithPlaybackFallback('query');
    assert.equal(page.provider, 'youtube');
    assert.deepEqual(Array.from(page.tracks, item => item.id), [2, 1]);
    assert.equal(catalogCalls, 0);
});

test('playback catalog searches all types on a YouTube outage and preserves real playback identities', async () => {
    const source = track(421, 'Playable song');
    const { searchWithPlaybackFallback } = loader({
        './ytmusic': { searchMusic: async () => { throw new Error('YouTube offline'); } },
        '../api': { API: {
            search: async () => [source],
            searchAlbums: async () => [{ id: 12, title: 'Album' }],
            searchArtists: async () => [{ id: 13, name: 'Artist' }],
            searchPlaylists: async () => [{ id: 'catalog-playlist', title: 'Playlist' }],
        } },
    })('src/services/search.ts');
    const page = await searchWithPlaybackFallback('query');
    assert.equal(page.provider, 'playback');
    assert.equal(page.tracks[0], source);
    assert.equal(page.tracks[0].source, 'tidal');
    assert.equal(page.albums[0].id, 12);
    assert.equal(page.artists[0].id, 13);
    assert.equal(page.playlists[0].id, 'catalog-playlist');
    assert.equal(page.continuation, null);
});

test('empty YouTube categories fall back only to the requested playback category', async () => {
    for (const [category, method, key] of [['songs', 'search', 'tracks'], ['albums', 'searchAlbums', 'albums'], ['artists', 'searchArtists', 'artists'], ['playlists', 'searchPlaylists', 'playlists']]) {
        const calls = [];
        const api = Object.fromEntries(['search', 'searchAlbums', 'searchArtists', 'searchPlaylists'].map(name => [name, async () => { calls.push(name); return [{ id: 1 }]; }]));
        const { searchWithPlaybackFallback } = loader({ './ytmusic': { searchMusic: async () => emptySearch() }, '../api': { API: api } })('src/services/search.ts');
        const page = await searchWithPlaybackFallback('query', category);
        assert.deepEqual(calls, [method]);
        assert.equal(page[key].length, 1);
    }
});

test('YouTube pagination failures never replay tokens against playback providers', async () => {
    let calls = 0;
    const { searchWithPlaybackFallback } = loader({
        './ytmusic': { searchMusic: async () => { throw new Error('offline'); } },
        '../api': { API: { search: async () => { calls++; return []; } } },
    })('src/services/search.ts');
    await assert.rejects(searchWithPlaybackFallback('query', 'songs', 'yt-token'), /offline/);
    assert.equal(calls, 0);
});

test('one playback search section failing does not discard successful sections', async () => {
    const { searchWithPlaybackFallback } = loader({
        './ytmusic': { searchMusic: async () => emptySearch() },
        '../api': { API: { search: async () => [track(1)], searchAlbums: async () => { throw new Error('offline'); }, searchArtists: async () => [], searchPlaylists: async () => [] } },
    })('src/services/search.ts');
    const page = await searchWithPlaybackFallback('query');
    assert.equal(page.tracks.length, 1);
    assert.equal(page.albums.length, 0);
});

test('a same-length instrumental or cover album never wins over the original song', () => {
    const { bestRecording } = loader()('src/services/musicMatching.ts');
    const original = { ...track(412830594, 'Tum Se Hi', 'Pritam', 321), album: { id: 1, title: 'Jab We Met', cover: '' } };
    const strings = { ...track(411278233, 'Tum Se Hi', 'Pritam', 322), album: { id: 2, title: 'Singing Strings Vol-2', cover: '' } };
    const picked = bestRecording({ title: 'Tum Se Hi', artist: 'Pritam, Mohit Chauhan, Irshad Kamil', duration: 322 }, [strings, original]);
    assert.equal(picked.id, 412830594);
});
