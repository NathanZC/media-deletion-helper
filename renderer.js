let images = [];
let currentIndex = 0;
let deletedImages = [];
let videoStartSettings = {
    mode: 'beginning',
    fixedTime: 0,
    percentage: 0,
    playbackSpeed: 1,
    skim: {
        enabled: false,
        playDuration: 2,
        skipDuration: 10,
        active: false
    }
};
let includeSubfolders = false;
let subfolderDepth = 0;
let quickMoveFolders = [];
let showQuickMovePanel = false;
let movedFiles = [];
let isOperationInProgress = false;
let operationQueue = [];
let isMediaUpdateInProgress = false;
let isRefreshInProgress = false;
let undoStack = [];
let quickSortGroups = {};
let currentQuickSortGroup = 'group1';
let tabNames = {};

const mediaElement = document.getElementById('current-media');
const videoElement = document.getElementById('current-video');
const counterElement = document.getElementById('image-counter');
const selectButton = document.getElementById('select-btn');
const fileNameElement = document.getElementById('file-name');
const imageToggle = document.getElementById('toggle-images');
const videoToggle = document.getElementById('toggle-videos');
const imageFormats = document.getElementById('image-formats');
const videoFormats = document.getElementById('video-formats');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const imageContainer = document.getElementById('image-container');
let isFullscreen = false;
let currentDirectory = null;
const currentDirPath = document.getElementById('current-dir-path');
const openDirBtn = document.getElementById('open-dir-btn');
const openFileBtn = document.getElementById('open-file-btn');

function isVideo(filePath) {
    return /\.(mp4|webm|mov)$/i.test(filePath);
}

function getEnabledFormats() {
    const formats = [];
    
    if (imageToggle.checked) {
        imageFormats.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            if (checkbox.checked) {
                formats.push(...checkbox.dataset.format.split(','));
            }
        });
    }
    
    if (videoToggle.checked) {
        videoFormats.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            if (checkbox.checked) {
                formats.push(...checkbox.dataset.format.split(','));
            }
        });
    }
    
    return formats;
}

function updateFormatCheckboxes() {
    // Handle image formats
    const imageCheckboxes = imageFormats.querySelectorAll('input[type="checkbox"]');
    imageCheckboxes.forEach(checkbox => {
        checkbox.disabled = !imageToggle.checked;
    });

    // Handle video formats
    const videoCheckboxes = videoFormats.querySelectorAll('input[type="checkbox"]');
    videoCheckboxes.forEach(checkbox => {
        checkbox.disabled = !videoToggle.checked;
    });
}

function filterFiles() {
    const enabledFormats = getEnabledFormats();
    const formatRegex = new RegExp(`\\.(${enabledFormats.join('|')})$`, 'i');
    
    if (window.fullDirectoryListing) {
        images = window.fullDirectoryListing.filter(file => formatRegex.test(file));
        currentIndex = Math.min(currentIndex, Math.max(0, images.length - 1));
        updateMedia();
    }
}

function stopCurrentMedia() {
    if (videoElement) {
        videoElement.pause();
        videoElement.src = '';  // Clear the source
        videoStartSettings.skim.active = false;  // Stop skimming if active
    }
}

async function scanDirectory(dirPath, includeSubfolders, depth = 0) {
    let files = await window.electronAPI.getDirectoryContents(dirPath, includeSubfolders, depth);
    return files;
}

async function loadDirectory() {
    stopCurrentMedia();
    const dirPath = await window.electronAPI.selectDirectory();
    if (dirPath) {
        currentDirectory = dirPath;
        currentDirPath.textContent = currentDirectory;
        openDirBtn.style.display = 'block';
        
        // Scan directory with current subfolder preference
        window.fullDirectoryListing = await scanDirectory(currentDirectory, includeSubfolders);
        
        currentIndex = 0;
        deletedImages = [];
        filterFiles();
    }
}

