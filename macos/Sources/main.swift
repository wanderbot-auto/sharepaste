import AppKit
import Foundation
import SwiftUI

struct CliOptions {
    var server: String
    var statePath: String?
    var deviceName: String?
}

struct DeviceState: Codable {
    let deviceId: String
    let groupId: String
    let deviceName: String
    let recoveryPhrase: String
}

struct BindCode: Codable {
    let code: String
    let expiresAtUnix: String
    let attemptsLeft: Int
}

struct DeviceInfo: Codable, Identifiable {
    let deviceId: String
    let name: String
    let platform: String
    let groupId: String

    var id: String { deviceId }
}

struct SharePolicy: Codable {
    let allowText: Bool
    let allowImage: Bool
    let allowFile: Bool
    let maxFileSizeBytes: Int
    let version: Int
    let allowEncryption: Bool? // Optional to support older clients/servers
}

struct SyncStatus: Codable {
    let running: Bool
    let pid: Int32?
}

private struct DeviceListResponse: Codable {
    let devices: [DeviceInfo]
}

private struct RemoveDeviceResponse: Codable {
    let removed: Bool
}

struct BindRequestResponse: Codable {
    let requestId: String
    let expiresAtUnix: String
}

struct ConfirmBindResponse: Codable {
    let approved: Bool
    let groupId: String
}

private enum BridgeError: LocalizedError {
    case invalidRepoRoot
    case commandFailed(command: String, detail: String)
    case noJSONOutput

    var errorDescription: String? {
        switch self {
        case .invalidRepoRoot:
            return "Cannot resolve repository root. Set SHAREPASTE_REPO_ROOT if needed."
        case let .commandFailed(command, detail):
            return "Command failed: \(command)\n\(detail)"
        case .noJSONOutput:
            return "Client returned no JSON output."
        }
    }
}

