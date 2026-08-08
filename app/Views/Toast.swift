import SwiftUI

/// Transient messages, from anywhere in the app: `Toast.shared.info("Copied")`.
///
/// Global on purpose - models, menu commands and the web-view bridge all need to say
/// something to the user, and none of them can reach a view.
@MainActor
@Observable
final class Toast {
    static let shared = Toast()

    enum Kind {
        case info
        case success
        case error

        var icon: String {
            switch self {
            case .info: return "info.circle"
            case .success: return "checkmark.circle"
            case .error: return "exclamationmark.triangle"
            }
        }
    }

    struct Message: Identifiable, Equatable {
        let id = UUID()
        let text: String
        let kind: Kind

        static func == (lhs: Self, rhs: Self) -> Bool { lhs.id == rhs.id }
    }

    private(set) var current: Message?

    private var dismissTask: Task<Void, Never>?

    private init() {}

    func info(_ text: String) { show(text, kind: .info) }

    func success(_ text: String) { show(text, kind: .success) }

    func error(_ text: String) { show(text, kind: .error, seconds: 6) }

    func dismiss() {
        dismissTask?.cancel()
        current = nil
    }

    private func show(_ text: String, kind: Kind, seconds: Double = 3) {
        dismissTask?.cancel()
        current = Message(text: text, kind: kind)

        dismissTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.current = nil
        }
    }
}

// MARK: - View

struct ToastView: View {
    private let toast = Toast.shared
    private let settings = AppSettings.shared

    private var theme: Theme { settings.theme }

    var body: some View {
        if let message = toast.current {
            HStack(spacing: 7) {
                Image(systemName: message.kind.icon)
                    .iconStyle(.buttons, scale: 0.9, weight: .medium)
                Text(message.text)
                    .textStyle(.buttons)
                    .lineLimit(2)
            }
            .foregroundColor(message.kind == .error ? theme[.accent] : theme[.text])
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(theme[.surface])
                    .shadow(color: .black.opacity(0.18), radius: 12, y: 3)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(message.kind == .error ? theme[.accent] : theme[.border], lineWidth: 1)
            )
            .padding(.bottom, 34)
            .onTapGesture { toast.dismiss() }
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .animation(.easeOut(duration: 0.18), value: message.id)
        }
    }
}
