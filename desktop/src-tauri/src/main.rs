#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliOptions {
    server: String,
    state_path: Option<String>,
    device_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolicyPatch {
    allow_text: bool,
    allow_image: bool,
    allow_file: bool,
    max_file_size_bytes: u64,
    version: u64,
}

#[derive(Default)]
struct SyncProcess {
    child: Mutex<Option<Child>>,
}

fn npm_executable() -> &'static str {
    if cfg!(target_os = "windows") {
        "npm.cmd"
    } else {
        "npm"
    }
}

fn repo_root() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .and_then(|parent| parent.parent())
        .map(PathBuf::from)
        .ok_or_else(|| "failed to resolve repository root".to_string())
}

fn global_args(options: &CliOptions) -> Vec<String> {
    let mut args = vec!["--server".to_string(), options.server.clone()];

    if let Some(path) = &options.state_path {
        args.push("--state".to_string());
        args.push(path.clone());
    }

    if let Some(name) = &options.device_name {
        args.push("--name".to_string());
        args.push(name.clone());
    }

    args
}

fn append_client_command(
    command: &mut Command,
    options: &CliOptions,
    subcommand: &str,
    sub_args: &[String],
    json_mode: bool,
) {
    command
        .arg("run")
        .arg("--silent")
        .arg("-w")
        .arg("client")
        .arg("dev")
        .arg("--");

    for arg in global_args(options) {
        command.arg(arg);
    }

    if json_mode {
        command.arg("--json");
    }

    command.arg(subcommand);
    for arg in sub_args {
        command.arg(arg);
    }
}

fn parse_last_json(stdout: &str) -> Result<Value, String> {
    for line in stdout.lines().rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(parsed) = serde_json::from_str::<Value>(trimmed) {
            return Ok(parsed);
        }
    }

    Err("client returned no JSON output".to_string())
}

fn run_client_json(options: &CliOptions, subcommand: &str, sub_args: &[String]) -> Result<Value, String> {
    let root = repo_root()?;
    let mut command = Command::new(npm_executable());
    command.current_dir(root);
    append_client_command(&mut command, options, subcommand, sub_args, true);

    let output = command.output().map_err(|err| err.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!(
            "client command failed ({subcommand}): {} {}",
            stderr.trim(),
            stdout.trim()
        ));
    }

    parse_last_json(&stdout)
}

fn refresh_status(child: &mut Option<Child>) -> Result<Value, String> {
    if let Some(process) = child.as_mut() {
        match process.try_wait() {
            Ok(None) => {
                return Ok(json!({
                    "running": true,
                    "pid": process.id()
                }));
            }
            Ok(Some(_)) => {
                *child = None;
            }
            Err(err) => {
                return Err(err.to_string());
            }
        }
    }

    Ok(json!({ "running": false }))
}

#[tauri::command]
async fn init_device(options: CliOptions) -> Result<Value, String> {
    if options.device_name.as_deref().unwrap_or("").is_empty() {
        return Err("deviceName is required".to_string());
    }
    run_client_json(&options, "init", &[])
}

#[tauri::command]
async fn list_devices(options: CliOptions) -> Result<Value, String> {
    run_client_json(&options, "devices", &[])
}

#[tauri::command]
async fn create_bind_code(options: CliOptions) -> Result<Value, String> {
    run_client_json(&options, "bind-code", &[])
}

#[tauri::command]
async fn request_bind(options: CliOptions, code: String) -> Result<Value, String> {
    run_client_json(&options, "bind-request", &["--code".to_string(), code])
}

#[tauri::command]
async fn confirm_bind(options: CliOptions, request_id: String, approve: bool) -> Result<Value, String> {
    let mut args = vec!["--request-id".to_string(), request_id];
    if approve {
        args.push("--approve".to_string());
    }
    run_client_json(&options, "bind-confirm", &args)
}

#[tauri::command]
async fn get_policy(options: CliOptions) -> Result<Value, String> {
    run_client_json(&options, "policy-get", &[])
}

#[tauri::command]
async fn update_policy(options: CliOptions, policy: PolicyPatch) -> Result<Value, String> {
    let _ = policy.version;
    let args = vec![
        "--allow-text".to_string(),
        policy.allow_text.to_string(),
        "--allow-image".to_string(),
        policy.allow_image.to_string(),
        "--allow-file".to_string(),
        policy.allow_file.to_string(),
        "--max-file-size".to_string(),
        policy.max_file_size_bytes.to_string(),
    ];

    run_client_json(&options, "policy", &args)
}

#[tauri::command]
async fn send_text(options: CliOptions, value: String) -> Result<Value, String> {
    run_client_json(&options, "send-text", &["--value".to_string(), value])
}

#[tauri::command]
async fn send_file(options: CliOptions, path: String, mime: String, as_image: bool) -> Result<Value, String> {
    let args = vec!["--path".to_string(), path, "--mime".to_string(), mime];
    if as_image {
        run_client_json(&options, "send-image", &args)
    } else {
        run_client_json(&options, "send-file", &args)
    }
}

#[tauri::command]
async fn start_sync(options: CliOptions, sync: tauri::State<'_, SyncProcess>) -> Result<Value, String> {
    let mut lock = sync.child.lock().map_err(|_| "failed to lock sync state".to_string())?;
    if let Value::Object(status) = refresh_status(&mut lock)? {
        if status.get("running").and_then(Value::as_bool) == Some(true) {
            return Ok(Value::Object(status));
        }
    }

    let root = repo_root()?;
    let mut command = Command::new(npm_executable());
    command.current_dir(root);
    append_client_command(&mut command, &options, "run", &[], false);
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());

    let child = command.spawn().map_err(|err| err.to_string())?;
    let pid = child.id();
    *lock = Some(child);

    Ok(json!({
        "running": true,
        "pid": pid
    }))
}

#[tauri::command]
async fn stop_sync(sync: tauri::State<'_, SyncProcess>) -> Result<Value, String> {
    let mut lock = sync.child.lock().map_err(|_| "failed to lock sync state".to_string())?;

    if let Some(mut process) = lock.take() {
        let _ = process.kill();
        let _ = process.wait();
    }

    Ok(json!({ "running": false }))
}

#[tauri::command]
async fn sync_status(sync: tauri::State<'_, SyncProcess>) -> Result<Value, String> {
    let mut lock = sync.child.lock().map_err(|_| "failed to lock sync state".to_string())?;
    refresh_status(&mut lock)
}

fn main() {
    tauri::Builder::default()
        .manage(SyncProcess::default())
        .invoke_handler(tauri::generate_handler![
            init_device,
            list_devices,
            create_bind_code,
            request_bind,
            confirm_bind,
            get_policy,
            update_policy,
            send_text,
            send_file,
            start_sync,
            stop_sync,
            sync_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
