const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const ffprobe = require('ffprobe-static');
const sizeOf = require('image-size');

const deletedFilesDir = path.join(app.getPath('temp'), 'image-viewer-deleted');

function initializeTempDirectory() {
    if (fs.existsSync(deletedFilesDir)) {
        fs.rmSync(deletedFilesDir, { recursive: true, force: true });
    }
    fs.mkdirSync(deletedFilesDir, { recursive: true });
}

function cleanupTempDirectory() {
    try {
        if (fs.existsSync(deletedFilesDir)) {
            fs.rmSync(deletedFilesDir, { recursive: true, force: true });
        }
    } catch (error) {
        console.error('Error cleaning up temp directory:', error);
    }
}

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 1000,
        icon: path.join(__dirname, 'trashcan.png'),
        webPreferences: {
            contextIsolation: true,
            enableRemoteModule: false,
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    mainWindow.loadFile('index.html');
    Menu.setApplicationMenu(null);
    
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.control && input.key.toLowerCase() === 'i') {  // Ctrl+I or Cmd+I
            mainWindow.webContents.toggleDevTools();
            event.preventDefault();
        }
    });
}

app.whenReady().then(() => {
    initializeTempDirectory();
    createWindow();
});

app.on('will-quit', () => {
    cleanupTempDirectory();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    if (!result.canceled) {
        const dirPath = result.filePaths[0];
        return fs.readdirSync(dirPath)
            .map(file => path.join(dirPath, file));
    }
    return [];
});

ipcMain.handle('delete-image', async (event, filePath) => {
    try {
        const fileName = path.basename(filePath);
        const tempPath = path.join(deletedFilesDir, fileName);
        
        await fs.promises.copyFile(filePath, tempPath);
        await fs.promises.unlink(filePath);
        return true;
    } catch (error) {
        console.error('Error deleting file:', error);
        return false;
    }
});

ipcMain.handle('undelete-image', async (event, filePath) => {
    try {
        const fileName = path.basename(filePath);
        const tempPath = path.join(deletedFilesDir, fileName);
        
        if (fs.existsSync(tempPath)) {
            await fs.promises.copyFile(tempPath, filePath);
            await fs.promises.unlink(tempPath);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error undeleting file:', error);
        return false;
    }
});

ipcMain.handle('set-fullscreen', (event, flag) => {
    mainWindow.setFullScreen(flag);
});

ipcMain.handle('open-directory', async (event, dirPath) => {
    try {
        await shell.openPath(dirPath);
        return true;
    } catch (error) {
        console.error('Error opening directory:', error);
        return false;
    }
});

ipcMain.handle('get-file-metadata', async (event, filePath) => {
    try {
        const stats = fs.statSync(filePath);
        const isVid = /\.(mp4|webm|mov)$/i.test(filePath);
        
        if (isVid) {
            return new Promise((resolve) => {
                exec(`${ffprobe.path} -v quiet -print_format json -show_format -show_streams "${filePath}"`, (error, stdout) => {
                    if (error) {
                        resolve({
                            size: stats.size,
                            isVideo: true,
                            error: 'Could not read video metadata'
                        });
                        return;
                    }
                    
                    const metadata = JSON.parse(stdout);
                    const videoStream = metadata.streams.find(s => s.codec_type === 'video');
                    
                    resolve({
                        size: stats.size,
                        isVideo: true,
                        duration: parseFloat(metadata.format.duration),
                        width: videoStream?.width,
                        height: videoStream?.height
                    });
                });
            });
        }
        
        if (/\.(jpg|jpeg|png|gif|webp)$/i.test(filePath)) {
            try {
                const dimensions = sizeOf(filePath);
                return {
                    size: stats.size,
                    width: dimensions.width,
                    height: dimensions.height,
                    isVideo: false
                };
            } catch (err) {
                console.error(`Error getting dimensions for ${filePath}:`, err);
                return {
                    size: stats.size,
                    isVideo: false
                };
            }
        }
        
        return { size: stats.size, isVideo: false };
    } catch (error) {
        console.error('Error getting metadata:', error);
        return { error: 'Failed to get file metadata' };
    }
});