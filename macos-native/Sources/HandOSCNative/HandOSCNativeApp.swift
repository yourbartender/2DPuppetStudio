import SwiftUI
import AppKit

extension Notification.Name {
    public static let saveCharacterPackageRequested = Notification.Name("HandOSC.SaveCharacterPackageRequested")
    public static let exportRigOnlyRequested = Notification.Name("HandOSC.ExportRigOnlyRequested")
    public static let importCharacterRequested = Notification.Name("HandOSC.ImportCharacterRequested")
}

@main
struct HandOSCNativeApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup("HandOSC Native") {
            ContentView()
                .frame(minWidth: 1080, minHeight: 680)
        }
        .defaultSize(width: 1360, height: 860)
        .commands {
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
