use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use anyhow::Result;
use log::{error, info, warn};
use tokio::sync::{mpsc, Notify};
use tokio::time::{sleep, Duration};
use futures_util::StreamExt;

use super::devices::AudioDevice;
use super::pipeline::AudioCapture;
use super::recording_state::{RecordingState, DeviceType};
use super::capture::{SystemAudioCapture, SystemAudioStream};
use super::telemetry::{AudioTelemetryEvent, emit_telemetry_event};

/// System audio stream implementation that integrates with existing pipeline
pub struct SystemAudioStreamManager {
    device: Arc<AudioDevice>,
    shutdown: Arc<AtomicBool>,
    shutdown_notify: Arc<Notify>,
    capture_task: Option<tokio::task::JoinHandle<()>>,
}

impl SystemAudioStreamManager {
    /// Create a new system audio stream that integrates with existing recording pipeline
    pub async fn create(
        device: Arc<AudioDevice>,
        state: Arc<RecordingState>,
        recording_sender: Option<mpsc::UnboundedSender<super::recording_state::AudioChunk>>,
    ) -> Result<Self> {
        info!("Creating system audio stream for device: {}", device.name);

        // Build the initial Core Audio tap before starting the supervisor loop
        let initial_stream = SystemAudioCapture::new()?.start_system_audio_capture()?;
        info!("Initial system audio stream started at {} Hz", initial_stream.sample_rate());

        let shutdown = Arc::new(AtomicBool::new(false));
        let shutdown_notify = Arc::new(Notify::new());

        let capture_task = tokio::spawn(run_capture_loop(
            device.clone(),
            state.clone(),
            recording_sender,
            Some(initial_stream),
            shutdown.clone(),
            shutdown_notify.clone(),
        ));

        info!("System audio stream started for device: {}", device.name);

        Ok(Self {
            device,
            shutdown,
            shutdown_notify,
            capture_task: Some(capture_task),
        })
    }

    /// Get device info
    pub fn device(&self) -> &AudioDevice {
        &self.device
    }

    /// Stop the system audio stream
    pub async fn stop(mut self) -> Result<()> {
        info!("Stopping system audio stream for device: {}", self.device.name);

        self.shutdown.store(true, Ordering::Release);
        self.shutdown_notify.notify_waiters();

        if let Some(task) = self.capture_task.take() {
            if let Err(e) = task.await {
                warn!("System audio capture task aborted: {}", e);
            }
        }

        Ok(())
    }
}

/// Enhanced AudioStreamManager that can use either regular CPAL or our new system audio approach
pub struct EnhancedAudioStreamManager {
    microphone_stream: Option<super::stream::AudioStream>,
    system_stream: Option<SystemAudioStreamManager>,
    state: Arc<RecordingState>,
}

impl EnhancedAudioStreamManager {
    pub fn new(state: Arc<RecordingState>) -> Self {
        Self {
            microphone_stream: None,
            system_stream: None,
            state,
        }
    }

    /// Start audio streams with enhanced system audio capture
    pub async fn start_streams(
        &mut self,
        microphone_device: Option<Arc<AudioDevice>>,
        system_device: Option<Arc<AudioDevice>>,
        recording_sender: Option<mpsc::UnboundedSender<super::recording_state::AudioChunk>>,
    ) -> Result<()> {
        info!("Starting enhanced audio streams");

        // Start microphone stream (if available)
        if let Some(mic_device) = microphone_device {
            info!("Starting microphone stream: {}", mic_device.name);
            let mic_stream = super::stream::AudioStream::create(
                mic_device,
                self.state.clone(),
                DeviceType::Input,
                recording_sender.clone(),
            ).await?;
            self.microphone_stream = Some(mic_stream);
        }

        // Start system audio stream with enhanced capture (if available)
        if let Some(sys_device) = system_device {
            info!("Starting enhanced system audio stream: {}", sys_device.name);

            // Check if we should use enhanced system audio capture
            if should_use_enhanced_system_audio(&sys_device) {
                info!("Using enhanced Core Audio system capture for: {}", sys_device.name);
                let sys_stream = SystemAudioStreamManager::create(
                    sys_device,
                    self.state.clone(),
                    recording_sender,
                ).await?;
                self.system_stream = Some(sys_stream);
            } else {
                info!("Falling back to ScreenCaptureKit for: {}", sys_device.name);
                // Fallback to existing ScreenCaptureKit approach
                let sys_stream = super::stream::AudioStream::create(
                    sys_device,
                    self.state.clone(),
                    DeviceType::Output,
                    recording_sender,
                ).await?;
                // Note: We'd need to store this differently or modify the structure
                warn!("Fallback ScreenCaptureKit stream created but not stored in enhanced manager");
            }
        }

        let mic_count = if self.microphone_stream.is_some() { 1 } else { 0 };
        let sys_count = if self.system_stream.is_some() { 1 } else { 0 };

        info!("Enhanced audio streams started: {} microphone, {} system audio",
               mic_count, sys_count);

        Ok(())
    }

    /// Stop all streams
    pub async fn stop_streams(&mut self) -> Result<()> {
        info!("Stopping enhanced audio streams");

        if let Some(mic_stream) = self.microphone_stream.take() {
            mic_stream.stop()?;
        }

        if let Some(sys_stream) = self.system_stream.take() {
            sys_stream.stop().await?;
        }

        info!("Enhanced audio streams stopped");
        Ok(())
    }

