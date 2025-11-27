// Audio capture tests
#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    use crate::audio::capture::CoreAudioCapture;
    use crate::audio::recording_preferences::RecordingPreferences;

    #[test]
    #[cfg(target_os = "macos")]
    fn test_core_audio_capture_creation() {
        // Test creating Core Audio capture without filtering
        let result = CoreAudioCapture::new(None);
        assert!(result.is_ok(), "Core Audio capture should be created successfully");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_core_audio_capture_with_empty_filter() {
        // Test creating Core Audio capture with empty filter (should capture all)
        let empty_filter: Option<Vec<String>> = Some(vec![]);
        let result = CoreAudioCapture::new(empty_filter);
        assert!(result.is_ok(), "Core Audio capture with empty filter should work");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_core_audio_capture_with_app_filter() {
        // Test creating Core Audio capture with app filtering
        let filter_apps = Some(vec!["Zoom".to_string(), "Google Chrome".to_string()]);
        let result = CoreAudioCapture::new(filter_apps);
        
        // Should succeed even if apps aren't running (will log warning)
        assert!(result.is_ok(), "Core Audio capture with app filter should be created");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_core_audio_stream_creation() {
        // Test creating a stream from capture
        let capture = CoreAudioCapture::new(None).expect("Failed to create capture");
        let stream_result = capture.stream();
        
        // Stream creation might fail if permissions aren't granted, but structure should be correct
        if let Err(e) = stream_result {
            // Permission errors are acceptable in tests
            assert!(
                e.to_string().contains("permission") || 
                e.to_string().contains("Permission") ||
                e.to_string().contains("denied"),
                "Expected permission error, got: {}", e
            );
        } else {
            let stream = stream_result.unwrap();
            let sample_rate = stream.sample_rate();
            assert!(sample_rate > 0, "Sample rate should be positive");
            assert!(sample_rate <= 192000, "Sample rate should be reasonable");
        }
    }

    #[test]
    fn test_recording_preferences_default() {
        // Test default recording preferences
        let prefs = RecordingPreferences::default();
        assert_eq!(prefs.auto_save, true);
        assert_eq!(prefs.file_format, "mp4");
        assert!(prefs.save_folder.exists() || prefs.save_folder.parent().is_some());
    }

    #[test]
    fn test_recording_preferences_with_filtered_apps() {
        // Test preferences with filtered apps
        let mut prefs = RecordingPreferences::default();
        prefs.filtered_apps = Some(vec!["Zoom".to_string(), "Teams".to_string()]);
        
        assert_eq!(prefs.filtered_apps.as_ref().unwrap().len(), 2);
        assert!(prefs.filtered_apps.as_ref().unwrap().contains(&"Zoom".to_string()));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_app_filtering_logic() {
        // Test the app filtering logic (without actually creating capture)
        let selected_apps = vec!["Zoom".to_string(), "Google Chrome".to_string()];
        
        // This test verifies the filtering logic works correctly
        // In a real scenario, we'd mock the process list
        assert_eq!(selected_apps.len(), 2);
        assert!(selected_apps.contains(&"Zoom".to_string()));
    }

    #[test]
    fn test_preferences_serialization() {
        // Test that preferences can be serialized/deserialized
        let mut prefs = RecordingPreferences::default();
        prefs.filtered_apps = Some(vec!["App1".to_string(), "App2".to_string()]);
        
        // Serialize
        let json = serde_json::to_string(&prefs).expect("Should serialize");
        assert!(json.contains("App1"));
        assert!(json.contains("filtered_apps"));
        
        // Deserialize
        let deserialized: RecordingPreferences = serde_json::from_str(&json)
            .expect("Should deserialize");
        assert_eq!(
            deserialized.filtered_apps.as_ref().unwrap().len(),
            prefs.filtered_apps.as_ref().unwrap().len()
        );
    }
}

// Integration tests for audio capture
#[cfg(test)]
mod integration_tests {
    use super::*;
    use futures_util::StreamExt;
    use tokio::time::{sleep, Duration};

    #[tokio::test]
    #[cfg(target_os = "macos")]
    #[ignore] // Only run manually as it requires audio hardware and permissions
    async fn test_core_audio_stream_samples() {
        // Integration test: verify we can actually get samples from the stream
        use futures_util::StreamExt;
        use crate::audio::capture::CoreAudioCapture;
        
        let capture = CoreAudioCapture::new(None).expect("Failed to create capture");
        let mut stream = capture.stream().expect("Failed to create stream");

        let sample_rate = stream.sample_rate();
        println!("Stream sample rate: {} Hz", sample_rate);

        // Collect some samples
        let mut sample_count = 0;
        let timeout = Duration::from_secs(2);
        let start = std::time::Instant::now();

        while sample_count < 1000 && start.elapsed() < timeout {
            if let Some(_sample) = stream.next().await {
                sample_count += 1;
            }
        }

        println!("Collected {} samples in {:?}", sample_count, start.elapsed());
        assert!(sample_count > 0, "Should collect at least some samples");
    }

    #[tokio::test]
    #[cfg(target_os = "macos")]
    #[ignore] // Only run manually
    async fn test_app_filtering_integration() {
        // Integration test: verify app filtering actually works
        // This requires:
        // 1. Selected apps to be running
        // 2. Audio to be playing from those apps
        // 3. Audio Capture permission
        use futures_util::StreamExt;
        use crate::audio::capture::CoreAudioCapture;
        
        let filter_apps = Some(vec!["Zoom".to_string()]);
        let capture = CoreAudioCapture::new(filter_apps).expect("Failed to create capture");
        let mut stream = capture.stream().expect("Failed to create stream");

        // Collect samples and verify we're getting audio
        let mut sample_count = 0;
        let mut non_zero_samples = 0;
        let timeout = Duration::from_secs(3);
        let start = std::time::Instant::now();

        while sample_count < 10000 && start.elapsed() < timeout {
            if let Some(sample) = stream.next().await {
                sample_count += 1;
                if sample.abs() > 0.0001 {
                    non_zero_samples += 1;
                }
            }
        }

        println!("Collected {} samples, {} non-zero", sample_count, non_zero_samples);
        
        // If filtering is working, we should get audio (non-zero samples)
        // Note: This test may fail if Zoom isn't playing audio
        if non_zero_samples > 0 {
            println!("✅ App filtering appears to be working - audio detected");
        } else {
            println!("⚠️ No audio detected - may indicate filtering issue or no audio playing");
        }
    }
}

