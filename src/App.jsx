import React, { useState, useEffect } from 'react';

const LOCALE_PROFILES = {
    US: { label: 'United States', lang: 'en-US', tz: 'America/New_York', offset: 300 },
    UK: { label: 'United Kingdom', lang: 'en-GB', tz: 'Europe/London', offset: 0 },
    DE: { label: 'Germany', lang: 'de-DE', tz: 'Europe/Berlin', offset: -60 },
    FR: { label: 'France', lang: 'fr-FR', tz: 'Europe/Paris', offset: -60 },
    CA: { label: 'Canada', lang: 'en-CA', tz: 'America/Toronto', offset: 300 },
    NL: { label: 'Netherlands', lang: 'nl-NL', tz: 'Europe/Amsterdam', offset: -60 },
    JP: { label: 'Japan', lang: 'ja-JP', tz: 'Asia/Tokyo', offset: -540 },
    AU: { label: 'Australia', lang: 'en-AU', tz: 'Australia/Sydney', offset: -660 },
    BR: { label: 'Brazil', lang: 'pt-BR', tz: 'America/Sao_Paulo', offset: 180 },
    IN: { label: 'India', lang: 'hi-IN', tz: 'Asia/Kolkata', offset: -330 },
};

function App() {
    const [instanceNum, setInstanceNum] = useState('');
    const [appVersion, setAppVersion] = useState('');
    const [proxyConnected, setProxyConnected] = useState(false);
    const [proxyInput, setProxyInput] = useState('');
    const [selectedLocale, setSelectedLocale] = useState('US');
    const [proxyError, setProxyError] = useState('');
    const [connecting, setConnecting] = useState(false);
    const [showProxyModal, setShowProxyModal] = useState(false);
    const [detectedCountry, setDetectedCountry] = useState('');

    const [tabs, setTabs] = useState([]);
    const [activeTabId, setActiveTabId] = useState(null);
    const [inputUrl, setInputUrl] = useState('');

    const [findText, setFindText] = useState('');
    const [findResult, setFindResult] = useState({ activeMatch: 0, matches: 0 });

    const [downloads, setDownloads] = useState([]);
    const [showDownloads, setShowDownloads] = useState(false);

    // Fetch instance number and auto-fill proxy from .env
    useEffect(() => {
        if (window.electronAPI?.getInstanceNumber) {
            window.electronAPI.getInstanceNumber().then(n => setInstanceNum(n));
        }
        if (window.electronAPI?.getAppVersion) {
            window.electronAPI.getAppVersion().then(v => setAppVersion(v));
        }
        if (window.electronAPI?.getEnvProxy) {
            window.electronAPI.getEnvProxy().then(envProxy => {
                if (envProxy && !proxyConnected) {
                    setProxyInput(envProxy);
                }
            });
        }

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                setShowFindBar(false);
            }
        };

        // Register global toggle function for Ctrl+F to simply focus the input
        window.__toggleFind = () => {
            const searchInput = document.getElementById('find-in-page-input');
            if (searchInput) {
                setTimeout(() => {
                    searchInput.focus();
                    searchInput.select();
                }, 50);
            }
        };

        let offFindResult, offFavicon, offDownload, offNewTab, offMenuAction, offLoadingUpdate;

        if (window.electronAPI?.onLoadingUpdate) {
            offLoadingUpdate = window.electronAPI.onLoadingUpdate(({ id, isLoading }) => {
                setTabs(prev => prev.map(t => t.id === id ? { ...t, isLoading } : t));
            });
        }

        if (window.electronAPI?.onFindResult) {
            offFindResult = window.electronAPI.onFindResult((result) => {
                setFindResult({
                    activeMatch: result.activeMatchOrdinal,
                    matches: result.matches
                });
            });
        }

        if (window.electronAPI?.onFaviconUpdate) {
            offFavicon = window.electronAPI.onFaviconUpdate(({ id, favicon }) => {
                setTabs(prev => prev.map(t => t.id === id ? { ...t, favicon } : t));
            });
        }

        if (window.electronAPI?.onDownloadUpdate) {
            offDownload = window.electronAPI.onDownloadUpdate((data) => {
                setDownloads(prev => {
                    const existing = prev.find(d => d.id === data.id);
                    if (existing) {
                        return prev.map(d => d.id === data.id ? { ...d, ...data } : d);
                    }
                    return [data, ...prev];
                });
                setShowDownloads(true);
                window.electronAPI?.hideActiveTab?.();
            });
        }

        if (window.electronAPI?.onRequestNewTab) {
            offNewTab = window.electronAPI.onRequestNewTab((url) => {
                const newId = Date.now();
                const newTab = { id: newId, url, title: 'New Tab' };
                setTabs(prev => [...prev, newTab]);
                if (window.electronAPI?.createTab) {
                    window.electronAPI.createTab(newId, url);
                }
            });
        }

        if (window.electronAPI?.onMenuAction) {
            offMenuAction = window.electronAPI.onMenuAction((action) => {
                switch (action) {
                    case 'proxy':
                        setShowProxyModal(true);
                        window.electronAPI?.hideActiveTab?.();
                        break;
                    case 'tracker':
                        window.electronAPI?.openTracker?.();
                        break;
                    case 'logs':
                        window.electronAPI?.openLogs?.();
                        break;
                    case 'downloads':
                        setShowDownloads(true);
                        window.electronAPI?.hideActiveTab?.();
                        break;
                    case 'cookies':
                        window.electronAPI?.openCookies?.();
                        break;
                    case 'clear':
                        if (confirm('Clear all session data (cookies, cache, storage)?')) {
                            window.electronAPI?.clearSessionData?.();
                        }
                        break;
                    case 'disconnect':
                        handleDisconnect();
                        break;
                }
            });
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            delete window.__toggleFind;
            offFindResult?.();
            offFavicon?.();
            offDownload?.();
            offNewTab?.();
            offMenuAction?.();
            offLoadingUpdate?.();
        };
    }, [proxyConnected]);

    const handleFind = (text, forward = true, findNext = false) => {
        if (!text) {
            if (window.electronAPI?.stopFindInPage) window.electronAPI.stopFindInPage('clearSelection');
            setFindResult({ activeMatch: 0, matches: 0 });
            return;
        }
        if (window.electronAPI?.findInPage) {
            window.electronAPI.findInPage(text, { forward, findNext });
        }
    };

    const handleClearFind = () => {
        setFindText('');
        if (window.electronAPI?.stopFindInPage) window.electronAPI.stopFindInPage('clearSelection');
        setFindResult({ activeMatch: 0, matches: 0 });
    };

    // Find best locale profile for a country code
    const findLocaleForCountry = (countryCode) => {
        // Direct match
        if (LOCALE_PROFILES[countryCode]) return countryCode;
        // Common mappings for countries not directly in our list
        const mapping = { 'GB': 'UK', 'IE': 'UK', 'NZ': 'AU', 'AT': 'DE', 'CH': 'DE', 'BE': 'NL', 'PT': 'BR', 'MX': 'US', 'AR': 'BR' };
        if (mapping[countryCode]) return mapping[countryCode];
        return 'US'; // fallback
    };

    const handleConnectProxy = async (e) => {
        e.preventDefault();
        const raw = proxyInput.trim();

        // Strict Validation: Ensure it matches ipv4:port or ipv4:port:user:pass
        const proxyRegex = /^(\d{1,3}\.){3}\d{1,3}:\d{1,5}(:[^:\s]+:[^:\s]+)?$/;

        if (!raw || !proxyRegex.test(raw)) {
            setProxyError('Enter proxy in format: ip:port or ip:port:user:pass');
            return;
        }
        setProxyError('');
        setConnecting(true);

        try {
            // Connect proxy and auto-detect country
            const result = await window.electronAPI?.setProxy(raw);
            const country = result?.detectedCountry || 'US';
            const localeKey = findLocaleForCountry(country);

            setDetectedCountry(country);
            setSelectedLocale(localeKey);

            // Apply the locale profile
            const profile = LOCALE_PROFILES[localeKey];
            if (window.electronAPI?.applyLocale) {
                window.electronAPI.applyLocale(profile);
            }

            setProxyConnected(true);
            setConnecting(false);

            // Create first tab
            const firstId = Date.now();
            const firstTab = { id: firstId, url: 'https://google.com', title: 'New Tab' };
            setTabs([firstTab]);
            setActiveTabId(firstId);

            if (window.electronAPI?.createTab) {
                window.electronAPI.createTab(firstId, firstTab.url);
                window.electronAPI.switchTab(firstId);
            }
        } catch (err) {
            setProxyError('Failed to connect: ' + (err.message || 'Unknown error'));
            setConnecting(false);
        }
    };

    const handleDisconnect = () => {
        if (window.electronAPI?.disconnectProxy) {
            window.electronAPI.disconnectProxy();
        }
        // Close all tabs
        tabs.forEach(t => {
            if (window.electronAPI?.closeTab) window.electronAPI.closeTab(t.id);
        });
        setTabs([]);
        setActiveTabId(null);
        setProxyConnected(false);
        setProxyInput('');
        setProxyError('');
    };

    const handleNavigate = (e) => {
        e.preventDefault();
        let newUrl = inputUrl.trim();
        if (!newUrl) return;

        // Omnibox Logic: Is it a search query or a true URL?
        // It's a URL if it has no spaces AND contains a dot (e.g., github.com) OR starts with http/localhost.
        const isUrl = !newUrl.includes(' ') && (newUrl.includes('.') || newUrl.startsWith('http://') || newUrl.startsWith('localhost'));

        if (isUrl) {
            if (!newUrl.startsWith('http://') && !newUrl.startsWith('https://')) {
                newUrl = `https://${newUrl}`;
            }
        } else {
            // It's a search query, format it for Google
            newUrl = `https://www.google.com/search?q=${encodeURIComponent(newUrl)}`;
        }
        setTabs(tabs.map(t => t.id === activeTabId ? { ...t, url: newUrl } : t));
        if (window.electronAPI?.sendNavigation) {
            window.electronAPI.sendNavigation(newUrl);
        }
    };

    const createTab = () => {
        const newId = Date.now();
        const newTab = { id: newId, url: 'https://google.com', title: 'New Tab' };
        setTabs(prev => [...prev, newTab]);
        setActiveTabId(newId);
        setInputUrl('');
        if (window.electronAPI?.createTab) {
            window.electronAPI.createTab(newId, newTab.url);
            window.electronAPI.switchTab(newId);
        }
    };

    const switchTab = (id) => {
        setActiveTabId(id);
        const tab = tabs.find(t => t.id === id);
        setInputUrl(tab?.url === 'https://google.com' ? '' : (tab?.url || ''));
        if (window.electronAPI?.switchTab) window.electronAPI.switchTab(id);
    };

    const closeTab = (e, id) => {
        e.stopPropagation();
        if (tabs.length === 1) return;
        const newTabs = tabs.filter(t => t.id !== id);
        setTabs(newTabs);
        if (activeTabId === id) {
            const lastTab = newTabs[newTabs.length - 1];
            switchTab(lastTab.id);
        }
        if (window.electronAPI?.closeTab) window.electronAPI.closeTab(id);
    };

    // ─── Proxy Setup Screen ───
    if (!proxyConnected) {
        return (
            <div className="flex flex-col h-screen overflow-hidden bg-gray-50">
                <div className="h-10 flex items-center justify-between px-4 bg-gray-200 select-none drag border-b border-gray-300" style={{ WebkitAppRegion: 'drag' }}>
                    <span className="text-xs font-semibold tracking-widest text-blue-600 opacity-80">FREE-BROWSER {instanceNum ? `#${instanceNum}` : ''} <span className="text-[9px] text-gray-400 font-normal ml-1">v{appVersion}</span></span>
                    <div className="flex gap-2 items-center no-drag" style={{ WebkitAppRegion: 'no-drag' }}>
                        <button onClick={() => window.electronAPI?.minimize?.()} className="w-3 h-3 rounded-full bg-yellow-400 hover:bg-yellow-500 shadow-sm"></button>
                        <button onClick={() => window.electronAPI?.close?.()} className="w-3 h-3 rounded-full bg-red-400 hover:bg-red-500 shadow-sm" title="Exit browser"></button>
                    </div>
                </div>

                <div className="flex-1 flex items-center justify-center">
                    <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 w-full max-w-md">
                        <div className="text-center mb-6">
                            <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                            </div>
                            <h2 className="text-xl font-bold text-gray-800">Proxy Required</h2>
                            <p className="text-sm text-gray-500 mt-1">Country and locale will be auto-detected from your proxy.</p>
                        </div>

                        <form onSubmit={handleConnectProxy} className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Proxy Address</label>
                                <div className="relative group">
                                    <input
                                        type="text"
                                        value={proxyInput}
                                        onChange={(e) => setProxyInput(e.target.value)}
                                        placeholder="ip:port:user:pass"
                                        className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 pr-16 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all text-gray-800 placeholder:text-gray-400"
                                        autoFocus
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const ip = proxyInput.split(':')[0];
                                            if (ip) window.electronAPI.openExternal(`https://scamalytics.com/ip/${ip}`);
                                        }}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-white hover:bg-gray-100 border border-gray-300 rounded text-[10px] font-bold text-gray-600 transition-colors shadow-sm"
                                        title="Check IP quality on Scamalytics"
                                    >
                                        CHECK
                                    </button>
                                </div>
                            </div>

                            {proxyError && (
                                <p className="text-xs text-red-500 font-medium">{proxyError}</p>
                            )}

                            <button
                                type="submit"
                                disabled={connecting}
                                className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold py-2.5 rounded-lg transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {connecting ? 'Detecting country...' : 'Connect'}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        );
    }

    // ─── Main Browser UI ───
    const currentProfile = LOCALE_PROFILES[selectedLocale];

    return (
        <div className="flex flex-col h-screen overflow-hidden bg-gray-100">
            {/* Custom Title Bar Area */}
            <div className="h-10 flex items-center px-4 bg-gray-200 select-none drag border-b border-gray-300" style={{ WebkitAppRegion: 'drag' }}>
                <span className="text-xs font-semibold tracking-widest text-blue-600 opacity-80">FREE-BROWSER {instanceNum ? `#${instanceNum}` : ''} <span className="text-[9px] text-gray-400 font-normal ml-1">v{appVersion}</span></span>
            </div>

            {/* Tab Bar */}
            <div className="flex items-center gap-1 px-2 bg-gray-200 no-drag border-b border-gray-300 h-9" style={{ WebkitAppRegion: 'no-drag' }}>
                {tabs.map((tab) => (
                    <div
                        key={tab.id}
                        onClick={() => switchTab(tab.id)}
                        className={`group relative flex items-center gap-2 px-4 py-1.5 min-w-[120px] max-w-[200px] rounded-t-lg cursor-default transition-all duration-200 text-xs font-medium ${activeTabId === tab.id
                            ? 'bg-white text-blue-600 border-t border-x border-gray-300 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]'
                            : 'text-gray-500 hover:bg-gray-300 hover:text-gray-700'
                            }`}
                    >
                        {tab.isLoading ? (
                            <svg className="w-3.5 h-3.5 animate-spin text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                        ) : tab.favicon ? (
                            <img src={tab.favicon} className="w-3.5 h-3.5" alt="" />
                        ) : (
                            <div className="w-3.5 h-3.5 rounded bg-gray-200 flex-shrink-0"></div>
                        )}
                        <span className="truncate flex-1">{tab.url ? tab.url.replace('https://', '').replace('http://', '') : 'New Tab'}</span>
                        <button
                            onClick={(e) => closeTab(e, tab.id)}
                            className={`opacity-0 group-hover:opacity-100 hover:bg-red-100 hover:text-red-500 p-0.5 rounded transition-all ${activeTabId === tab.id ? 'opacity-40 text-gray-400' : ''}`}
                        >
                            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                ))}
                <button onClick={createTab} className="p-1.5 ml-1 rounded-full text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-all">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                    </svg>
                </button>
            </div>

            {/* Toolbar */}
            <div className="flex items-center gap-3 p-3 bg-white border-b border-gray-300 no-drag shadow-sm" style={{ WebkitAppRegion: 'no-drag' }}>
                <div className="flex gap-2 mr-2 no-drag cursor-pointer" style={{ WebkitAppRegion: 'no-drag' }}>
                    <button onClick={() => window.electronAPI?.close?.()} className="w-3 h-3 rounded-full bg-red-400 hover:bg-red-500 focus:outline-none shadow-sm"></button>
                    <button onClick={() => window.electronAPI?.minimize?.()} className="w-3 h-3 rounded-full bg-yellow-400 hover:bg-yellow-500 focus:outline-none shadow-sm"></button>
                    <button onClick={() => window.electronAPI?.maximize?.()} className="w-3 h-3 rounded-full bg-green-400 hover:bg-green-500 focus:outline-none shadow-sm"></button>
                </div>

                <div className="flex items-center gap-1.5 px-1 mr-1">
                    <button
                        onClick={() => window.electronAPI?.goBack?.()}
                        className="p-1.5 hover:bg-gray-100 rounded-full text-gray-600 transition-colors"
                        title="Go Back"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <button
                        onClick={() => window.electronAPI?.goForward?.()}
                        className="p-1.5 hover:bg-gray-100 rounded-full text-gray-600 transition-colors"
                        title="Go Forward"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
                        </svg>
                    </button>
                    <button
                        onClick={() => window.electronAPI?.reload?.()}
                        className="p-1.5 hover:bg-gray-100 rounded-full text-gray-600 transition-colors"
                        title="Reload Page"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                </div>

                <form onSubmit={handleNavigate} className="flex-1 max-w-[60%]">
                    <input
                        type="text"
                        value={inputUrl}
                        onChange={(e) => setInputUrl(e.target.value)}
                        placeholder="Search or enter address"
                        className="w-full bg-gray-100 border border-gray-200 rounded-full py-1.5 px-5 text-sm outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all text-gray-800 placeholder:text-gray-400 shadow-inner"
                    />
                </form>

                {/* Persistent Find Bar */}
                <div className="flex-1 max-w-[250px] flex items-center bg-gray-100 border border-gray-200 focus-within:border-blue-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100 rounded-full px-3 py-1 shadow-inner transition-all">
                    <svg className="w-3.5 h-3.5 text-gray-400 mr-1.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        id="find-in-page-input"
                        type="text"
                        placeholder="Find in page..."
                        className="bg-transparent border-none outline-none text-[11px] w-full py-0.5 text-gray-700 placeholder:text-gray-400"
                        value={findText}
                        onChange={(e) => {
                            setFindText(e.target.value);
                            handleFind(e.target.value);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleFind(findText, !e.shiftKey, true);
                            if (e.key === 'Escape') {
                                handleClearFind();
                                e.target.blur();
                            }
                        }}
                    />
                    {findText && (
                        <div className="flex items-center gap-1.5 ml-1">
                            <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">
                                {findResult.matches > 0 ? `${findResult.activeMatch}/${findResult.matches}` : '0/0'}
                            </span>
                            <div className="flex items-center">
                                <button onClick={() => handleFind(findText, false, true)} className="text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded p-0.5" title="Previous">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" /></svg>
                                </button>
                                <button onClick={() => handleFind(findText, true, true)} className="text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded p-0.5" title="Next">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                                </button>
                            </div>
                            <button onClick={handleClearFind} className="text-gray-400 hover:text-red-500 hover:bg-red-50 rounded p-0.5 ml-0.5" title="Clear">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                        onClick={() => {
                            setShowProxyModal(true);
                            window.electronAPI?.hideActiveTab?.();
                        }}
                        title="Proxy Settings"
                        className="flex items-center gap-2 px-3 py-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 hover:border-blue-300 rounded-full shadow-sm mr-1 transition-colors cursor-pointer outline-none"
                    >
                        <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                        <span className="text-[10px] uppercase tracking-tighter text-blue-700 font-bold">{detectedCountry || selectedLocale} · {currentProfile.label}</span>
                    </button>

                    <div className="relative">
                        <button
                            onClick={() => window.electronAPI?.showMainMenu?.()}
                            className="p-1.5 rounded-full transition-all duration-200 hover:bg-gray-100 text-gray-600"
                            title="Menu"
                        >
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            {/* Downloads Overlay */}
            {showDownloads && (
                <div className="fixed top-28 right-4 w-72 bg-white rounded-xl shadow-2xl border border-gray-200 z-[999] animate-in fade-in slide-in-from-right-4 duration-200 no-drag" style={{ WebkitAppRegion: 'no-drag' }}>
                    <div className="flex justify-between items-center p-3 border-b border-gray-100">
                        <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Downloads</h4>
                        <button onClick={() => { setShowDownloads(false); window.electronAPI?.showActiveTab?.(); }} className="text-gray-400 hover:text-gray-600">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    <div className="max-h-80 overflow-y-auto p-2 space-y-2">
                        {downloads.length === 0 ? (
                            <div className="text-center py-8 text-gray-400 text-xs italic">No downloads yet</div>
                        ) : (
                            downloads.map(d => (
                                <div key={d.id} className="p-2.5 bg-gray-50 rounded-lg border border-gray-100 text-xs">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="font-semibold text-gray-800 truncate flex-1 mr-2">{d.fileName}</span>
                                        <button onClick={() => setDownloads(prev => prev.filter(item => item.id !== d.id))} className="text-gray-300 hover:text-red-400 transition-colors">
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                    {d.status === 'progressing' ? (
                                        <div className="space-y-1.5">
                                            <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                                                <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${(d.received / d.total) * 100}%` }}></div>
                                            </div>
                                            <div className="flex justify-between text-[10px] text-gray-500 font-medium">
                                                <span>{(d.received / 1024 / 1024).toFixed(1)} MB / {(d.total / 1024 / 1024).toFixed(1)} MB</span>
                                                <span>{Math.round((d.received / d.total) * 100)}%</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className={`flex items-center gap-1.5 font-bold ${d.status === 'completed' ? 'text-green-600' : 'text-red-500'}`}>
                                            <div className={`w-1.5 h-1.5 rounded-full ${d.status === 'completed' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                                            <span className="uppercase text-[9px] tracking-widest">{d.status}</span>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* Content Area placeholder */}
            <div className="flex-1 bg-white"></div>
            {/* Proxy Update Modal */}
            {showProxyModal && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm no-drag" style={{ WebkitAppRegion: 'no-drag' }}>
                    <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 p-6 w-full max-w-sm animate-in fade-in zoom-in duration-200">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-gray-800 text-lg">Proxy Settings</h3>
                            <button onClick={() => { setShowProxyModal(false); setProxyError(''); window.electronAPI?.showActiveTab?.(); }} className="text-gray-400 hover:text-gray-600 transition-colors">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <form onSubmit={async (e) => {
                            e.preventDefault();
                            const raw = proxyInput.trim();
                            const proxyRegex = /^(\d{1,3}\.){3}\d{1,3}:\d{1,5}(:[^:\s]+:[^:\s]+)?$/;

                            if (!raw || !proxyRegex.test(raw)) {
                                setProxyError('Enter proxy in format: ip:port or ip:port:user:pass');
                                return;
                            }

                            setConnecting(true);
                            try {
                                const result = await window.electronAPI?.setProxy(raw);
                                const country = result?.detectedCountry || 'US';
                                const localeKey = findLocaleForCountry(country);
                                setDetectedCountry(country);
                                setSelectedLocale(localeKey);
                                const profile = LOCALE_PROFILES[localeKey];
                                if (window.electronAPI?.applyLocale) window.electronAPI.applyLocale(profile);
                            } catch (err) {
                                setProxyError(err.message || 'Failed');
                            }
                            setConnecting(false);
                            setShowProxyModal(false);
                            window.electronAPI?.showActiveTab?.();
                        }} className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Proxy Address</label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={proxyInput}
                                        onChange={(e) => setProxyInput(e.target.value)}
                                        placeholder="ip:port:user:pass"
                                        className="w-full px-3 py-2 pr-16 bg-gray-50 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const ip = proxyInput.split(':')[0];
                                            if (ip) window.electronAPI.openExternal(`https://scamalytics.com/ip/${ip}`);
                                        }}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-white hover:bg-gray-100 border border-gray-300 rounded text-[10px] font-bold text-gray-600 transition-colors shadow-sm"
                                        title="Check IP quality on Scamalytics"
                                    >
                                        CHECK
                                    </button>
                                </div>
                            </div>


                            {proxyError && <p className="text-red-500 text-xs font-medium bg-red-50 p-2 rounded-lg">{proxyError}</p>}

                            <button
                                type="submit"
                                disabled={connecting}
                                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-blue-200 transition-all active:scale-[0.98] disabled:opacity-50"
                            >
                                {connecting ? 'Detecting...' : 'Apply Changes'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
