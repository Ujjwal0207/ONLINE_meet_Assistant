import React, { useState, useEffect, useCallback, useRef } from "react";
import { Keyboard, Zap, Type, Layers, X, Play, Square, AlertCircle, CheckCircle, Clock, Sliders } from "lucide-react";
import type { AutoTypeMode, AutoTypeState, AutoTypePermissionStatus } from "../types/autotype";

interface AutoTypeModalProps {
  isOpen: boolean;
  code: string;
  onClose: () => void;
}

export const AutoTypeModal: React.FC<AutoTypeModalProps> = ({ isOpen, code, onClose }) => {
  const [mode, setMode] = useState<AutoTypeMode>("char");
  const [wordsPerMinute, setWordsPerMinute] = useState<number>(50);
  const startRequest = useRef(0);
  const [countdownSec, setCountdownSec] = useState<number>(3);
  const [autoTypeState, setAutoTypeState] = useState<AutoTypeState>({ status: "idle" });
  const [showCodePreview, setShowCodePreview] = useState(false);
  const [permission, setPermission] = useState<AutoTypePermissionStatus | null>(null);
  const permissionRequest = useRef(0);

  const refreshPermission = useCallback(async () => {
    const request = ++permissionRequest.current;
    try {
      const result = await window.electronAPI?.checkAccessibilityPermission?.();
      if (request !== permissionRequest.current) return;
      setPermission(result ?? null);
    } catch {
      if (request === permissionRequest.current) setPermission(null);
    }
  }, []);

  // Check accessibility permission when modal opens & reset error state
  useEffect(() => {
    if (!isOpen) return;
    // Reset terminal state when modal opens fresh
    setAutoTypeState((prev) => ["done", "cancelled", "error"].includes(prev.status) ? { status: "idle" } : prev);
    void refreshPermission();
    // The user normally changes permissions while this dialog remains open.
    // Refresh on return and also when an unfocused overlay stays visible.
    window.addEventListener("focus", refreshPermission);
    const timer = setInterval(refreshPermission, 2000);
    return () => {
      ++permissionRequest.current;
      clearInterval(timer);
      window.removeEventListener("focus", refreshPermission);
    };
  }, [isOpen, refreshPermission]);

  // Subscribe to auto-typer state changes from backend
  useEffect(() => {
    if (!isOpen) return;
    let receivedState = false;
    const initialRequest = startRequest.current;
    const unsubscribe = window.electronAPI?.onAutoTypeState?.((state: AutoTypeState) => {
      receivedState = true;
      setAutoTypeState(state);
    });

    let active = true;
    window.electronAPI?.getAutoTypeState?.().then((state) => {
      if (active && !receivedState && initialRequest === startRequest.current) {
        // Terminal state belongs to the previous run; opening a fresh dialog
        // should remain ready to start instead of scheduling its old Done close.
        setAutoTypeState(["done", "cancelled", "error"].includes(state.status) ? { status: "idle" } : state);
      }
    }).catch(() => {});
    return () => {
      active = false;
      if (unsubscribe) unsubscribe();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || autoTypeState.status !== "done") return;
    const timer = setTimeout(onClose, 1200);
    return () => clearTimeout(timer);
  }, [isOpen, autoTypeState.status, onClose]);

  // Keep the selected WPM when switching between character and token modes.
  const handleModeChange = (newMode: AutoTypeMode) => {
    setMode(newMode);
  };

  // Start auto-typing
  const handleStart = async () => {
    const request = ++startRequest.current;
    setAutoTypeState({ status: "countdown", remainingSeconds: countdownSec, mode });
    try {
      const result = await window.electronAPI?.startAutoType?.({
        code,
        mode,
        wordsPerMinute,
        countdownSec,
      });
      if (request === startRequest.current && (!result || !result.success) && result?.error !== "Auto-typing cancelled.") {
        setAutoTypeState((previous) => previous.status === "error" && previous.error === result?.error
          ? previous
          : { status: "error", error: result?.error || "Failed to start auto-typing." });
      }
    } catch (err: any) {
      if (request === startRequest.current) setAutoTypeState({ status: "error", error: err?.message || "Failed to start auto-typing." });
    }
  };

  // Cancel / Stop
  const handleCancel = useCallback(async () => {
    ++startRequest.current;
    setAutoTypeState({ status: "cancelled" });
    try {
      await window.electronAPI?.cancelAutoType?.();
    } catch {
      setAutoTypeState({ status: "error", error: "Could not stop auto-typing. Press Escape to retry." });
    }
  }, []);

  // Local Escape handling; the service also owns Escape while an editor is focused.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (autoTypeState.status === "countdown" || autoTypeState.status === "typing") {
          handleCancel();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, autoTypeState.status, handleCancel, onClose]);

  if (!isOpen) return null;

  const isRunning = autoTypeState.status === "countdown" || autoTypeState.status === "typing";
  const linesCount = code.split("\n").length;
  const charsCount = code.length;
  const permissionIssue = autoTypeState.errorCode || (permission?.granted === false ? "accessibility" : undefined);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
      <div
        className="w-full max-w-xl bg-neutral-900/95 border border-white/10 rounded-2xl shadow-2xl p-6 flex flex-col gap-5 text-white"
        style={{ maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/20 text-blue-400">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Auto-Type into Compiler / Editor</h3>
              <p className="text-xs text-neutral-400">
                Inserts code at your chosen pace while preserving the source spacing
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              if (isRunning) handleCancel();
              onClose();
            }}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ACTIVE COUNTDOWN STATE */}
        {autoTypeState.status === "countdown" && (
          <div className="py-8 flex flex-col items-center justify-center gap-4 text-center">
            <div className="relative flex items-center justify-center">
              <div className="w-20 h-20 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin" />
              <span className="absolute text-2xl font-bold font-mono text-white">
                {autoTypeState.remainingSeconds ?? countdownSec}
              </span>
            </div>
            <div className="space-y-1">
              <h4 className="text-lg font-medium text-white">Switch to your compiler now!</h4>
              <p className="text-xs text-neutral-400">
                Click your cursor into the editor window where you want the code typed.
              </p>
            </div>
            <button
              onClick={handleCancel}
              className="mt-2 flex items-center gap-2 px-5 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 font-medium transition-colors"
            >
              <Square className="w-4 h-4 fill-current" />
              <span>Cancel (Esc)</span>
            </button>
          </div>
        )}

        {/* ACTIVE TYPING STATE */}
        {autoTypeState.status === "typing" && (
          <div className="py-8 flex flex-col items-center justify-center gap-4 text-center">
            <div className="flex items-center gap-2 p-3 rounded-2xl bg-blue-500/10 border border-blue-500/20">
              <div className="w-3 h-3 rounded-full bg-blue-400 animate-ping" />
              <span className="text-sm font-medium text-blue-300">
                Typing in progress ({mode === "char" ? "Character by Character" : mode === "word" ? "Word by Word" : "Instant Paste"})...
              </span>
            </div>
            <p className="text-xs text-neutral-400">
              Keep your editor active. Press Escape or click below to stop anytime.
            </p>
            <button
              onClick={handleCancel}
              className="mt-2 flex items-center gap-2 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-medium shadow-lg shadow-red-600/20 transition-colors"
            >
              <Square className="w-4 h-4 fill-current" />
              <span>Stop Typing (Esc)</span>
            </button>
          </div>
        )}

        {/* DONE STATE */}
        {autoTypeState.status === "done" && (
          <div className="py-8 flex flex-col items-center justify-center gap-3 text-center">
            <CheckCircle className="w-12 h-12 text-emerald-400 animate-bounce" />
            <h4 className="text-base font-semibold text-white">Typing Completed!</h4>
            <p className="text-xs text-neutral-400">All code has been entered into your editor.</p>
          </div>
        )}

        {/* CONFIGURATION / IDLE STATE */}
        {(autoTypeState.status === "idle" || autoTypeState.status === "cancelled" || autoTypeState.status === "error") && (
          <>
            {permissionIssue && (
              <div role="alert" className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs space-y-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>{autoTypeState.errorCode ? autoTypeState.error : `macOS has not granted keyboard control to this running copy of ${permission?.appName || "Natively"}. If it is already enabled in Accessibility (Device Control and Data Access on newer macOS), fully quit and reopen the app.`}</span>
                </div>
                {permission?.appPath && <p className="break-all text-neutral-400">Running app: {permission.appPath}</p>}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => window.electronAPI.openAutoTypePermissionSettings(permissionIssue)} className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20">Open Settings</button>
                  <button type="button" onClick={refreshPermission} className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20">Check Again</button>
                  <button type="button" onClick={() => window.electronAPI.restartApp()} className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20">Restart App</button>
                </div>
              </div>
            )}

            {/* Error display (non-permission errors) */}
            {autoTypeState.status === "error" && autoTypeState.error && !autoTypeState.errorCode && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{autoTypeState.error}</span>
              </div>
            )}

            {/* Mode Selection */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-neutral-300">Typing Mode</label>
              <div className="grid grid-cols-3 gap-2.5">
                {/* Char Mode */}
                <button
                  type="button"
                  onClick={() => handleModeChange("char")}
                  className={`p-3 rounded-xl border text-left flex flex-col gap-1.5 transition-all ${
                    mode === "char"
                      ? "bg-blue-600/20 border-blue-500/60 text-white shadow-lg shadow-blue-500/10"
                      : "bg-white/5 border-white/10 text-neutral-400 hover:bg-white/10 hover:text-neutral-200"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Type className="w-4 h-4 text-blue-400" />
                    <span className="text-xs font-semibold text-white">Char by Char</span>
                  </div>
                  <span className="text-[11px] text-neutral-400 leading-snug">
                    Natural keystroke-by-keystroke typing
                  </span>
                </button>

                {/* Word Mode */}
                <button
                  type="button"
                  onClick={() => handleModeChange("word")}
                  className={`p-3 rounded-xl border text-left flex flex-col gap-1.5 transition-all ${
                    mode === "word"
                      ? "bg-blue-600/20 border-blue-500/60 text-white shadow-lg shadow-blue-500/10"
                      : "bg-white/5 border-white/10 text-neutral-400 hover:bg-white/10 hover:text-neutral-200"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-semibold text-white">Word by Word</span>
                  </div>
                  <span className="text-[11px] text-neutral-400 leading-snug">
                    Types syntax words with brief pauses
                  </span>
                </button>

                {/* Instant Mode */}
                <button
                  type="button"
                  onClick={() => handleModeChange("instant")}
                  className={`p-3 rounded-xl border text-left flex flex-col gap-1.5 transition-all ${
                    mode === "instant"
                      ? "bg-blue-600/20 border-blue-500/60 text-white shadow-lg shadow-blue-500/10"
                      : "bg-white/5 border-white/10 text-neutral-400 hover:bg-white/10 hover:text-neutral-200"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-semibold text-white">Instant Code</span>
                  </div>
                  <span className="text-[11px] text-neutral-400 leading-snug">
                    Instantly pastes full code block via Cmd+V
                  </span>
                </button>
              </div>
            </div>

            {/* Speed Slider (only for char & word modes) */}
            {mode !== "instant" && (
              <div className="space-y-2 p-3.5 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-200">
                    <Sliders className="w-3.5 h-3.5 text-blue-400" />
                    <span>Typing Speed</span>
                  </div>
                  <span className="text-xs font-mono text-blue-400 font-semibold">
                    ~{wordsPerMinute} WPM
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Typing speed in words per minute"
                  min={40}
                  max={1200}
                  step={10}
                  value={wordsPerMinute}
                  onChange={(e) => setWordsPerMinute(Number(e.target.value))}
                  className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between text-[10px] text-neutral-500">
                  <span>40 WPM</span>
                  <span>5 characters = 1 word</span>
                  <span>1200 WPM</span>
                </div>
                <div className="flex gap-2">
                  {[40, 50, 60].map((speed) => (
                    <button
                      key={speed}
                      type="button"
                      onClick={() => setWordsPerMinute(speed)}
                      className={`px-2.5 py-1 rounded-lg text-xs ${wordsPerMinute === speed ? "bg-blue-600 text-white" : "bg-white/5 text-neutral-400 hover:text-white"}`}
                    >
                      {speed} WPM
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-neutral-500">Uses the clipboard for exact text insertion, then restores it. Editor processing may reduce actual speed.</p>
              </div>
            )}

            {/* Countdown Delay Selector */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-white/5 border border-white/10">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-neutral-400" />
                <div>
                  <div className="text-xs font-medium text-neutral-200">Focus Countdown</div>
                  <div className="text-[11px] text-neutral-400">Time to click into your compiler</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 5].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => setCountdownSec(sec)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      countdownSec === sec
                        ? "bg-blue-600 text-white"
                        : "bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10"
                    }`}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            </div>

            {/* Snippet summary & toggleable preview */}
            <div className="rounded-xl border border-white/10 bg-black/40 overflow-hidden text-xs">
              <div
                onClick={() => setShowCodePreview(!showCodePreview)}
                className="px-3.5 py-2.5 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors select-none"
              >
                <div className="flex items-center gap-2 text-neutral-300">
                  <span className="font-medium">Target Code Snippet</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-neutral-400 font-mono">
                    {linesCount} lines · {charsCount} chars
                  </span>
                </div>
                <span className="text-neutral-400 text-[11px]">
                  {showCodePreview ? "Hide Preview ▲" : "Show Preview ▼"}
                </span>
              </div>
              {showCodePreview && (
                <pre className="p-3 text-[11px] font-mono text-neutral-300 max-h-36 overflow-y-auto bg-black/60 border-t border-white/10 whitespace-pre-wrap leading-relaxed">
                  {code}
                </pre>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <span className="text-[11px] text-neutral-400">
                {permission?.granted === true ? "✅ Keyboard-control permission granted" : permission?.granted === false ? "⚠️ Keyboard-control permission not active for this app" : "Requires macOS Accessibility permission"}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-neutral-300 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleStart}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/25 transition-all active:scale-95"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Start Auto-Type</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