actor SharePasteBridge {
    private var syncProcess: Process?

    func initDevice(options: CliOptions) throws -> DeviceState {
        try runClientJSON(options: options, subcommand: "init", subArgs: [], as: DeviceState.self)
    }

    func recoverGroup(options: CliOptions, phrase: String) throws -> DeviceState {
        guard let deviceName = options.deviceName, !deviceName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw BridgeError.commandFailed(command: "recover", detail: "deviceName is required for recovery")
        }

        return try runClientJSON(
            options: options,
            subcommand: "recover",
            subArgs: ["--phrase", phrase, "--name", deviceName],
            as: DeviceState.self
        )
    }

    func listDevices(options: CliOptions) throws -> [DeviceInfo] {
        let response = try runClientJSON(options: options, subcommand: "devices", subArgs: [], as: DeviceListResponse.self)
        return response.devices
    }

    func removeDevice(options: CliOptions, targetDeviceId: String) throws -> Bool {
        let response = try runClientJSON(
            options: options,
            subcommand: "remove-device",
            subArgs: ["--target-device-id", targetDeviceId],
            as: RemoveDeviceResponse.self
        )
        return response.removed
    }

    func getPolicy(options: CliOptions) throws -> SharePolicy {
        try runClientJSON(options: options, subcommand: "policy-get", subArgs: [], as: SharePolicy.self)
    }

    func updatePolicy(
        options: CliOptions,
        allowText: Bool,
        allowImage: Bool,
        allowFile: Bool,
        allowEncryption: Bool,
        maxFileSizeBytes: Int
    ) throws -> SharePolicy {
        return try runClientJSON(
            options: options,
            subcommand: "policy",
            subArgs: [
                "--allow-text", String(allowText),
                "--allow-image", String(allowImage),
                "--allow-file", String(allowFile),
                "--allow-encryption", String(allowEncryption),
                "--max-file-size", String(maxFileSizeBytes)
            ],
            as: SharePolicy.self
        )
    }

    func createBindCode(options: CliOptions) throws -> BindCode {
        try runClientJSON(options: options, subcommand: "bind-code", subArgs: [], as: BindCode.self)
    }

    func requestBind(options: CliOptions, code: String) throws -> BindRequestResponse {
        try runClientJSON(options: options, subcommand: "bind-request", subArgs: ["--code", code], as: BindRequestResponse.self)
    }

    func confirmBind(options: CliOptions, requestId: String, approve: Bool) throws -> ConfirmBindResponse {
        var args = ["--request-id", requestId]
        if approve {
            args.append("--approve")
        }
        return try runClientJSON(options: options, subcommand: "bind-confirm", subArgs: args, as: ConfirmBindResponse.self)
    }

    func syncStatus() -> SyncStatus {
        if let process = syncProcess, process.isRunning {
            return SyncStatus(running: true, pid: process.processIdentifier)
        }

        syncProcess = nil
        return SyncStatus(running: false, pid: nil)
    }

    func startSync(options: CliOptions) throws -> SyncStatus {
        if let process = syncProcess, process.isRunning {
            return SyncStatus(running: true, pid: process.processIdentifier)
        }

        syncProcess = nil

        let root = try resolveRepoRoot()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.currentDirectoryURL = root
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        process.arguments = ["npm", "run", "--silent", "-w", "client", "dev", "--"]
            + globalClientArgs(options: options)
            + ["run"]

        do {
            try process.run()
            syncProcess = process
            return SyncStatus(running: true, pid: process.processIdentifier)
        } catch {
            throw BridgeError.commandFailed(command: "start sync", detail: error.localizedDescription)
        }
    }

    func stopSync() -> SyncStatus {
        if let process = syncProcess {
            if process.isRunning {
                process.terminate()
                process.waitUntilExit()
            }
            syncProcess = nil
        }

        return SyncStatus(running: false, pid: nil)
    }

    private func runClientJSON<T: Decodable>(
        options: CliOptions,
        subcommand: String,
        subArgs: [String],
        as type: T.Type
    ) throws -> T {
        let root = try resolveRepoRoot()

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.currentDirectoryURL = root

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        process.arguments = ["npm", "run", "--silent", "-w", "client", "dev", "--"]
            + globalClientArgs(options: options)
            + ["--json", subcommand]
            + subArgs

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            throw BridgeError.commandFailed(command: subcommand, detail: error.localizedDescription)
        }

        let outData = stdout.fileHandleForReading.readDataToEndOfFile()
        let errData = stderr.fileHandleForReading.readDataToEndOfFile()

        let outText = String(data: outData, encoding: .utf8) ?? ""
        let errText = String(data: errData, encoding: .utf8) ?? ""

        guard process.terminationStatus == 0 else {
            let detail = "stderr: \(errText.trimmingCharacters(in: .whitespacesAndNewlines))\nstdout: \(outText.trimmingCharacters(in: .whitespacesAndNewlines))"
            throw BridgeError.commandFailed(command: subcommand, detail: detail)
        }

        let lineJSON = try extractLastJSONLine(from: outText)
        let decoder = JSONDecoder()
        return try decoder.decode(type, from: lineJSON)
    }

    private func extractLastJSONLine(from output: String) throws -> Data {
        for line in output.split(separator: "\n").reversed() {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else {
                continue
            }

            if let data = trimmed.data(using: .utf8),
               (try? JSONSerialization.jsonObject(with: data)) != nil {
                return data
            }
        }

        throw BridgeError.noJSONOutput
    }

    private func globalClientArgs(options: CliOptions) -> [String] {
        var args = ["--server", options.server]

        if let statePath = options.statePath, !statePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            args += ["--state", statePath]
        }

        if let deviceName = options.deviceName, !deviceName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            args += ["--name", deviceName]
        }

        return args
    }

    private func resolveRepoRoot() throws -> URL {
        if let forced = ProcessInfo.processInfo.environment["SHAREPASTE_REPO_ROOT"], !forced.isEmpty {
            let url = URL(fileURLWithPath: forced)
            if isRepoRoot(url) {
                return url
            }
        }

        var current = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        for _ in 0..<8 {
            if isRepoRoot(current) {
                return current
            }
            current.deleteLastPathComponent()
        }

        var executable = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
        executable.deleteLastPathComponent()
        for _ in 0..<10 {
            if isRepoRoot(executable) {
                return executable
            }
            executable.deleteLastPathComponent()
        }

        throw BridgeError.invalidRepoRoot
    }

    private func isRepoRoot(_ url: URL) -> Bool {
        let packageJSON = url.appendingPathComponent("package.json")
        guard FileManager.default.fileExists(atPath: packageJSON.path) else {
            return false
        }

        guard let data = try? Data(contentsOf: packageJSON),
              let content = String(data: data, encoding: .utf8) else {
            return false
        }

        return content.contains("\"name\": \"sharepaste\"")
    }
}

enum ConnectionState {
    case disconnected
    case connecting
    case connected
}