async function updateMedia() {
    if (isMediaUpdateInProgress) {
        return; // Skip if already updating
    }
    
    isMediaUpdateInProgress = true;
    
    try {
        if (images.length === 0) {
            stopCurrentMedia();
            mediaElement.style.display = 'none';
            videoElement.style.display = 'none';
            counterElement.textContent = 'No media';
            fileNameElement.textContent = '';
            openFileBtn.style.display = 'none';
            return;
        }
        
        const currentFile = images[currentIndex];
        
        // Stop current media before loading new one
        stopCurrentMedia();
        
        try {
            // Check if file exists before trying to get metadata
            const fileExists = await window.electronAPI.fileExists(currentFile);
            if (!fileExists) {
                throw new Error('File not found');
            }
            
            const fileName = currentFile.split('\\').pop().split('/').pop();
            
            // Get file metadata with retry
            let metadata = null;
            let retryCount = 0;
            while (retryCount < 3) {
                try {
                    metadata = await window.electronAPI.getFileMetadata(currentFile);
                    break;
                } catch (error) {
                    retryCount++;
                    if (retryCount === 3) throw error;
                    await new Promise(resolve => setTimeout(resolve, 100)); // Wait before retry
                }
            }
            
            // Format file size
            const fileSize = formatFileSize(metadata.size);
            
            // Format resolution
            const resolution = metadata.width && metadata.height ? 
                `${metadata.width}x${metadata.height}` : 'Unknown';
            
            // Format duration for videos
            const duration = metadata.isVideo && metadata.duration ? 
                formatDuration(metadata.duration) : '';
            
            // Create info string
            const infoString = `${fileName} (${resolution}, ${fileSize}${duration ? `, ${duration}` : ''})`;
            fileNameElement.textContent = infoString;
            
            if (isVideo(currentFile)) {
                mediaElement.style.display = 'none';
                videoElement.style.display = 'block';
                videoElement.src = `file://${currentFile}`;
                videoElement.controls = !isFullscreen;
                handleVideoStart();
            } else {
                mediaElement.style.display = 'block';
                videoElement.style.display = 'none';
                mediaElement.src = `file://${currentFile}`;
            }
            
            counterElement.textContent = `File ${currentIndex + 1} of ${images.length}`;
            openFileBtn.style.display = images.length > 0 ? 'block' : 'none';
        } catch (error) {
            console.error('Error updating media:', error);
            // Remove the problematic file from our arrays
            cleanupMissingFile(currentFile);
            // Try to update with next file if available
            if (images.length > 0) {
                currentIndex = Math.min(currentIndex, images.length - 1);
                await updateMedia();
            }
        }
    } finally {
        isMediaUpdateInProgress = false;
    }
}

function formatFileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

async function deleteCurrentImage() {
    operationQueue.push(async () => {
        if (images.length === 0) return;
        
        const currentFile = images[currentIndex];
        
        stopCurrentMedia();
        await new Promise(resolve => setTimeout(resolve, 100));
        
        try {
            const result = await window.electronAPI.deleteImage(currentFile);
            if (result.success) {
                // Add to unified undo stack
                undoStack.push({
                    type: 'delete',
                    data: { originalPath: currentFile, tempPath: result.tempPath }
                });
                
                images.splice(currentIndex, 1);
                if (currentIndex >= images.length) {
                    currentIndex = Math.max(0, images.length - 1);
                }
                await updateMedia();
            } else {
                console.error('Failed to delete file:', result.error);
            }
        } catch (error) {
            console.error('Error in deleteCurrentImage:', error);
        }
    });
    
    processNextOperation();
}

async function undoDelete() {
    // Queue the undo operation
    operationQueue.push(async () => {
        if (deletedImages.length === 0) return;
        
        // Stop current media before file operations
        stopCurrentMedia();
        
        // Small delay to ensure resources are freed
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const lastDeleted = deletedImages.pop();
        try {
            const result = await window.electronAPI.undeleteImage(lastDeleted.originalPath);
            if (result.success) {
                // Wait for file system
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Refresh directory listing
                await refreshDirectoryListing();
                
                // Find the correct position to insert the restored file
                let insertIndex = 0;
                while (insertIndex < images.length && 
                       images[insertIndex].localeCompare(lastDeleted.originalPath) < 0) {
                    insertIndex++;
                }
                
                // Make sure the file isn't already in the array
                if (!images.includes(lastDeleted.originalPath)) {
                    images.splice(insertIndex, 0, lastDeleted.originalPath);
                }
                
                currentIndex = insertIndex;
                await updateMedia();
            } else {
                console.error('Failed to undelete file:', result.error);
                deletedImages.push(lastDeleted); // Put it back in the deleted list if failed
            }
        } catch (error) {
            console.error('Error in undoDelete:', error);
            deletedImages.push(lastDeleted); // Put it back in the deleted list if failed
            await refreshDirectoryListing(); // Try to refresh directory listing
        }
    });
    
    processNextOperation();
}

