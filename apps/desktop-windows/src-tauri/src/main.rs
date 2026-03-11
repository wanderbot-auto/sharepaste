#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use arboard::{Clipboard, ImageData};
use png::{BitDepth, ColorType, Decoder, Encoder};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
  api::notification::Notification, AppHandle, CustomMenuItem, Manager, State, SystemTray, SystemTrayEvent, SystemTrayMenu,
  WindowEvent
};

#[derive(Clone)]
struct BridgeSettings {
  server: String,
  state_path: Option<String>,
  default_name: String,
  reset_stale_state: bool,
}

impl Default for BridgeSettings {
  fn default() -> Self {
    Self {
      server: std::env::var("SHAREPASTE_SERVER").unwrap_or_else(|_| "127.0.0.1:50052".to_string()),
      state_path: std::env::var("SHAREPASTE_STATE_PATH").ok(),
      default_name: std::env::var("SHAREPASTE_DEVICE_NAME").unwrap_or_else(|_| "sharepaste-windows".to_string()),
      reset_stale_state: std::env::var("SHAREPASTE_RESET_STALE_STATE")
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true"))
        .unwrap_or(false),
    }
  }
}

struct BridgeProcess {
  child: Child,
  stdin: BufWriter<ChildStdin>,
  pending: Arc<Mutex<HashMap<String, Sender<Result<Value, String>>>>>,
  next_id: u64,
}

impl BridgeProcess {
  fn is_alive(&mut self) -> bool {
    matches!(self.child.try_wait(), Ok(None))
  }

  fn send(&mut self, method: String, params: Value) -> Result<Receiver<Result<Value, String>>, String> {
    if !self.is_alive() {
      return Err("runtime bridge is not running".to_string());
    }

    self.next_id += 1;
    let request_id = format!("req_{}", self.next_id);
    let (tx, rx) = mpsc::channel();
    self.pending.lock().map_err(|_| "pending map poisoned".to_string())?.insert(request_id.clone(), tx);

    let request = json!({
      "id": request_id,
      "method": method,
      "params": params
    });

    serde_json::to_writer(&mut self.stdin, &request).map_err(|error| error.to_string())?;
    self.stdin.write_all(b"\n").map_err(|error| error.to_string())?;
    self.stdin.flush().map_err(|error| error.to_string())?;

    Ok(rx)
  }
}

#[derive(Default)]
struct AppState {
  bridge: Mutex<Option<BridgeProcess>>,
  settings: Mutex<BridgeSettings>,
}

#[derive(Serialize)]
struct ClipboardSnapshot {
  kind: String,
  fingerprint: Option<String>,
  text: Option<String>,
  path: Option<String>,
  mime: Option<String>,
}

fn main() {
  let show = CustomMenuItem::new("show".to_string(), "Show SharePaste");
  let hide = CustomMenuItem::new("hide".to_string(), "Hide Window");
  let quit = CustomMenuItem::new("quit".to_string(), "Quit");
  let tray_menu = SystemTrayMenu::new().add_item(show).add_item(hide).add_item(quit);

  tauri::Builder::default()
    .manage(AppState::default())
    .invoke_handler(tauri::generate_handler![
      bridge_request,
      read_clipboard_snapshot,
      write_text_clipboard,
      write_image_clipboard,
      hide_main_window,
      show_main_window,
      quit_app
    ])
    .system_tray(SystemTray::new().with_menu(tray_menu))
    .on_system_tray_event(handle_system_tray_event)
    .on_window_event(|event| {
      if let WindowEvent::CloseRequested { api, .. } = event.event() {
        api.prevent_close();
        let _ = event.window().hide();
      }
    })
    .run(tauri::generate_context!())
    .expect("failed to run SharePaste Windows app");
}

fn handle_system_tray_event(app: &AppHandle, event: SystemTrayEvent) {
  match event {
    SystemTrayEvent::MenuItemClick { id, .. } if id.as_str() == "show" => {
      let _ = show_window(app);
    }
    SystemTrayEvent::MenuItemClick { id, .. } if id.as_str() == "hide" => {
      if let Some(window) = app.get_window("main") {
        let _ = window.hide();
      }
    }
    SystemTrayEvent::MenuItemClick { id, .. } if id.as_str() == "quit" => {
      app.exit(0);
    }
    SystemTrayEvent::LeftClick { .. } => {
      let _ = show_window(app);
    }
    _ => {}
  }
}

fn show_window(app: &AppHandle) -> Result<(), String> {
  let window = app.get_window("main").ok_or_else(|| "main window not found".to_string())?;
  window.show().map_err(|error| error.to_string())?;
  window.set_focus().map_err(|error| error.to_string())?;
  Ok(())
}

fn emit_log(app: &AppHandle, level: &str, message: impl Into<String>, detail: Option<String>) {
  let _ = app.emit_all(
    "bridge:event",
    json!({
      "event": "log",
      "payload": {
        "level": level,
        "message": message.into(),
        "detail": detail
      }
    }),
  );
}

