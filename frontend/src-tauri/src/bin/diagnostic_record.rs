// Minimal standalone diagnostic that records ~5s of system audio (ALL programs, no filtering)
// and writes a mono f32 WAV file into the default recordings folder.
//
// Note: On macOS 14.4+, Audio Capture permission must be granted to the app/binary.
// If the tap fails (!obj), grant permission in System Settings → Privacy & Security → Audio Capture.

use futures_util::StreamExt;
use app_lib::audio;
use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;
use std::time::{Duration, Instant};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Start system audio capture (CoreAudio on macOS; no app filtering here)
    let mut stream = audio::start_system_audio_capture().await?;
    let sample_rate = stream.sample_rate();
    if sample_rate == 0 {
        anyhow::bail!("Invalid sample rate from system audio stream");
    }

    println!("Diagnostic: capturing ~5 seconds at {} Hz (global/all apps)...", sample_rate);

    let start = Instant::now();
    let mut samples: Vec<f32> = Vec::with_capacity((sample_rate as usize) * 5);
    while start.elapsed() < Duration::from_secs(5) {
        match stream.next().await {
            Some(s) => samples.push(s),
            None => break,
        }
    }

    let rms = if !samples.is_empty() {
        let sum_sq: f32 = samples.iter().map(|v| v * v).sum();
        (sum_sq / samples.len() as f32).sqrt()
    } else {
        0.0
    };
    println!("Captured {} samples, RMS={:.4}", samples.len(), rms);

    // Save to default recordings folder
    let out_dir = audio::get_default_recordings_folder();
    std::fs::create_dir_all(&out_dir)?;

    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let out_path = out_dir.join(format!("Diagnostic_5s_cli_{}.wav", timestamp));
    write_wav_f32_mono(&out_path, sample_rate, &samples)?;
    println!("Saved: {}", out_path.display());

    Ok(())
}

fn write_wav_f32_mono(path: &Path, sample_rate: u32, samples: &[f32]) -> anyhow::Result<()> {
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


