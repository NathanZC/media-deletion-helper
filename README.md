# Media Deletion Helper

A desktop application built with Electron to help go through and delete media files as fast as possible.

## Features

- Browse and view media files (images and videos)
- Quick deletion with arrow keys and undo capability
- File metadata display
- Fullscreen viewing mode
- Temporary deletion storage for recovery
- Keyboard shortcuts for navigation
- Skim though videos automatically and quickly

## Installation

### Development

1. Clone the repository:
```bash
git clone https://github.com/YourUsername/media-deletion-helper.git
cd media-deletion-helper
```

2. Install dependencies:
```bash
npm install
```

3. Run the application:
```bash
npm start
```

### Building

To create an executable:
```bash
npm run build
```

The built application will be available in the `release` folder.

## Keyboard Shortcuts

- `Left Arrow` / `Right Arrow`: Navigate between files
- `Up Arrow`: Delete current file
- `Down Arrow`: Undo last deletion
- `Esc`: Exit fullscreen mode
- `Ctrl + I`: Toggle DevTools (development only)

## Dependencies

- Electron
- ffprobe-static (for video metadata)
- image-size (for image dimensions)

## Development

### Project Structure
```
media-deletion-helper/
├── main.js         # Main process
├── preload.js      # Preload script for IPC
├── renderer.js     # Renderer process
├── index.html      # Main UI
└── package.json    # Project configuration
```

## License

[MIT License](LICENSE)
