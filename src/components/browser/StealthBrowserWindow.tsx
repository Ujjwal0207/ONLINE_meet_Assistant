import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Globe,
  Camera,
  Crop,
  Clipboard,
  Shield,
  X,
  ExternalLink,
  Check,
  Sparkles,
  Lock
} from 'lucide-react';
import { isMac } from '../../utils/platformUtils';

const PRESETS = [
  {
    name: 'ChatGPT',
    url: 'https://chatgpt.com',
    color: 'from-emerald-500/20 to-teal-500/20',
    border: 'border-emerald-500/30 hover:border-emerald-500/60',
    text: 'text-emerald-400',
    icon: '🤖',
  },
  {
    name: 'Gemini',
    url: 'https://gemini.google.com',
    color: 'from-blue-500/20 to-indigo-500/20',
    border: 'border-blue-500/30 hover:border-blue-500/60',
    text: 'text-blue-400',
    icon: '✨',
  },
  {
    name: 'Claude',
    url: 'https://claude.ai',
    color: 'from-amber-500/20 to-orange-500/20',
    border: 'border-amber-500/30 hover:border-amber-500/60',
    text: 'text-amber-400',
    icon: '⚡',
  },
  {
    name: 'LeetCode',
    url: 'https://leetcode.com',
    color: 'from-yellow-500/20 to-amber-500/20',
    border: 'border-yellow-500/30 hover:border-yellow-500/60',
    text: 'text-yellow-400',
    icon: '💻',
  },
];

const DESKTOP_CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.265 Safari/537.36';