@MainActor
final class AppViewModel: ObservableObject {
    @Published var connectionState: ConnectionState = .disconnected
    @Published var server = "127.0.0.1:50051"
    @Published var statePath = ""
    @Published var deviceName = "my-mac"

    @Published var deviceState: DeviceState?
    @Published var devices: [DeviceInfo] = []

    @Published var policyLoaded = false
    @Published var policyVersion = 0
    @Published var policyAllowText = true
    @Published var policyAllowImage = true
    @Published var policyAllowFile = true
    @Published var policyAllowEncryption = true
    @Published var policyMaxFileSizeBytes = 3 * 1024 * 1024

    @Published var bindCode: BindCode?
    @Published var syncStatus = SyncStatus(running: false, pid: nil)

    @Published var bindInputCode = ""
    @Published var requestId = ""
    @Published var removeTargetId = ""
    @Published var recoveryPhrase = ""
    @Published var busy = false
    @Published var message = "Ready"
    @Published var showSettings = false

    // Connection Monitoring
    @Published var connectionTimeout: Int = 5
    @Published var remainingSeconds: Int = 0
    private var connectionAttemptStartTime: Date?
    private var isMonitoring = false

    private let bridge = SharePasteBridge()

    var options: CliOptions {
        CliOptions(
            server: server,
            statePath: statePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : statePath,
            deviceName: deviceName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : deviceName
        )
    }

    init() {
        // Load timeout from environment or default
        if let envTimeout = ProcessInfo.processInfo.environment["CONNECTION_TIMEOUT"], 
           let timeout = Int(envTimeout), timeout > 0 {
            self.connectionTimeout = timeout
        }
        log("App initialized. Connection timeout set to \(connectionTimeout)s")
    }

    func refreshSyncStatus() async {
        if !isMonitoring {
            startMonitoring()
        }
    }
    
    func startMonitoring() {
        guard !isMonitoring else { return }
        isMonitoring = true
        
        Task {
            log("Starting connection monitoring loop")
            while !Task.isCancelled {
                await checkConnectionStatus()
                
                // Dynamic sleep interval
                let sleepSeconds: UInt64
                if connectionState == .connecting {
                    sleepSeconds = 1 // Update countdown every second
                } else {
                    sleepSeconds = 4 // Regular check interval
                }
                
                try? await Task.sleep(nanoseconds: sleepSeconds * 1_000_000_000)
            }
        }
    }
    
    private func log(_ msg: String) {
        let timestamp = ISO8601DateFormatter().string(from: Date())
        print("[\(timestamp)] \(msg)")
    }
    
    private func checkConnectionStatus() async {
        do {
            // 1. Check if process is running
            let status = await bridge.syncStatus()
            self.syncStatus = status
            
            if !status.running {
                if connectionState != .disconnected {
                    log("State changed: \(connectionState) -> disconnected (Process stopped)")
                    connectionState = .disconnected
                    connectionAttemptStartTime = nil
                }
                return
            }
            
            // 2. Process running, check server connectivity
            // Use 'list' command as ping
            do {
                _ = try await bridge.listDevices(options: options)
                
                // Success
                if connectionState != .connected {
                    log("State changed: \(connectionState) -> connected (Server reachable)")
                    connectionState = .connected
                    connectionAttemptStartTime = nil
                }
            } catch {
                // Failure
                handleConnectionFailure(error: error)
            }
            
        } catch {
            // Status check failed (CLI error)
            log("Status check failed: \(error)")
            if connectionState != .disconnected {
                 log("State changed: \(connectionState) -> disconnected (CLI error)")
                 connectionState = .disconnected
                 connectionAttemptStartTime = nil
            }
            self.syncStatus = SyncStatus(running: false, pid: nil)
        }
    }
    
    private func handleConnectionFailure(error: Error) {
        if connectionState == .connected {
            log("Connection lost: \(error). Switching to connecting...")
            connectionState = .connecting
            connectionAttemptStartTime = Date()
            remainingSeconds = connectionTimeout
            return
        }
        
        if connectionState == .disconnected {
             log("Process running, attempting connection...")
             connectionState = .connecting
             connectionAttemptStartTime = Date()
             remainingSeconds = connectionTimeout
             return
        }
        
        if connectionState == .connecting {
            // Check timeout
            if let start = connectionAttemptStartTime {
                let elapsed = Int(Date().timeIntervalSince(start))
                remainingSeconds = max(0, connectionTimeout - elapsed)
                
                if elapsed >= connectionTimeout {
                    log("Connection timeout after \(elapsed)s. Error: \(error)")
                    connectionState = .disconnected
                    connectionAttemptStartTime = nil
                } 
            } else {
                connectionAttemptStartTime = Date()
                remainingSeconds = connectionTimeout
            }
        }
    }

