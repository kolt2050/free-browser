# Free Browser

**Free Browser** is a specialized Electron-based browser designed to provide maximum isolation for working environments.

## Disclaimer and Legal Information

**This software is intended exclusively for educational purposes, web interface testing, and ensuring privacy within the framework of applicable laws.**

*   The developers do not encourage or support the use of this tool for committing illegal acts.
*   The use of proxy servers and isolation mechanisms must be carried out in strict accordance with the laws of your jurisdiction and the Terms of Service of the visited resources.
*   The user bears full individual responsibility for any actions performed using this software.

## Key Features

*   **Session Isolation and Multi-Instance**: Run multiple completely independent browser instances. Each process has its own isolated data folder (`userData`).
*   **Auto-Cleanup on Startup**: The browser always starts completely clean. Cookies, cache, and local storage are forcefully deleted on every startup.
*   **Auto-Country Detection**: When connecting a proxy, the browser automatically detects the country (GeoIP) and configures the locale, timezone, and language.
*   **Dynamic Proxy Configuration**: Manage network connections through an interface with authorization support.
*   **Safe Start & Kill Switch**: Complete block of network activity until the configuration is confirmed by the user. If the proxy connection drops or fails, all connections are instantly terminated to prevent traffic leakage.
*   **Strict System Isolation**: The browser does not pull any configuration, data, or settings from the host operating system.
*   **Compatibility and Rendering Technologies**:
    *   **User-Agent** spoofing to match modern standards (Chrome 120).
    *   Synchronization of timezones and locales with proxy parameters.
    *   Protection against Canvas, WebGL, and WebRTC fingerprinting.
    *   Blocking automatic translations and pop-ups.

## Control Tools and UI
*   **Radar (Tracker)**: Real-time monitoring of resources and trackers requested by the page.
*   **🍪 Cookies (Cookie Viewer)**: Viewing and searching session cookies. Grouping by domains.
    *   🔒 (**Secure**): Transmitted only over HTTPS.
    *   **H** (**HttpOnly**): Inaccessible to JS (session hijacking protection).
    *   **S** (**Session**): Temporary cookie for the current session.
*   **Logs**: Advanced network events log with color differentiation of HTTP statuses (200, 404, 500) and a convenient dropdown filter by levels (All, Success, Warning, Error).
*   **Clear**: Button for instant manual clearing of all session data (Cookies, Cache, Storage) in one click.


## Build and Run

### Installation
```bash
npm install
```

### Build
```bash
npm run build
```
The executable file will be available in the `release/` directory.
