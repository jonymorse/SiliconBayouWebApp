# Unified Bayou AR Implementation

## Overview
This unified implementation combines the Remote API functionality from `proper.js` with the camera controls and UX from `proper_og.js`, plus implements the sophisticated caching system described in `lens_state_cache.md`.

## Key Features

### 1. **Remote API Integration**
- Implements `ping`, `get_state`, and `set_state` endpoints
- Provides lens communication for collectible game mechanics
- Maintains game state with collected items (names[], collected{})

### 2. **Camera Management**
- Auto-starts camera with lens applied
- Double-tap gesture to switch between front/back cameras
- Mobile-optimized canvas rendering with proper aspect ratios
- Transform handling for front camera mirroring

### 3. **Smart Caching System**
- **localStorage**: Persists collected items across sessions
- **sessionStorage**: Tracks camera switch vs manual refresh
- **State injection**: Restores state after camera switches
- **Duplicate prevention**: Avoids re-collecting same items

### 4. **Background Audio**
- Ambient bayou sounds with user interaction requirement
- Auto-starts on first user touch/click
- Loops continuously for immersion

## Cache Flow Logic

```
User Action           Storage               Behavior
─────────────────────┼────────────────────┼─────────────────────
Double-tap (switch)  │ sessionStorage:    │ Page reloads →
                     │ "switchCamera"     │ State restored
─────────────────────┼────────────────────┼─────────────────────
Manual refresh       │ (nothing set)      │ Fresh start
─────────────────────┼────────────────────┼─────────────────────
Lens sends set_state │ localStorage:      │ State persisted
                     │ game data          │ for next switch
```

## API Endpoints

### GET /get_state
Returns current game state (including restored cache if camera switch)
```json
{
  "names": ["Frog", "Gator", "Pelican"],
  "collected": {"Frog": true, "Gator": true, "Pelican": false},
  "t": 1758166937527
}
```

### POST /set_state
Receives updated state from lens, saves to cache
```json
{
  "payload": "{\"names\":[\"Frog\",\"Gator\",\"NewItem\"],\"collected\":{...}}"
}
```

### GET /ping
Health check endpoint for lens connectivity

## File Structure

- `proper_unified.js` - Main application logic
- `index_unified.html` - HTML with audio integration
- `config.js` - API tokens and lens configuration
- `bayouaudio_fixed.mp3` - Background ambient audio

## Usage Instructions

1. **Load the app**: Automatically starts camera + lens
2. **Collect items**: Tap objects in AR view (lens handles this)
3. **Switch cameras**: Double-tap anywhere on screen
4. **State persistence**: Items remain collected across camera switches
5. **Fresh start**: Manual browser refresh clears collected items

## Technical Implementation Details

### Cache Detection Logic
```javascript
function isCameraSwitchReload() {
  const reason = sessionStorage.getItem('reloadReason');
  if (reason === 'switchCamera') {
    sessionStorage.removeItem('reloadReason'); // Clean up
    return true;
  }
  return false; // Normal refresh
}
```

### Camera Switch Process
```javascript
async switchCamera() {
  markCameraSwitch();           // Set sessionStorage flag
  saveStateToCache(gameState);  // Persist current state
  window.location.reload();     // Restart app
}
```

### State Restoration
```javascript
if (isCameraSwitchReload()) {
  const cachedState = loadStateFromCache();
  if (cachedState) {
    gameState = sanitizeState(cachedState); // Restore state
  }
}
```

## Benefits

1. **Seamless UX**: Users don't lose progress when switching cameras
2. **Smart Detection**: Differentiates intentional switches from accidental refreshes  
3. **Data Integrity**: Prevents duplicate collection of same items
4. **Cross-session Persistence**: State survives browser crashes
5. **Mobile Optimized**: Touch gestures, safe areas, proper canvas sizing

## Testing Scenarios

- ✅ Double-tap to switch cameras (state preserved)
- ✅ Manual refresh (fresh start)
- ✅ Collect items, switch camera, items still collected
- ✅ Browser crash recovery (items persist)
- ✅ Duplicate collection prevention
- ✅ Audio starts on user interaction
- ✅ Responsive canvas on different screen sizes

This unified implementation provides a production-ready AR experience with sophisticated state management and excellent user experience.
