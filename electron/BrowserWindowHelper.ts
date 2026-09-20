import { BrowserWindow, screen, app, clipboard, nativeImage } from "electron"
import path from "node:path"
import type { WindowHelper } from "./WindowHelper"
import type { ScreenshotHelper } from "./ScreenshotHelper"

const isDev = process.env.NODE_ENV === "development"

const startUrl = isDev
    ? "http://localhost:5180"
    : `file://${path.join(app.getAppPath(), "dist/index.html")}`

export class BrowserWindowHelper {
    private browserWindow: BrowserWindow | null = null
    private windowHelper: WindowHelper | null = null
    private screenshotHelper: ScreenshotHelper | null = null
    private contentProtection: boolean = false

    constructor() {}

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

        const queryParams = new URLSearchParams()
        queryParams.set("window", "browser")
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