fn repo_root() -> Result<PathBuf, String> {
  if let Ok(value) = std::env::var("SHAREPASTE_REPO_ROOT") {
    return Ok(PathBuf::from(value));
  }

  let mut current = std::env::current_dir().map_err(|error| error.to_string())?;
  loop {
    if current.join("package.json").exists() && current.join("apps").join("client-cli").exists() {
      return Ok(current);
    }

    if !current.pop() {
      break;
    }
  }

  Err("unable to locate repo root; set SHAREPASTE_REPO_ROOT".to_string())
}

fn spawn_bridge(app: &AppHandle, settings: &BridgeSettings) -> Result<BridgeProcess, String> {
  let repo = repo_root()?;
  let npm = if cfg!(target_os = "windows") { "npm.cmd" } else { "npm" };

  let mut command = Command::new(npm);
  command
    .current_dir(&repo)
    .arg("run")
    .arg("--silent")
    .arg("-w")
    .arg("@sharepaste/client")
    .arg("dev:bridge")
    .arg("--")
    .arg("--server")
    .arg(&settings.server)
    .arg("--name")
    .arg(&settings.default_name)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

  if let Some(state_path) = &settings.state_path {
    command.arg("--state").arg(state_path);
  }
  if settings.reset_stale_state {
    command.arg("--reset-stale-state");
  }

  let mut child = command.spawn().map_err(|error| format!("failed to spawn runtime bridge: {error}"))?;
  let stdout = child.stdout.take().ok_or_else(|| "bridge stdout unavailable".to_string())?;
  let stderr = child.stderr.take().ok_or_else(|| "bridge stderr unavailable".to_string())?;
  let stdin = child.stdin.take().ok_or_else(|| "bridge stdin unavailable".to_string())?;
  let pending = Arc::new(Mutex::new(HashMap::new()));

  spawn_stdout_pump(app.clone(), stdout, pending.clone());
  spawn_stderr_pump(app.clone(), stderr);

  Ok(BridgeProcess {
    child,
    stdin: BufWriter::new(stdin),
    pending,
    next_id: 0,
  })
}

fn spawn_stdout_pump(app: AppHandle, stdout: ChildStdout, pending: Arc<Mutex<HashMap<String, Sender<Result<Value, String>>>>>) {
  std::thread::spawn(move || {
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
      let line = match line {
        Ok(value) => value,
        Err(error) => {
          emit_log(&app, "error", "failed to read runtime bridge stdout", Some(error.to_string()));
          break;
        }
      };

      let payload: Value = match serde_json::from_str(&line) {
        Ok(value) => value,
        Err(error) => {
          emit_log(&app, "error", "invalid runtime bridge message", Some(error.to_string()));
          continue;
        }
      };

      if let Some(id) = payload.get("id").and_then(Value::as_str) {
        let sender = pending.lock().ok().and_then(|mut map| map.remove(id));
        if let Some(sender) = sender {
          let response = if payload.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            Ok(payload.get("result").cloned().unwrap_or(Value::Null))
          } else {
            Err(
              payload
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("runtime bridge request failed")
                .to_string(),
            )
          };
          let _ = sender.send(response);
        }
        continue;
      }

      let _ = app.emit_all("bridge:event", payload);
    }
  });
}

fn spawn_stderr_pump(app: AppHandle, stderr: ChildStderr) {
  std::thread::spawn(move || {
    let reader = BufReader::new(stderr);
    for line in reader.lines() {
      match line {
        Ok(message) => emit_log(&app, "error", "runtime bridge stderr", Some(message)),
        Err(error) => {
          emit_log(&app, "error", "failed to read runtime bridge stderr", Some(error.to_string()));
          break;
        }
      }
    }
  });
}

fn ensure_bridge<'a>(app: &AppHandle, bridge_guard: &'a mut Option<BridgeProcess>, settings: &BridgeSettings) -> Result<&'a mut BridgeProcess, String> {
  let needs_spawn = match bridge_guard {
    Some(process) => !process.is_alive(),
    None => true,
  };

  if needs_spawn {
    *bridge_guard = Some(spawn_bridge(app, settings)?);
  }

  bridge_guard.as_mut().ok_or_else(|| "runtime bridge unavailable".to_string())
}

#[tauri::command]
fn bridge_request(app: AppHandle, state: State<'_, AppState>, method: String, params: Value) -> Result<Value, String> {
  let settings = state.settings.lock().map_err(|_| "settings lock poisoned".to_string())?.clone();
  let receiver = {
    let mut bridge_guard = state.bridge.lock().map_err(|_| "bridge lock poisoned".to_string())?;
    let bridge = ensure_bridge(&app, &mut bridge_guard, &settings)?;
    bridge.send(method, params)?
  };

  receiver
    .recv_timeout(Duration::from_secs(60))
    .map_err(|_| "runtime bridge timed out".to_string())?
}

fn sha_hex(bytes: &[u8]) -> String {
  let mut hasher = Sha256::new();
  hasher.update(bytes);
  format!("{:x}", hasher.finalize())
}