    func initializeDevice() async {
        await runAction {
            guard !self.deviceName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw BridgeError.commandFailed(command: "init", detail: "device name is required")
            }
            let state = try await self.bridge.initDevice(options: self.options)
            self.deviceState = state
            let status = await self.bridge.syncStatus()
            if status.running {
                self.syncStatus = status
            } else {
                self.syncStatus = try await self.bridge.startSync(options: self.options)
            }
            return "Initialized \(state.deviceId). Clipboard auto-upload enabled."
        }
    }

    func recoverGroup() async {
        await runAction {
            guard !self.recoveryPhrase.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw BridgeError.commandFailed(command: "recover", detail: "recovery phrase is required")
            }
            let state = try await self.bridge.recoverGroup(options: self.options, phrase: self.recoveryPhrase)
            self.deviceState = state
            let status = await self.bridge.syncStatus()
            if status.running {
                self.syncStatus = status
            } else {
                self.syncStatus = try await self.bridge.startSync(options: self.options)
            }
            return "Recovered into group \(state.groupId). Clipboard auto-upload enabled."
        }
    }

    func loadDevices() async {
        await runAction {
            self.devices = try await self.bridge.listDevices(options: self.options)
            return "Loaded \(self.devices.count) devices"
        }
    }

    func removeDevice() async {
        await runAction {
            let target = self.removeTargetId.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !target.isEmpty else {
                throw BridgeError.commandFailed(command: "remove-device", detail: "target device id is required")
            }
            let removed = try await self.bridge.removeDevice(options: self.options, targetDeviceId: target)
            self.devices = try await self.bridge.listDevices(options: self.options)
            return removed ? "Device removed from group" : "Device removal failed"
        }
    }

    func loadPolicy() async {
        await runAction {
            let policy = try await self.bridge.getPolicy(options: self.options)
            self.policyAllowText = policy.allowText
            self.policyAllowImage = policy.allowImage
            self.policyAllowFile = policy.allowFile
            self.policyAllowEncryption = policy.allowEncryption ?? true
            self.policyMaxFileSizeBytes = policy.maxFileSizeBytes
            self.policyVersion = policy.version
            self.policyLoaded = true
            return "Policy v\(policy.version) loaded"
        }
    }

    func savePolicy() async {
        await runAction {
            guard self.policyLoaded else {
                throw BridgeError.commandFailed(command: "policy", detail: "load policy first")
            }
            let next = try await self.bridge.updatePolicy(
                options: self.options,
                allowText: self.policyAllowText,
                allowImage: self.policyAllowImage,
                allowFile: self.policyAllowFile,
                allowEncryption: self.policyAllowEncryption,
                maxFileSizeBytes: max(1, self.policyMaxFileSizeBytes)
            )
            self.policyAllowText = next.allowText
            self.policyAllowImage = next.allowImage
            self.policyAllowFile = next.allowFile
            self.policyAllowEncryption = next.allowEncryption ?? true
            self.policyMaxFileSizeBytes = next.maxFileSizeBytes
            self.policyVersion = next.version
            return "Policy updated to v\(next.version)"
        }
    }

    func generateBindCode() async {
        await runAction {
            self.bindCode = try await self.bridge.createBindCode(options: self.options)
            guard let code = self.bindCode else {
                return "Bind code generation failed"
            }
            return "Bind code \(code.code) created"
        }
    }

    func requestBind() async {
        await runAction {
            let code = self.bindInputCode.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !code.isEmpty else {
                throw BridgeError.commandFailed(command: "bind-request", detail: "bind code is required")
            }
            let response = try await self.bridge.requestBind(options: self.options, code: code)
            self.requestId = response.requestId
            return "Bind request \(response.requestId) sent"
        }
    }

    func confirmBind(approve: Bool) async {
        await runAction {
            let req = self.requestId.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !req.isEmpty else {
                throw BridgeError.commandFailed(command: "bind-confirm", detail: "request id is required")
            }
            let response = try await self.bridge.confirmBind(options: self.options, requestId: req, approve: approve)
            return response.approved ? "Request approved into \(response.groupId)" : "Request rejected"
        }
    }

    func startSync() async {
        await runAction {
            self.syncStatus = try await self.bridge.startSync(options: self.options)
            return self.syncStatus.running ? "Clipboard auto-upload enabled" : "Unable to enable clipboard auto-upload"
        }
    }

    func stopSync() async {
        await runAction {
            self.syncStatus = await self.bridge.stopSync()
            return "Clipboard auto-upload stopped"
        }
    }

    private func runAction(_ operation: @escaping () async throws -> String) async {
        busy = true
        defer { busy = false }

        do {
            message = try await operation()
        } catch {
            message = "Error: \(error.localizedDescription)"
        }
    }
}