selectButton.addEventListener('click', loadDirectory);

document.addEventListener('keydown', async (event) => {
    // Always prevent default behavior for arrow keys
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
    }

    switch (event.key) {
        case 'ArrowLeft':
            if (currentIndex > 0) {
                currentIndex--;
                updateMedia();
            }
            break;
        case 'ArrowRight':
            if (currentIndex < images.length - 1) {
                currentIndex++;
                updateMedia();
            }
            break;
        case 'ArrowUp':
            deleteCurrentImage();
            break;
        case 'ArrowDown':
            handleUndo();
            break;
        case 'f':
            toggleFullscreen();
            break;
        case 'm':
            moveCurrentFile();
            break;
    }

    // Quick move with number keys (1-9)
    if (!event.ctrlKey && !event.altKey && !isNaN(event.key) && event.key !== '0') {
        const index = parseInt(event.key) - 1;
        const currentFolders = quickSortGroups[currentQuickSortGroup] || [];
        if (index >= 0 && index < currentFolders.length) {
            moveToQuickFolder(currentFolders[index]);
        }
    }

    // Add Ctrl+Z for undo move
    if (event.ctrlKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        await handleUndo();
        return;
    }
});

imageToggle.addEventListener('change', () => {
    updateFormatCheckboxes();
    filterFiles();
});

videoToggle.addEventListener('change', () => {
    updateFormatCheckboxes();
    filterFiles();
});

imageFormats.addEventListener('change', filterFiles);
videoFormats.addEventListener('change', filterFiles);

function initializeVideoSettings() {
    const radioButtons = document.querySelectorAll('input[name="video-start"]');
    const fixedTimeInput = document.getElementById('fixed-start-time');
    const percentageInput = document.getElementById('percentage-start');
    const skimCheckbox = document.getElementById('enable-skim');
    const playDurationInput = document.getElementById('skim-play-duration');
    const skipDurationInput = document.getElementById('skim-skip-duration');
    const playbackSpeedSelect = document.getElementById('playback-speed');

    radioButtons.forEach(radio => {
        radio.addEventListener('change', (e) => {
            videoStartSettings.mode = e.target.value;
        });
    });

    fixedTimeInput.addEventListener('change', (e) => {
        videoStartSettings.fixedTime = Math.max(0, parseInt(e.target.value) || 0);
    });

    percentageInput.addEventListener('change', (e) => {
        videoStartSettings.percentage = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
    });

    skimCheckbox.addEventListener('change', (e) => {
        videoStartSettings.skim.enabled = e.target.checked;
        if (e.target.checked && videoElement.duration) {
            startSkimming();
        }
    });

    playDurationInput.addEventListener('change', (e) => {
        videoStartSettings.skim.playDuration = Math.max(1, parseInt(e.target.value) || 3);
    });

    skipDurationInput.addEventListener('change', (e) => {
        videoStartSettings.skim.skipDuration = Math.max(1, parseInt(e.target.value) || 10);
    });

    playbackSpeedSelect.addEventListener('change', (e) => {
        videoStartSettings.playbackSpeed = parseFloat(e.target.value);
        if (videoElement) {
            videoElement.playbackRate = videoStartSettings.playbackSpeed;
        }
    });
}

function handleVideoStart() {
    videoElement.addEventListener('loadedmetadata', () => {
        setVideoStartTime();
    }, { once: true });
}

function setVideoStartTime() {
    let startTime = 0;
    
    switch (videoStartSettings.mode) {
        case 'fixed':
            if (videoElement.duration > videoStartSettings.fixedTime) {
                startTime = videoStartSettings.fixedTime;
            }
            break;
        case 'percentage':
            startTime = (videoElement.duration * videoStartSettings.percentage) / 100;
            break;
    }
    
    videoElement.currentTime = startTime;
    videoElement.playbackRate = videoStartSettings.playbackSpeed;
    
    if (videoStartSettings.skim.enabled) {
        videoStartSettings.skim.lastSkipTime = startTime;
        startSkimming();
    } else {
        videoElement.play();
    }
}