export const StealthBrowserWindow: React.FC = () => {
  const queryParams = new URLSearchParams(window.location.search);
  const initialUrlFromQuery = queryParams.get('url') || 'https://chatgpt.com';
  const guestPreloadFromQuery = queryParams.get('guestPreload') || '';

  const [inputUrl, setInputUrl] = useState(initialUrlFromQuery);
  const [currentUrl, setCurrentUrl] = useState(initialUrlFromQuery);
  const [isLoading, setIsLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastSuccess, setToastSuccess] = useState(true);
  const [isUndetectable, setIsUndetectable] = useState(true);
  const [guestPreloadUrl, setGuestPreloadUrl] = useState<string>(guestPreloadFromQuery);

  const webviewRef = useRef<any>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback((msg: string, success = true, duration = 3000) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    setToastSuccess(success);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, duration);
  }, []);

  const navigateTo = useCallback((rawTarget: string) => {
    let target = rawTarget.trim();
    if (!target) return;

    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      if (target.includes('.') && !target.includes(' ')) {
        target = `https://${target}`;
      } else {
        target = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
      }
    }

    setInputUrl(target);
    setCurrentUrl(target);
    if (webviewRef.current) {
      try {
        webviewRef.current.loadURL(target);
      } catch (e) {
        console.error('Failed to load URL on webview:', e);
      }
    }
  }, []);

  // Sync navigation state from main process
  useEffect(() => {
    const unsub = window.electronAPI?.onBrowserNavigateTo?.((newUrl: string) => {
      if (newUrl) {
        navigateTo(newUrl);
      }
    });

    window.electronAPI?.getUndetectable?.().then((undetectable: boolean) => {
      setIsUndetectable(undetectable);
    }).catch(() => {});

    window.electronAPI?.browserGetGuestPreloadUrl?.().then((url: string) => {
      if (url) setGuestPreloadUrl(url);
    }).catch(() => {});

    return () => {
      unsub?.();
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, [navigateTo]);

  // Hook into webview events
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const handleDidStartLoading = () => setIsLoading(true);
    const handleDidStopLoading = () => {
      setIsLoading(false);
      try {
        setCanGoBack(webview.canGoBack());
        setCanGoForward(webview.canGoForward());
        const u = webview.getURL();
        if (u && u !== 'about:blank') {
          setInputUrl(u);
          setCurrentUrl(u);
        }
      } catch (e) {}
    };

    const handleDidNavigate = (event: any) => {
      if (event.url && event.url !== 'about:blank') {
        setInputUrl(event.url);
        setCurrentUrl(event.url);
      }
    };

    webview.addEventListener('did-start-loading', handleDidStartLoading);
    webview.addEventListener('did-stop-loading', handleDidStopLoading);
    webview.addEventListener('did-navigate', handleDidNavigate);
    webview.addEventListener('did-navigate-in-page', handleDidNavigate);

    return () => {
      webview.removeEventListener('did-start-loading', handleDidStartLoading);
      webview.removeEventListener('did-stop-loading', handleDidStopLoading);
      webview.removeEventListener('did-navigate', handleDidNavigate);
      webview.removeEventListener('did-navigate-in-page', handleDidNavigate);
    };
  }, []);

  const handleBack = () => {
    if (webviewRef.current && webviewRef.current.canGoBack()) {
      webviewRef.current.goBack();
    }
  };

  const handleForward = () => {
    if (webviewRef.current && webviewRef.current.canGoForward()) {
      webviewRef.current.goForward();
    }
  };

  const handleReload = () => {
    if (webviewRef.current) {
      webviewRef.current.reload();
    }
  };

  const handleClose = () => {
    window.electronAPI?.browserClose?.();
  };

  // Screenshot Actions
  const handleFullScreenshot = async () => {
    try {
      showToast('Capturing full screen...', true, 2000);
      const res = await window.electronAPI?.browserTakeScreenshot?.();
      if (res?.success) {
        showToast('📸 Screenshot copied to clipboard! Paste with Cmd+V / Ctrl+V', true, 4000);
        // Focus the webview
        setTimeout(() => {
          webviewRef.current?.focus();
        }, 300);
      } else {
        showToast('Failed to take screenshot: ' + (res?.error || 'Unknown error'), false, 3500);
      }
    } catch (err: any) {
      showToast('Screenshot error: ' + (err?.message || String(err)), false, 3500);
    }
  };

  const handleSelectiveScreenshot = async () => {
    try {
      showToast('Select screen area to capture...', true, 2000);
      const res = await window.electronAPI?.browserTakeSelectiveScreenshot?.();
      if (res?.cancelled) {
        showToast('Selection cancelled', false, 2000);
        return;
      }
      if (res?.success) {
        showToast('✂️ Cropped area copied to clipboard! Paste with Cmd+V / Ctrl+V', true, 4000);
        setTimeout(() => {
          webviewRef.current?.focus();
        }, 300);
      } else {
        showToast('Crop failed: ' + (res?.error || 'Unknown error'), false, 3500);
      }
    } catch (err: any) {
      showToast('Crop error: ' + (err?.message || String(err)), false, 3500);
    }
  };

  const handlePasteToChat = async () => {
    try {
      // Ensure latest screenshot is written to clipboard
      await window.electronAPI?.browserCopyLatestScreenshot?.();

      if (webviewRef.current) {
        webviewRef.current.focus();
        webviewRef.current.paste();
        showToast('📋 Pasted clipboard image into web page!', true, 2500);
      } else {
        showToast('Webview not ready to paste', false, 2000);
      }
    } catch (err: any) {
      showToast('Paste error: ' + (err?.message || String(err)), false, 2500);
    }
  };

  return (
    <div className="flex flex-col w-screen h-screen bg-[#0e0e11] text-slate-200 select-none overflow-hidden font-sans antialiased border border-white/10 shadow-2xl">
      {/* Draggable Titlebar & Navigation Controls */}
      <header
        className="flex flex-col bg-[#16161b] border-b border-white/[0.08] shadow-sm shrink-0"
        style={{ WebkitAppRegion: 'drag' } as any}
      >
        {/* Top bar: Window info, quick presets, stealth badge, window controls */}
        <div className="flex items-center justify-between px-3 py-1.5 min-h-[38px]">
          <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
            {/* macOS traffic light spacing */}
            {isMac && <div className="w-14" />}
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.08]">
              <Globe size={13} className="text-emerald-400 animate-pulse" />
              <span className="text-[11px] font-semibold tracking-wide text-slate-200">
                Stealth Browser
              </span>
            </div>

            {/* Undetectable Status Badge */}
            <div
              className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border ${
                isUndetectable
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}
              title={
                isUndetectable
                  ? 'Screen-share protection active (NSWindowSharingNone / WDA_EXCLUDEFROMCAPTURE)'
                  : 'Normal window mode'
              }
            >
              <Shield size={10} />
              <span>{isUndetectable ? 'Undetectable Active' : 'Stealth Off'}</span>
            </div>
          </div>

          {/* Quick AI Presets */}
          <div
            className="flex items-center gap-1.5 overflow-x-auto py-0.5"
            style={{ WebkitAppRegion: 'no-drag' } as any}
          >
            {PRESETS.map((preset) => {
              const isActive = currentUrl.includes(preset.url.replace('https://', ''));
              return (
                <button
                  key={preset.name}
                  onClick={() => navigateTo(preset.url)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all duration-200 active:scale-95 ${
                    isActive
                      ? `bg-white/[0.12] ${preset.border} ${preset.text} shadow-sm font-semibold`
                      : 'bg-white/[0.03] border-white/[0.06] text-slate-300 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  <span className="text-xs">{preset.icon}</span>
                  <span>{preset.name}</span>
                </button>
              );
            })}
          </div>

          {/* Screenshot & Window Controls */}
          <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as any}>
            {/* Screenshot Action Buttons */}
            <div className="flex items-center gap-1 bg-white/[0.04] p-0.5 rounded-lg border border-white/[0.08]">
              <button
                onClick={handleFullScreenshot}
                title="Capture full screen and copy directly to clipboard for ChatGPT/Gemini"
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-slate-200 bg-white/[0.05] hover:bg-white/[0.12] hover:text-white transition-all active:scale-95"
              >
                <Camera size={13} className="text-blue-400" />
                <span>Snap</span>
              </button>

              <button
                onClick={handleSelectiveScreenshot}
                title="Crop selective area and copy to clipboard"
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-slate-200 bg-white/[0.05] hover:bg-white/[0.12] hover:text-white transition-all active:scale-95"
              >
                <Crop size={13} className="text-emerald-400" />
                <span>Crop</span>
              </button>

              <button
                onClick={handlePasteToChat}
                title="Paste copied screenshot image into the web chat prompt"
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-slate-200 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition-all active:scale-95 shadow-sm"
              >
                <Clipboard size={13} />
                <span>Paste to Chat</span>
              </button>
            </div>

            {/* Close Button */}
            <button
              onClick={handleClose}
              title="Close browser (or press Cmd+Shift+W to toggle)"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-red-500/20 hover:text-red-400 transition-colors duration-150"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Bottom bar: Back, Forward, Reload, URL Input */}
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#121216] border-t border-white/[0.04]"
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          {/* Navigation Controls */}
          <button
            onClick={handleBack}
            disabled={!canGoBack}
            title="Go Back"
            className={`p-1.5 rounded-md transition-colors ${
              canGoBack
                ? 'text-slate-200 hover:bg-white/10 hover:text-white'
                : 'text-slate-600 cursor-not-allowed'
            }`}
          >
            <ArrowLeft size={14} />
          </button>

          <button
            onClick={handleForward}
            disabled={!canGoForward}
            title="Go Forward"
            className={`p-1.5 rounded-md transition-colors ${
              canGoForward
                ? 'text-slate-200 hover:bg-white/10 hover:text-white'
                : 'text-slate-600 cursor-not-allowed'
            }`}
          >
            <ArrowRight size={14} />
          </button>

          <button
            onClick={handleReload}
            title="Reload Page"
            className="p-1.5 rounded-md text-slate-200 hover:bg-white/10 hover:text-white transition-colors"
          >
            <RotateCw size={14} className={isLoading ? 'animate-spin text-emerald-400' : ''} />
          </button>

          {/* URL Input Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              navigateTo(inputUrl);
            }}
            className="flex-1 flex items-center gap-2 bg-[#1b1b22] border border-white/[0.1] hover:border-white/20 focus-within:border-emerald-500/60 focus-within:ring-1 focus-within:ring-emerald-500/40 rounded-lg px-3 py-1 transition-all duration-200"
          >
            <Lock size={11} className="text-emerald-400 shrink-0" />
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="Search or enter web address (e.g. chatgpt.com, gemini.google.com)..."
              className="flex-1 bg-transparent text-xs text-slate-100 placeholder-slate-500 focus:outline-none font-mono"
            />
            {isLoading ? (
              <span className="text-[10px] text-emerald-400 font-medium animate-pulse shrink-0">
                Loading...
              </span>
            ) : (
              <span className="text-[10px] text-slate-500 font-sans shrink-0">
                ↵ Enter
              </span>
            )}
          </form>

          {/* Persistent Partition Indicator */}
          <div
            className="flex items-center gap-1 px-2 py-1 rounded bg-white/[0.03] border border-white/[0.06] text-[10px] text-slate-400"
            title="All cookies, logins, and session data are stored securely on disk in 'persist:stealth-browser' so you stay logged in"
          >
            <Sparkles size={11} className="text-amber-400" />
            <span>Session Saved</span>
          </div>

          {/* Chrome Safe Auth Badge */}
          <div
            className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-300"
            title="Browser identifies as genuine Google Chrome 131 with full Google & OpenAI auth compatibility"
          >
            <Shield size={11} className="text-emerald-400" />
            <span>Chrome Safe</span>
          </div>
        </div>
      </header>

      {/* Floating Notification Toast */}
      {toastMessage && (
        <div
          className={`absolute top-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium shadow-2xl backdrop-blur-md border animate-in fade-in slide-in-from-top-3 duration-200 ${
            toastSuccess
              ? 'bg-[#18231c]/95 text-emerald-300 border-emerald-500/30 shadow-emerald-950/50'
              : 'bg-[#291818]/95 text-red-300 border-red-500/30 shadow-red-950/50'
          }`}
        >
          {toastSuccess ? <Check size={14} className="text-emerald-400" /> : <X size={14} className="text-red-400" />}
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Embedded Electron Webview Container */}
      <main className="flex-1 w-full h-full relative bg-[#121214] overflow-hidden">
        {guestPreloadUrl ? (
          <webview
            ref={webviewRef}
            src={initialUrlFromQuery}
            partition="persist:stealth-browser"
            useragent={DESKTOP_CHROME_UA}
            allowpopups={true}
            preload={guestPreloadUrl}
            className="w-full h-full border-0 bg-[#121214]"
            style={{ width: '100%', height: '100%', display: 'flex' }}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-400">
            <div className="w-6 h-6 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
            <span className="text-xs font-mono">Initializing secure Chrome session...</span>
          </div>
        )}
      </main>
    </div>
  );
};

export default StealthBrowserWindow;
