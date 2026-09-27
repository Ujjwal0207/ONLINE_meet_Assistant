import { app, BrowserWindow, globalShortcut, shell, systemPreferences } from "electron";
import { spawn, ChildProcess } from "child_process";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { AUTO_TYPE_SCRIPT, buildAutoTypeUnits } from "./AutoTypeScript";
import { describeAutoTypeFailure } from "./AutoTypePermissions";

import type { AutoTypeMode, AutoTypeOptions, AutoTypeState, AutoTypePermissionKind, AutoTypePermissionStatus } from "../../src/types/autotype";
export type { AutoTypeMode, AutoTypeOptions, AutoTypeState };

interface TypingSession {
    cancelled: boolean;
    child?: ChildProcess;
    childFinished?: Promise<void>;
    countdownTimer?: NodeJS.Timeout;
    escapeGuard?: NodeJS.Timeout;
    finishCountdown?: () => void;
    directory?: string;
    markerPath?: string;
    configPath?: string;
    stopping?: Promise<void>;
}

export class AutoTyperService {
    private static instance: AutoTyperService | null = null;
    private state: AutoTypeState = { status: "idle" };
    private session: TypingSession | null = null;
    private escapeOwner: TypingSession | null = null;
    private requestSequence = 0;

    private constructor() {}

    public static getInstance(): AutoTyperService {
        if (!AutoTyperService.instance) AutoTyperService.instance = new AutoTyperService();
        return AutoTyperService.instance;
    }

    public getState(): AutoTypeState { return { ...this.state }; }

    public getPermissionStatus(): AutoTypePermissionStatus {
        const executable = app.getPath("exe");
        return {
            granted: process.platform === "darwin" && systemPreferences.isTrustedAccessibilityClient(false),
            appName: app.isPackaged ? app.getName() : "Electron (Natively development)",
            appPath: executable.match(/^.*?\.app(?=\/|$)/)?.[0] || executable,
        };
    }

    public async openPermissionSettings(kind: AutoTypePermissionKind): Promise<void> {
        const pane = kind === "automation" ? "Privacy_Automation" : "Privacy_Accessibility";
        await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
    }

    private broadcastState(newState: AutoTypeState): void {
        this.state = newState;
        for (const win of BrowserWindow.getAllWindows()) {
            try {
                if (!win.isDestroyed()) win.webContents.send("auto-typer:state-changed", this.state);
            } catch { /* The window may close during shutdown. */ }
        }
    }

    private releaseEscape(session: TypingSession): void {
        if (this.escapeOwner !== session) return;
        globalShortcut.unregister("Escape");
        this.escapeOwner = null;
    }

    public async cancel(): Promise<{ success: boolean }> {
        ++this.requestSequence;
        if (this.session) await this.stopSession(this.session);
        return { success: true };
    }