function initializeSettingsCollapse() {
    const toggleBtn = document.getElementById('toggle-settings');
    const filterControls = document.getElementById('filter-controls');
    const toggleIcon = toggleBtn.querySelector('.toggle-icon');
    
    // Check if there's a saved preference
    const isCollapsed = localStorage.getItem('settingsCollapsed') === 'true';
    
    if (isCollapsed) {
        filterControls.classList.add('collapsed');
        toggleIcon.classList.add('collapsed');
    }
    
    toggleBtn.addEventListener('click', () => {
        filterControls.classList.toggle('collapsed');
        toggleIcon.classList.toggle('collapsed');
        
        // Save the preference
        localStorage.setItem('settingsCollapsed', filterControls.classList.contains('collapsed'));
    });
}

function handleSkimming() {
    if (!videoStartSettings.skim.enabled || !videoStartSettings.skim.active) return;
    
    const currentTime = videoElement.currentTime;
    const duration = videoElement.duration;
    
    if (currentTime >= videoStartSettings.skim.lastSkipTime + videoStartSettings.skim.playDuration) {
        const nextTime = currentTime + videoStartSettings.skim.skipDuration;
        
        if (nextTime >= duration) {
            videoStartSettings.skim.active = false;
            videoElement.pause();
        } else {
            videoElement.currentTime = nextTime;
            videoStartSettings.skim.lastSkipTime = nextTime;
        }
    }
}

function startSkimming() {
    videoStartSettings.skim.active = true;
    videoStartSettings.skim.lastSkipTime = videoElement.currentTime;
    videoElement.play();
}

function toggleFullscreen() {
    isFullscreen = !isFullscreen;
    
    if (isFullscreen) {
        window.electronAPI.setFullscreen(true);
        document.body.classList.add('fullscreen-mode');
        if (videoElement.style.display === 'block') {
            videoElement.controls = false;
        }
    } else {
        window.electronAPI.setFullscreen(false);
        document.body.classList.remove('fullscreen-mode');
        if (videoElement.style.display === 'block') {
            videoElement.controls = true;
        }
    }
}

fullscreenBtn.addEventListener('click', toggleFullscreen);

// Add this to your existing initialization calls

initializeSettingsCollapse();
initializeVideoSettings();

videoElement.addEventListener('timeupdate', handleSkimming);

openDirBtn.addEventListener('click', async () => {
    if (currentDirectory) {
        await window.electronAPI.openDirectory(currentDirectory);
    }
});

function initializeExtrasSettings() {
    const instructionsToggle = document.getElementById('toggle-instructions');
    const instructions = document.querySelector('.instructions');
    
    // Check if there's a saved preference
    const hideInstructions = localStorage.getItem('hideInstructions') === 'true';
    
    if (hideInstructions) {
        instructions.style.display = 'none';
        instructionsToggle.checked = false;
    }
    
    instructionsToggle.addEventListener('change', (e) => {
        instructions.style.display = e.target.checked ? 'block' : 'none';
        localStorage.setItem('hideInstructions', (!e.target.checked).toString());
    });
}

initializeExtrasSettings();

document.getElementById('include-subfolders').addEventListener('change', async (e) => {
    includeSubfolders = e.target.checked;
    if (currentDirectory) {
        window.fullDirectoryListing = await scanDirectory(currentDirectory, includeSubfolders, subfolderDepth);
        filterFiles();
    }
    localStorage.setItem('includeSubfolders', includeSubfolders);
});

document.getElementById('subfolder-depth').addEventListener('change', async (e) => {
    subfolderDepth = parseInt(e.target.value) || 0;
    if (currentDirectory && includeSubfolders) {
        window.fullDirectoryListing = await scanDirectory(currentDirectory, includeSubfolders, subfolderDepth);
        filterFiles();
    }
    localStorage.setItem('subfolderDepth', subfolderDepth);
});

function initializeSubfolderSetting() {
    const subfoldersToggle = document.getElementById('include-subfolders');
    const depthInput = document.getElementById('subfolder-depth');
    
    includeSubfolders = localStorage.getItem('includeSubfolders') === 'true';
    subfolderDepth = parseInt(localStorage.getItem('subfolderDepth')) || 0;
    
    subfoldersToggle.checked = includeSubfolders;
    depthInput.value = subfolderDepth;
    depthInput.disabled = !includeSubfolders;
    
    subfoldersToggle.addEventListener('change', (e) => {
        depthInput.disabled = !e.target.checked;
    });
}

