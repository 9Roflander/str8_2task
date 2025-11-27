# Audio Capture Review: App Filtering Not Working

## Executive Summary

The app filtering feature for system audio capture is **partially implemented but not functional**. The code correctly identifies which processes to include/exclude based on user selections, but **never actually applies the filter** because it always creates an empty exclude array.

## Problem Analysis

### Root Cause

In `frontend/src-tauri/src/audio/capture/core_audio.rs`, lines 95-167:

1. ✅ **Correctly identifies selected apps**: The code finds PIDs of selected apps (lines 108-123)
2. ✅ **Correctly builds exclude list**: It identifies which processes to exclude (lines 136-139)
3. ❌ **Never applies the filter**: Always returns `cidre::ns::Array::new()` (empty array) on line 153

**Critical Code Section:**
```rust
// Lines 144-153 in core_audio.rs
// Convert PIDs to NSArray of CFNumbers
// Note: Core Audio expects an array of process IDs to exclude
// For now, we'll skip the actual filtering implementation
// as it requires complex CFArray to NSArray conversion
// TODO: Implement proper NSArray creation from process PIDs
if !exclude_pids.is_empty() {
    info!("🎙️ CoreAudio: Found {} processes to exclude, but filtering not yet fully implemented", exclude_pids.len());
    info!("🎙️ CoreAudio: Would exclude PIDs: {:?}", exclude_pids);
}
cidre::ns::Array::new()  // ❌ ALWAYS EMPTY - NO FILTERING!
```

### Impact

- **User Experience**: Users select specific apps in the UI, but the system captures audio from ALL apps
- **Privacy**: Users expect only selected apps to be captured, but all system audio is recorded
- **Functionality**: The feature appears to work (no errors), but silently fails

## Data Flow Analysis

### ✅ Correct Flow (Preferences → Capture)

1. **UI Layer** (`RecordingSettings.tsx`):
   - User selects apps via `AppSelector` component
   - Preferences saved with `filtered_apps` field

2. **Command Layer** (`recording_commands.rs`):
   - Loads preferences (lines 120-136, 294-310)
   - Extracts `filtered_apps` from preferences
   - Passes to `start_recording()` or `start_recording_with_defaults()`

3. **Manager Layer** (`recording_manager.rs`):
   - Receives `filter_apps` parameter
   - Passes to `stream_manager.start_streams()` (line 126)

4. **Stream Layer** (`stream.rs`):
   - Receives `filter_apps` in `start_streams()` (line 370)
   - Passes to `AudioStream::create()` for system audio (line 407)
   - Passes to `create_core_audio_stream()` (line 89)
   - Passes to `CoreAudioCapture::new()` (line 159)

5. **Capture Layer** (`core_audio.rs`):
   - Receives `filter_apps` in `new()` method (line 62)
   - ❌ **FAILS HERE**: Identifies processes but doesn't create exclude array

### Backend Selection

The filtering only works with **Core Audio backend**, not ScreenCaptureKit:

```rust
// stream.rs, lines 68-89
#[cfg(target_os = "macos")]
let use_core_audio = device_type == DeviceType::System
    && backend_type == AudioCaptureBackend::CoreAudio;

if use_core_audio {
    // ✅ App filtering supported here
    return Self::create_core_audio_stream(device, state, device_type, recording_sender, filter_apps).await;
}

// ❌ CPAL/ScreenCaptureKit path - filtering ignored
info!("🎵 Stream: Using CPAL backend ({}) for device: {}", backend_name, device.name);
// Note: CPAL doesn't support app filtering, so filter_apps is ignored here
```

**Note**: If the backend is set to ScreenCaptureKit, app filtering is completely ignored (line 104 in `stream.rs`).

## Technical Details

### Core Audio Tap API

The code uses `ca::TapDesc::with_mono_global_tap_excluding_processes()` which expects:
- An `NSArray` of process IDs (PIDs) to **exclude** from capture
- Empty array = capture all processes
- Non-empty array = capture all processes EXCEPT those in the array

### Current Implementation Logic

1. Gets all processes using audio: `ca::System::processes()`
2. Finds PIDs of selected apps by matching app names
3. Builds exclude list: all PIDs EXCEPT selected ones
4. **Should create NSArray from exclude_pids** ← **NOT IMPLEMENTED**
5. Always creates empty array instead

### Required Fix

The exclude array needs to be created from the `exclude_pids` vector. The `cidre` crate should provide utilities to convert Rust types to NSArray/CFArray.

**Suggested Implementation:**

Based on the pattern used in line 221 (`cf::ArrayOf::from_slice()`), the fix should convert PIDs to CFNumbers and create an NSArray:

```rust
// Convert PIDs to NSArray of CFNumbers
let exclude_array = if !exclude_pids.is_empty() {
    // Convert each PID (i32) to CFNumber
    let cf_numbers: Vec<cf::Number> = exclude_pids
        .iter()
        .map(|&pid| cf::Number::from_i32(pid))
        .collect();
    
    // Create NSArray from CFNumbers
    // Note: May need to use cidre::ns::Array::from_vec() or similar API
    // Check cidre crate docs for exact method
    cidre::ns::Array::from_vec(cf_numbers)
        .unwrap_or_else(|| {
            warn!("⚠️ CoreAudio: Failed to create exclude array, falling back to global tap");
            cidre::ns::Array::new()
        })
} else {
    cidre::ns::Array::new()
};
```

