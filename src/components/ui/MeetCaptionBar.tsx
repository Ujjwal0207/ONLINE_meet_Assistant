import React, { useState, useEffect } from 'react';
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Mic,
  Radio,
  Sparkles,
  Volume2,
  X,
  Zap,
} from 'lucide-react';

export interface MeetCaptionBarProps {
  /** The latest finalized question or sentence from the meeting */
  captionText: string;
  /** Live in-progress partial transcript streaming right now */
  partialText?: string;
  /** Whether someone in the meeting is speaking right now */
  isSpeaking: boolean;
  /** Status of system audio capture STT */
  sttStatus?: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio';
  /** Auto-fill mode state */
  autoFillInput: boolean;
  /** Callback to toggle auto-fill setting */
  onToggleAutoFill: () => void;
  /** Callback to insert caption into the normal question input bar */
  onUseAsQuestion: (text: string) => void;
  /** Callback to immediately submit the question */
  onSubmitQuestion?: (text: string) => void;
  /** Callback to clear current caption */
  onClear: () => void;
  /** Current theme appearance styles */
  appearance?: {
    controlStyle?: React.CSSProperties;
    inputStyle?: React.CSSProperties;
    transcriptStyle?: React.CSSProperties;
  };
}

export const MeetCaptionBar: React.FC<MeetCaptionBarProps> = ({
  captionText,
  partialText = '',
  isSpeaking,
  sttStatus = 'connected',
  autoFillInput,
  onToggleAutoFill,
  onUseAsQuestion,
  onSubmitQuestion,
  onClear,
  appearance,
}) => {
  const [copied, setCopied] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Combined text to show: finalized text plus any live streaming partial
  const combinedText = partialText
    ? captionText
      ? `${captionText} ${partialText}`
      : partialText
    : captionText;

  const hasContent = Boolean(combinedText.trim());

  // Check if text looks like a question
  const isQuestion = hasContent && (
    combinedText.includes('?') ||
    /\b(what|why|how|who|when|where|which|can|could|would|should|is|are|do|does|explain|describe)\b/i.test(combinedText)
  );

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!combinedText) return;
    navigator.clipboard.writeText(combinedText.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUseQuestion = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!combinedText) return;
    onUseAsQuestion(combinedText.trim());
  };

  const handleSubmit = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!combinedText) return;
    if (onSubmitQuestion) {
      onSubmitQuestion(combinedText.trim());
    } else {
      onUseAsQuestion(combinedText.trim());
    }
  };

  return (
    <div
      className={`w-full mb-2 rounded-xl border transition-all duration-200 select-none overflow-hidden ${
        isSpeaking
          ? 'bg-slate-900/80 border-sky-500/40 shadow-[0_0_16px_rgba(14,165,233,0.18)]'
          : 'bg-neutral-900/60 border-white/10 hover:border-white/20'
      } backdrop-blur-md`}
      style={appearance?.transcriptStyle}
    >
      {/* Top Header Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 bg-white/[0.02]">
        <div className="flex items-center gap-2 min-w-0">
          {/* Animated sound wave bars when speaking, or live radio icon when idle */}
          <div className="flex items-center gap-1 shrink-0">
            {isSpeaking ? (
              <div className="flex items-center gap-0.5 h-3 px-0.5" title="Capturing sound from meet">
                <span className="w-0.5 h-3 bg-sky-400 rounded-full animate-[pulse_0.6s_ease-in-out_infinite]" />
                <span className="w-0.5 h-2 bg-emerald-400 rounded-full animate-[pulse_0.8s_ease-in-out_infinite]" />
                <span className="w-0.5 h-3.5 bg-blue-400 rounded-full animate-[pulse_0.5s_ease-in-out_infinite]" />
                <span className="w-0.5 h-1.5 bg-sky-400 rounded-full animate-[pulse_0.7s_ease-in-out_infinite]" />
              </div>
            ) : (
              <div className="flex items-center justify-center w-3.5 h-3.5 text-emerald-400" title="Sound Listener Active">
                <Radio className="w-3 h-3 animate-pulse" />
              </div>
            )}
            <span className="text-[11px] font-medium tracking-wide text-slate-200 flex items-center gap-1.5">
              <span>Meet Caption</span>
              {isSpeaking ? (
                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                  LIVE
                </span>
              ) : sttStatus === 'reconnecting' ? (
                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  CONNECTING
                </span>
              ) : (
                <span className="text-[10px] text-slate-400 font-normal opacity-75">
                  Listening
                </span>
              )}
            </span>
          </div>

          {/* Question detected chip */}
          {isQuestion && (
            <span className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              <Sparkles className="w-2.5 h-2.5" />
              Question Detected
            </span>
          )}
        </div>

        {/* Action Controls Header */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Auto-Fill Toggle */}
          <button
            onClick={onToggleAutoFill}
            title={
              autoFillInput
                ? 'Auto-fill: ON — Heard questions automatically fill the question bar below'
                : 'Auto-fill: OFF — Click to automatically fill questions into the bar below'
            }
            className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium transition-colors border ${
              autoFillInput
                ? 'bg-blue-500/20 border-blue-500/40 text-blue-300 hover:bg-blue-500/30 shadow-[0_0_8px_rgba(59,130,246,0.2)]'
                : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/10'
            }`}
          >
            <Zap className={`w-2.5 h-2.5 ${autoFillInput ? 'fill-blue-400 text-blue-400' : ''}`} />
            <span>Auto-fill {autoFillInput ? 'ON' : 'OFF'}</span>
          </button>

          {/* Copy Button */}
          {hasContent && (
            <button
              onClick={handleCopy}
              title="Copy caption text"
              className="p-1 rounded-md hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            </button>
          )}

          {/* Clear Button */}
          {hasContent && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              title="Clear caption"
              className="p-1 rounded-md hover:bg-white/10 text-slate-400 hover:text-rose-400 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}

          {/* Collapse/Expand Toggle */}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? 'Expand caption bar' : 'Collapse caption bar'}
            className="p-1 rounded-md hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
          >
            {isCollapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Caption Body */}
      {!isCollapsed && (
        <div
          onClick={() => {
            if (hasContent) handleUseQuestion();
          }}
          className={`px-3 py-2 flex items-center justify-between gap-3 text-[12px] leading-relaxed transition-all ${
            hasContent ? 'cursor-pointer hover:bg-white/[0.03]' : ''
          }`}
          title={hasContent ? 'Click to fill into question box below' : undefined}
        >
          <div className="flex-1 min-w-0 pr-1">
            {hasContent ? (
              <div className="break-words select-text">
                {captionText && (
                  <span className="text-slate-100 font-normal">{captionText}</span>
                )}
                {partialText && (
                  <span className="text-sky-300 font-medium ml-1 animate-[pulse_1.5s_ease-in-out_infinite]">
                    {partialText}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-slate-400/80 text-[11px] italic">
                <Volume2 className="w-3.5 h-3.5 text-slate-400/60 shrink-0" />
                <span>
                  Listening for meet audio questions (Google Meet, Zoom, Teams, browser calls)...
                </span>
              </div>
            )}
          </div>

          {/* Quick Action Button */}
          {hasContent && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={handleUseQuestion}
                title="Fill this into the text writing bar below, then click Send"
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-blue-600/30 hover:bg-blue-600/50 text-blue-200 border border-blue-400/30 hover:border-blue-400/60 transition-all shadow-sm active:scale-95"
              >
                <ArrowDown className="w-3 h-3" />
                <span>Use Question</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MeetCaptionBar;
