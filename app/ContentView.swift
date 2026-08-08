import SwiftUI
import AppKit

struct ContentView: View {
    /// Bindable for the divider below, which writes the width straight back into settings.
    @Bindable private var settings = AppSettings.shared
    private let manager = MdBossManager.shared

    private var theme: Theme { settings.theme }

    var body: some View {
        ZStack(alignment: .bottom) {
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    if settings.showSidebar {
                        SidebarView(tree: manager.tree)
                            .frame(width: settings.sidebarWidth)
                        PaneDivider.width($settings.data.sidebarWidth, theme: theme, min: 160, max: 520)
                    }

                    contentArea
                        .frame(minWidth: 460, maxWidth: .infinity, maxHeight: .infinity)
                }

                StatusBarView(url: manager.selectedFile)
            }

            ToastView()
        }
        .frame(minWidth: 720, minHeight: 480)
        .background(theme[.bg])
        .background(WindowAccessor())
    }

    // DocumentPane owns the empty state now - the notes pane is useful with no file open.
    private var contentArea: some View { DocumentPane() }
}

struct EmptyPane: View {
    let theme: Theme
    let message: String

    var body: some View {
        VStack {
            Spacer()
            Text(message)
                .textStyle(.default)
                .foregroundColor(theme[.muted])
                .multilineTextAlignment(.center)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Window frame persistence

/// Restores the saved window frame on launch and records moves and resizes.
/// Ported from the sibling project's ContentView.
struct WindowAccessor: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            guard let window = view.window else { return }
            let settings = AppSettings.shared

            if let x = settings.windowX, let y = settings.windowY,
               let width = settings.windowWidth, let height = settings.windowHeight {
                window.setFrame(NSRect(x: x, y: y, width: width, height: height), display: true)
            }

            for name in [NSWindow.didMoveNotification, NSWindow.didResizeNotification] {
                NotificationCenter.default.addObserver(
                    context.coordinator,
                    selector: #selector(Coordinator.windowFrameChanged(_:)),
                    name: name,
                    object: window
                )
            }
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    @MainActor
    final class Coordinator: NSObject {
        @objc func windowFrameChanged(_ notification: Notification) {
            guard let window = notification.object as? NSWindow else { return }
            let frame = window.frame
            let settings = AppSettings.shared
            settings.windowX = frame.origin.x
            settings.windowY = frame.origin.y
            settings.windowWidth = frame.size.width
            settings.windowHeight = frame.size.height
        }
    }
}
