const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
    deleteImage: (filePath) => ipcRenderer.invoke('delete-image', filePath),
    undeleteImage: (filePath) => ipcRenderer.invoke('undelete-image', filePath),
    setFullscreen: (flag) => ipcRenderer.invoke('set-fullscreen', flag),
    openDirectory: (path) => ipcRenderer.invoke('open-directory', path),
    getFileMetadata: (path) => ipcRenderer.invoke('get-file-metadata', path)
}); 