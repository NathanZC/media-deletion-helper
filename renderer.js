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
        playDuration: 3,
        skipDuration: 10,
        active: false
    }
};

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

async function loadDirectory() {
    stopCurrentMedia();
    const result = await window.electronAPI.selectDirectory();
    if (result && result.length > 0) {
        window.fullDirectoryListing = result;
        // Extract directory path from the first file
        currentDirectory = result[0].substring(0, result[0].lastIndexOf(result[0].includes('\\') ? '\\' : '/'));
        currentDirPath.textContent = currentDirectory;
        openDirBtn.style.display = 'block';
        currentIndex = 0;
        deletedImages = [];
        filterFiles();
    }
}

async function updateMedia() {
    if (images.length === 0) {
        mediaElement.style.display = 'none';
        videoElement.style.display = 'none';
        counterElement.textContent = 'No media';
        fileNameElement.textContent = '';
        return;
    }
    
    const currentFile = images[currentIndex];
    const fileName = currentFile.split('\\').pop().split('/').pop();
    
    // Get file metadata
    const metadata = await window.electronAPI.getFileMetadata(currentFile);
    
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
    if (images.length === 0) return;
    
    const success = await window.electronAPI.deleteImage(images[currentIndex]);
    if (success) {
        deletedImages.push({
            path: images[currentIndex],
            index: currentIndex
        });
        
        images.splice(currentIndex, 1);
        if (currentIndex >= images.length) {
            currentIndex = Math.max(0, images.length - 1);
        }
        updateMedia();
    }
}

async function undoDelete() {
    if (deletedImages.length === 0) return;
    
    const lastDeleted = deletedImages.pop();
    const success = await window.electronAPI.undeleteImage(lastDeleted.path);
    
    if (success) {
        images.splice(lastDeleted.index, 0, lastDeleted.path);
        currentIndex = lastDeleted.index;
        updateMedia();
    }
}

selectButton.addEventListener('click', loadDirectory);

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isFullscreen) {
        toggleFullscreen();
        return;
    }

    // Prevent default behavior for arrow keys in fullscreen mode
    if (isFullscreen && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
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
            undoDelete();
            break;
        case 'f':
            toggleFullscreen();
            break;
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