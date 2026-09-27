import type { AutoTypePermissionKind } from "../../src/types/autotype";

export function describeAutoTypeFailure(stderr: string, appName: string): { message: string; code?: AutoTypePermissionKind } {
    // -1743 is Apple Events/Automation, not Accessibility. The two grants are
    // independent, so sending the user back to the wrong pane cannot fix it.
    if (/-1743|not (?:authorized|authorised|permitted|allowed) to send apple events/i.test(stderr)) {
        return {
            code: "automation",
            message: `macOS blocked Automation access to System Events. In System Settings → Privacy & Security → Automation, enable System Events under ${appName}. If it is already enabled, fully quit and reopen ${appName}, then retry.`,
        };
    }
    if (/-1719|-25211|not allowed (?:to send keystrokes|assistive access)|assistive access|accessibility (?:access|permission|denied)/i.test(stderr)) {
        return {
            code: "accessibility",
            message: `macOS has not granted keyboard control to this running copy of ${appName}. Check Accessibility (Device Control and Data Access on newer macOS). If it is already enabled, fully quit and reopen ${appName}, then retry.`,
        };
    }
    return { message: stderr.trim() || "Auto-typing exited unexpectedly." };
}