function initializeThemeSettings() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.querySelector(`input[name="theme"][value="${savedTheme}"]`).checked = true;

    document.querySelectorAll('input[name="theme"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const newTheme = e.target.value;
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
        });
    });
}

initializeThemeSettings();

function initializeQuickMove() {
    // Load saved settings
    quickMoveFolders = JSON.parse(localStorage.getItem('quickMoveFolders') || '[]');
    showQuickMovePanel = localStorage.getItem('showQuickMovePanel') === 'true';
    
    // Initialize UI
    const enableQuickMove = document.getElementById('enable-quick-move');
    const quickMovePanel = document.getElementById('quick-move-panel');
    
    enableQuickMove.checked = showQuickMovePanel;
    quickMovePanel.style.display = showQuickMovePanel ? 'block' : 'none';
    
    // Event listener
    enableQuickMove.addEventListener('change', (e) => {
        showQuickMovePanel = e.target.checked;
        document.getElementById('quick-sort-tabs').style.display = showQuickMovePanel ? 'block' : 'none';
        localStorage.setItem('showQuickMovePanel', showQuickMovePanel);
    });
    
    updateQuickMoveFoldersUI();
}

async function addQuickMoveFolder() {
    const currentFolders = quickSortGroups[currentQuickSortGroup] || [];
    if (currentFolders.length >= 9) {
        alert('Maximum of 9 quick move folders allowed per group');
        return;
    }
    
    const dir = await window.electronAPI.selectMoveDirectory();
    if (dir && !currentFolders.includes(dir)) {
        currentFolders.push(dir);
        quickSortGroups[currentQuickSortGroup] = currentFolders;
        localStorage.setItem('quickSortGroups', JSON.stringify(quickSortGroups));
        updateQuickMoveFoldersUI();
    }
}

function removeQuickMoveFolder(index) {
    const currentFolders = quickSortGroups[currentQuickSortGroup] || [];
    currentFolders.splice(index, 1);
    quickSortGroups[currentQuickSortGroup] = currentFolders;
    localStorage.setItem('quickSortGroups', JSON.stringify(quickSortGroups));
    updateQuickMoveFoldersUI();
}

async function moveToQuickFolder(folderPath) {
    if (images.length === 0) return;
    
    const currentFile = images[currentIndex];
    
    stopCurrentMedia();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    try {
        const result = await window.electronAPI.moveFile(currentFile, folderPath);
        if (result.success) {
            // Add to unified undo stack
            undoStack.push({
                type: 'move',
                data: {
                    sourcePath: currentFile,
                    destinationPath: result.newPath
                }
            });
            
            images.splice(currentIndex, 1);
            if (currentIndex >= images.length) {
                currentIndex = Math.max(0, images.length - 1);
            }
            await updateMedia();
        } else {
            console.error('Failed to move file:', result.error);
        }
    } catch (error) {
        console.error('Error moving file:', error);
    }
}

function updateQuickMoveFoldersUI() {
    const currentFolders = quickSortGroups[currentQuickSortGroup] || [];
    const currentPanel = document.querySelector(`.tab-panel[data-tab="${currentQuickSortGroup}"]`);
    const panelFolders = currentPanel.querySelector('.quick-move-folders');
    
    let html = '';
    const slotsToShow = Math.min(currentFolders.length + 1, 9);
    
    for (let i = 0; i < slotsToShow; i++) {
        if (i < currentFolders.length) {
            html += `
                <div class="quick-folder-item">
                    <span class="quick-folder-key">${i + 1}</span>
                    <span class="quick-folder-path" onclick="moveToQuickFolder('${currentFolders[i].replace(/\\/g, '\\\\')}')">${currentFolders[i]}</span>
                    <span class="quick-folder-remove" onclick="removeQuickMoveFolder(${i})">×</span>
                </div>
            `;
        } else {
            html += `
                <div class="quick-folder-item empty" onclick="addQuickMoveFolder()">
                    <span class="quick-folder-key">${i + 1}</span>
                    <span class="quick-folder-path">Click to add folder...</span>
                </div>
            `;
        }
    }
    
    panelFolders.innerHTML = html;
}

