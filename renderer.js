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
        playDuration: {
            value: 2,
            mode: 'seconds'
        },
        skipDuration: {
            value: 10,
            mode: 'seconds'
        },
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
let autoAdvanceTimer = null;
let autoAdvanceEnabled = false;
let autoAdvanceDelay = parseInt(localStorage.getItem('autoAdvanceDelay')) || 3000;
document.getElementById('auto-advance-delay').value = autoAdvanceDelay / 1000;

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
        // Remove event listeners first
        videoElement.removeEventListener('ended', handleMediaEnd);
        videoElement.pause();
        videoElement.src = '';  // Clear the source
        videoStartSettings.skim.active = false;  // Stop skimming if active
        clearAutoAdvanceTimer();
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
            // Format resolution
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
        // Setup auto-advance after media is loaded
        setupAutoAdvance();
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

    // Quick move with number keys (1-9) and letter keys (Q-P)
    if (!event.ctrlKey && !event.altKey) {
        const currentFolders = quickSortGroups[currentQuickSortGroup] || [];
        let index = -1;

        if (!isNaN(event.key) && event.key !== '0') {
            // Handle number keys 1-9
            index = parseInt(event.key) - 1;
        } else {
            // Handle letter keys Q-P
            const letterKeys = 'qwertyuiop';
            const letterIndex = letterKeys.indexOf(event.key.toLowerCase());
            if (letterIndex !== -1) {
                index = letterIndex + 9; // Start letters after the numbers
            }
        }

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
    const playDurationInput = document.getElementById('skim-play-duration');
    const skipDurationInput = document.getElementById('skim-skip-duration');
    const skimCheckbox = document.getElementById('enable-skim');
    const playbackSpeedSelect = document.getElementById('playback-speed');
    
    const playDurationMode = document.querySelector('select[name="play-duration-mode"]');
    const skipDurationMode = document.querySelector('select[name="skip-duration-mode"]');

    playDurationInput.addEventListener('change', (e) => {
        videoStartSettings.skim.playDuration.value = Math.max(0.1, parseFloat(e.target.value) || 2);
    });

    skipDurationInput.addEventListener('change', (e) => {
        videoStartSettings.skim.skipDuration.value = Math.max(0.1, parseFloat(e.target.value) || 10);
    });

    playDurationMode.addEventListener('change', (e) => {
        videoStartSettings.skim.playDuration.mode = e.target.value;
    });

    skipDurationMode.addEventListener('change', (e) => {
        videoStartSettings.skim.skipDuration.mode = e.target.value;
    });

    skimCheckbox.addEventListener('change', (e) => {
        videoStartSettings.skim.enabled = e.target.checked;
        if (e.target.checked && videoElement.duration) {
            startSkimming();
        }
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
        // Apply video start settings based on mode
        switch (videoStartSettings.mode) {
            case 'fixed':
                if (videoElement.duration > videoStartSettings.fixedTime) {
                    videoElement.currentTime = videoStartSettings.fixedTime;
                }
                break;
            case 'percentage':
                videoElement.currentTime = (videoElement.duration * videoStartSettings.percentage) / 100;
                break;
            case 'beginning':
            default:
                videoElement.currentTime = 0;
                break;
        }

        // Apply playback speed
        videoElement.playbackRate = videoStartSettings.playbackSpeed;

        // Start skimming if enabled, otherwise just play
        if (videoStartSettings.skim.enabled) {
            videoStartSettings.skim.lastSkipTime = videoElement.currentTime;
            startSkimming();
        } else {
            videoElement.play();
        }
    }, { once: true });
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
    
    let playDuration, skipDuration;
    
    // Calculate play duration based on mode
    if (videoStartSettings.skim.playDuration.mode === 'percentage') {
        playDuration = (duration * videoStartSettings.skim.playDuration.value) / 100;
    } else {
        playDuration = videoStartSettings.skim.playDuration.value;
    }
    
    // Calculate skip duration based on mode
    if (videoStartSettings.skim.skipDuration.mode === 'percentage') {
        skipDuration = (duration * videoStartSettings.skim.skipDuration.value) / 100;
    } else {
        skipDuration = videoStartSettings.skim.skipDuration.value;
    }
    
    if (currentTime >= videoStartSettings.skim.lastSkipTime + playDuration) {
        const nextTime = currentTime + skipDuration;
        
        if (nextTime >= duration) {
            videoStartSettings.skim.active = false;
            videoElement.pause();
            
            if (autoAdvanceEnabled && currentIndex < images.length - 1) {
                currentIndex++;
                updateMedia();
            }
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
    if (currentFolders.length >= 19) {
        alert('Maximum of 19 quick move folders allowed per group');
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
    
    let leftColumnHtml = '';
    let rightColumnHtml = '';
    const slotsToShow = Math.min(currentFolders.length + 1, 19);
    const letterKeys = 'QWERTYUIOP';
    
    for (let i = 0; i < slotsToShow; i++) {
        const isRightColumn = i >= 9;
        let html = '';
        
        if (i < currentFolders.length) {
            const fullPath = currentFolders[i];
            const folderName = fullPath.split(/[\\/]/).pop();
            const keyLabel = i < 9 ? (i + 1) : letterKeys[i - 9];
            html += `
                <div class="quick-folder-item">
                    <span class="quick-folder-key">${keyLabel}</span>
                    <span class="quick-folder-path" 
                          onclick="moveToQuickFolder('${fullPath.replace(/\\/g, '\\\\')}')"
                          ondblclick="window.electronAPI.openDirectory('${fullPath.replace(/\\/g, '\\\\')}')"
                          title="${fullPath}">${folderName}</span>
                    <span class="quick-folder-remove" onclick="removeQuickMoveFolder(${i})">×</span>
                </div>
            `;
        } else {
            const keyLabel = i < 9 ? (i + 1) : letterKeys[i - 9];
            html += `
                <div class="quick-folder-item empty" onclick="addQuickMoveFolder()">
                    <span class="quick-folder-key">${keyLabel}</span>
                    <span class="quick-folder-path">Click to add folder...</span>
                </div>
            `;
        }
        
        if (isRightColumn) {
            rightColumnHtml += html;
        } else {
            leftColumnHtml += html;
        }
    }
    
    // Create the two-column layout
    panelFolders.innerHTML = `
        <div class="quick-move-folders-container">
            <div class="quick-move-column">
                ${leftColumnHtml}
            </div>
            ${rightColumnHtml ? `
                <div class="quick-move-column">
                    ${rightColumnHtml}
                </div>
            ` : ''}
        </div>
    `;
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
    console.log("quickSortGroups: " + JSON.stringify(quickSortGroups));
    tabNames = JSON.parse(localStorage.getItem('tabNames') || '{"group1": "Group 1", "group2": "Group 2", "group3": "Group 3"}');
    console.log(localStorage.getItem('tabNames'));
    const tabsContainer = document.getElementById('quick-sort-tabs');
    const tabButtons = document.querySelectorAll('.tab-button:not(.add-tab-button)');
    const addTabButton = document.querySelector('.add-tab-button');
    const tabButtonsContainer = document.querySelector('.tab-buttons');
    const tabPanelsContainer = document.querySelector('.tab-panels');
    // Show/hide tabs container based on quickmove panel setting
    tabsContainer.style.display = showQuickMovePanel ? 'block' : 'none';
        // Clear existing tabs (except add button)
        while (tabButtonsContainer.firstChild) {
            if (tabButtonsContainer.firstChild === addTabButton) break;
            tabButtonsContainer.removeChild(tabButtonsContainer.firstChild);
        }
        tabPanelsContainer.innerHTML = '';
        
        // Create tabs for each group in localStorage
        Object.keys(quickSortGroups).forEach(groupId => {
            // Create tab button
            const newTabButton = document.createElement('div');
            newTabButton.className = 'tab-group';
            newTabButton.innerHTML = `
                <button class="tab-button" data-tab="${groupId}">
                    <span class="tab-name" contenteditable="true">${tabNames[groupId]}</span>
                    <span class="tab-delete-btn">×</span>
                </button>
            `;
            
            // Create tab panel
            const newPanel = document.createElement('div');
            newPanel.className = 'tab-panel';
            newPanel.dataset.tab = groupId;
            newPanel.innerHTML = `<div class="quick-move-folders"></div>`;
            
            // Add elements to DOM
            tabButtonsContainer.insertBefore(newTabButton, addTabButton);
            tabPanelsContainer.appendChild(newPanel);
            
            // Add name editing functionality
            const nameSpan = newTabButton.querySelector('.tab-name');
            nameSpan.addEventListener('blur', () => {
                console.log("changing tab name");
                const newName = nameSpan.textContent.trim();
                if (newName) {
                    console.log("new name: " + newName);
                    tabNames[groupId] = newName;
                    localStorage.setItem('tabNames', JSON.stringify(tabNames));
                } else {
                    nameSpan.textContent = tabNames[groupId];
                }
            });
            
            // Prevent tab switching when editing name
            nameSpan.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            
            // Setup tab switching
            setupTabButton(newTabButton.querySelector('.tab-button'));

            // Add delete functionality
            const deleteBtn = newTabButton.querySelector('.tab-delete-btn');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (Object.keys(quickSortGroups).length <= 1) {
                    return; // Don't delete if it's the last tab
                }
                
                // Remove from data structures
                delete quickSortGroups[groupId];
                delete tabNames[groupId];
                
                // Update localStorage
                localStorage.setItem('quickSortGroups', JSON.stringify(quickSortGroups));
                localStorage.setItem('tabNames', JSON.stringify(tabNames));
                
                // Remove DOM elements
                newTabButton.remove();
                document.querySelector(`.tab-panel[data-tab="${groupId}"]`).remove();
                
                // If we deleted the active tab, activate the first remaining tab
                if (currentQuickSortGroup === groupId) {
                    const firstTab = document.querySelector('.tab-button');
                    if (firstTab) {
                        firstTab.click();
                    }
                }
            });
        });
    // Initialize tab names
    tabButtons.forEach(button => {
        const tabId = button.dataset.tab;
        const nameSpan = button.querySelector('.tab-name');
        nameSpan.textContent = tabNames[tabId] || `Group ${tabId.replace('group', '')}`;
        
        // Add event listener for name editing
        nameSpan.addEventListener('blur', () => {
            console.log("changing tab name");
            const newName = nameSpan.textContent.trim();
            if (newName) {
                console.log("new name: " + newName);
                tabNames[tabId] = newName;
                console.log("settuing tab names: " + tabNames.JSON, tabId);
                console.log("settuing tab names: " + tabNames);
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
                <span class="tab-delete-btn">×</span>
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
            console.log("changing new tab name");
            const newName = nameSpan.textContent.trim();
            if (newName) {
                console.log("new tab new name: " + newName);
                tabNames[newGroupId] = newName;
                console.log("setting tab names:", JSON.stringify(tabNames), newGroupId);
                localStorage.setItem('tabNames', JSON.stringify(tabNames));
                console.log("local storage tab names: " + localStorage.getItem('tabNames'));
            } else {
                nameSpan.textContent = tabNames[newGroupId];
            }
        });console.log("Current tabNames:", tabNames);
        console.log("newGroupId:", newGroupId);
        console.log("Current saved name:", tabNames[newGroupId]);
        nameSpan.textContent = tabNames[newGroupId] || `Group ${newGroupId.replace('group', '')}`;
        // Prevent tab switching when editing name
        nameSpan.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        newTabButton.querySelector('.tab-button').click();

        // Add delete functionality
        const deleteBtn = newTabButton.querySelector('.tab-delete-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (Object.keys(quickSortGroups).length <= 1) {
                return; // Don't delete if it's the last tab
            }
            
            // Remove from data structures
            delete quickSortGroups[newGroupId];
            delete tabNames[newGroupId];
            
            // Update localStorage
            localStorage.setItem('quickSortGroups', JSON.stringify(quickSortGroups));
            localStorage.setItem('tabNames', JSON.stringify(tabNames));
            
            // Remove DOM elements
            newTabButton.remove();
            document.querySelector(`.tab-panel[data-tab="${newGroupId}"]`).remove();
            
            // If we deleted the active tab, activate the first remaining tab
            if (currentQuickSortGroup === newGroupId) {
                const firstTab = document.querySelector('.tab-button');
                if (firstTab) {
                    firstTab.click();
                }
            }
        });
    });
}

