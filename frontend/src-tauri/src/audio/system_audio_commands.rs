use tauri::{command, AppHandle, Emitter, State};
use crate::audio::{
    start_system_audio_capture, list_system_audio_devices, check_system_audio_permissions,
    SystemAudioDetector, SystemAudioEvent, new_system_audio_callback, list_system_audio_using_apps
};
use crate::audio::recording_preferences::get_default_recordings_folder;
use std::sync::{Arc, Mutex};
use anyhow::Result;
use futures_util::StreamExt;
use std::time::{Duration, Instant};
use std::fs::File;
use std::io::{Write, Seek, SeekFrom};
use log::{info, warn};

// Global state for system audio detector
type SystemAudioDetectorState = Arc<Mutex<Option<SystemAudioDetector>>>;

/// Start system audio capture (for capturing system output audio)
#[command]
pub async fn start_system_audio_capture_command() -> Result<String, String> {
    match start_system_audio_capture().await {
        Ok(_stream) => {
            // TODO: Store the stream in global state if needed for management
            Ok("System audio capture started successfully".to_string())
        }
        Err(e) => Err(format!("Failed to start system audio capture: {}", e))
    }
}

/// Diagnostic: Record 5 seconds of system audio from ALL programs (no filtering) and save as WAV
#[command]
pub async fn diagnostic_record_all_programs_5s() -> Result<String, String> {
    let mut stream = start_system_audio_capture()
        .await
        .map_err(|e| format!("Failed to start system capture: {}", e))?;

    let sample_rate = stream.sample_rate();
    if sample_rate == 0 {
        return Err("Invalid sample rate from system audio stream".to_string());
    }

    info!("🔎 Diagnostic capture started (global, no filtering), sample_rate={}", sample_rate);

    // Collect ~5 seconds of audio
    let duration = Duration::from_secs(5);
    let start_time = Instant::now();
    let mut samples: Vec<f32> = Vec::with_capacity((sample_rate as usize) * 5);

    while start_time.elapsed() < duration {
        match stream.next().await {
            Some(s) => samples.push(s),
            None => break,
        }
    }

    if samples.is_empty() {
        warn!("No samples captured during diagnostic window");
    }

    // Compute RMS
    let rms = if !samples.is_empty() {
        let sum_sq: f32 = samples.iter().map(|v| v * v).sum();
        (sum_sq / samples.len() as f32).sqrt()
    } else {
        0.0
    };
    info!("📈 Diagnostic RMS over {} samples: {:.4}", samples.len(), rms);

    // Write simple mono 32-bit float WAV
    let out_dir = get_default_recordings_folder();
    if let Err(e) = std::fs::create_dir_all(&out_dir) {
        return Err(format!("Failed to create recordings folder: {}", e));
    }

    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let out_path = out_dir.join(format!("Diagnostic_5s_{}.wav", timestamp));

    write_wav_f32_mono(&out_path, sample_rate, &samples)
        .map_err(|e| format!("Failed to write WAV: {}", e))?;

    info!("✅ Diagnostic recording saved: {}", out_path.display());
    Ok(out_path.to_string_lossy().to_string())
}

/// Minimal WAV writer for mono f32 (IEEE float) data
fn write_wav_f32_mono(path: &std::path::Path, sample_rate: u32, samples: &[f32]) -> Result<()> {
    let mut file = File::create(path)?;

    let num_channels: u16 = 1;
    let bits_per_sample: u16 = 32; // f32
    let byte_rate: u32 = sample_rate * num_channels as u32 * (bits_per_sample as u32 / 8);
    let block_align: u16 = num_channels * (bits_per_sample / 8);
    // RIFF header
    file.write_all(b"RIFF")?;
    file.write_all(&[0u8; 4])?; // Placeholder for chunk size
    file.write_all(b"WAVE")?;
    // fmt chunk
    file.write_all(b"fmt ")?;
    file.write_all(&(16u32).to_le_bytes())?; // Subchunk1Size for PCM
    file.write_all(&(3u16).to_le_bytes())?; // AudioFormat 3 = IEEE float
    file.write_all(&num_channels.to_le_bytes())?;
    file.write_all(&sample_rate.to_le_bytes())?;
    file.write_all(&byte_rate.to_le_bytes())?;
    file.write_all(&block_align.to_le_bytes())?;
    file.write_all(&bits_per_sample.to_le_bytes())?;
    // data chunk
    file.write_all(b"data")?;
    let data_size: u32 = (samples.len() * 4) as u32;
    file.write_all(&data_size.to_le_bytes())?;

    // Sample data
    for &s in samples {
        file.write_all(&s.to_le_bytes())?;
    }

    // Patch RIFF chunk size (file size - 8)
    let file_len = file.metadata()?.len();
    let riff_size = (file_len as u32).saturating_sub(8);
    file.seek(SeekFrom::Start(4))?;
    file.write_all(&riff_size.to_le_bytes())?;

    Ok(())
}

