const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
    deleteImage: (filePath) => ipcRenderer.invoke('delete-image', filePath),
    undeleteImage: (filePath) => ipcRenderer.invoke('undelete-image', filePath),
    setFullscreen: (flag) => ipcRenderer.invoke('set-fullscreen', flag),
    openDirectory: (path) => ipcRenderer.invoke('open-directory', path),
    getFileMetadata: (path) => ipcRenderer.invoke('get-file-metadata', path),
    getDirectoryContents: (dirPath, includeSubfolders, depth) => 
        ipcRenderer.invoke('getDirectoryContents', dirPath, includeSubfolders, depth),
    selectMoveDirectory: () => ipcRenderer.invoke('select-move-directory'),
    moveFile: (sourcePath, destinationDir) => ipcRenderer.invoke('move-file', sourcePath, destinationDir),
    getParentDirectory: (filePath) => ipcRenderer.invoke('getParentDirectory', filePath),
    fileExists: (filePath) => ipcRenderer.invoke('fileExists', filePath),
    openFileLocation: (path) => ipcRenderer.invoke('open-file-location', path),
}); 