function updateQuickMoveFoldersUI() {
    const currentFolders = quickSortGroups[currentQuickSortGroup] || [];
    const currentPanel = document.querySelector(`.tab-panel[data-tab="${currentQuickSortGroup}"]`);
    const panelFolders = currentPanel.querySelector('.quick-move-folders');
    
    let leftColumnHtml = '';
    let rightColumnHtml = '';
    const slotsToShow = Math.min(currentFolders.length + 1, 19);
    const letterKeys = 'QWERTYUIOP';
    
    for (let i = 0; i < slotsToShow; i++) {
        const isRightColumn = i >= 9;
        let html = '';
        
        if (i < currentFolders.length) {
            const fullPath = currentFolders[i];
            const folderName = fullPath.split(/[\\/]/).pop();
            const keyLabel = i < 9 ? (i + 1) : letterKeys[i - 9];
            html += `
                <div class="quick-folder-item">
                    <span class="quick-folder-key">${keyLabel}</span>
                    <span class="quick-folder-path" 
                          onclick="moveToQuickFolder('${fullPath.replace(/\\/g, '\\\\')}')"
                          ondblclick="window.electronAPI.openDirectory('${fullPath.replace(/\\/g, '\\\\')}')"
                          title="${fullPath}">${folderName}</span>
                    <span class="quick-folder-remove" onclick="removeQuickMoveFolder(${i})">×</span>
                </div>
            `;
        } else {
            const keyLabel = i < 9 ? (i + 1) : letterKeys[i - 9];
            html += `
                <div class="quick-folder-item empty" onclick="addQuickMoveFolder()">
                    <span class="quick-folder-key">${keyLabel}</span>
                    <span class="quick-folder-path">Click to add folder...</span>
                </div>
            `;
        }
        
        if (isRightColumn) {
            rightColumnHtml += html;
        } else {
            leftColumnHtml += html;
        }
    }
    
    // Create the two-column layout
    panelFolders.innerHTML = `
        <div class="quick-move-folders-container">
            <div class="quick-move-column">
                ${leftColumnHtml}
            </div>
            ${rightColumnHtml ? `
                <div class="quick-move-column">
                    ${rightColumnHtml}
                </div>
            ` : ''}
        </div>
    `;
}

