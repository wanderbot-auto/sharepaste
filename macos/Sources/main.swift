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

    func initDevice(options: CliOptions) async throws -> DeviceState {
        try await runClientJSON(options: options, subcommand: "init", subArgs: [], as: DeviceState.self)
    }

    func recoverGroup(options: CliOptions, phrase: String) async throws -> DeviceState {
        guard let deviceName = options.deviceName, !deviceName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw BridgeError.commandFailed(command: "recover", detail: "deviceName is required for recovery")
        }

        return try await runClientJSON(
            options: options,
            subcommand: "recover",
            subArgs: ["--phrase", phrase, "--name", deviceName],
            as: DeviceState.self
        )
    }

    func listDevices(options: CliOptions) async throws -> [DeviceInfo] {
        let response = try await runClientJSON(options: options, subcommand: "devices", subArgs: [], as: DeviceListResponse.self)
        return response.devices
    }

    func removeDevice(options: CliOptions, targetDeviceId: String) async throws -> Bool {
        let response = try await runClientJSON(
            options: options,
            subcommand: "remove-device",
            subArgs: ["--target-device-id", targetDeviceId],
            as: RemoveDeviceResponse.self
        )
        return response.removed
    }

    func getPolicy(options: CliOptions) async throws -> SharePolicy {
        try await runClientJSON(options: options, subcommand: "policy-get", subArgs: [], as: SharePolicy.self)
    }

    func updatePolicy(
        options: CliOptions,
        allowText: Bool,
        allowImage: Bool,
        allowFile: Bool,
        maxFileSizeBytes: Int
    ) async throws -> SharePolicy {
        return try await runClientJSON(
            options: options,
            subcommand: "policy",
            subArgs: [
                "--allow-text", String(allowText),
                "--allow-image", String(allowImage),
                "--allow-file", String(allowFile),
                "--max-file-size", String(maxFileSizeBytes)
            ],
            as: SharePolicy.self
        )
    }

    func createBindCode(options: CliOptions) async throws -> BindCode {
        try await runClientJSON(options: options, subcommand: "bind-code", subArgs: [], as: BindCode.self)
    }

    func requestBind(options: CliOptions, code: String) async throws -> BindRequestResponse {
        try await runClientJSON(options: options, subcommand: "bind-request", subArgs: ["--code", code], as: BindRequestResponse.self)
    }

    func confirmBind(options: CliOptions, requestId: String, approve: Bool) async throws -> ConfirmBindResponse {
        var args = ["--request-id", requestId]
        if approve {
            args.append("--approve")
        }
        return try await runClientJSON(options: options, subcommand: "bind-confirm", subArgs: args, as: ConfirmBindResponse.self)
    }

    func syncStatus() -> SyncStatus {
        if let process = syncProcess, process.isRunning {
            return SyncStatus(running: true, pid: process.processIdentifier)
        }

        syncProcess = nil
        return SyncStatus(running: false, pid: nil)
    }

    func startSync(options: CliOptions) throws -> SyncStatus {
        // Double check: if process is running, return it.
        // But also check if it's dead?
        if let process = syncProcess {
             if process.isRunning {
                 return SyncStatus(running: true, pid: process.processIdentifier)
             } else {
                 // Dead reference
                 syncProcess = nil
             }
        }

        let root = try resolveRepoRoot()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.currentDirectoryURL = root
        // Daemon should not block, so no timeout needed here.
        // Redirecting output to null or handling logs?
        // User probably wants logs for debugging but for now null is fine as per existing code.
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
    ) async throws -> T {
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
            
            // Timeout implementation (5 seconds)
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                let timeoutSeconds: Double = 5.0
                
                // Use a state variable protected by lock? No, continuation is one-shot.
                // We can use a Task to monitor.
                // Or simply rely on Process.terminationHandler which is thread-safe callback.
                
                // We must ensure continuation is resumed exactly once.
                // We use an Atomic flag or just rely on the fact that if timeout fires, we terminate process, which fires terminationHandler?
                // YES! process.terminate() triggers terminationHandler.
                // So we only need to resume in terminationHandler.
                // BUT we need to know if it was a timeout or normal exit to throw error or not?
                // Actually if we terminate(), the exit status will be non-zero (SIGTERM 15).
                // So we can detect it there.
                
                // Set up timeout task
                let timeoutTask = Task {
                    try? await Task.sleep(nanoseconds: UInt64(timeoutSeconds * 1_000_000_000))
                    if process.isRunning {
                        process.terminate() // This will trigger terminationHandler
                    }
                }
                
                process.terminationHandler = { _ in
                    timeoutTask.cancel()
                    continuation.resume()
                }
            }
        } catch {
             // If run failed immediately
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

enum ValidationError: LocalizedError {
    case emptyInput(field: String)
    case invalidFormat(field: String, reason: String)
    
    var errorDescription: String? {
        switch self {
        case .emptyInput(let field): return "\(field)不能为空"
        case .invalidFormat(let field, let reason): return "\(field)格式错误: \(reason)"
        }
    }
}

@MainActor
final class AppViewModel: ObservableObject {
    @Published var connectionState: ConnectionState = .disconnected
    @Published var server = "127.0.0.1:50052"
    @Published var statePath = ""
    @Published var deviceName = "my-mac"

    @Published var deviceState: DeviceState?
    @Published var devices: [DeviceInfo] = []

    @Published var policyLoaded = false
    @Published var policyVersion = 0
    @Published var policyAllowText = true
    @Published var policyAllowImage = true
    @Published var policyAllowFile = true
    @Published var policyMaxFileSizeBytes = 3 * 1024 * 1024
    @Published var policyMaxFileSizeMB = 3

    @Published var bindCode: BindCode?
    @Published var bindCodeRemainingSeconds: Int = 0
    @Published var syncStatus = SyncStatus(running: false, pid: nil)

    @Published var bindInputCode = ""
    @Published var requestId = ""
    @Published var removeTargetId = ""
    @Published var recoveryPhrase = ""
    @Published var busy = false
    @Published var currentMessage: UserMessage?
    @Published var showSettings = false

    // Connection Monitoring
    @Published var connectionTimeout: Int = 5
    @Published var remainingSeconds: Int = 0
    private var connectionAttemptStartTime: Date?
    private var monitoringTask: Task<Void, Never>?
    private var bindCodeCountdownTask: Task<Void, Never>?
    private var autoDismissTask: Task<Void, Never>?
    private var bindCodeAutoRefreshInFlight = false
    private static let bytesPerMB = 1024 * 1024
    
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
        // If already monitoring, just let it be. But if disconnected/connecting, we might want to force a check.
        // Actually, refreshSyncStatus is often called to *ensure* monitoring is active.
        if monitoringTask == nil {
            startMonitoring()
        } else if connectionState != .connected {
             // If not connected, force restart monitoring to get immediate check
             startMonitoring()
        }
    }
    
    func startMonitoring() {
        // Cancel existing task if any to restart immediately
        monitoringTask?.cancel()
        
        monitoringTask = Task {
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

    private func bindCodeSecondsRemaining(for code: BindCode, now: Date = Date()) -> Int {
        guard let expiryUnix = Double(code.expiresAtUnix) else {
            return 0
        }
        let remaining = Int(ceil(expiryUnix - now.timeIntervalSince1970))
        return max(0, remaining)
    }

    private static func bytesToMB(_ bytes: Int) -> Int {
        if bytes <= 0 {
            return 1
        }
        return max(1, (bytes + bytesPerMB - 1) / bytesPerMB)
    }

    private func syncBindCodeRemainingSeconds() -> Int {
        guard let code = bindCode else {
            bindCodeRemainingSeconds = 0
            return 0
        }
        let remaining = bindCodeSecondsRemaining(for: code)
        bindCodeRemainingSeconds = remaining
        return remaining
    }

    private func stopBindCodeCountdown() {
        bindCodeCountdownTask?.cancel()
        bindCodeCountdownTask = nil
    }

    private func startBindCodeCountdown() {
        stopBindCodeCountdown()
        guard bindCode != nil else {
            bindCodeRemainingSeconds = 0
            return
        }

        bindCodeCountdownTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                let remaining = self.syncBindCodeRemainingSeconds()
                if remaining == 0 {
                    await self.autoRefreshBindCodeAfterExpiry()
                }
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
    }

    private func applyBindCode(_ code: BindCode) {
        bindCode = code
        let remaining = bindCodeSecondsRemaining(for: code)
        // Newly generated code should always restart at a full TTL display.
        bindCodeRemainingSeconds = remaining > 0 ? remaining : 60
        startBindCodeCountdown()
    }

    private func autoRefreshBindCodeAfterExpiry() async {
        guard bindCode != nil else { return }
        guard !bindCodeAutoRefreshInFlight else { return }

        bindCodeAutoRefreshInFlight = true
        defer { bindCodeAutoRefreshInFlight = false }

        do {
            let freshCode = try await bridge.createBindCode(options: options)
            applyBindCode(freshCode)
            // Quiet success
        } catch {
            showError(error)
        }
    }

    func initializeDevice() async {
        await runAction {
            guard !self.deviceName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw ValidationError.emptyInput(field: "设备名称")
            }
            let state = try await self.bridge.initDevice(options: self.options)
            self.deviceState = state
            let status = await self.bridge.syncStatus()
            if status.running {
                self.syncStatus = status
            } else {
                self.syncStatus = try await self.bridge.startSync(options: self.options)
            }
            return "初始化成功: \(state.deviceId)。剪贴板自动同步已开启。"
        }
    }

    func recoverGroup() async {
        await runAction {
            guard !self.recoveryPhrase.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw ValidationError.emptyInput(field: "恢复短语")
            }
            let state = try await self.bridge.recoverGroup(options: self.options, phrase: self.recoveryPhrase)
            self.deviceState = state
            let status = await self.bridge.syncStatus()
            if status.running {
                self.syncStatus = status
            } else {
                self.syncStatus = try await self.bridge.startSync(options: self.options)
            }
            return "恢复成功: \(state.groupId)。剪贴板自动同步已开启。"
        }
    }

    func loadDevices() async {
        await runAction {
            self.devices = try await self.bridge.listDevices(options: self.options)
            return "已加载 \(self.devices.count) 个设备"
        }
    }

    func removeDevice() async {
        await runAction {
            let target = self.removeTargetId.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !target.isEmpty else {
                throw ValidationError.emptyInput(field: "目标设备ID")
            }
            let removed = try await self.bridge.removeDevice(options: self.options, targetDeviceId: target)
            self.devices = try await self.bridge.listDevices(options: self.options)
            return removed ? "设备已移除" : "设备移除失败"
        }
    }

    func loadPolicy() async {
        await runAction {
            let policy = try await self.bridge.getPolicy(options: self.options)
            self.policyAllowText = policy.allowText
            self.policyAllowImage = policy.allowImage
            self.policyAllowFile = policy.allowFile
            self.policyMaxFileSizeBytes = policy.maxFileSizeBytes
            self.policyMaxFileSizeMB = Self.bytesToMB(policy.maxFileSizeBytes)
            self.policyVersion = policy.version
            self.policyLoaded = true
            return "策略 v\(policy.version) 已加载"
        }
    }

    func savePolicy() async {
        await runAction {
            guard self.policyLoaded else {
                throw BridgeError.commandFailed(command: "policy", detail: "load policy first")
            }
            let normalizedMB = max(1, self.policyMaxFileSizeMB)
            let maxFileSizeBytes = normalizedMB * Self.bytesPerMB
            let next = try await self.bridge.updatePolicy(
                options: self.options,
                allowText: self.policyAllowText,
                allowImage: self.policyAllowImage,
                allowFile: self.policyAllowFile,
                maxFileSizeBytes: maxFileSizeBytes
            )
            self.policyAllowText = next.allowText
            self.policyAllowImage = next.allowImage
            self.policyAllowFile = next.allowFile
            self.policyMaxFileSizeBytes = next.maxFileSizeBytes
            self.policyMaxFileSizeMB = Self.bytesToMB(next.maxFileSizeBytes)
            self.policyVersion = next.version
            return "策略已更新至 v\(next.version)"
        }
    }

    func generateBindCode() async {
        await runAction {
            let code = try await self.bridge.createBindCode(options: self.options)
            self.applyBindCode(code)
            return "绑定码 \(code.code) 已生成"
        }
    }

    func requestBind() async {
        await runAction {
            let code = self.bindInputCode.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !code.isEmpty else {
                throw ValidationError.emptyInput(field: "绑定码")
            }
            if code.count > 100 {
                throw ValidationError.invalidFormat(field: "绑定码", reason: "长度不能超过100字符")
            }
            let response = try await self.bridge.requestBind(options: self.options, code: code)
            self.requestId = response.requestId
            return "已发送绑定请求: \(response.requestId)"
        }
    }

    func confirmBind(approve: Bool) async {
        await runAction {
            let req = self.requestId.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !req.isEmpty else {
                throw ValidationError.emptyInput(field: "请求ID")
            }
            let response = try await self.bridge.confirmBind(options: self.options, requestId: req, approve: approve)
            return response.approved ? "请求已批准，加入群组 \(response.groupId)" : "请求已拒绝"
        }
    }

    func startSync() async {
        await runAction {
            // Preflight to surface stale-state / unreachable-server errors directly.
            _ = try await self.bridge.getPolicy(options: self.options)

            // Check if already running
            let status = await self.bridge.syncStatus()
            if status.running {
                // FORCE transition to connecting to give immediate feedback
                self.connectionState = .connecting
                self.connectionAttemptStartTime = Date()
                self.remainingSeconds = self.connectionTimeout
                
                // Force check immediately via restarting monitoring
                self.startMonitoring()
                
                return "同步进程已运行，正在检查连接..."
            }
            
            // Not running, start it
            self.connectionState = .connecting
            self.connectionAttemptStartTime = Date()
            self.remainingSeconds = self.connectionTimeout
            self.log("Starting sync process... Setting state to connecting")
            
            self.syncStatus = try await self.bridge.startSync(options: self.options)
            self.log("Sync process started. Running: \(self.syncStatus.running)")
            
            // Start monitoring immediately which will handle Connecting -> Connected state transition
            self.startMonitoring()
            
            return self.syncStatus.running ? "剪贴板自动同步已开启" : "无法开启剪贴板同步"
        }
    }

    func stopSync() async {
        await runAction {
            self.syncStatus = await self.bridge.stopSync()
            return "剪贴板自动同步已停止"
        }
    }
    
    func restartSync() async {
        await runAction {
            self.log("Restarting sync process...")
            // Stop existing process
            _ = await self.bridge.stopSync()
            
            // Force connecting state
            self.connectionState = .connecting
            self.connectionAttemptStartTime = Date()
            self.remainingSeconds = self.connectionTimeout
            
            // Start new process
            self.syncStatus = try await self.bridge.startSync(options: self.options)
            self.log("Sync process restarted. Running: \(self.syncStatus.running)")
            
            // Start monitoring
            self.startMonitoring()
            
            return self.syncStatus.running ? "同步进程已重启" : "同步重启失败"
        }
    }

    private func runAction(_ operation: @escaping () async throws -> String) async {
        busy = true
        defer { busy = false }

        do {
            let msg = try await operation()
            // 如果返回空字符串，则不显示成功提示（用于静默操作）
            if !msg.isEmpty {
                showMessage("操作成功", msg, type: .success, autoDismiss: true)
            }
        } catch {
            showError(error)
        }
    }
    
    private func showMessage(_ title: String, _ message: String, type: UserMessage.MessageType = .info, autoDismiss: Bool = false) {
        // 取消之前的自动消失任务
        autoDismissTask?.cancel()
        autoDismissTask = nil
        
        let newMessage = UserMessage(type: type, title: title, message: message, autoDismiss: autoDismiss)
        
        withAnimation(.spring(response: 0.4, dampingFraction: 0.7, blendDuration: 0)) {
            currentMessage = newMessage
        }
        
        if autoDismiss {
            autoDismissTask = Task {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                if !Task.isCancelled {
                    // 必须回到主线程操作UI状态
                    Task { @MainActor in
                        // 再次检查ID，防止在sleep期间有了新消息被错误清除
                        if self.currentMessage?.id == newMessage.id {
                            withAnimation(.spring(response: 0.4, dampingFraction: 0.7, blendDuration: 0)) {
                                self.currentMessage = nil
                            }
                        }
                    }
                }
            }
        }
    }
    
    private func showError(_ error: Error) {
        let (title, msg) = parseError(error)
        // 错误提示不自动消失，除非是特定类型的轻微提示？目前保持手动关闭。
        showMessage(title, msg, type: .error, autoDismiss: false)
    }

    private func parseError(_ error: Error) -> (String, String) {
        if let validationError = error as? ValidationError {
            return ("输入错误", validationError.errorDescription ?? "未知输入错误")
        }
        
        let raw = error.localizedDescription
        let lower = raw.lowercased()
        
        // 尝试从JSON输出中提取具体错误
        if let jsonError = extractJSONError(from: raw) {
             let lowerJson = jsonError.lowercased()
             if lowerJson.contains("bind code expired") || lowerJson.contains("bind code not found") {
                 return ("绑定失败", "该绑定码未找到，请检查是否输入正确或联系管理员获取有效绑定码")
             }
             if lowerJson.contains("already bound") {
                 return ("绑定失败", "设备已在该群组中，无需重复绑定")
             }
             // Fallback to raw JSON error if generic
             return ("服务器错误", jsonError)
        }
        
        if lower.contains("device not found") {
            return ("设备状态异常", "本地设备状态与服务器不一致，请点击“保存并初始化”或“恢复群组”")
        }
        if lower.contains("state_file_invalid") {
            return ("本地状态损坏", "检测到本地状态文件无效，请点击“保存并初始化”或“恢复群组”")
        }
        if lower.contains("stale device state") {
            return ("设备状态异常", "检测到本地设备状态已过期，请点击“保存并初始化”或“恢复群组”")
        }
        if lower.contains("unavailable") || lower.contains("failed to connect") {
            return ("连接失败", "无法连接到服务器，请检查服务器地址是否正确以及服务器是否运行中")
        }
        
        // Fallback
        return ("发生错误", raw)
    }
    
    private func extractJSONError(from text: String) -> String? {
        do {
            // Pattern: "error":"..."
            let pattern = "\"error\":\"(.*?)\""
            let regex = try NSRegularExpression(pattern: pattern, options: [])
            let nsString = text as NSString
            if let match = regex.firstMatch(in: text, options: [], range: NSRange(location: 0, length: nsString.length)) {
                if let range = Range(match.range(at: 1), in: text) {
                    return String(text[range])
                }
            }
        } catch {
            return nil
        }
        return nil
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
                TextField("e.g. 127.0.0.1:50052", text: $vm.server)
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
                
                // If running, restart to apply new settings (server, etc)
                // If not running, just save (which is automatic via Published) and initialize
                Task { 
                    if vm.syncStatus.running {
                        await vm.restartSync()
                    } else {
                        await vm.initializeDevice() 
                    }
                }
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
            .scrollIndicators(.hidden)
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
            
            // Message Overlay
            if let msg = vm.currentMessage {
                VStack {
                    Spacer()
                    MessageView(message: msg) {
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.7, blendDuration: 0)) {
                            vm.currentMessage = nil
                        }
                    }
                    .padding(.bottom, Spacing.l)
                }
                .transition(.asymmetric(
                    insertion: .move(edge: .bottom).combined(with: .opacity).combined(with: .scale(scale: 0.9)),
                    removal: .opacity.combined(with: .move(edge: .bottom))
                ))
                .zIndex(2)
            }
        }
        .frame(width: 360, height: 600)
        .task {
            // Initial Check
            await vm.refreshSyncStatus()
            // If disconnected, try to start sync automatically if user wants?
            // User said: "程序启动时，尝试连接默认server地址"
            // This implies we should try to connect (which means ensuring process is running if we treat 'start sync' as connecting).
            // BUT "失败时显示离线" implies we try once.
            // If process is NOT running, 'refreshSyncStatus' sets it to disconnected.
            // If process IS running, it sets to connecting -> connected/disconnected.
            // If the user means "Auto Start Sync on Launch", we should call startSync().
            // Assuming "Try to connect" means "Check if we can connect", which refreshSyncStatus does if process is running.
            // If process is NOT running, do we start it? Usually menu bar apps start their daemon.
            // Let's assume we should attempt to START the sync process if it's not running.
            
            if !vm.syncStatus.running {
                // Attempt to start
                await vm.startSync()
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
            // Main Sync Control Button
            switch vm.connectionState {
            case .connected:
                // Online -> Stop Sync
                actionButton(icon: "stop.fill", label: "Stop Sync", color: .red) {
                    Task { await vm.stopSync() }
                }
            case .connecting:
                // Connecting -> Disabled Button showing Wait
                actionButton(icon: "hourglass", label: "Connecting...", color: .orange) {
                    // No action
                }
                .disabled(true)
                .opacity(0.6)
            case .disconnected:
                // Offline (Process not running or Connection failed) -> Start Sync
                // Even if process is technically running but disconnected, we treat it as 'needs start/retry'
                // But if process IS running, startSync might just restart it or do nothing.
                // Let's make sure startSync handles "restart if running but broken" or we just call refresh.
                // Actually user said: "Status Offline -> Start Sync".
                // So if we are in that state where process is running but we are offline (timeout),
                // we probably want to try connecting again.
                // But 'Start Sync' implies launching the process.
                // If the process is already running, 'Start Sync' logic in VM should handle it gracefully (e.g. check status, if running, maybe just verify connection).
                actionButton(icon: "play.fill", label: "Start Sync", color: .green) {
                    if vm.syncStatus.running {
                        // Running but Offline -> Restart
                        Task { await vm.restartSync() }
                    } else {
                        // Not Running -> Start
                        Task { await vm.startSync() }
                    }
                }
            }

            // Bind and Recover only available when connected
            actionButton(icon: "key", label: "Bind Code", color: .primaryBlue) {
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
                            policyToggle(icon: "doc", label: "File", isOn: $vm.policyAllowFile)
                        }
                    }
                    
                    Divider().background(Color.divider)
                    
                    VStack(alignment: .leading, spacing: Spacing.s) {
                        HStack {
                            Text("Max File Size")
                                .font(.caption)
                                .foregroundStyle(Color.textSecondary)
                            Spacer()
                            Text("Unit fixed: MB")
                                .font(.caption2)
                                .foregroundStyle(Color.textSecondary)
                        }

                        HStack(spacing: Spacing.s) {
                            HStack(spacing: 0) {
                                TextField(
                                    "3",
                                    value: Binding(
                                        get: { vm.policyMaxFileSizeMB },
                                        set: { vm.policyMaxFileSizeMB = max(1, $0) }
                                    ),
                                    format: .number
                                )
                                .textFieldStyle(.plain)
                                .font(.system(size: 15, weight: .semibold, design: .monospaced))
                                .multilineTextAlignment(.center)
                                .frame(width: 84)

                                Divider()
                                    .background(Color.divider)

                                Text("MB")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(Color.textSecondary)
                                    .frame(width: 52)
                            }
                            .frame(height: 36)
                            .background(Color.background)
                            .clipShape(RoundedRectangle(cornerRadius: Radius.s))

                            Spacer(minLength: 0)

                            Button {
                                Task { await vm.savePolicy() }
                            } label: {
                                Label("Save Policy", systemImage: "checkmark.circle.fill")
                                    .frame(width: 122)
                            }
                            .buttonStyle(PrimaryButtonStyle(height: 36, padding: 12))
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                } else {
                    Button {
                        Task { await vm.loadPolicy() }
                    } label: {
                        Label("Load Policy", systemImage: "arrow.down.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PrimaryButtonStyle(fullWidth: true, height: 40, padding: 14))
                    .padding(.vertical, Spacing.s)
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
                        Text("Expires in \(max(0, vm.bindCodeRemainingSeconds))s")
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

// MARK: - Error Handling Models

struct UserMessage: Identifiable, Equatable {
    let id = UUID()
    enum MessageType {
        case success
        case error
        case warning
        case info
    }
    let type: MessageType
    let title: String
    let message: String
    let autoDismiss: Bool
    
    init(type: MessageType, title: String, message: String, autoDismiss: Bool = false) {
        self.type = type
        self.title = title
        self.message = message
        self.autoDismiss = autoDismiss
    }
    
    var color: Color {
        switch type {
        case .success: return Color(hex: 0x34C759) // iOS System Green
        case .error: return Color(hex: 0xFF9500) // iOS System Orange (柔和警告)
        case .warning: return Color(hex: 0xFFCC00) // iOS System Yellow
        case .info: return Color.primaryBlue // 使用主题色
        }
    }
    
    var icon: String {
        switch type {
        case .success: return "checkmark.circle.fill"
        case .error: return "exclamationmark.triangle.fill"
        case .warning: return "exclamationmark.circle.fill"
        case .info: return "info.circle.fill"
        }
    }
}

struct MessageView: View {
    let message: UserMessage
    let onDismiss: () -> Void
    
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: message.icon)
                .font(.system(size: 18))
                .foregroundStyle(message.color)
                .padding(.top, 2)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(message.title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Color.textPrimary)
                
                Text(message.message)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            
            Spacer()
            
            if !message.autoDismiss {
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.system(size: 14))
                        .foregroundStyle(Color.textSecondary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(12)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(message.color.opacity(0.3), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.15), radius: 12, x: 0, y: 6)
        .padding(.horizontal, 16)
        .transition(.move(edge: .top).combined(with: .opacity))
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
