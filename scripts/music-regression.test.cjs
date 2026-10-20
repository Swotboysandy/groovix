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

function loader(mocks = {}, globals = {}) {
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
            return load(path.resolve(path.dirname(absolute), `${specifier}.ts`));
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

test('homepage appends below charts and virtualizes batches into small stable cells', () => {
    const { appendHomeSection } = loader()('src/services/homeFeed.ts');
    const chart = appendHomeSection([], 'chart', [track(1)]);
    const feed = appendHomeSection(chart, 'discovery', Array.from({ length: 24 }, (_, i) => track(i + 1)));
    assert.equal(feed[0], chart[0]);
    assert.equal(feed.reduce((count, section) => count + section.tracks.length, 0), 24);
    assert.ok(feed.every(section => section.tracks.length <= 8));
    assert.equal(appendHomeSection(feed, 'discovery', [track(2)]), feed);
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

test('regional radio bounds search concurrency, fills sparse-artist batches and excludes repeats', async () => {
    let active = 0; let peak = 0;
    const api = { search: async name => {
        peak = Math.max(peak, ++active);
        await delay(1);
        active--;
        return Array.from({ length: 70 }, (_, id) => track(id + 1, `Song ${id + 1}`, name));
    } };
    const { getRadioRecommendations } = loader({ '../api': { API: api } }, {
        fetch: async () => new Response('{}'),
    })('src/services/recommendations.ts');
    const result = await getRadioRecommendations(track(1, 'Song 1', 'Anirudh Ravichander'), {
        artistPlays: {}, trackPlays: {}, likedTracks: [], likedTrackIds: [], recentTracks: [],
    }, [], new Set([1, 2]), 60, []);
    assert.ok(peak <= 3);
    assert.equal(result.length, 60);
    assert.ok(result.every(item => ![1, 2].includes(item.id)));
    assert.equal(new Set(result.map(item => item.id)).size, result.length);
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