// MARK: - Design System

extension Color {
    init(hex: UInt, alpha: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double((hex >> 0) & 0xff) / 255,
            opacity: alpha
        )
    }

    // Modern Dashboard Palette
    static let primaryBlue = Color(hex: 0x2A85FF) // Vibrant, accessible blue
    static let secondaryBlue = Color(hex: 0x83BF6E) // A soft green/blue if needed
    
    static let surface = Color(hex: 0xFFFFFF)
    static let background = Color(hex: 0xF4F5F7) // Very light grey/blue tint
    
    static let textPrimary = Color(hex: 0x1A1D1F) // Almost black
    static let textSecondary = Color(hex: 0x6F767E) // Grey
    static let textOnPrimary = Color(hex: 0xFFFFFF)
    
    static let divider = Color(hex: 0xEFEFEF)
}

struct Spacing {
    static let xs: CGFloat = 4
    static let s: CGFloat = 8
    static let m: CGFloat = 12
    static let l: CGFloat = 16
}

struct Radius {
    static let s: CGFloat = 8
    static let m: CGFloat = 12 // Card radius
    static let l: CGFloat = 16
}

struct Shadow {
    static let card = Color.black.opacity(0.04)
    static let float = Color.black.opacity(0.08)
}

// MARK: - Components

struct PrimaryButtonStyle: ButtonStyle {
    var fullWidth: Bool = false
    var height: CGFloat = 36 // Default height within 32-40px range
    var padding: CGFloat = 16
    
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold, design: .default))
            .foregroundStyle(Color.textOnPrimary)
            .padding(.horizontal, padding)
            .frame(height: height)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background(Color.primaryBlue)
            .clipShape(RoundedRectangle(cornerRadius: Radius.s))
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
            .animation(.easeOut(duration: 0.2), value: configuration.isPressed)
    }
}

struct IconButton: View {
    let icon: String
    let action: () -> Void
    var color: Color = .primaryBlue
    
    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(color)
                .clipShape(Circle())
        }
        .buttonStyle(.plain)
    }
}

struct Card<Content: View>: View {
    var padding: CGFloat = Spacing.m
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .background(Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: Radius.m))
            .shadow(color: Shadow.card, radius: 10, x: 0, y: 4)
    }
}

struct StatusBadge: View {
    let isActive: Bool
    
    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(isActive ? Color.green : Color.orange)
                .frame(width: 8, height: 8)
            Text(isActive ? "Active" : "Offline")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(isActive ? Color.green : Color.orange)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            Capsule()
                .fill((isActive ? Color.green : Color.orange).opacity(0.1))
        )
    }
}

struct SettingsView: View {
    @ObservedObject var vm: AppViewModel
    
    var body: some View {
        VStack(spacing: Spacing.m) {
            HStack {
                Text("Settings")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Color.textPrimary)
                Spacer()
                Button(action: { withAnimation { vm.showSettings = false } }) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(Color.textSecondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.bottom, Spacing.xs)
            
            VStack(alignment: .leading, spacing: Spacing.s) {
                Text("Server Address")
                    .font(.caption)
                    .foregroundStyle(Color.textSecondary)
                TextField("e.g. 127.0.0.1:50051", text: $vm.server)
                    .textFieldStyle(.plain)
                    .padding(10)
                    .background(Color.background)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.s))
            }
            