**Alternative Approach (if NSArray API is different):**

If `cidre::ns::Array` doesn't have a `from_vec()` method, you may need to:
1. Create an empty NSArray
2. Iterate through PIDs and add each as NSNumber
3. Or use CFArray and convert to NSArray

**Research Needed:**
- Check `cidre::ns::Array` API documentation
- Check `cidre::cf::Number` API for creating numbers from i32
- Verify if `TapDesc::with_mono_global_tap_excluding_processes()` accepts NSArray or CFArray

## Recommendations

### Immediate Fix (High Priority)

1. **Implement NSArray creation from PIDs**:
   - Research `cidre` crate documentation for NSArray creation
   - Convert `Vec<i32>` (PIDs) to `NSArray` of `NSNumber`
   - Replace `cidre::ns::Array::new()` with actual exclude array

2. **Add validation**:
   - Log when filtering is applied vs. when it's not
   - Warn if selected apps are not found (already partially done)
   - Verify that the exclude array is non-empty when filtering is active

3. **Backend selection check**:
   - Warn users if they select apps but backend is ScreenCaptureKit
   - Or automatically switch to Core Audio when app filtering is enabled

### Code Quality Improvements

1. **Error handling**: Currently silently falls back to global tap
   - Should return an error if filtering is requested but can't be applied
   - Or at least emit a clear warning to the user

2. **Process matching**: Current implementation uses `localized_name()`
   - May not match if app name differs (e.g., "Zoom" vs "zoom.us")
   - Consider using bundle identifier or multiple matching strategies

3. **Dynamic updates**: Selected apps are only checked at capture start
   - If a new app starts playing audio, it won't be filtered
   - Consider periodic re-checking or process monitoring

### Testing Recommendations

1. **Unit test**: Verify exclude array creation from PIDs
2. **Integration test**: Start capture with selected apps, verify only those apps are captured
3. **Manual test**: Select specific apps, play audio from multiple apps, verify only selected apps are captured

## Related Files

- `frontend/src-tauri/src/audio/capture/core_audio.rs` - Core implementation (BUG HERE)
- `frontend/src-tauri/src/audio/stream.rs` - Stream creation, passes filter_apps
- `frontend/src-tauri/src/audio/recording_manager.rs` - Manager, passes filter_apps
- `frontend/src-tauri/src/audio/recording_commands.rs` - Commands, loads preferences
- `frontend/src-tauri/src/audio/recording_preferences.rs` - Preferences structure
- `frontend/src/components/RecordingSettings.tsx` - UI for app selection
- `frontend/src/components/AppSelector.tsx` - App selection component

## Additional Issues Found

### Issue 2: Backend Selection Not Validated

**Location**: `stream.rs` line 104

**Problem**: If user selects apps but backend is ScreenCaptureKit, filtering is silently ignored.

**Impact**: Users may think filtering is working when it's not.

**Recommendation**: 
- Check backend when `filter_apps` is provided
- Automatically switch to Core Audio, OR
- Show clear warning that filtering requires Core Audio backend

### Issue 3: Process Matching May Be Fragile

**Location**: `core_audio.rs` lines 111-120

**Problem**: Uses `localized_name()` which may not match user's app selection exactly.

**Example**: User selects "Zoom" but app reports as "zoom.us" or "Zoom Meetings"

**Recommendation**:
- Use bundle identifier as primary match
- Fall back to localized name
- Consider fuzzy matching or multiple name variations

### Issue 4: No Runtime Validation

**Location**: `core_audio.rs` line 153

**Problem**: Even if filtering is implemented, there's no way to verify it's working.

**Recommendation**:
- Log which processes are being excluded
- Add telemetry to track filtering effectiveness
- Provide UI indicator showing which apps are being captured

## Issue 5: Preferences Not Persisted (FIXED ✅)

**Location**: `recording_preferences.rs` lines 96-139

**Problem**: `load_recording_preferences()` and `save_recording_preferences()` were not actually saving/loading from persistent storage - they just returned defaults!

**Impact**: `filtered_apps` selections were lost on app restart.

**Status**: ✅ **FIXED** - Now using `tauri-plugin-store` to persist preferences to `recording-preferences.json`

**Changes Made**:
- Added `tauri_plugin_store::StoreExt` import
- Updated `load_recording_preferences()` to load from store
- Updated `save_recording_preferences()` to save to store
- Added logging for `filtered_apps` in save/load operations

## Summary

**Status**: ⚠️ **PARTIALLY WORKING** - Preferences are now persisted, but app filtering still not functional

**Severity**: 🔴 **HIGH** - Core feature that users expect to work

**Fix Complexity**: 🟡 **MEDIUM** - Requires understanding of `cidre` crate's NSArray API

**Estimated Fix Time**: 2-4 hours (research + implementation + testing)

**Good News**: 
- ✅ **FIXED**: Preferences are now persisted (Issue 5)
- ✅ Data flow is correct (preferences → commands → manager → stream → capture)
- ✅ Filtering logic is sound (correctly identifies which processes to exclude)
- ❌ Still missing: creating NSArray from PIDs (Issue 1)

**Next Steps**:
1. ✅ **DONE**: Fix preferences persistence (Issue 5)
2. Research `cidre::ns::Array` API for creating arrays from Vec
3. Research `cidre::cf::Number` API for converting i32 to CFNumber
4. Implement exclude array creation
5. Add validation and logging
6. Test with multiple apps to verify filtering works