// Add to your existing initialization calls
initializeQuickSortTabs();

// Add event listener for ESC key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isFullscreen) {
        document.body.classList.remove('fullscreen-mode');
        window.electronAPI.setFullscreen(false);
        isFullscreen = false;
    }
});

function initializeDragAndResize() {
    const container = document.querySelector('.quick-sort-tabs');
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;

    // Save the position to localStorage
    function savePosition() {
        const position = {
            right: container.style.right,
            top: container.style.top,
            width: container.style.width,
            height: container.style.height
        };
        localStorage.setItem('quickSortPosition', JSON.stringify(position));
    }

    // Load the position from localStorage
    function loadPosition() {
        const savedPosition = localStorage.getItem('quickSortPosition');
        if (savedPosition) {
            const position = JSON.parse(savedPosition);
            container.style.right = position.right;
            container.style.top = position.top;
            container.style.width = position.width;
            container.style.height = position.height;
        }
    }

    function dragStart(e) {
        // Only start dragging if clicking the header area (first 40px from top)
        const rect = container.getBoundingClientRect();
        const clickY = e.clientY - rect.top;
        
        if (clickY > 40) return; // Only allow dragging from the header area

        isDragging = true;
        container.classList.add('dragging');
        
        initialX = e.clientX - container.offsetLeft;
        initialY = e.clientY - container.offsetTop;
    }

    function dragEnd() {
        isDragging = false;
        container.classList.remove('dragging');
        savePosition();
    }

    function drag(e) {
        if (isDragging) {
            e.preventDefault();
            
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;

            // Convert position to right-based positioning
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;
            const containerWidth = container.offsetWidth;
            const containerHeight = container.offsetHeight;

            const right = windowWidth - (currentX + containerWidth);
            const top = currentY;

            // Ensure the container doesn't go out of bounds
            const maxRight = windowWidth - containerWidth;
            const maxTop = windowHeight - containerHeight;

            if (right < 0) {
                container.style.right = 0;
            } else if (right > maxRight) {
                container.style.right = maxRight;
            } else {
                container.style.right = right;
            }

            if (top < 0) {
                container.style.top = 0;
            } else if (top > maxTop) {
                container.style.top = maxTop;
            } else {
                container.style.top = top;
            }
        }
    }

    // Add event listeners
    container.addEventListener('mousedown', dragStart);
    container.addEventListener('mousemove', drag);
    container.addEventListener('mouseup', dragEnd);
}

