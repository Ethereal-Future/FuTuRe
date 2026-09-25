# frontend/components/QRScanner.jsx: Camera video stream tracks are not stopped on successful QR scan

**Domain:** Frontend & Device APIs  
**Complexity:** Medium  
**Labels:** `bug`, `frontend`, `mobile`, `battery`  
**Issue ID:** ISSUE-173

---

## Background
In `frontend/src/components/QRScanner.jsx` (lines 88-92):
```javascript
          if (raw !== null) {
            onScan(parseStellarQR(raw));
            return; // stop scanning after first hit
          }
```
When a QR code is detected, `onScan` is called, and the animation frame loop returns early.

## Problem
- The camera stream tracks (`streamRef.current.getTracks()`) are never stopped when scanning finishes!
- Although the scanning loop stops processing frames, the camera hardware sensor remains active, capturing video in background memory.
- On mobile devices and laptops:
  1. The hardware camera indicator light stays lit, causing severe user privacy concern.
  2. The device battery drains rapidly.
  3. Subsequent attempts to re-open the camera or switch to another camera fail because the camera resource is locked by the browser!

## Proposed Solution
1. Explicitly stop all video tracks as soon as a barcode is detected:
```javascript
if (raw !== null) {
  if (streamRef.current) {
    streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }
  onScan(parseStellarQR(raw));
  return;
}
```
2. Also ensure track cleanup runs in component unmount and when the modal close button is pressed.

## Implementation Steps
1. Update scan success handler in `frontend/src/components/QRScanner.jsx` to stop all tracks.
2. Add helper `stopCameraStream()` called on success, error, and unmount.
3. Verify camera indicator light turns off immediately upon QR code recognition.

## Acceptance Criteria
- [ ] Camera stream tracks are terminated immediately upon scanning a QR code.
- [ ] Device camera indicator light turns off without delay.
- [ ] No camera sensor lock occurs when reopening the scanner modal.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Critical for mobile battery consumption and user privacy compliance.

**GitHub Issue:** [1420](https://github.com/Ethereal-Future/FuTuRe/issues/1420)