    /// Get count of active streams
    pub fn active_stream_count(&self) -> usize {
        let mut count = 0;
        if self.microphone_stream.is_some() {
            count += 1;
        }
        if self.system_stream.is_some() {
            count += 1;
        }
        count
    }
}

/// Determine if we should use enhanced system audio capture
/// This can be based on device name, capabilities, or user preferences
fn should_use_enhanced_system_audio(device: &AudioDevice) -> bool {
    // For now, always use enhanced capture on macOS
    #[cfg(target_os = "macos")]
    {
        // You could add logic here to check device capabilities or user preferences
        // For example, only use enhanced capture for certain device types
        true
    }

    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_use_enhanced_system_audio() {
        let device = Arc::new(AudioDevice::new("Test Device".to_string(), super::super::DeviceType::Output));

        #[cfg(target_os = "macos")]
        assert!(should_use_enhanced_system_audio(&device));

        #[cfg(not(target_os = "macos"))]
        assert!(!should_use_enhanced_system_audio(&device));
    }
}

async fn run_capture_loop(
    device: Arc<AudioDevice>,
    state: Arc<RecordingState>,
    recording_sender: Option<mpsc::UnboundedSender<super::recording_state::AudioChunk>>,
    mut pending_stream: Option<SystemAudioStream>,
    shutdown: Arc<AtomicBool>,
    shutdown_notify: Arc<Notify>,
) {
    const FRAMES_PER_CHUNK: usize = 1024;
    const INITIAL_BACKOFF_MS: u64 = 250;
    const MAX_BACKOFF_MS: u64 = 5_000;

    let mut backoff_ms = INITIAL_BACKOFF_MS;
    let mut restart_attempt: u32 = 0;

    while !shutdown.load(Ordering::Acquire) {
        let stream_result = match pending_stream.take() {
            Some(stream) => Ok(stream),
            None => {
                SystemAudioCapture::new()
                    .and_then(|capture| capture.start_system_audio_capture())
            }
        };

        let system_stream = match stream_result {
            Ok(stream) => {
                info!("System audio capture stream ready ({} Hz)", stream.sample_rate());
                emit_telemetry_event(AudioTelemetryEvent::SystemCaptureRecovered {
                    sample_rate: stream.sample_rate(),
                });
                restart_attempt = 0;
                stream
            }
            Err(err) => {
                error!("Failed to initialize system audio capture: {}", err);
                restart_attempt = restart_attempt.saturating_add(1);

                if shutdown.load(Ordering::Acquire) {
                    break;
                }

                let delay = Duration::from_millis(backoff_ms);
                warn!("Retrying system audio capture in {:?}...", delay);
                emit_telemetry_event(AudioTelemetryEvent::SystemCaptureRestart {
                    attempt: restart_attempt,
                    error: err.to_string(),
                    backoff_ms,
                });

                tokio::select! {
                    _ = sleep(delay) => {},
                    _ = shutdown_notify.notified() => break,
                }

                backoff_ms = (backoff_ms * 2).min(MAX_BACKOFF_MS);
                continue;
            }
        };

        backoff_ms = INITIAL_BACKOFF_MS;

        let audio_capture = AudioCapture::new(
            device.clone(),
            state.clone(),
            system_stream.sample_rate(),
            2, // Assume stereo for system audio
            DeviceType::Output,
            recording_sender.clone(),
        );

        match pump_system_audio(
            system_stream,
            audio_capture,
            FRAMES_PER_CHUNK,
            shutdown.clone(),
            shutdown_notify.clone(),
        ).await {
            Ok(_) => {
                info!("System audio capture loop exited after shutdown signal");
                break;
            }
            Err(err) => {
                warn!("System audio stream interrupted: {}", err);
                restart_attempt = restart_attempt.saturating_add(1);

                if shutdown.load(Ordering::Acquire) {
                    break;
                }

                emit_telemetry_event(AudioTelemetryEvent::SystemCaptureRestart {
                    attempt: restart_attempt,
                    error: err.to_string(),
                    backoff_ms,
                });

                let delay = Duration::from_millis(backoff_ms);
                tokio::select! {
                    _ = sleep(delay) => {},
                    _ = shutdown_notify.notified() => break,
                }

                backoff_ms = (backoff_ms * 2).min(MAX_BACKOFF_MS);
                continue;
            }
        }
    }

    info!("System audio capture supervisor exiting");
    emit_telemetry_event(AudioTelemetryEvent::SystemCaptureShutdown);
}

async fn pump_system_audio(
    mut system_stream: SystemAudioStream,
    audio_capture: AudioCapture,
    frames_per_chunk: usize,
    shutdown: Arc<AtomicBool>,
    shutdown_notify: Arc<Notify>,
) -> Result<()> {
    let mut buffer = Vec::with_capacity(frames_per_chunk);

    loop {
        tokio::select! {
            _ = shutdown_notify.notified(), if shutdown.load(Ordering::Acquire) => {
                info!("Shutdown signal received for system audio capture");
                break;
            }
            sample = system_stream.next() => {
                match sample {
                    Some(sample) => {
                        buffer.push(sample);
                        if buffer.len() >= frames_per_chunk {
                            audio_capture.process_audio_data(&buffer);
                            buffer.clear();
                        }
                    }
                    None => {
                        if !buffer.is_empty() {
                            audio_capture.process_audio_data(&buffer);
                        }
                        anyhow::bail!("System audio stream ended unexpectedly");
                    }
                }
            }
        }
    }

    if !buffer.is_empty() {
        audio_capture.process_audio_data(&buffer);
    }

    Ok(())
}