fn encode_png(path: &Path, width: usize, height: usize, rgba: &[u8]) -> Result<(), String> {
  let file = File::create(path).map_err(|error| error.to_string())?;
  let writer = BufWriter::new(file);
  let mut encoder = Encoder::new(writer, width as u32, height as u32);
  encoder.set_color(ColorType::Rgba);
  encoder.set_depth(BitDepth::Eight);
  let mut png_writer = encoder.write_header().map_err(|error| error.to_string())?;
  png_writer.write_image_data(rgba).map_err(|error| error.to_string())
}

fn decode_png(path: &Path) -> Result<(usize, usize, Vec<u8>), String> {
  let file = File::open(path).map_err(|error| error.to_string())?;
  let decoder = Decoder::new(BufReader::new(file));
  let mut reader = decoder.read_info().map_err(|error| error.to_string())?;
  let mut buffer = vec![0; reader.output_buffer_size()];
  let info = reader.next_frame(&mut buffer).map_err(|error| error.to_string())?;
  let bytes = buffer[..info.buffer_size()].to_vec();
  Ok((info.width as usize, info.height as usize, bytes))
}

fn clipboard_temp_dir() -> Result<PathBuf, String> {
  let dir = std::env::temp_dir().join("sharepaste-windows-clipboard");
  fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
  Ok(dir)
}

#[tauri::command]
fn read_clipboard_snapshot() -> Result<ClipboardSnapshot, String> {
  let mut clipboard = Clipboard::new().map_err(|error| error.to_string())?;

  if let Ok(text) = clipboard.get_text() {
    let fingerprint = sha_hex(text.as_bytes());
    return Ok(ClipboardSnapshot {
      kind: "text".to_string(),
      fingerprint: Some(fingerprint),
      text: Some(text),
      path: None,
      mime: None,
    });
  }

  if let Ok(image) = clipboard.get_image() {
    let mut bytes = Vec::with_capacity(image.bytes.len() + 16);
    bytes.extend_from_slice(&(image.width as u64).to_le_bytes());
    bytes.extend_from_slice(&(image.height as u64).to_le_bytes());
    bytes.extend_from_slice(image.bytes.as_ref());
    let fingerprint = sha_hex(&bytes);
    let output_path = clipboard_temp_dir()?.join(format!("{fingerprint}.png"));
    if !output_path.exists() {
      encode_png(&output_path, image.width, image.height, image.bytes.as_ref())?;
    }

    return Ok(ClipboardSnapshot {
      kind: "image".to_string(),
      fingerprint: Some(fingerprint),
      text: None,
      path: Some(output_path.to_string_lossy().to_string()),
      mime: Some("image/png".to_string()),
    });
  }

  Ok(ClipboardSnapshot {
    kind: "empty".to_string(),
    fingerprint: None,
    text: None,
    path: None,
    mime: None,
  })
}

#[tauri::command]
fn write_text_clipboard(value: String) -> Result<ClipboardSnapshot, String> {
  let mut clipboard = Clipboard::new().map_err(|error| error.to_string())?;
  clipboard.set_text(value.clone()).map_err(|error| error.to_string())?;
  Ok(ClipboardSnapshot {
    kind: "text".to_string(),
    fingerprint: Some(sha_hex(value.as_bytes())),
    text: Some(value),
    path: None,
    mime: None,
  })
}

#[tauri::command]
fn write_image_clipboard(path: String) -> Result<ClipboardSnapshot, String> {
  let image_path = PathBuf::from(path);
  let (width, height, rgba) = decode_png(&image_path)?;
  let mut clipboard = Clipboard::new().map_err(|error| error.to_string())?;
  clipboard
    .set_image(ImageData {
      width,
      height,
      bytes: Cow::Owned(rgba.clone()),
    })
    .map_err(|error| error.to_string())?;

  let mut bytes = Vec::with_capacity(rgba.len() + 16);
  bytes.extend_from_slice(&(width as u64).to_le_bytes());
  bytes.extend_from_slice(&(height as u64).to_le_bytes());
  bytes.extend_from_slice(&rgba);
  let fingerprint = sha_hex(&bytes);

  Ok(ClipboardSnapshot {
    kind: "image".to_string(),
    fingerprint: Some(fingerprint),
    text: None,
    path: Some(image_path.to_string_lossy().to_string()),
    mime: Some("image/png".to_string()),
  })
}

#[tauri::command]
fn hide_main_window(app: AppHandle) -> Result<(), String> {
  let window = app.get_window("main").ok_or_else(|| "main window not found".to_string())?;
  window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), String> {
  show_window(&app)
}

#[tauri::command]
fn quit_app(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
  if let Ok(mut bridge_guard) = state.bridge.lock() {
    if let Some(bridge) = bridge_guard.as_mut() {
      let _ = bridge.send("shutdown".to_string(), Value::Null);
    }
  }

  Notification::new(&app.config().tauri.bundle.identifier)
    .title("SharePaste")
    .body("SharePaste is shutting down")
    .show()
    .ok();

  app.exit(0);
  Ok(())
}