// Add to your existing initialization calls
initializeQuickMove();

// Debounced operation handler
async function processNextOperation() {
    if (isOperationInProgress || operationQueue.length === 0) return;
    
    isOperationInProgress = true;
    try {
        await operationQueue.shift()();
    } catch (error) {
        console.error('Operation error:', error);
    } finally {
        isOperationInProgress = false;
        if (operationQueue.length > 0) {
            setTimeout(processNextOperation, 50); // Small delay between operations
        }
    }
}

// New unified undo function
async function handleUndo() {
    operationQueue.push(async () => {
        if (undoStack.length === 0) return;
        
        const lastAction = undoStack.pop();
        let result;
        let restoredPath;
        
        try {
            // Stop current media before any file operations
            stopCurrentMedia();
            
            switch (lastAction.type) {
                case 'delete':
                    result = await window.electronAPI.undeleteImage(lastAction.data.originalPath);
                    restoredPath = lastAction.data.originalPath;
                    break;
                    
                case 'move':
                    const parentDir = await window.electronAPI.getParentDirectory(lastAction.data.sourcePath);
                    result = await window.electronAPI.moveFile(
                        lastAction.data.destinationPath, 
                        parentDir
                    );
                    restoredPath = lastAction.data.sourcePath;
                    break;
            }
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to undo action');
            }

            // Quick check if file exists after operation
            const fileExists = await window.electronAPI.fileExists(restoredPath);
            if (!fileExists) {
                throw new Error('Restored file not found');
            }

            // Add file to full listing if not present
            if (!window.fullDirectoryListing.includes(restoredPath)) {
                window.fullDirectoryListing.push(restoredPath);
                window.fullDirectoryListing.sort();
            }

            // Re-filter files with current format settings
            const enabledFormats = getEnabledFormats();
            const formatRegex = new RegExp(`\\.(${enabledFormats.join('|')})$`, 'i');
            
            // Update images array directly
            if (formatRegex.test(restoredPath)) {
                // Find the correct position to insert the file
                let insertIndex = 0;
                while (insertIndex < images.length && 
                       images[insertIndex].localeCompare(restoredPath) < 0) {
                    insertIndex++;
                }
                
                // Insert the file if it's not already there
                if (!images.includes(restoredPath)) {
                    images.splice(insertIndex, 0, restoredPath);
                    currentIndex = insertIndex;
                } else {
                    currentIndex = images.indexOf(restoredPath);
                }

                // Update the media display
                await updateMedia();

                // Handle video specific setup if needed
                if (isVideo(restoredPath)) {
                    videoElement.src = `file://${restoredPath}`;
                    videoElement.addEventListener('loadedmetadata', () => {
                        setVideoStartTime();
                        videoElement.play();
                    }, { once: true });
                }
            }

        } catch (error) {
            console.error('Error in handleUndo:', error);
            undoStack.push(lastAction); // Put the action back on the stack
            await refreshDirectoryListing(); // Fallback to full refresh
        }
    });
    
    processNextOperation();
}

// Helper function to update the counter display
function updateCounter(current, total) {
    const counter = document.getElementById('image-counter');
    if (counter) {
        counter.textContent = `${current} / ${total}`;
    }
}

async function handleSuccessfulUndo(lastMove) {
    try {
        // Wait a bit to ensure file system has completed the move
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Refresh the directory listing
        await refreshDirectoryListing();
        
        // Find the restored file in the filtered images array
        const restoredIndex = images.indexOf(lastMove.sourcePath);
        if (restoredIndex !== -1) {
            currentIndex = restoredIndex;
        } else {
            // If not found in current filter, check if it exists
            const fileExists = await window.electronAPI.fileExists(lastMove.sourcePath);
            if (fileExists) {
                // Force a re-filter to include the file
                if (!window.fullDirectoryListing.includes(lastMove.sourcePath)) {
                    window.fullDirectoryListing.push(lastMove.sourcePath);
                }
                filterFiles();
                
                // Find the file again after re-filtering
                const newIndex = images.indexOf(lastMove.sourcePath);
                if (newIndex !== -1) {
                    currentIndex = newIndex;
                }
            }
        }
        
        await updateMedia();
    } catch (error) {
        console.error('Error in handleSuccessfulUndo:', error);
        // If something goes wrong, try to refresh the directory
        await refreshDirectoryListing();
    }
}