            VStack(alignment: .leading, spacing: Spacing.s) {
                Text("Recovery Phrase (Optional)")
                    .font(.caption)
                    .foregroundStyle(Color.textSecondary)
                SecureField("Enter recovery phrase", text: $vm.recoveryPhrase)
                    .textFieldStyle(.plain)
                    .padding(10)
                    .background(Color.background)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.s))
            }
            
            VStack(alignment: .leading, spacing: Spacing.s) {
                Text("Device Name")
                    .font(.caption)
                    .foregroundStyle(Color.textSecondary)
                TextField("e.g. My Mac", text: $vm.deviceName)
                    .textFieldStyle(.plain)
                    .padding(10)
                    .background(Color.background)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.s))
            }
            
            Button(action: { 
                // Settings are bound to VM, so we just close
                withAnimation { vm.showSettings = false }
                // Trigger re-init if needed or just save
                Task { await vm.initializeDevice() }
            }) {
                Text("Save & Initialize")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle())
            .padding(.top, Spacing.xs)
        }
        .padding(Spacing.l)
        .frame(maxWidth: 320)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: Radius.m))
        .shadow(color: Color.black.opacity(0.15), radius: 16, x: 0, y: 8)
    }
}

struct ContentView: View {
    @StateObject private var vm = AppViewModel()

    var body: some View {
        ZStack {
            Color.background
                .ignoresSafeArea()

            ScrollView {
                VStack(spacing: Spacing.m) {
                    // Header
                    header

                    // Hero Card (Status)
                    statusHeroCard

                    // Quick Actions
                    quickActionsGrid

                    // Devices List
                    devicesListCard

                    // Settings / Policy
                    policyCard

                    // Footer Message
                    if !vm.message.isEmpty && vm.message != "Ready" {
                        Text(vm.message)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Color.textSecondary)
                            .padding(.top, Spacing.s)
                    }

                    // Offline Indicator
                    if !vm.syncStatus.running {
                        Text("Offline: Automatic sync paused")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.orange)
                            .padding(.top, Spacing.xs)
                            .frame(maxWidth: .infinity)
                    }
                }
                .padding(Spacing.l)
            }
            .blur(radius: vm.showSettings ? 4 : 0) // Blur background when settings open
            
