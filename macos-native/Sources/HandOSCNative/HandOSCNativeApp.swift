import SwiftUI
import AppKit

extension Notification.Name {
    public static let newPuppetRequested = Notification.Name("PuppetStudio.NewPuppetRequested")
    public static let importPSDRequested = Notification.Name("PuppetStudio.ImportPSDRequested")
    public static let saveCharacterPackageRequested = Notification.Name("PuppetStudio.SaveCharacterPackageRequested")
    public static let exportRigOnlyRequested = Notification.Name("PuppetStudio.ExportRigOnlyRequested")
    public static let importCharacterRequested = Notification.Name("PuppetStudio.ImportCharacterRequested")
    public static let undoRequested = Notification.Name("PuppetStudio.UndoRequested")
    public static let redoRequested = Notification.Name("PuppetStudio.RedoRequested")
}

@main
struct HandOSCNativeApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup("Puppet Studio") {
            ContentView()
                .frame(minWidth: 1080, minHeight: 680)
        }
        .defaultSize(width: 1360, height: 860)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Character…") {
                    NotificationCenter.default.post(name: .newPuppetRequested, object: nil)
                }
                .keyboardShortcut("n", modifiers: .command)

                Button("Import Photoshop Document (.PSD)…") {
                    NotificationCenter.default.post(name: .importPSDRequested, object: nil)
                }
                .keyboardShortcut("i", modifiers: [.command, .shift])
            }

            CommandGroup(replacing: .undoRedo) {
                Button("Undo") {
                    NotificationCenter.default.post(name: .undoRequested, object: nil)
                }
                .keyboardShortcut("z", modifiers: .command)

                Button("Redo") {
                    NotificationCenter.default.post(name: .redoRequested, object: nil)
                }
                .keyboardShortcut("z", modifiers: [.command, .shift])
            }

            CommandGroup(replacing: .saveItem) {
                Button("Save Character Package…") {
                    NotificationCenter.default.post(name: .saveCharacterPackageRequested, object: nil)
                }
                .keyboardShortcut("s", modifiers: .command)

                Button("Export Rig Only…") {
                    NotificationCenter.default.post(name: .exportRigOnlyRequested, object: nil)
                }
                .keyboardShortcut("s", modifiers: [.option, .command])

                Button("Open Character…") {
                    NotificationCenter.default.post(name: .importCharacterRequested, object: nil)
                }
                .keyboardShortcut("o", modifiers: .command)
            }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        UserDefaults.standard.set(true, forKey: "ApplePersistenceIgnoreState")
        UserDefaults.standard.set(false, forKey: "NSQuitAlwaysKeepsWindows")
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        // Prevent AppKit from prompting to restore old window states or halting on crash dialogs
        false
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