// Add to your existing initialization calls
initializeDragAndResize();

function initializeCustomResize() {
    const container = document.querySelector('.quick-sort-tabs');
    let isResizing = false;
    let initialWidth, initialHeight, initialX, initialY;

    container.addEventListener('mousedown', (e) => {
        // Check if click is in the bottom-left 15x15px area
        const rect = container.getBoundingClientRect();
        const isInResizeZone = 
            e.clientX <= rect.left + 15 && 
            e.clientY >= rect.bottom - 15;

        if (isInResizeZone) {
            isResizing = true;
            initialWidth = container.offsetWidth;
            initialHeight = container.offsetHeight;
            initialX = e.clientX;
            initialY = e.clientY;
            e.preventDefault();
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const deltaX = initialX - e.clientX;
        const deltaY = e.clientY - initialY;

        const newWidth = Math.max(150, initialWidth + deltaX);  // Min width 150px
        const newHeight = Math.max(100, initialHeight + deltaY); // Min height 100px

        container.style.width = `${newWidth}px`;
        container.style.height = `${newHeight}px`;
    });

    document.addEventListener('mouseup', () => {
        isResizing = false;
    });
}

// Call this function when the quick sort panel is initialized
document.addEventListener('DOMContentLoaded', () => {
    initializeCustomResize();
});

function clearAutoAdvanceTimer() {
    if (autoAdvanceTimer) {
        clearTimeout(autoAdvanceTimer);
        autoAdvanceTimer = null;
    }
}

function setupAutoAdvance() {
    clearAutoAdvanceTimer();
    videoElement.removeEventListener('ended', handleMediaEnd);
    
    if (!autoAdvanceEnabled) return;
    
    const currentFile = images[currentIndex];
    if (!currentFile) return;
    
    if (isVideo(currentFile)) {
        // For videos, add the ended event listener
        videoElement.addEventListener('ended', handleMediaEnd, { once: true });
    } else {
        // For images, use a timer
        autoAdvanceTimer = setTimeout(handleMediaEnd, autoAdvanceDelay);
    }
}


function handleMediaEnd() {
    if (!autoAdvanceEnabled) return;
    
    // Clear any existing timers and listeners
    clearAutoAdvanceTimer();
    videoElement.removeEventListener('ended', handleMediaEnd);
    
    // Prevent multiple triggers
    if (isMediaUpdateInProgress) return;
    
    if (currentIndex < images.length - 1) {
        currentIndex++;
        updateMedia();
    }
}
document.getElementById('enable-autoplay').addEventListener('change', (e) => {
    autoAdvanceEnabled = e.target.checked;
    
    // Clear any existing auto-advance setup
    clearAutoAdvanceTimer();
    videoElement.removeEventListener('ended', handleMediaEnd);
    
    // Setup new auto-advance if enabled
    if (autoAdvanceEnabled) {
        setupAutoAdvance();
    }
});

document.getElementById('auto-advance-delay').addEventListener('change', (e) => {
    const newDelay = Math.max(0.1, Math.min(60, parseFloat(e.target.value) || 3));
    e.target.value = newDelay.toFixed(1); // Format to 1 decimal place
    autoAdvanceDelay = newDelay * 1000; // Convert to milliseconds
    localStorage.setItem('autoAdvanceDelay', autoAdvanceDelay);
    
    // Restart auto-advance with new delay if enabled
    if (autoAdvanceEnabled && !isVideo(images[currentIndex])) {
        setupAutoAdvance();
    }
});

// Add this function to renderer.js
function applyVideoStartSettings() {
    if (!videoElement) return;
    
    switch (videoStartSettings.mode) {
        case 'fixed':
            videoElement.currentTime = videoStartSettings.fixedTime;
            break;
        case 'percentage':
            if (videoElement.duration) {
                videoElement.currentTime = (videoStartSettings.percentage / 100) * videoElement.duration;
            }
            break;
        case 'beginning':
        default:
            videoElement.currentTime = 0;
            break;
    }
}

// Add event listeners for the video start settings
document.querySelectorAll('input[name="video-start"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        videoStartSettings.mode = e.target.value;
    });
});

document.getElementById('fixed-start-time').addEventListener('change', (e) => {
    videoStartSettings.fixedTime = Math.max(0, parseFloat(e.target.value) || 0);
});

document.getElementById('percentage-start').addEventListener('change', (e) => {
    videoStartSettings.percentage = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0));
});

// Modify the video loadedmetadata event handler
videoElement.addEventListener('loadedmetadata', () => {
    applyVideoStartSettings();
    videoElement.playbackRate = videoStartSettings.playbackSpeed;
});