            // Settings Overlay
            if vm.showSettings {
                Color.black.opacity(0.3)
                    .ignoresSafeArea()
                    .onTapGesture {
                        withAnimation { vm.showSettings = false }
                    }
                
                SettingsView(vm: vm)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(1)
            }
        }
        .frame(width: 360, height: 600)
        .task {
            await vm.refreshSyncStatus()
            // Poll sync status
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                await vm.refreshSyncStatus()
            }
        }
    }

    // MARK: - Subviews

    private var header: some View {
        HStack {
            Text("SharePaste")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(Color.textPrimary)
            Spacer()
            
            HStack(spacing: Spacing.s) {
                Button(action: { withAnimation { vm.showSettings = true } }) {
                    Image(systemName: "gearshape.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Color.textSecondary)
                        .padding(6)
                        .background(Color.white)
                        .clipShape(Circle())
                        .shadow(color: Shadow.card, radius: 2, y: 1)
                }
                .buttonStyle(.plain)

                Button(action: { NSApplication.shared.terminate(nil) }) {
                    Image(systemName: "power")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Color.textSecondary)
                        .padding(6)
                        .background(Color.white)
                        .clipShape(Circle())
                        .shadow(color: Shadow.card, radius: 2, y: 1)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, Spacing.xs)
        .padding(.top, Spacing.s)
    }

    private var statusHeroCard: some View {
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: Radius.m)
                .fill(statusGradient)
                .shadow(color: statusShadowColor.opacity(0.3), radius: 8, x: 0, y: 4)

            HStack(spacing: Spacing.l) {
                // Status Icon & Text
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .center, spacing: 8) {
                        Circle()
                            .fill(statusIndicatorColor)
                            .frame(width: 8, height: 8)
                        Text(statusText)
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(Color.white)
                    }
                    Text(statusSubtext)
                        .font(.caption)
                        .foregroundStyle(Color.white.opacity(0.8))
                }
                
                Spacer()

                // Info Columns
                VStack(alignment: .trailing, spacing: 2) {
                    Text(vm.server)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.white)
                    Text("Server")
                        .font(.caption2)
                        .foregroundStyle(Color.white.opacity(0.6))
                }
                
                VStack(alignment: .trailing, spacing: 2) {
                    Text(vm.deviceName)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.white)
                    Text("Device")
                        .font(.caption2)
                        .foregroundStyle(Color.white.opacity(0.6))
                }
            }
            .padding(Spacing.m)
        }
        .frame(height: 80)
    }

    private var statusGradient: LinearGradient {
        switch vm.connectionState {
        case .connected:
            return LinearGradient(
                colors: [Color.primaryBlue, Color(hex: 0x4B9FFF)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        case .connecting:
            return LinearGradient(
                colors: [Color.orange, Color.yellow],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        case .disconnected:
            return LinearGradient(
                colors: [Color.gray, Color.gray.opacity(0.8)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
    }

    private var statusShadowColor: Color {
        switch vm.connectionState {
        case .connected: return Color.primaryBlue
        case .connecting: return Color.orange
        case .disconnected: return Color.gray
        }
    }

    private var statusIndicatorColor: Color {
        switch vm.connectionState {
        case .connected: return Color.white
        case .connecting: return Color.white.opacity(0.8)
        case .disconnected: return Color.white.opacity(0.4)
        }
    }

    private var statusText: String {
        switch vm.connectionState {
        case .connected: return "Online"
        case .connecting: return "Connecting..."
        case .disconnected: return "Offline"
        }
    }
    
    private var statusSubtext: String {
        switch vm.connectionState {
        case .connected: return "Synced & Ready"
        case .connecting: return "Timeout in \(vm.remainingSeconds)s"
        case .disconnected: return "Sync Paused"
        }
    }

    private var quickActionsGrid: some View {
        HStack(spacing: Spacing.s) {
            actionButton(
                icon: "arrow.triangle.2.circlepath",
                label: vm.syncStatus.running ? "Stop Sync" : "Start Sync",
                color: vm.syncStatus.running ? Color.orange : Color.green
            ) {
                Task {
                    if vm.syncStatus.running {
                        await vm.stopSync()
                    } else {
                        await vm.startSync()
                    }
                }
            }
            .disabled(vm.busy)

            actionButton(icon: "key.fill", label: "Bind Code", color: Color.primaryBlue) {
                Task { await vm.generateBindCode() }
            }
            .disabled(vm.busy || vm.connectionState != .connected)
            .opacity(vm.connectionState != .connected ? 0.6 : 1.0)
            
            actionButton(icon: "lock.shield", label: "Recover", color: Color(hex: 0x8E5AF7)) {
                 Task { await vm.recoverGroup() }
            }
            .disabled(vm.busy || vm.connectionState != .connected)
            .opacity(vm.connectionState != .connected ? 0.6 : 1.0)
        }
    }

    private func actionButton(icon: String, label: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(color)
                    .frame(width: 28, height: 28)
                    .background(color.opacity(0.1))
                    .clipShape(Circle())
                
                Text(label)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.textPrimary)
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: Radius.m))
            .shadow(color: Shadow.card, radius: 4, x: 0, y: 2)
        }
        .buttonStyle(.plain)
    }

    private var devicesListCard: some View {
        Card(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("Connected Devices")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.textPrimary)
                    Spacer()
                    Button(action: { Task { await vm.loadDevices() } }) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Color.textSecondary)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, Spacing.l)
                .padding(.vertical, Spacing.m)

                if vm.devices.isEmpty {
                    Text("No devices found")
                        .font(.caption)
                        .foregroundStyle(Color.textSecondary)
                        .padding(Spacing.l)
                        .frame(maxWidth: .infinity, alignment: .center)
                } else {
                    VStack(spacing: 0) {
                        ForEach(vm.devices) { device in
                            Divider().background(Color.divider)
                            HStack(spacing: Spacing.m) {
                                Image(systemName: "laptopcomputer") // Generic icon, could map to platform
                                    .font(.system(size: 14))
                                    .foregroundStyle(Color.primaryBlue)
                                    .frame(width: 32, height: 32)
                                    .background(Color.primaryBlue.opacity(0.1))
                                    .clipShape(RoundedRectangle(cornerRadius: 8))

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(device.name)
                                        .font(.system(size: 13, weight: .medium))
                                        .foregroundStyle(Color.textPrimary)
                                    Text(device.platform)
                                        .font(.caption2)
                                        .foregroundStyle(Color.textSecondary)
                                }
                                Spacer()
                                Button(action: {
                                    vm.removeTargetId = device.deviceId
                                    Task { await vm.removeDevice() }
                                }) {
                                    Image(systemName: "trash")
                                        .font(.system(size: 12))
                                        .foregroundStyle(Color.textSecondary.opacity(0.5))
                                }
                                .buttonStyle(.plain)
                            }
                            .padding(.horizontal, Spacing.l)
                            .padding(.vertical, Spacing.s)
                        }
                    }
                }
            }
        }
    }
    
    private var policyCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.m) {
                HStack {
                    Text("Policy & Settings")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Color.textPrimary)
                    Spacer()
                }
                
                // Policy Toggles
                if vm.policyLoaded {
                    VStack(spacing: Spacing.m) {
                        HStack(spacing: Spacing.m) {
                            policyToggle(icon: "text.alignleft", label: "Text", isOn: $vm.policyAllowText)
                            policyToggle(icon: "photo", label: "Image", isOn: $vm.policyAllowImage)
                        }
                        HStack(spacing: Spacing.m) {
                            policyToggle(icon: "doc", label: "File", isOn: $vm.policyAllowFile)
                            policyToggle(icon: "lock.shield", label: "Encryption", isOn: $vm.policyAllowEncryption)
                        }
                    }
                    
                    Divider().background(Color.divider)
                    
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Max File Size")
                                .font(.caption)
                                .foregroundStyle(Color.textSecondary)
                            TextField("Bytes", value: $vm.policyMaxFileSizeBytes, format: .number)
                                .textFieldStyle(.plain)
                                .font(.system(size: 14, weight: .medium))
                                .padding(8)
                                .background(Color.background)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        
                        Spacer()
                        
                        Button("Save") {
                            Task { await vm.savePolicy() }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                    }
                } else {
                    HStack {
                        Spacer()
                        Button("Load Policy") {
                            Task { await vm.loadPolicy() }
                        }
                        .buttonStyle(PrimaryButtonStyle()) // Uses default adaptive width
                        Spacer()
                    }
                    .padding(.vertical, Spacing.m)
                }
                
                // Binding Input
                Divider().background(Color.divider)
                    .padding(.vertical, Spacing.xs)
                    
                VStack(alignment: .leading, spacing: Spacing.s) {
                    Text("Pair New Device")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.textPrimary)
                    
                    HStack(spacing: Spacing.s) {
                        TextField("Enter Bind Code", text: $vm.bindInputCode)
                            .textFieldStyle(.plain)
                            .padding(12)
                            .background(Color.background)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        
                        Button(action: { Task { await vm.requestBind() } }) {
                            Image(systemName: "arrow.right")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(width: 40, height: 40)
                                .background(Color.primaryBlue)
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                        .disabled(vm.bindInputCode.isEmpty)
                    }
                }

                // Show generated code if exists
                if let code = vm.bindCode {
                    VStack(spacing: 4) {
                        Text(code.code)
                            .font(.system(size: 36, weight: .bold, design: .monospaced))
                            .foregroundStyle(Color.primaryBlue)
                            .kerning(4)
                        Text("Expires in \(Int((Double(code.expiresAtUnix) ?? 0) - Date().timeIntervalSince1970))s")
                            .font(.caption)
                            .foregroundStyle(Color.textSecondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.primaryBlue.opacity(0.05))
                    .clipShape(RoundedRectangle(cornerRadius: Radius.m))
                }
                
                // Confirm Dialog
                if !vm.requestId.isEmpty {
                    HStack {
                        Text("Confirm Request: \(vm.requestId.prefix(4))...")
                            .font(.caption)
                            .foregroundStyle(Color.textPrimary)
                        Spacer()
                        Button("Approve") { Task { await vm.confirmBind(approve: true) } }
                            .font(.caption.bold())
                            .foregroundStyle(.green)
                        Button("Reject") { Task { await vm.confirmBind(approve: false) } }
                            .font(.caption.bold())
                            .foregroundStyle(.red)
                    }
                    .padding()
                    .background(Color.background)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
        }
    }
    
    private func policyToggle(icon: String, label: String, isOn: Binding<Bool>) -> some View {
        Button(action: { isOn.wrappedValue.toggle() }) {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 16))
                    .foregroundStyle(isOn.wrappedValue ? Color.primaryBlue : Color.textSecondary)
                Text(label)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(isOn.wrappedValue ? Color.primaryBlue : Color.textSecondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(isOn.wrappedValue ? Color.primaryBlue.opacity(0.1) : Color.background)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isOn.wrappedValue ? Color.primaryBlue : Color.clear, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func unixToDateText(_ unix: String) -> String {
        guard let value = Double(unix) else {
            return unix
        }
        let date = Date(timeIntervalSince1970: value)
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .medium
        return formatter.string(from: date)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
    }
}

@main
struct SharePasteDesktopApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        MenuBarExtra("SharePaste", systemImage: "sparkles.rectangle.stack.fill") {
            ContentView()
        }
        .menuBarExtraStyle(.window)
    }
}
