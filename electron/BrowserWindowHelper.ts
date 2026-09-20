import { BrowserWindow, screen, app, clipboard, nativeImage, session } from "electron"
import path from "node:path"
import fs from "node:fs"
import url from "node:url"
import type { WindowHelper } from "./WindowHelper"
import type { ScreenshotHelper } from "./ScreenshotHelper"

const isDev = process.env.NODE_ENV === "development"

const startUrl = isDev
    ? "http://localhost:5180"
    : `file://${path.join(app.getAppPath(), "dist/index.html")}`

export const CHROME_VERSION = "131.0.6778.265"
export const CHROME_DESKTOP_UA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`
const CHROME_BRANDS = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"'
const CHROME_FULL_VERSION_LIST = `"Google Chrome";v="${CHROME_VERSION}", "Chromium";v="${CHROME_VERSION}", "Not_A Brand";v="24.0.0.0"`

function setHeaderClean(headers: Record<string, string>, targetName: string, value: string) {
    const targetLower = targetName.toLowerCase()
    let foundKey: string | null = null
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === targetLower) {
            if (!foundKey) {
                foundKey = key
            } else {
                delete headers[key]
            }
        }
    }
    const keyToUse = foundKey || targetName
    headers[keyToUse] = value
}

export class BrowserWindowHelper {
    private browserWindow: BrowserWindow | null = null
    private windowHelper: WindowHelper | null = null
    private screenshotHelper: ScreenshotHelper | null = null
    private contentProtection: boolean = false
    private sessionConfigured: boolean = false

    constructor() {
        this.initStealthSession()

        // Ensure any child popup windows (e.g. Google OAuth login dialogs) inherit screen protection & user agent
        app.on("browser-window-created", (_, win) => {
            if (!win.isDestroyed()) {
                try {
                    win.webContents.setUserAgent(CHROME_DESKTOP_UA)
                } catch (e) {}
            }
            if (this.contentProtection && !win.isDestroyed()) {
                try {
                    win.setContentProtection(true)
                } catch (e) {
                    console.warn("[BrowserWindowHelper] Failed to apply content protection to child window:", e)
                }
            }
        })
    }

    public getGuestPreloadPath(): string {
        let p = path.join(__dirname, "stealthGuestPreload.js")
        if (!fs.existsSync(p)) {
            const unpacked = p.replace("app.asar", "app.asar.unpacked")
            if (fs.existsSync(unpacked)) {
                p = unpacked
            }
        }
        return p
    }

    public getGuestPreloadUrl(): string {
        return url.pathToFileURL(this.getGuestPreloadPath()).href
    }

    public initStealthSession(): void {
        if (this.sessionConfigured) return

        try {
            const stealthSession = session.fromPartition("persist:stealth-browser")

            // 1. Force the session User-Agent to clean Chrome desktop
            stealthSession.setUserAgent(CHROME_DESKTOP_UA)

            // 2. Register guest preload script with Chrome navigator properties
            const guestPreloadPath = this.getGuestPreloadPath()
            if (fs.existsSync(guestPreloadPath)) {
                try {
                    if (typeof (stealthSession as any).registerPreloadScript === "function") {
                        (stealthSession as any).registerPreloadScript({ filePath: guestPreloadPath })
                    } else if (typeof (stealthSession as any).setPreloads === "function") {
                        (stealthSession as any).setPreloads([guestPreloadPath])
                    }
                } catch (e) {
                    console.warn("[BrowserWindowHelper] Could not register preload script on session:", e)
                }
            }

            // 3. Intercept outgoing request headers to sanitize client hints & remove Electron markers
            stealthSession.webRequest.onBeforeSendHeaders((details, callback) => {
                const headers = { ...details.requestHeaders }

                // Always enforce clean desktop Chrome User-Agent without case duplication
                setHeaderClean(headers, "User-Agent", CHROME_DESKTOP_UA)

                // Replace/clean Sec-CH-UA client hints to match genuine Google Chrome without casing duplicates
                const hasHeader = (name: string) => Object.keys(headers).some(k => k.toLowerCase() === name.toLowerCase())

                if (hasHeader("sec-ch-ua")) {
                    setHeaderClean(headers, "Sec-CH-UA", CHROME_BRANDS)
                }
                if (hasHeader("sec-ch-ua-full-version-list")) {
                    setHeaderClean(headers, "Sec-CH-UA-Full-Version-List", CHROME_FULL_VERSION_LIST)
                }
                if (hasHeader("sec-ch-ua-mobile")) {
                    setHeaderClean(headers, "Sec-CH-UA-Mobile", "?0")
                }
                if (hasHeader("sec-ch-ua-platform")) {
                    setHeaderClean(headers, "Sec-CH-UA-Platform", '"macOS"')
                }
                if (hasHeader("sec-ch-ua-platform-version")) {
                    setHeaderClean(headers, "Sec-CH-UA-Platform-Version", '"15.2.0"')
                }
                if (hasHeader("sec-ch-ua-arch")) {
                    setHeaderClean(headers, "Sec-CH-UA-Arch", '"arm"')
                }
                if (hasHeader("sec-ch-ua-bitness")) {
                    setHeaderClean(headers, "Sec-CH-UA-Bitness", '"64"')
                }
                if (hasHeader("sec-ch-ua-model")) {
                    setHeaderClean(headers, "Sec-CH-UA-Model", '""')
                }

                // Strip any residual Electron markers from custom headers
                for (const key of Object.keys(headers)) {
                    if (typeof headers[key] === "string" && headers[key].includes("Electron/")) {
                        headers[key] = headers[key].replace(/Electron\/[\d.]+\s?/g, "")
                    }
                }

                callback({ requestHeaders: headers })
            })

            // 4. Intercept incoming responses on authentication endpoints to strip accept-ch query challenges
            stealthSession.webRequest.onHeadersReceived((details, callback) => {
                const headers = { ...details.responseHeaders }
                const urlLower = details.url.toLowerCase()
                if (urlLower.includes("accounts.google.com") || urlLower.includes("openai.com")) {
                    delete headers["accept-ch"]
                    delete headers["Accept-CH"]
                }
                callback({ responseHeaders: headers })
            })

            this.sessionConfigured = true
            console.log("[BrowserWindowHelper] persist:stealth-browser session configured with Chrome 131 identity")
        } catch (err) {
            console.error("[BrowserWindowHelper] Failed to configure stealth session:", err)
        }
    }

    public setWindowHelper(wh: WindowHelper): void {
        this.windowHelper = wh
    }

    public setScreenshotHelper(sh: ScreenshotHelper): void {
        this.screenshotHelper = sh
    }

    public getWindow(): BrowserWindow | null {
        return this.browserWindow
    }

    public setContentProtection(enable: boolean): void {
        if (this.contentProtection === enable) return
        this.contentProtection = enable
        if (this.browserWindow && !this.browserWindow.isDestroyed()) {
            this.browserWindow.setContentProtection(enable)
        }
    }

    public reassertContentProtection(): void {
        if (this.browserWindow && !this.browserWindow.isDestroyed()) {
            this.browserWindow.setContentProtection(this.contentProtection)
        }
    }

    public toggleWindow(initialUrl?: string): void {
        if (this.browserWindow && !this.browserWindow.isDestroyed()) {
            if (this.browserWindow.isVisible()) {
                this.browserWindow.hide()
            } else {
                this.showWindow(initialUrl)
            }
        } else {
            this.createWindow(initialUrl)
        }
    }

    public showWindow(initialUrl?: string): void {
        if (!this.browserWindow || this.browserWindow.isDestroyed()) {
            this.createWindow(initialUrl)
            return
        }

        if (initialUrl) {
            this.browserWindow.webContents.send("browser:navigate-to", initialUrl)
        }

        this.browserWindow.setContentProtection(this.contentProtection)
        this.browserWindow.show()
        this.browserWindow.focus()
    }

    public hideWindow(): void {
        if (this.browserWindow && !this.browserWindow.isDestroyed()) {
            this.browserWindow.hide()
        }
    }

    public copyLatestScreenshotToClipboard(): boolean {
        try {
            const queue = this.screenshotHelper?.getScreenshotQueue() || []
            const extraQueue = this.screenshotHelper?.getExtraScreenshotQueue() || []
            const latestPath = extraQueue[extraQueue.length - 1] || queue[queue.length - 1]

            if (!latestPath) {
                console.warn("[BrowserWindowHelper] No screenshot available in queue to copy")
                return false
            }

            const img = nativeImage.createFromPath(latestPath)
            if (img.isEmpty()) {
                console.warn(`[BrowserWindowHelper] Screenshot image is empty: ${latestPath}`)
                return false
            }

            clipboard.writeImage(img)
            console.log(`[BrowserWindowHelper] Successfully copied screenshot to clipboard: ${latestPath}`)
            return true
        } catch (err) {
            console.error("[BrowserWindowHelper] Error copying screenshot to clipboard:", err)
            return false
        }
    }

    private createWindow(initialUrl?: string): void {
        this.initStealthSession()

        const primaryDisplay = screen.getPrimaryDisplay()
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

        const winWidth = Math.min(1200, Math.round(screenWidth * 0.85))
        const winHeight = Math.min(850, Math.round(screenHeight * 0.85))

        const x = Math.round((screenWidth - winWidth) / 2)
        const y = Math.round((screenHeight - winHeight) / 2)

        const isMac = process.platform === "darwin"

        this.browserWindow = new BrowserWindow({
            width: winWidth,
            height: winHeight,
            minWidth: 550,
            minHeight: 400,
            x,
            y,
            frame: false,
            titleBarStyle: isMac ? "hiddenInset" : "default",
            backgroundColor: "#121214",
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                webviewTag: true,
                preload: path.join(__dirname, "preload.js"),
                backgroundThrottling: false,
            },
        })

        this.browserWindow.setContentProtection(this.contentProtection)

        // Attach to the webview once mounted in the renderer
        this.browserWindow.webContents.on("did-attach-webview", (_, webviewContents) => {
            // Enforce clean user agent on the webview webContents
            webviewContents.setUserAgent(CHROME_DESKTOP_UA)

            // Intercept window.open calls from within the webview (e.g. Google OAuth login popup)
            webviewContents.setWindowOpenHandler((details) => {
                const guestPreloadPath = this.getGuestPreloadPath()
                return {
                    action: "allow",
                    overrideBrowserWindowOptions: {
                        width: 520,
                        height: 680,
                        title: "Sign In",
                        autoHideMenuBar: true,
                        backgroundColor: "#121214",
                        show: true,
                        webPreferences: {
                            partition: "persist:stealth-browser",
                            contextIsolation: true,
                            nodeIntegration: false,
                            preload: fs.existsSync(guestPreloadPath) ? guestPreloadPath : undefined,
                        },
                    },
                }
            })
        })

        const queryParams = new URLSearchParams()
        queryParams.set("window", "browser")
        queryParams.set("guestPreload", this.getGuestPreloadUrl())
        if (initialUrl) {
            queryParams.set("url", initialUrl)
        }

        const targetUrl = `${startUrl}?${queryParams.toString()}`
        this.browserWindow.loadURL(targetUrl).catch((err) => {
            console.error("[BrowserWindowHelper] Failed to load browser window URL:", err)
        })

        this.browserWindow.once("ready-to-show", () => {
            if (this.browserWindow && !this.browserWindow.isDestroyed()) {
                this.browserWindow.setContentProtection(this.contentProtection)
                this.browserWindow.show()
                this.browserWindow.focus()
            }
        })

        this.browserWindow.on("closed", () => {
            this.browserWindow = null
        })
    }
}
