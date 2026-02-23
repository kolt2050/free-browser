const { app, BrowserWindow, session, WebContentsView, ipcMain, shell, Menu, MenuItem } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dotenv = require('dotenv');

dotenv.config();

// ─── Multi-Instance Setup ───
// Each instance gets a unique number and isolated userData
const instanceDir = path.join(os.tmpdir(), 'free-browser-instances');
if (!fs.existsSync(instanceDir)) fs.mkdirSync(instanceDir, { recursive: true });

function getInstanceNumber() {
    // Scan lock files to find next available number
    const existing = fs.readdirSync(instanceDir)
        .filter(f => f.endsWith('.lock'))
        .map(f => parseInt(f.replace('.lock', ''), 10))
        .filter(n => !isNaN(n))
        .sort((a, b) => a - b);

    let num = 1;
    for (const n of existing) {
        if (n === num) num++;
        else break;
    }
    return num;
}

const instanceNumber = getInstanceNumber();
const lockFile = path.join(instanceDir, `${instanceNumber}.lock`);
fs.writeFileSync(lockFile, String(process.pid));

// Isolated user data directory per instance
const userDataPath = path.join(app.getPath('userData'), `instance-${instanceNumber}`);
app.setPath('userData', userDataPath);

// Force accept-lang at Chromium level
app.commandLine.appendSwitch('accept-lang', 'en-US,en');

// Spoof User-Agent to regular Chrome (removes "Electron" from UA string)
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let mainWindow;
const tabs = new Map();
let activeTabId = null;

// Dynamic proxy/locale state
let currentProxyConfig = null;
let currentLocaleProfile = null;

