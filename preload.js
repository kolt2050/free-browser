const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getEnvProxy: () => ipcRenderer.invoke('get-env-proxy'),
    getInstanceNumber: () => ipcRenderer.invoke('get-instance-number'),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    sendNavigation: (url) => ipcRenderer.send('navigate-to', url),
    createTab: (id, url) => ipcRenderer.send('create-tab', { id, url }),
    switchTab: (id) => ipcRenderer.send('switch-tab', id),
    closeTab: (id) => ipcRenderer.send('close-tab', id),
    openLogs: () => ipcRenderer.send('open-logs'),
    openTracker: () => ipcRenderer.send('open-tracker'),
    openCookies: () => ipcRenderer.send('open-cookies'),
    clearSessionData: () => ipcRenderer.invoke('clear-session-data'),
    setProxy: (config) => ipcRenderer.invoke('set-proxy', { config }),
    applyLocale: (profile) => ipcRenderer.send('apply-locale', { profile }),
    disconnectProxy: () => ipcRenderer.send('disconnect-proxy'),
    openExternal: (url) => ipcRenderer.send('open-external', url),
    findInPage: (text, options) => ipcRenderer.send('find-in-page', { text, options }),
    stopFindInPage: (action) => ipcRenderer.send('stop-find-in-page', { action }),
    onFindResult: (callback) => {
        const listener = (event, result) => callback(result);
        ipcRenderer.on('find-result', listener);
        return () => ipcRenderer.removeListener('find-result', listener);
    },
    goBack: () => ipcRenderer.send('go-back'),
    goForward: () => ipcRenderer.send('go-forward'),
    reload: () => ipcRenderer.send('reload'),
    onFaviconUpdate: (callback) => {
        const listener = (event, data) => callback(data);
        ipcRenderer.on('favicon-updated', listener);
        return () => ipcRenderer.removeListener('favicon-updated', listener);
    },
    onDownloadUpdate: (callback) => {
        const listener = (event, data) => callback(data);
        ipcRenderer.on('download-progress', listener);
        return () => ipcRenderer.removeListener('download-progress', listener);
    },
    onRequestNewTab: (callback) => {
        const listener = (event, url) => callback(url);
        ipcRenderer.on('request-new-tab', listener);
        return () => ipcRenderer.removeListener('request-new-tab', listener);
    },
    onToggleFind: (callback) => {
        const listener = () => callback();
        ipcRenderer.on('toggle-find', listener);
        return () => ipcRenderer.removeListener('toggle-find', listener);
    },
    showMainMenu: () => ipcRenderer.send('show-main-menu'),
    onMenuAction: (callback) => {
        const listener = (event, action) => callback(action);
        ipcRenderer.on('menu-action', listener);
        return () => ipcRenderer.removeListener('menu-action', listener);
    },
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    hideActiveTab: () => ipcRenderer.send('hide-active-tab'),
    showActiveTab: () => ipcRenderer.send('show-active-tab'),
    onLoadingUpdate: (callback) => {
        const listener = (event, data) => callback(data);
        ipcRenderer.on('loading-update', listener);
        return () => ipcRenderer.removeListener('loading-update', listener);
    }
});
