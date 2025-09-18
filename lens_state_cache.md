# Mechanism for Cached Array Injection on Camera Switch

## 1. Lens Side (`CollectManager.js`)

The Lens maintains two collections in memory:

- `names[]` (list of collected item names)  
- `collected{}` (map of keys → collected state)  

On startup (`OnStartEvent`), the script checks for `launchParams.cachedItems`.  

If `cachedItems` is found, the script rebuilds its state by:  
- repopulating `names[]`  
- repopulating `collected{}`  

Existing functions like `renderText` and `syncToggles` continue to work without changes.  

---

## 2. Web App: Storing Collected Items

- When a user interacts with the Lens (for example, clicking to collect an item), the Lens sends the item data outward.  
- The web app receives the data and updates a cached array stored in `localStorage`.  
- `localStorage` is persistent and survives across reloads, so the data is always available when needed.  

---

## 3. Switch Camera Flow

When the user double taps to switch the camera:  

1. Before reloading the page, the app writes a marker into `sessionStorage.reloadReason` with the value `"switchCamera"`.  
2. The app then calls `window.location.reload()` to restart the app.  

---

## 4. Startup Flow After Reload

When the app initializes (`autoStartWithLens`):  

1. Check `sessionStorage.reloadReason`.  
   - If the value is `"switchCamera"`, continue with injection.  
   - If the value is missing, skip injection.  
2. Read the cached items array from `localStorage`.  
3. When applying the Lens (`applyLens`), include the cached array via `launchParams`:  

```js
await this.session.applyLens(this.currentLens, {
    launchParams: {
        cachedItems: cachedArray
    }
});
```
4. Clear `sessionStorage.reloadReason` so it does not persist across unrelated reloads.  

---

## 5. Manual Refresh Case

If the user presses the browser refresh button directly:  

- `sessionStorage.reloadReason` will not be set.  
- No injection occurs.  
- The Lens starts fresh with no restored state.  

---

## 6. Duplicate Handling Between Cache and Remote Collectibles

### The Problem
- When cached items are restored on startup, `CollectManager` repopulates `names[]` and `collected{}`.  
- If a user taps the same remote collectible again, the following happens:
  - `names[]` will receive a second entry (`["Coin", "Coin"]`).  
  - `collected{}` will remain `true` for `"Coin"`.  
- This creates duplicates in the displayed list, even though logically the item has already been collected.  

### The Fix
Modify `CollectManager.addItem()` to check if an item is already marked as collected before adding it again:

```js
function addItem(item) {
    var n = (item && item.name) ? (""+item.name).trim() : "Item";
    if (collected[n]) return; // Skip duplicates
    names.push(n);
    collected[n] = true;
    if (started) { renderText(); syncToggles(); }
}
```

---
\
## Checklist

- [ ] Lens script can rebuild state from `launchParams.cachedItems`.  
- [ ] Web app saves array updates to `localStorage`.  
- [ ] `switchCamera()` sets `sessionStorage.reloadReason = "switchCamera"` before reloading.  
- [ ] On startup, web app checks `sessionStorage.reloadReason`.  
- [ ] If `"switchCamera"`, read cached array from `localStorage` and inject into Lens.  
- [ ] Clear `sessionStorage.reloadReason` after using it.  

---

## Behavior Summary

This ensures that:  

- Switching from front to back camera preserves the user’s collected state.  
- Normal reloads always start with a clean state.  
