export type AutoTypeMode = "char" | "word" | "instant";

export type AutoTypePermissionKind = "accessibility" | "automation";

export interface AutoTypePermissionStatus {
  granted: boolean;
  appName: string;
  appPath: string;
}

export interface AutoTypeOptions {
  code: string;
  mode: AutoTypeMode;
  /** Five source characters count as one word, including in token mode. */
  wordsPerMinute?: number;
  /** Legacy delay option, used only when wordsPerMinute is omitted. */
  speedMs?: number;
  countdownSec?: number;
}

export interface AutoTypeState {
  status: "idle" | "countdown" | "typing" | "done" | "cancelled" | "error";
  remainingSeconds?: number;
  mode?: AutoTypeMode;
  error?: string;
  errorCode?: AutoTypePermissionKind;
}