// Modified cleanupMissingFile function
function cleanupMissingFile(filePath) {
    // Remove from images array
    const index = images.indexOf(filePath);
    if (index > -1) {
        images.splice(index, 1);
    }
    
    // Remove from fullDirectoryListing
    if (window.fullDirectoryListing) {
        const dirIndex = window.fullDirectoryListing.indexOf(filePath);
        if (dirIndex > -1) {
            window.fullDirectoryListing.splice(dirIndex, 1);
        }
    }
    
    // Update counter
    if (images.length === 0) {
        counterElement.textContent = 'No media';
        fileNameElement.textContent = '';
    } else {
        currentIndex = Math.min(currentIndex, images.length - 1);
    }
}

// Add this new function to refresh directory contents
async function refreshDirectoryListing() {
    if (!currentDirectory || isRefreshInProgress) return;
    
    isRefreshInProgress = true;
    try {
        // Re-scan directory with current subfolder preference
        window.fullDirectoryListing = await scanDirectory(currentDirectory, includeSubfolders, subfolderDepth);
        
        // Re-filter files
        const enabledFormats = getEnabledFormats();
        const formatRegex = new RegExp(`\\.(${enabledFormats.join('|')})$`, 'i');
        const newImages = window.fullDirectoryListing.filter(file => formatRegex.test(file));
        
        // Update images array while preserving current index position if possible
        const currentFile = images[currentIndex];
        images = newImages;
        
        if (currentFile) {
            const newIndex = images.indexOf(currentFile);
            if (newIndex !== -1) {
                currentIndex = newIndex;
            } else {
                currentIndex = Math.min(currentIndex, Math.max(0, images.length - 1));
            }
        }
    } catch (error) {
        console.error('Error refreshing directory:', error);
    } finally {
        isRefreshInProgress = false;
    }
}

async function moveCurrentFile() {
    if (images.length === 0) return;
    
    const currentFile = images[currentIndex];
    
    // Stop any playing media
    stopCurrentMedia();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    try {
        // Let user select destination directory
        const destinationDir = await window.electronAPI.selectMoveDirectory();
        if (!destinationDir) return; // User cancelled selection
        
        const result = await window.electronAPI.moveFile(currentFile, destinationDir);
        if (result.success) {
            // Remove the moved file from our array
            images.splice(currentIndex, 1);
            if (currentIndex >= images.length) {
                currentIndex = Math.max(0, images.length - 1);
            }
            await updateMedia();
        } else {
            console.error('Failed to move file:', result.error);
        }
    } catch (error) {
        console.error('Error moving file:', error);
    }
}

openFileBtn.addEventListener('click', async () => {
    if (images[currentIndex]) {
        await window.electronAPI.openFileLocation(images[currentIndex]);
    }
});

// Initialize media display
updateMedia();

