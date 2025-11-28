use log::{error, info, warn};

use super::recording_state::DeviceType;

/// High-level telemetry events for the audio pipeline
#[derive(Debug, Clone)]
pub enum AudioTelemetryEvent {
    LatencyWindowConfigured {
        window_ms: f32,
        max_buffer_ms: f32,
    },
    BufferOverflow {
        device: DeviceType,
        current_samples: usize,
        max_samples: usize,
    },
    SystemCaptureRestart {
        attempt: u32,
        error: String,
        backoff_ms: u64,
    },
    SystemCaptureRecovered {
        sample_rate: u32,
    },
    SystemCaptureShutdown,
}

/// Emit a structured telemetry event to the log stream
pub fn emit_telemetry_event(event: AudioTelemetryEvent) {
    match event {
        AudioTelemetryEvent::LatencyWindowConfigured {
            window_ms,
            max_buffer_ms,
        } => {
            info!(
                "📡 [telemetry] latency_window_configured window_ms={:.1} max_buffer_ms={:.1}",
                window_ms, max_buffer_ms
            );
        }
        AudioTelemetryEvent::BufferOverflow {
            device,
            current_samples,
            max_samples,
        } => {
            warn!(
                "📡 [telemetry] buffer_overflow device={:?} current={} max={}",
                device, current_samples, max_samples
            );
        }
        AudioTelemetryEvent::SystemCaptureRestart {
            attempt,
            error,
            backoff_ms,
        } => {
            warn!(
                "📡 [telemetry] system_capture_restart attempt={} backoff_ms={} reason={}",
                attempt, backoff_ms, error
            );
        }
        AudioTelemetryEvent::SystemCaptureRecovered { sample_rate } => {
            info!(
                "📡 [telemetry] system_capture_recovered sample_rate={}Hz",
                sample_rate
            );
        }
        AudioTelemetryEvent::SystemCaptureShutdown => {
            info!("📡 [telemetry] system_capture_shutdown");
        }
    }
}