// Cleanup lock file on exit
function cleanupLock() {
    try { fs.unlinkSync(lockFile); } catch (e) { }
}
app.on('will-quit', () => {
    cleanupLock();
    const { globalShortcut } = require('electron');
    globalShortcut.unregisterAll();
});
process.on('exit', cleanupLock);
process.on('SIGINT', () => { cleanupLock(); process.exit(); });
process.on('SIGTERM', () => { cleanupLock(); process.exit(); });

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: `Free Browser #${instanceNumber}`,
        titleBarStyle: 'hidden',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    // Set User-Agent at session level (affects all requests globally)
    session.defaultSession.setUserAgent(CHROME_UA);

    const updateContentViewBounds = () => {
        if (!activeTabId) return;
        const view = tabs.get(activeTabId);
        if (!view) return;
        const { width, height } = mainWindow.getContentBounds();
        const yOffset = 134;
        view.setBounds({ x: 0, y: yOffset, width: width, height: height - yOffset });
    };

    mainWindow.on('resize', updateContentViewBounds);

    // ─── Ctrl+F: Toggle Find Bar ───
    // Using globalShortcut + executeJavaScript to bypass IPC completely.
    const { globalShortcut } = require('electron');

    const registerFindShortcut = () => {
        if (!globalShortcut.isRegistered('CommandOrControl+F')) {
            globalShortcut.register('CommandOrControl+F', () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    // Force hardware focus back to the main UI so the input can actually receive typing
                    mainWindow.webContents.focus();
                    mainWindow.webContents.executeJavaScript(
                        'window.__toggleFind && window.__toggleFind()'
                    ).catch(() => { });
                }
            });
        }
    };
    const unregisterFindShortcut = () => {
        globalShortcut.unregister('CommandOrControl+F');
    };

    mainWindow.on('focus', registerFindShortcut);
    mainWindow.on('blur', unregisterFindShortcut);
    registerFindShortcut();

    // ─── Window Controls ───
    ipcMain.on('window-minimize', () => mainWindow?.minimize());
    ipcMain.on('window-maximize', () => {
        if (mainWindow?.isMaximized()) mainWindow.unmaximize();
        else mainWindow?.maximize();
    });
    ipcMain.on('window-close', () => {
        cleanupLock();
        app.quit();
    });

    // ─── Instance Info ───
    ipcMain.handle('get-instance-number', () => instanceNumber);

    // ─── Native Menu Logic ───
    ipcMain.on('show-main-menu', (event) => {
        const template = [
            {
                label: 'Radar (Tracker)',
                click: () => {
                    // Reuse existing logic or send to renderer
                    event.sender.send('menu-action', 'tracker');
                }
            },
            {
                label: 'Network Logs',
                click: () => event.sender.send('menu-action', 'logs')
            },
            {
                label: 'Downloads',
                click: () => event.sender.send('menu-action', 'downloads')
            },
            {
                label: 'Cookie Viewer',
                click: () => event.sender.send('menu-action', 'cookies')
            },
            { type: 'separator' },
            {
                label: 'Clear Session',
                click: () => event.sender.send('menu-action', 'clear')
            },
            {
                label: 'Disconnect Proxy',
                click: () => event.sender.send('menu-action', 'disconnect')
            }
        ];
        const menu = Menu.buildFromTemplate(template);
        menu.popup({ window: mainWindow });
    });
    ipcMain.handle('get-app-version', () => app.getVersion());

    // ─── Auto-fill proxy from .env (for testing) ───
    ipcMain.handle('get-env-proxy', () => {
        return process.env.VITE_PROXY_CONFIG || null;
    });

    // ─── Set Proxy (from UI) ───
    ipcMain.handle('set-proxy', async (event, { config }) => {
        // Log without credentials for security
        const parts = config.split(':');
        const safeLog = parts.length >= 2 ? `${parts[0]}:${parts[1]}` : 'invalid';
        console.log(`[#${instanceNumber}] Setting proxy: ${safeLog}`);
        currentProxyConfig = config;

        let proxyRules = '';
        if (parts.length >= 2) {
            proxyRules = `${parts[0]}:${parts[1]}`;
        }

        await session.defaultSession.setProxy({ proxyRules });

        // GeoIP lookup through the proxy to detect country
        let detectedCountry = 'US'; // fallback
        try {
            const { net } = require('electron');
            const geoData = await new Promise((resolve, reject) => {
                const request = net.request('http://ip-api.com/json/?fields=countryCode,country,timezone');
                let body = '';
                request.on('response', (response) => {
                    response.on('data', (chunk) => { body += chunk.toString(); });
                    response.on('end', () => {
                        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
                    });
                });
                request.on('error', reject);
                setTimeout(() => reject(new Error('timeout')), 5000);
                request.end();
            });
            if (geoData.countryCode) {
                detectedCountry = geoData.countryCode;
                console.log(`[#${instanceNumber}] GeoIP detected: ${geoData.country} (${detectedCountry}), tz: ${geoData.timezone}`);
            }
        } catch (err) {
            console.log(`[#${instanceNumber}] GeoIP lookup failed, using fallback US: ${err.message}`);
        }

        return { detectedCountry };
    });

    // ─── Apply Locale Profile (separate step after detection) ───
    ipcMain.on('apply-locale', (event, { profile }) => {
        currentLocaleProfile = profile;
        const lang = profile?.lang || 'en-US';
        console.log(`[#${instanceNumber}] Locale applied: ${lang}, tz: ${profile?.tz}`);
    });

    // ─── Disconnect Proxy ───
    ipcMain.on('disconnect-proxy', async () => {
        console.log(`[#${instanceNumber}] Disconnecting proxy...`);
        currentProxyConfig = null;
        currentLocaleProfile = null;

        tabs.forEach((view) => {
            mainWindow.contentView.removeChildView(view);
            view.webContents.destroy();
        });
        tabs.clear();
        activeTabId = null;

        await session.defaultSession.setProxy({ proxyRules: 'http://0.0.0.0:1' });
        console.log(`[#${instanceNumber}] Proxy disconnected. Network blocked.`);
    });

    // ─── Proxy Authentication ───
    app.on('login', (event, webContents, request, authInfo, callback) => {
        if (authInfo.isProxy && currentProxyConfig) {
            const parts = currentProxyConfig.split(':');
            if (parts.length === 4) {
                event.preventDefault();
                callback(parts[2], parts[3]);
                return;
            }
        }
    });

    // ─── Logs Window ───
    let logsWindow = null;
    ipcMain.on('open-logs', () => {
        if (logsWindow) { logsWindow.focus(); return; }
        logsWindow = new BrowserWindow({
            width: 800, height: 600, title: `Network Logs #${instanceNumber}`,
            webPreferences: { nodeIntegration: true, contextIsolation: false }
        });
        logsWindow.loadFile(path.join(__dirname, 'logs.html'));
        logsWindow.setMenu(null);
        logsWindow.on('closed', () => { logsWindow = null; });
    });

    // ─── Tracker Window ───
    let trackerWindow = null;
    ipcMain.on('open-tracker', () => {
        if (trackerWindow) { trackerWindow.focus(); return; }
        trackerWindow = new BrowserWindow({
            width: 400, height: 600, title: `Resource Radar #${instanceNumber}`,
            webPreferences: { nodeIntegration: true, contextIsolation: false }
        });
        trackerWindow.loadFile(path.join(__dirname, 'radar.html'));
        trackerWindow.setMenu(null);
        trackerWindow.on('closed', () => { trackerWindow = null; });
    });

    // ─── Cookies Window ───
    let cookiesWindow = null;
    ipcMain.on('open-cookies', () => {
        if (cookiesWindow) { cookiesWindow.focus(); refreshCookies(); return; }
        cookiesWindow = new BrowserWindow({
            width: 700, height: 600, title: `Cookies #${instanceNumber}`,
            webPreferences: { nodeIntegration: true, contextIsolation: false }
        });
        cookiesWindow.loadFile(path.join(__dirname, 'cookies.html'));
        cookiesWindow.setMenu(null);
        cookiesWindow.on('closed', () => { cookiesWindow = null; });
    });

    function refreshCookies() {
        session.defaultSession.cookies.get({}).then(cookies => {
            if (cookiesWindow && !cookiesWindow.isDestroyed()) {
                cookiesWindow.webContents.send('cookies-data', cookies);
            }
        }).catch(() => { });
    }

    ipcMain.on('get-cookies', () => {
        refreshCookies();
    });

    ipcMain.handle('clear-session-data', async () => {
        await session.defaultSession.clearStorageData();
        console.log(`[#${instanceNumber}] Session data cleared manually.`);
        return true;
    });

    ipcMain.on('open-external', (event, url) => {
        shell.openExternal(url);
    });

    ipcMain.on('find-in-page', (event, { text, options }) => {
        if (activeTabId && tabs.has(activeTabId)) {
            tabs.get(activeTabId).webContents.findInPage(text, options);
        }
    });

    ipcMain.on('stop-find-in-page', (event, { action }) => {
        if (activeTabId && tabs.has(activeTabId)) {
            tabs.get(activeTabId).webContents.stopFindInPage(action || 'clearSelection');
        }
    });

    ipcMain.on('go-back', () => {
        if (activeTabId && tabs.has(activeTabId)) {
            const wc = tabs.get(activeTabId).webContents;
            if (wc.canGoBack()) wc.goBack();
        }
    });

    ipcMain.on('go-forward', () => {
        if (activeTabId && tabs.has(activeTabId)) {
            const wc = tabs.get(activeTabId).webContents;
            if (wc.canGoForward()) wc.goForward();
        }
    });

    ipcMain.on('reload', () => {
        if (activeTabId && tabs.has(activeTabId)) {
            tabs.get(activeTabId).webContents.reload();
        }
    });

    // ─── Download Manager ───
    session.defaultSession.on('will-download', (event, item, webContents) => {
        const fileName = item.getFilename();
        const totalBytes = item.getTotalBytes();
        const startTime = Date.now();

        item.on('updated', (event, state) => {
            if (state === 'interrupted') {
                console.log(`[#${instanceNumber}] Download interrupted: ${fileName}`);
            } else if (state === 'progressing') {
                if (item.isPaused()) {
                    // paused
                } else {
                    const received = item.getReceivedBytes();
                    mainWindow.webContents.send('download-progress', {
                        id: startTime,
                        fileName,
                        received,
                        total: totalBytes,
                        status: 'progressing'
                    });
                }
            }
        });

        item.once('done', (event, state) => {
            mainWindow.webContents.send('download-progress', {
                id: startTime,
                fileName,
                status: state === 'completed' ? 'completed' : 'failed'
            });
        });
    });

    // ─── Network Interceptors ───
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        try {
            if (trackerWindow && !trackerWindow.isDestroyed()) {
                const urlObj = new URL(details.url);
                if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
                    trackerWindow.webContents.send('tracked-resource', urlObj.hostname);
                }
            }
        } catch (e) { }

        if (logsWindow && !logsWindow.isDestroyed()) {
            session.defaultSession.resolveProxy(details.url).then(proxyStr => {
                logsWindow.webContents.send('network-log', {
                    id: details.id, method: details.method, url: details.url, proxy: proxyStr
                });
            }).catch(() => { });
        }
        callback({});
    });

    session.defaultSession.webRequest.onCompleted((details) => {
        if (logsWindow && !logsWindow.isDestroyed()) {
            logsWindow.webContents.send('network-log-done', {
                id: details.id,
                statusCode: details.statusCode
            });
        }
    });

    session.defaultSession.webRequest.onErrorOccurred((details) => {
        if (logsWindow && !logsWindow.isDestroyed()) {
            // Ignore ERR_ABORTED as it's just normal navigation cancellation
            if (details.error === 'net::ERR_ABORTED') return;
            logsWindow.webContents.send('network-log-done', {
                id: details.id,
                error: details.error
            });
        }
    });

    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        // Spoof User-Agent to regular Chrome
        details.requestHeaders['User-Agent'] = CHROME_UA;
        // Set Accept-Language based on locale
        if (currentLocaleProfile) {
            details.requestHeaders['Accept-Language'] = `${currentLocaleProfile.lang},en;q=0.5`;
        } else {
            details.requestHeaders['Accept-Language'] = 'en-US,en;q=0.9';
        }
        callback({ requestHeaders: details.requestHeaders });
    });

    // ─── Tab Management ───
    ipcMain.on('create-tab', (event, { id, url }) => {
        console.log(`[#${instanceNumber}] Creating tab: ${id} with url: ${url}`);
        const view = new WebContentsView();
        tabs.set(id, view);

        // Set User-Agent to regular Chrome
        view.webContents.setUserAgent(CHROME_UA);

        const profile = currentLocaleProfile || { lang: 'en-US', tz: 'America/New_York', offset: 300 };
        const antiFingerprintScript = `
            // ═══ 1. WEBDRIVER / AUTOMATION FLAGS ═══
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            delete navigator.__proto__.webdriver;

            // Remove Electron/automation markers
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

            // ═══ 2. CHROME RUNTIME OBJECT ═══
            if (!window.chrome) {
                window.chrome = {};
            }
            window.chrome.runtime = {
                connect: function() {},
                sendMessage: function() {},
                onMessage: { addListener: function() {}, removeListener: function() {} },
                id: undefined
            };
            window.chrome.csi = function() { return { startE: Date.now(), onloadT: Date.now() + 100, pageT: 300, tran: 15 }; };
            window.chrome.loadTimes = function() {
                return {
                    commitLoadTime: Date.now() / 1000,
                    connectionInfo: 'h2',
                    finishDocumentLoadTime: Date.now() / 1000 + 0.2,
                    finishLoadTime: Date.now() / 1000 + 0.3,
                    firstPaintAfterLoadTime: 0,
                    firstPaintTime: Date.now() / 1000 + 0.1,
                    navigationType: 'Other',
                    npnNegotiatedProtocol: 'h2',
                    requestTime: Date.now() / 1000 - 0.5,
                    startLoadTime: Date.now() / 1000 - 0.3,
                    wasAlternateProtocolAvailable: false,
                    wasFetchedViaSpdy: true,
                    wasNpnNegotiated: true
                };
            };
            // ═══ 3. PLUGINS & MIME TYPES (DISABLED FOR GOOGLE) ═══
            /*
            Object.defineProperty(navigator, 'plugins', {
                get: () => {
                    const arr = [
                        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
                        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1 },
                        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 2 }
                    ];
                    arr.refresh = function() {};
                    return arr;
                }
            });
            Object.defineProperty(navigator, 'mimeTypes', {
                get: () => {
                    const arr = [
                        { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
                        { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' }
                    ];
                    return arr;
                }
            });
            */

             // ═══ 4. PERMISSIONS API ═══
            const origQuery = window.navigator.permissions?.query;
            if (origQuery) {
                window.navigator.permissions.query = function(params) {
                    if (params.name === 'notifications') {
                        return Promise.resolve({ state: Notification.permission });
                    }
                    return origQuery.call(this, params);
                };
            }

            // ═══ 5. LANGUAGE / LOCALE (DISABLED FOR GOOGLE) ═══
            /*
            Object.defineProperty(navigator, 'language', { get: () => '${profile.lang}' });
            Object.defineProperty(navigator, 'languages', { get: () => ['${profile.lang}', 'en'] });
            Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
            Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
            Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });
            Object.defineProperty(navigator, 'appVersion', { get: () => '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
            */

            // ═══ 6. TIMEZONE (DISABLED FOR GOOGLE) ═══
            /*
            const origDTF = Intl.DateTimeFormat;
            const newDTF = function(l, o) {
                o = o || {}; o.timeZone = o.timeZone || '${profile.tz}';
                return new origDTF(l, o);
            };
            newDTF.prototype = origDTF.prototype;
            newDTF.supportedLocalesOf = origDTF.supportedLocalesOf;
            Object.defineProperty(Intl, 'DateTimeFormat', { value: newDTF, writable: false });
            const origRO = Intl.DateTimeFormat.prototype.resolvedOptions;
            Intl.DateTimeFormat.prototype.resolvedOptions = function() {
                const r = origRO.call(this); r.timeZone = '${profile.tz}'; return r;
            };
            Date.prototype.getTimezoneOffset = function() { return ${profile.offset}; };
            */

            // ═══ 7. WEBRTC LEAK PREVENTION (DISABLED FOR GOOGLE) ═══
            /*
            if (window.RTCPeerConnection) {
                const O = window.RTCPeerConnection;
                window.RTCPeerConnection = function(c, n) {
                    if (c && c.iceServers) c.iceServers = [];
                    return new O(c, n);
                };
                window.RTCPeerConnection.prototype = O.prototype;
            }
            */

            // ═══ 8. SCREEN (DISABLED FOR GOOGLE) ═══
            /*
            Object.defineProperty(screen, 'width', { get: () => 1920 });
            Object.defineProperty(screen, 'height', { get: () => 1080 });
            Object.defineProperty(screen, 'availWidth', { get: () => 1920 });
            Object.defineProperty(screen, 'availHeight', { get: () => 1040 });
            Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
            Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
            */

            // ═══ 9. CONNECTION (DISABLED FOR GOOGLE) ═══
            /*
            if (navigator.connection) {
                Object.defineProperty(navigator.connection, 'effectiveType', { get: () => '4g' });
                Object.defineProperty(navigator.connection, 'downlink', { get: () => 10 });
                Object.defineProperty(navigator.connection, 'rtt', { get: () => 50 });
            }
            */

            // ═══ 10. WEBGL RENDERER (DISABLED FOR GOOGLE COMPATIBILITY) ═══
            /*
            const getParamOrig = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(param) {
                if (param === 37445) return 'Google Inc. (NVIDIA)';
                if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)';
                return getParamOrig.call(this, param);
            };
            if (typeof WebGL2RenderingContext !== 'undefined') {
                const getParam2Orig = WebGL2RenderingContext.prototype.getParameter;
                WebGL2RenderingContext.prototype.getParameter = function(param) {
                    if (param === 37445) return 'Google Inc. (NVIDIA)';
                    if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)';
                    return getParam2Orig.call(this, param);
                };
            }
            */

            // ═══ 11. CANVAS FINGERPRINT NOISE (DISABLED FOR GOOGLE COMPATIBILITY) ═══
            /*
            const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function(type) {
                const ctx = this.getContext('2d');
                if (ctx) {
                    const style = ctx.fillStyle;
                    ctx.fillStyle = 'rgba(0,0,1,0.01)';
                    ctx.fillRect(0, 0, 1, 1);
                    ctx.fillStyle = style;
                }
                return origToDataURL.apply(this, arguments);
            };
            */

            // ═══ 12. BATTERY API (hide) ═══
            if (navigator.getBattery) {
                navigator.getBattery = undefined;
            }

            // ═══ 13. IFRAME contentWindow BYPASS ═══
            try {
                Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
                    get: function() {
                        return new Proxy(Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow').get.call(this), {
                            get: (target, prop) => {
                                if (prop === 'chrome') return window.chrome;
                                return Reflect.get(target, prop);
                            }
                        });
                    }
                });
            } catch(e) {}
        `;

        // Inject anti-detection BEFORE page scripts run (dom-ready is too late for YouTube)
        view.webContents.on('did-start-navigation', (event, url, isInPlace, isMainFrame) => {
            if (isMainFrame) {
                view.webContents.executeJavaScript(antiFingerprintScript).catch(() => { });
            }
        });
        view.webContents.on('dom-ready', () => {
            view.webContents.executeJavaScript(antiFingerprintScript).catch(() => { });
        });

        view.webContents.on('found-in-page', (event, result) => {
            mainWindow.webContents.send('find-result', result);
        });

        view.webContents.on('page-favicon-updated', (event, favicons) => {
            if (favicons && favicons.length > 0) {
                mainWindow.webContents.send('favicon-updated', { id, favicon: favicons[0] });
            }
        });

        // ─── Loading State Indicators ───
        view.webContents.on('did-start-loading', () => {
            mainWindow.webContents.send('loading-update', { id, isLoading: true });
        });
        view.webContents.on('did-stop-loading', () => {
            mainWindow.webContents.send('loading-update', { id, isLoading: false });
        });

        view.webContents.on('context-menu', (event, params) => {
            const menu = new Menu();

            // 1. Link Handling
            if (params.linkURL) {
                menu.append(new MenuItem({
                    label: 'Open link in new tab',
                    click: () => mainWindow.webContents.send('request-new-tab', params.linkURL)
                }));
                menu.append(new MenuItem({
                    label: 'Copy link address',
                    click: () => {
                        const { clipboard } = require('electron');
                        clipboard.writeText(params.linkURL);
                    }
                }));
                menu.append(new MenuItem({
                    label: 'Save link as...',
                    click: () => view.webContents.downloadURL(params.linkURL)
                }));
                menu.append(new MenuItem({ type: 'separator' }));
            }

            // 2. Image Handling
            if (params.mediaType === 'image') {
                menu.append(new MenuItem({
                    label: 'Save image as...',
                    click: () => view.webContents.downloadURL(params.srcURL)
                }));
                menu.append(new MenuItem({
                    label: 'Copy image',
                    role: 'copyImage'
                }));
                menu.append(new MenuItem({
                    label: 'Copy image address',
                    click: () => {
                        const { clipboard } = require('electron');
                        clipboard.writeText(params.srcURL);
                    }
                }));
                menu.append(new MenuItem({ type: 'separator' }));
            }

            // 3. Text Selection Handling
            if (params.selectionText) {
                menu.append(new MenuItem({ role: 'copy', label: 'Copy' }));
                menu.append(new MenuItem({
                    label: `Search Google for "${params.selectionText.substring(0, 15)}${params.selectionText.length > 15 ? '...' : ''}"`,
                    click: () => {
                        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(params.selectionText)}`;
                        mainWindow.webContents.send('request-new-tab', searchUrl);
                    }
                }));
                menu.append(new MenuItem({ type: 'separator' }));
            }

            // 4. Default Page Functions (if clicking on background, etc.)
            if (!params.linkURL && params.mediaType === 'none' && !params.selectionText) {
                menu.append(new MenuItem({
                    label: 'Back',
                    enabled: view.webContents.canGoBack(),
                    click: () => view.webContents.goBack()
                }));
                menu.append(new MenuItem({
                    label: 'Forward',
                    enabled: view.webContents.canGoForward(),
                    click: () => view.webContents.goForward()
                }));
                menu.append(new MenuItem({
                    label: 'Reload',
                    click: () => view.webContents.reload()
                }));
                menu.append(new MenuItem({ type: 'separator' }));
                menu.append(new MenuItem({
                    label: 'Save page as...',
                    click: () => {
                        view.webContents.downloadURL(view.webContents.getURL());
                    }
                }));
                menu.append(new MenuItem({ type: 'separator' }));
            }

            // 5. Always allow pasting if in an editable field
            if (params.isEditable) {
                menu.append(new MenuItem({ role: 'paste', label: 'Paste' }));
                menu.append(new MenuItem({ type: 'separator' }));
            }

            // Developer tools
            menu.append(new MenuItem({ label: 'Inspect Element', click: () => view.webContents.inspectElement(params.x, params.y) }));
            menu.popup();
        });

        view.webContents.on('did-fail-load', (e, errorCode, errorDescription, validatedURL, isMainFrame) => {
            // Error -3 is ERR_ABORTED, which happens normally on swift user navigation
            if (!isMainFrame || errorCode === -3) return;
            console.error(`[#${instanceNumber}] Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);

            const errorHtml = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Site cannot be reached</title>
                    <style>
                        body {
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                            background-color: #f8f9fa;
                            color: #202124;
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            justify-content: center;
                            height: 100vh;
                            margin: 0;
                            text-align: center;
                            padding: 20px;
                        }
                        .container {
                            max-width: 500px;
                        }
                        .icon {
                            width: 64px;
                            height: 64px;
                            color: #5f6368;
                            margin-bottom: 24px;
                        }
                        h1 {
                            font-size: 24px;
                            font-weight: 400;
                            margin-bottom: 16px;
                            color: #202124;
                        }
                        p {
                            font-size: 15px;
                            color: #5f6368;
                            line-height: 1.5;
                            margin-bottom: 24px;
                        }
                        .url {
                            font-weight: 500;
                            word-break: break-all;
                        }
                        .error-code {
                            font-size: 12px;
                            color: #80868b;
                            text-transform: uppercase;
                            letter-spacing: 0.5px;
                        }
                        .button {
                            background-color: #1a73e8;
                            color: white;
                            border: none;
                            padding: 10px 24px;
                            border-radius: 4px;
                            font-weight: 500;
                            font-size: 14px;
                            cursor: pointer;
                            transition: background-color 0.2s;
                        }
                        .button:hover {
                            background-color: #1557b0;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                        </svg>
                        <h1>This site can't be reached</h1>
                        <p>The webpage at <span class="url">${validatedURL}</span> might be temporarily down or it may have moved permanently to a new web address.</p>
                        <button class="button" onclick="window.location.reload()">Reload</button>
                        <br><br>
                        <span class="error-code">${errorDescription} (${errorCode})</span>
                    </div>
                </body>
                </html>
            `;

            view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorHtml));
        });

        let targetUrl = url || 'https://google.com';
        if (targetUrl && !targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            targetUrl = `https://${targetUrl}`;
        }
        view.webContents.loadURL(targetUrl);

        // ─── Security: Block dangerous navigation ───
        view.webContents.on('will-navigate', (event, navUrl) => {
            if (navUrl.startsWith('file://') || navUrl.startsWith('javascript:') || navUrl.startsWith('data:')) {
                event.preventDefault();
            }
        });

        // Block opening new windows (popups) — open in same tab instead
        view.webContents.setWindowOpenHandler(({ url }) => {
            if (url.startsWith('http://') || url.startsWith('https://')) {
                view.webContents.loadURL(url);
            }
            return { action: 'deny' };
        });

    });

    // ─── Hide/Show active tab (for modals) ───
    ipcMain.on('hide-active-tab', () => {
        if (activeTabId && tabs.has(activeTabId)) {
            mainWindow.contentView.removeChildView(tabs.get(activeTabId));
        }
    });
    ipcMain.on('show-active-tab', () => {
        if (activeTabId && tabs.has(activeTabId)) {
            mainWindow.contentView.addChildView(tabs.get(activeTabId));
            updateContentViewBounds();
        }
    });

    ipcMain.on('switch-tab', (event, id) => {
        if (activeTabId && tabs.has(activeTabId)) {
            mainWindow.contentView.removeChildView(tabs.get(activeTabId));
        }
        activeTabId = id;
        const view = tabs.get(id);
        if (view) {
            mainWindow.contentView.addChildView(view);
            updateContentViewBounds();
        }
    });

    ipcMain.on('close-tab', (event, id) => {
        const view = tabs.get(id);
        if (view) {
            if (activeTabId === id) {
                mainWindow.contentView.removeChildView(view);
                activeTabId = null;
            }
            view.webContents.destroy();
            tabs.delete(id);
        }
    });

    ipcMain.on('navigate-to', (event, url) => {
        if (!activeTabId) return;
        const view = tabs.get(activeTabId);
        if (view) {
            let targetUrl = url;
            if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
                targetUrl = `https://${targetUrl}`;
            }
            view.webContents.loadURL(targetUrl);
        }
    });

    // ─── Find on Page (Chrome-style) ───
    ipcMain.on('find-in-page', (event, { text, options }) => {
        if (!activeTabId) return;
        const view = tabs.get(activeTabId);
        if (view) {
            const requestId = view.webContents.findInPage(text, options || {});
        }
    });

    ipcMain.on('stop-find-in-page', (event, { action }) => {
        if (!activeTabId) return;
        const view = tabs.get(activeTabId);
        if (view) {
            view.webContents.stopFindInPage(action || 'clearSelection');
        }
    });

    // Load shell UI
    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL('http://localhost:3000');
    } else {
        mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
    }

    // Block all connections on startup (no proxy = no network)
    await session.defaultSession.setProxy({ proxyRules: 'http://0.0.0.0:1' });
    console.log(`[#${instanceNumber}] Startup: network blocked until proxy configured.`);

    // ─── Security: Permission request handler ───
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = ['clipboard-read', 'clipboard-sanitized-write', 'media', 'fullscreen'];
        if (allowedPermissions.includes(permission)) {
            callback(true);
        } else {
            console.log(`[#${instanceNumber}] Blocked permission request: ${permission}`);
            callback(false);
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        tabs.forEach(v => v.webContents.destroy());
        tabs.clear();
    });
}

app.whenReady().then(async () => {
    // Ensure clean start: clear all storage data on launch
    await session.defaultSession.clearStorageData();
    console.log(`[#${instanceNumber}] Startup: Session data cleared.`);

    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    cleanupLock();
    if (process.platform !== 'darwin') app.quit();
});
