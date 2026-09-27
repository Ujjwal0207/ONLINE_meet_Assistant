import type { AutoTypeMode } from "../../src/types/autotype";

export interface AutoTypeUnit {
    text: string;
    delayMs: number;
}

/** Keep every source character, including tabs, blank lines and CRLF pairs. */
export function buildAutoTypeUnits(code: string, mode: AutoTypeMode, delayMs: number, perCharacter: boolean): AutoTypeUnit[] {
    if (mode === "instant") return [{ text: code, delayMs: 0 }];
    const tokens = mode === "word" ? code.match(/\S+|\s+/gu) || [] : [code];
    const units: AutoTypeUnit[] = [];
    for (const token of tokens) {
        const characters = token.match(/\r\n|[\s\S]/gu) || [];
        // Bound each paste so even a minified line remains interruptible.
        // Insert whitespace individually as well: a multi-line paste can invoke
        // an editor's paste reindentation even when typed auto-indent is bypassed.
        const chunkSize = mode === "char" || /^\s+$/u.test(token) ? 1 : 8;
        for (let index = 0; index < characters.length; index += chunkSize) {
            const chunk = characters.slice(index, index + chunkSize);
            units.push({ text: chunk.join(""), delayMs: delayMs * (perCharacter ? chunk.length : 1) });
        }
    }
    return units;
}

/** JXA runs separately from Electron so its native calls cannot block Stop/Escape. */
export const AUTO_TYPE_SCRIPT = String.raw`
ObjC.import("AppKit");
ObjC.import("Foundation");

function readText(path) {
    return $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null).js;
}
function writeText(path, text) {
    if (!$(text).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null)) {
        throw new Error("Could not prepare auto-typing files.");
    }
}
function snapshotClipboard(pb) {
    var snapshot = [];
    var items = pb.pasteboardItems;
    for (var i = 0; i < items.count; i++) {
        var item = items.objectAtIndex(i);
        var values = [];
        var types = item.types;
        for (var j = 0; j < types.count; j++) {
            var type = types.objectAtIndex(j);
            var data = item.dataForType(type);
            if (data) values.push({ type: type.js, data: data.base64EncodedStringWithOptions(0).js });
        }
        snapshot.push(values);
    }
    return snapshot;
}
function restoreClipboard(pb, config) {
    if (!$.NSFileManager.defaultManager.fileExistsAtPath(config.changePath)) return;
    // A user's newer clipboard entry belongs to them; never overwrite it.
    if (Number(readText(config.changePath)) !== Number(pb.changeCount)) return;
    var snapshot = JSON.parse(readText(config.recoveryPath));
    var restored = snapshot.map(function(values) {
        var item = $.NSPasteboardItem.alloc.init;
        values.forEach(function(value) {
            var data = $.NSData.alloc.initWithBase64EncodedStringOptions(value.data, 0);
            item.setDataForType(data, value.type);
        });
        return item;
    });
    pb.clearContents;
    if (restored.length) pb.writeObjects($(restored));
}
function run(argv) {
    var config = JSON.parse(readText(argv[0]));
    var pb = $.NSPasteboard.generalPasteboard;
    if (argv[1] === "restore") {
        restoreClipboard(pb, config);
        return;
    }
    var systemEvents = Application("System Events");
    var files = $.NSFileManager.defaultManager;
    function active() { return files.fileExistsAtPath(config.markerPath); }
    if (!active()) return;
    writeText(config.recoveryPath, JSON.stringify(snapshotClipboard(pb)));
    var ownedChangeCount = Number(pb.changeCount);
    try {
        for (var i = 0; i < config.units.length && active(); i++) {
            var unit = config.units[i];
            if (Number(pb.changeCount) !== ownedChangeCount) {
                throw new Error("Clipboard changed during auto-typing. Stopped to keep your copied content.");
            }
            var startedAt = Date.now();
            pb.clearContents;
            pb.setStringForType(unit.text, $.NSPasteboardTypeString);
            ownedChangeCount = Number(pb.changeCount);
            writeText(config.changePath, String(ownedChangeCount));
            if (!active()) break;
            // Pasting literal text bypasses typed Enter/Tab/brace auto-indent and
            // completion handlers. No spaces or indentation are synthesized.
            systemEvents.keystroke("v", { using: ["command down"] });
            // Let the receiving app consume this paste before changing/restoring
            // the pasteboard. Delay slices keep even slow word mode cancellable.
            var deadline = Math.max(startedAt + unit.delayMs, Date.now() + 40);
            while (Date.now() < deadline && active()) {
                delay(Math.min(0.02, Math.max(0, deadline - Date.now()) / 1000));
            }
            if (!active()) { delay(0.04); break; }
        }
    } finally {
        restoreClipboard(pb, config);
    }
}
`;
