# Emergent Task Tracker - iOS App

## Setup Instructions

1. **Prerequisites**
   - Xcode 15.0+ (macOS 13.5+)
   - iOS 14.0+ deployment target
   - CocoaPods or Swift Package Manager

2. **Initial Setup**
   ```bash
   cd ios-app
   pod install
   # OR if using SPM, open EmergenTaskTracker.xcodeproj in Xcode
   ```

3. **Build & Run**
   - Open `EmergenTaskTracker.xcodeproj` in Xcode
   - Select simulator or device
   - Press ⌘R to build and run

## Dependencies (CocoaPods)

- **Realm**: Local database (lightweight, free)
- **Alamofire**: HTTP client (optional; can use URLSession)
- **SwiftUI**: UI framework (built-in, iOS 14+)

## Project Structure

```
EmergenTaskTracker/
├── Models/
│   ├── Session.swift
│   ├── Task.swift
│   └── IntervalLog.swift
├── Persistence/
│   └── RealmManager.swift
├── Networking/
│   ├── APIClient.swift
│   └── SyncManager.swift
├── Views/
│   ├── TimerView.swift
│   ├── TaskInputView.swift
│   ├── BubbleGridView.swift
│   ├── SummaryView.swift
│   └── ContentView.swift
├── ViewModels/
│   └── SessionViewModel.swift
└── App/
    └── EmergenTaskTrackerApp.swift
```

## Feature Checklist

- [ ] Timer (15-min countdown with start/pause/reset)
- [ ] Task input & logging
- [ ] Bubble grid visualization
- [ ] Local Realm persistence
- [ ] API sync (to Rails backend)
- [ ] Offline queue (tasks sync when online)
- [ ] CSV/PDF export
- [ ] Background timer notifications
- [ ] Widget (iOS 17+, optional)

## Notes

- **Realm over Core Data**: Simpler API, better performance for this use case
- **SwiftUI over UIKit**: Cleaner code, iOS 14+ is sufficient
- **Low cost**: All dependencies are free/open-source