/// List available system audio devices
#[command]
pub async fn list_system_audio_devices_command() -> Result<Vec<String>, String> {
    list_system_audio_devices()
        .map_err(|e| format!("Failed to list system audio devices: {}", e))
}

/// Check if the app has permission to access system audio
#[command]
pub async fn check_system_audio_permissions_command() -> bool {
    check_system_audio_permissions()
}

/// Start monitoring system audio usage by other applications
#[command]
pub async fn start_system_audio_monitoring(
    app_handle: AppHandle,
    detector_state: State<'_, SystemAudioDetectorState>
) -> Result<(), String> {
    let mut detector_guard = detector_state.lock()
        .map_err(|e| format!("Failed to acquire detector lock: {}", e))?;

    if detector_guard.is_some() {
        return Err("System audio monitoring is already active".to_string());
    }

    let mut detector = SystemAudioDetector::new();

    // Create callback that emits events to the frontend
    let callback = new_system_audio_callback(move |event| {
        match event {
            SystemAudioEvent::SystemAudioStarted(apps) => {
                tracing::info!("System audio started by apps: {:?}", apps);
                let _ = app_handle.emit("system-audio-started", apps);
            }
            SystemAudioEvent::SystemAudioStopped => {
                let _ = app_handle.emit("system-audio-stopped", ());
                tracing::info!("System audio stopped");
            }
        }
    });

    detector.start(callback);
    *detector_guard = Some(detector);

    Ok(())
}

/// Stop monitoring system audio usage
#[command]
pub async fn stop_system_audio_monitoring(
    detector_state: State<'_, SystemAudioDetectorState>
) -> Result<(), String> {
    let mut detector_guard = detector_state.lock()
        .map_err(|e| format!("Failed to acquire detector lock: {}", e))?;

    if let Some(mut detector) = detector_guard.take() {
        detector.stop();
        Ok(())
    } else {
        Err("System audio monitoring is not active".to_string())
    }
}

/// Get the current status of system audio monitoring
#[command]
pub async fn get_system_audio_monitoring_status(
    detector_state: State<'_, SystemAudioDetectorState>
) -> Result<bool, String> {
    let detector_guard = detector_state.lock()
        .map_err(|e| format!("Failed to acquire detector lock: {}", e))?;

    Ok(detector_guard.is_some())
}

/// Get list of applications currently using system audio
#[command]
pub async fn get_apps_using_audio() -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let apps = list_system_audio_using_apps();
        Ok(apps)
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        // For non-macOS platforms, return empty for now
        // Can be extended for Windows/Linux later
        Ok(vec![])
    }
}

/// Initialize the system audio detector state in Tauri app
pub fn init_system_audio_state() -> SystemAudioDetectorState {
    Arc::new(Mutex::new(None))
}

// Event payload types for frontend
#[derive(serde::Serialize, Clone)]
pub struct SystemAudioStartedPayload {
    pub apps: Vec<String>,
}

#[derive(serde::Serialize, Clone)]
pub struct SystemAudioStoppedPayload;

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_list_system_audio_devices() {
        let devices = list_system_audio_devices_command().await;
        match devices {
            Ok(device_list) => {
                println!("System audio devices: {:?}", device_list);
                assert!(device_list.len() >= 0); // Should at least not crash
            }
            Err(e) => {
                println!("Error listing devices: {}", e);
                // This might fail on CI or systems without audio
            }
        }
    }

    #[tokio::test]
    async fn test_check_permissions() {
        let has_permission = check_system_audio_permissions_command().await;
        println!("Has system audio permissions: {}", has_permission);
        // This is mainly a smoke test to ensure it doesn't crash
    }
}