    private stopSession(session: TypingSession): Promise<void> {
        if (session.stopping) return session.stopping;
        session.cancelled = true;
        if (session.escapeGuard) clearInterval(session.escapeGuard);
        this.releaseEscape(session);
        if (session.countdownTimer) clearInterval(session.countdownTimer);
        session.finishCountdown?.();
        if (this.session === session) this.broadcastState({ status: "cancelled", remainingSeconds: 0 });
        session.stopping = (async () => {
            if (session.markerPath) await fs.unlink(session.markerPath).catch(() => {});
            if (!session.child || !session.childFinished) return;
            let timeout: NodeJS.Timeout | undefined;
            const finished = await Promise.race([
                session.childFinished.then(() => true),
                new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(false), 700); }),
            ]);
            if (timeout) clearTimeout(timeout);
            if (!finished) {
                session.child?.kill("SIGKILL");
                await session.childFinished;
                // Recover the original clipboard if a native call stalled and
                // the worker could not run its own finally block.
                if (session.configPath) await this.runWorker(session, "restore").catch(() => {});
            }
        })();
        return session.stopping;
    }

    public async start(options: AutoTypeOptions): Promise<{ success: boolean; error?: string }> {
        if (!options || typeof options.code !== "string" || !options.code.trim()) {
            return { success: false, error: "No code provided to type." };
        }
        const request = ++this.requestSequence;
        if (this.session) await this.stopSession(this.session);
        if (request !== this.requestSequence) return { success: false, error: "Auto-typing cancelled." };

        const session: TypingSession = { cancelled: false };
        this.session = session;
        const mode: AutoTypeMode = ["char", "word", "instant"].includes(options.mode) ? options.mode : "char";
        const countdownSec = Math.round(Math.max(0, Math.min(10, Number.isFinite(options.countdownSec) ? options.countdownSec! : 3)));
        const hasWpm = Number.isFinite(options.wordsPerMinute);
        const wordsPerMinute = Math.max(40, Math.min(1200, hasWpm ? options.wordsPerMinute! : 50));
        const delayMs = hasWpm || !Number.isFinite(options.speedMs)
            ? 60000 / (wordsPerMinute * 5)
            : Math.max(5, Math.min(2000, options.speedMs!));

        try {
            // Renderer keydown cannot see Escape while another editor is focused.
            if (!globalShortcut.isRegistered("Escape")) {
                globalShortcut.register("Escape", () => { void this.cancel(); });
                if (globalShortcut.isRegistered("Escape")) this.escapeOwner = session;
            }
            if (this.escapeOwner !== session) {
                throw new Error("Could not enable Escape to stop auto-typing. Close any conflicting Escape shortcut and try again.");
            }
            // Settings can rebuild app shortcuts via unregisterAll(). Do not
            // continue injecting text if that removes the emergency stop key.
            session.escapeGuard = setInterval(() => {
                if (!globalShortcut.isRegistered("Escape")) void this.cancel();
            }, 100);
            if (countdownSec > 0) {
                let remaining = countdownSec;
                this.broadcastState({ status: "countdown", remainingSeconds: remaining, mode });
                await new Promise<void>((resolve) => {
                    session.finishCountdown = resolve;
                    session.countdownTimer = setInterval(() => {
                        if (--remaining <= 0) {
                            clearInterval(session.countdownTimer);
                            session.countdownTimer = undefined;
                            resolve();
                        } else if (!session.cancelled) {
                            this.broadcastState({ status: "countdown", remainingSeconds: remaining, mode });
                        }
                    }, 1000);
                });
            }
            this.assertActive(session);
            session.directory = await fs.mkdtemp(path.join(os.tmpdir(), "natively-autotype-"));
            this.assertActive(session);
            session.markerPath = path.join(session.directory, "active");
            session.configPath = path.join(session.directory, "config.json");
            await fs.writeFile(session.markerPath, "active", { mode: 0o600 });
            this.assertActive(session);
            await fs.writeFile(session.configPath, JSON.stringify({
                units: buildAutoTypeUnits(options.code, mode, delayMs, hasWpm || !Number.isFinite(options.speedMs)),
                markerPath: session.markerPath,
                recoveryPath: path.join(session.directory, "clipboard.json"),
                changePath: path.join(session.directory, "clipboard-change.txt"),
            }), { mode: 0o600 });
            this.assertActive(session);
            this.broadcastState({ status: "typing", mode, remainingSeconds: 0 });
            await this.runWorker(session);
            this.assertActive(session);
            this.broadcastState({ status: "done", mode });
            return { success: true };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Auto-typing encountered an error.";
            const errorCode = (error as { permissionCode?: AutoTypePermissionKind })?.permissionCode;
            if (!session.cancelled && this.session === session) this.broadcastState({ status: "error", error: message, errorCode });
            return { success: false, error: session.cancelled ? "Auto-typing cancelled." : message };
        } finally {
            await session.stopping;
            this.releaseEscape(session);
            if (session.escapeGuard) clearInterval(session.escapeGuard);
            if (session.countdownTimer) clearInterval(session.countdownTimer);
            if (session.directory) await fs.rm(session.directory, { recursive: true, force: true }).catch(() => {});
            if (this.session === session) this.session = null;
        }
    }

    private assertActive(session: TypingSession): void {
        if (session.cancelled || this.session !== session) throw new Error("Auto-typing cancelled.");
    }

    private runWorker(session: TypingSession, action = "type"): Promise<void> {
        const result = new Promise<void>((resolve, reject) => {
            const child = spawn("/usr/bin/osascript", ["-l", "JavaScript", "-e", AUTO_TYPE_SCRIPT, session.configPath!, action], {
                stdio: ["ignore", "ignore", "pipe"],
            });
            session.child = child;
            const recoveryTimeout = action === "restore" ? setTimeout(() => child.kill("SIGKILL"), 1000) : undefined;
            let stderr = "";
            child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
            child.on("error", (error) => {
                if (recoveryTimeout) clearTimeout(recoveryTimeout);
                if (session.child === child) session.child = undefined;
                reject(new Error("Failed to launch auto-typing: " + error.message));
            });
            child.on("close", (code, signal) => {
                if (recoveryTimeout) clearTimeout(recoveryTimeout);
                if (session.child === child) session.child = undefined;
                if (signal || session.cancelled && action === "type") return reject(new Error("Auto-typing cancelled."));
                if (code !== 0) {
                    const failure = describeAutoTypeFailure(stderr, app.isPackaged ? app.getName() : "Electron (Natively development)");
                    return reject(Object.assign(new Error(failure.message), { permissionCode: failure.code }));
                }
                resolve();
            });
        });
        session.childFinished = result.then(() => {}, () => {});
        return result;
    }
}
