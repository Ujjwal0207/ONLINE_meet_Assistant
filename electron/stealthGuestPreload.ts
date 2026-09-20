/**
 * Stealth Guest Preload Script
 * Runs in the guest webview / OAuth popup before any website scripts execute.
 * Masks Electron and aligns the DOM fingerprint with genuine Google Chrome / Brave.
 */

(function () {
  const CHROME_VERSION = '131.0.6778.265';
  const CHROME_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' +
    CHROME_VERSION +
    ' Safari/537.36';

  const brands = [
    { brand: 'Google Chrome', version: '131' },
    { brand: 'Chromium', version: '131' },
    { brand: 'Not_A Brand', version: '24' },
  ];

  const fullVersionList = [
    { brand: 'Google Chrome', version: CHROME_VERSION },
    { brand: 'Chromium', version: CHROME_VERSION },
    { brand: 'Not_A Brand', version: '24.0.0.0' },
  ];

  const highEntropyValues = {
    architecture: 'arm',
    bitness: '64',
    brands: brands,
    mobile: false,
    model: '',
    platform: 'macOS',
    platformVersion: '15.2.0',
    uaFullVersion: CHROME_VERSION,
    fullVersionList: fullVersionList,
  };

  const uaData = {
    brands: brands,
    mobile: false,
    platform: 'macOS',
    getHighEntropyValues: function (hints: string[]) {
      return Promise.resolve(highEntropyValues);
    },
    toJSON: function () {
      return {
        brands: brands,
        mobile: false,
        platform: 'macOS',
      };
    },
  };

  function applyStealth(win: any) {
    try {
      if (!win) return;

      // 1. Mask navigator.webdriver to boolean false (genuine unautomated Chrome)
      try {
        if (win.navigator) {
          const navProto = Object.getPrototypeOf(win.navigator);
          if (navProto) {
            Object.defineProperty(navProto, 'webdriver', {
              get: () => false,
              configurable: true,
              enumerable: true,
            });
          }
          Object.defineProperty(win.navigator, 'webdriver', {
            get: () => false,
            configurable: true,
            enumerable: true,
          });
        }
      } catch (e) {}

      // 2. Align navigator.userAgent & appVersion
      try {
        if (win.navigator) {
          Object.defineProperty(win.navigator, 'userAgent', {
            get: () => CHROME_UA,
            configurable: true,
            enumerable: true,
          });
          Object.defineProperty(win.navigator, 'appVersion', {
            get: () => CHROME_UA.replace(/^Mozilla\//, ''),
            configurable: true,
            enumerable: true,
          });
        }
      } catch (e) {}

      // 3. Genuine Chrome navigator.userAgentData
      try {
        if (win.navigator) {
          Object.defineProperty(win.navigator, 'userAgentData', {
            get: () => uaData,
            configurable: true,
            enumerable: true,
          });
        }
      } catch (e) {}

      // 4. Ensure window.chrome exists with legitimate Chrome sub-properties
      try {
        if (!win.chrome) {
          win.chrome = {};
        }
        if (!win.chrome.app) {
          win.chrome.app = {
            isInstalled: false,
            InstallState: {
              DISABLED: 'disabled',
              INSTALLED: 'installed',
              NOT_INSTALLED: 'not_installed',
            },
            RunningState: {
              CANNOT_RUN: 'cannot_run',
              READY_TO_RUN: 'ready_to_run',
              RUNNING: 'running',
            },
            getDetails: function (): any {
              return null;
            },
            getIsInstalled: function (): boolean {
              return false;
            },
            runningState: function (): string {
              return 'cannot_run';
            },
          };
        }
        if (!win.chrome.runtime) {
          win.chrome.runtime = {
            id: undefined,
            connect: function () {},
            sendMessage: function () {},
            onMessage: {
              addListener: function () {},
              removeListener: function () {},
              hasListener: function () {
                return false;
              },
            },
          };
        }
        if (!win.chrome.loadTimes) {
          win.chrome.loadTimes = function () {
            const now = Date.now() / 1000;
            return {
              requestTime: now - 0.15,
              startLoadTime: now - 0.12,
              commitLoadTime: now - 0.08,
              finishDocumentLoadTime: now,
              finishLoadTime: now,
              firstPaintTime: now,
              firstPaintAfterLoadTime: 0,
              navigationType: 'Other',
              wasFetchedViaSpdy: true,
              wasNpnNegotiated: true,
              npnNegotiatedProtocol: 'h2',
              wasAlternateProtocolAvailable: false,
              connectionInfo: 'h2',
            };
          };
        }
        if (!win.chrome.csi) {
          win.chrome.csi = function () {
            return {
              startE: Date.now() - 250,
              onloadT: Date.now(),
              pageT: 120,
              tran: 15,
            };
          };
        }
      } catch (e) {}

      // 5. Clean up any accidental node or electron leaks
      try {
        delete win.process;
        delete win.Buffer;
        delete win.setImmediate;
        delete win.clearImmediate;
        delete win.__electron;
      } catch (e) {}
    } catch (e) {}
  }

  // Apply to current preload environment
  applyStealth(window);

  // Also inject script element directly into document head/root for main-world evaluation
  try {
    const code = `(${applyStealth.toString()})(window);`;
    const script = document.createElement('script');
    script.textContent = code;
    (document.head || document.documentElement || document).appendChild(script);
    script.remove();
  } catch (e) {}
})();