function initializeQuickSortTabs() {
    // Load saved groups and names from localStorage
    quickSortGroups = JSON.parse(localStorage.getItem('quickSortGroups') || '{"group1": [], "group2": [], "group3": []}');
    tabNames = JSON.parse(localStorage.getItem('tabNames') || '{"group1": "Group 1", "group2": "Group 2", "group3": "Group 3"}');
    
    const tabsContainer = document.getElementById('quick-sort-tabs');
    const tabButtons = document.querySelectorAll('.tab-button:not(.add-tab-button)');
    const addTabButton = document.querySelector('.add-tab-button');
    
    // Show/hide tabs container based on quickmove panel setting
    tabsContainer.style.display = showQuickMovePanel ? 'block' : 'none';
    
    // Initialize tab names
    tabButtons.forEach(button => {
        const tabId = button.dataset.tab;
        const nameSpan = button.querySelector('.tab-name');
        nameSpan.textContent = tabNames[tabId] || `Group ${tabId.replace('group', '')}`;
        
        // Add event listener for name editing
        nameSpan.addEventListener('blur', () => {
            const newName = nameSpan.textContent.trim();
            if (newName) {
                tabNames[tabId] = newName;
                localStorage.setItem('tabNames', JSON.stringify(tabNames));
            } else {
                nameSpan.textContent = tabNames[tabId];
            }
        });
        
        // Prevent tab switching when editing name
        nameSpan.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    });

    // Initialize the first group as active
    currentQuickSortGroup = 'group1';
    document.querySelector('.tab-panel[data-tab="group1"]').classList.add('active');
    updateQuickMoveFoldersUI();
    
    // Add tab switching functionality
    function setupTabButton(button) {
        button.addEventListener('click', () => {
            document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
            
            button.classList.add('active');
            const tabName = button.dataset.tab;
            document.querySelector(`.tab-panel[data-tab="${tabName}"]`).classList.add('active');
            currentQuickSortGroup = tabName;
            
            updateQuickMoveFoldersUI();
        });
    }

    tabButtons.forEach(setupTabButton);

    // Add new tab functionality
    addTabButton.addEventListener('click', () => {
        const existingTabs = document.querySelectorAll('.tab-button:not(.add-tab-button)');
        const newGroupNumber = existingTabs.length + 1;
        const newGroupId = `group${newGroupNumber}`;
        
        // Create new tab button with editable name
        const newTabButton = document.createElement('div');
        newTabButton.className = 'tab-group';
        newTabButton.innerHTML = `
            <button class="tab-button" data-tab="${newGroupId}">
                <span class="tab-name" contenteditable="true">Group ${newGroupNumber}</span>
            </button>
        `;
        
        // Create new tab panel with just the folders div
        const newPanel = document.createElement('div');
        newPanel.className = 'tab-panel';
        newPanel.dataset.tab = newGroupId;
        newPanel.innerHTML = `<div class="quick-move-folders"></div>`;

        // Insert new elements
        const tabButtons = document.querySelector('.tab-buttons');
        tabButtons.insertBefore(newTabButton, addTabButton);
        document.querySelector('.tab-panels').appendChild(newPanel);

        // Initialize the new group in quickSortGroups if it doesn't exist
        if (!quickSortGroups[newGroupId]) {
            quickSortGroups[newGroupId] = [];
            localStorage.setItem('quickSortGroups', JSON.stringify(quickSortGroups));
        }

        // Setup event listener for the new tab
        setupTabButton(newTabButton.querySelector('.tab-button'));

        // Add name editing functionality to new tab
        const nameSpan = newTabButton.querySelector('.tab-name');
        nameSpan.addEventListener('blur', () => {
            const newName = nameSpan.textContent.trim();
            if (newName) {
                tabNames[newGroupId] = newName;
                localStorage.setItem('tabNames', JSON.stringify(tabNames));
            } else {
                nameSpan.textContent = tabNames[newGroupId];
            }
        });
        
        // Prevent tab switching when editing name
        nameSpan.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Initialize the new group name
        tabNames[newGroupId] = `Group ${newGroupNumber}`;
        localStorage.setItem('tabNames', JSON.stringify(tabNames));

        // Activate the new tab
        newTabButton.querySelector('.tab-button').click();
    });
}

function updateQuickMoveFoldersUI() {
    const currentFolders = quickSortGroups[currentQuickSortGroup] || [];
    const currentPanel = document.querySelector(`.tab-panel[data-tab="${currentQuickSortGroup}"]`);
    const panelFolders = currentPanel.querySelector('.quick-move-folders');
    
    let html = '';
    const slotsToShow = Math.min(currentFolders.length + 1, 9);
    
    for (let i = 0; i < slotsToShow; i++) {
        if (i < currentFolders.length) {
            html += `
                <div class="quick-folder-item">
                    <span class="quick-folder-key">${i + 1}</span>
                    <span class="quick-folder-path" onclick="moveToQuickFolder('${currentFolders[i].replace(/\\/g, '\\\\')}')">${currentFolders[i]}</span>
                    <span class="quick-folder-remove" onclick="removeQuickMoveFolder(${i})">×</span>
                </div>
            `;
        } else {
            html += `
                <div class="quick-folder-item empty" onclick="addQuickMoveFolder()">
                    <span class="quick-folder-key">${i + 1}</span>
                    <span class="quick-folder-path">Click to add folder...</span>
                </div>
            `;
        }
    }
    
    panelFolders.innerHTML = html;
}

// Add to your existing initialization calls
initializeQuickSortTabs();