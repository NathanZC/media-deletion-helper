const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const ffprobe = require('ffprobe-static');
const sizeOf = require('image-size');

const deletedFilesDir = path.join(app.getPath('temp'), 'image-viewer-deleted');

async function initializeTempDirectory() {
    try {
        await fs.mkdir(deletedFilesDir, { recursive: true });
    } catch (error) {
        console.error('Error initializing temp directory:', error);
    }
}

async function cleanupTempDirectory() {
    try {
        await fs.rm(deletedFilesDir, { recursive: true, force: true });
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
        return result.filePaths[0];
    }
    return null;
});

ipcMain.handle('delete-image', async (event, filePath) => {
    try {
        const fileName = path.basename(filePath);
        const tempPath = path.join(deletedFilesDir, fileName);
        
        await fs.mkdir(deletedFilesDir, { recursive: true });
        
        await fs.copyFile(filePath, tempPath);
        
        await fs.unlink(filePath);
        
        return { success: true, tempPath };
    } catch (error) {
        console.error('Error deleting file:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('undelete-image', async (event, originalPath) => {
    try {
        const fileName = path.basename(originalPath);
        const tempPath = path.join(deletedFilesDir, fileName);
        await fs.copyFile(tempPath, originalPath);
        
        await fs.unlink(tempPath);
        
        return { success: true };
    } catch (error) {
        console.error('Error undeleting file:', error);
        return { success: false, error: error.message };
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

function getFfprobePath() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'ffprobe-static', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    }
    return ffprobe.path;
}

ipcMain.handle('get-file-metadata', async (event, filePath) => {
    try {
        const stats = await fs.stat(filePath);
        const isVid = /\.(mp4|webm|mov)$/i.test(filePath);
        
        if (isVid) {
            return new Promise((resolve) => {
                const ffprobePath = getFfprobePath();
                exec(`"${ffprobePath}" -v quiet -print_format json -show_format -show_streams "${filePath}"`, (error, stdout) => {
                    if (error) {
                        console.error('FFprobe error:', error);
                        resolve({
                            size: stats.size,
                            isVideo: true,
                            error: 'Could not read video metadata'
                        });
                        return;
                    }
                    
                    try {
                        const metadata = JSON.parse(stdout);
                        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
                        
                        resolve({
                            size: stats.size,
                            isVideo: true,
                            duration: parseFloat(metadata.format.duration),
                            width: videoStream?.width,
                            height: videoStream?.height
                        });
                    } catch (parseError) {
                        console.error('Metadata parse error:', parseError);
                        resolve({
                            size: stats.size,
                            isVideo: true,
                            error: 'Could not parse video metadata'
                        });
                    }
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
        console.error('General metadata error:', error);
        return {
            error: 'Error getting metadata'
        };
    }
});

async function getAllFiles(dir, includeSubfolders) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && includeSubfolders) {
            return getAllFiles(fullPath, includeSubfolders);
        } else if (entry.isFile()) {
            return fullPath;
        }
    }));
    
    return files.flat().filter(Boolean);
}

ipcMain.handle('getDirectoryContents', async (event, dirPath, includeSubfolders) => {
    try {
        return await getAllFiles(dirPath, includeSubfolders);
    } catch (error) {
        console.error('Error reading directory:', error);
        return [];
    }
});