// app.js

// --- State ---
let ytPlayer = null;
let isPlaying = false;
let currentPlaylist = 'PLUSeOh5veVTo'; // Custom Office Playlist
let progressTimer = null;
let metadataTimer = null;

// Pomodoro State
let timerInterval = null;
let timeLeft = 25 * 60; // 25 minutes
let isTimerRunning = false;
let isWorkSession = true; // true = Work (25m), false = Break (5m)

// --- DOM Elements ---
const playBtn = document.getElementById('btn-play');
const prevBtn = document.getElementById('btn-prev');
const nextBtn = document.getElementById('btn-next');
const playIcon = document.getElementById('icon-play');
const trackNameEl = document.getElementById('track-name');
const playlistNameEl = document.getElementById('playlist-name');
const coverArtEl = document.getElementById('cover-art');
const timeNowEl = document.getElementById('time-now');
const timeTotalEl = document.getElementById('time-total');
const progressFill = document.getElementById('progress-fill');
const progressContainer = document.getElementById('progress-container');
const bgImage = document.getElementById('bg-image');

const timerDisplay = document.getElementById('timer-display');
const timerLabel = document.getElementById('timer-label');
const btnTimerToggle = document.getElementById('btn-timer-toggle');
const btnTimerReset = document.getElementById('btn-timer-reset');

const vibeBtns = []; // Removed

// --- YouTube API ---
function onYouTubeIframeAPIReady() {
    ytPlayer = new YT.Player('youtubeBridge', {
        height: '200',
        width: '200',
        playerVars: {
            listType: 'playlist',
            list: currentPlaylist,
            autoplay: 0,
            controls: 0,
            enablejsapi: 1,
            playsinline: 1,
            rel: 0,
            index: Math.floor(Math.random() * 20) // Random start track
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange,
            'onError': onPlayerError
        }
    });
}

function onPlayerReady(event) {
    event.target.setVolume(100);
    // Shuffle playlist logic
    setTimeout(() => {
        if(ytPlayer && ytPlayer.setShuffle) {
            ytPlayer.setShuffle(true);
        }
    }, 1000);
    
    startMetadataPolling();
}

function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING) {
        isPlaying = true;
        updatePlayIconUI(true);
        updateTrackData();
        startProgressMonitor();
    } else if (event.data === YT.PlayerState.PAUSED) {
        isPlaying = false;
        updatePlayIconUI(false);
        coverArtEl.classList.remove('spin-slow');
    } else if (event.data === YT.PlayerState.ENDED) {
        nextTrack();
    }
}

function onPlayerError(e) {
    console.warn("YT Error, skipping");
    nextTrack();
}

// --- Player Controls ---
playBtn.addEventListener('click', () => {
    if (!ytPlayer) return;
    if (isPlaying) {
        ytPlayer.pauseVideo();
    } else {
        ytPlayer.playVideo();
    }
});

nextBtn.addEventListener('click', () => {
    if (ytPlayer) ytPlayer.nextVideo();
});

prevBtn.addEventListener('click', () => {
    if (ytPlayer) ytPlayer.previousVideo();
});

function nextTrack() {
    if (ytPlayer) ytPlayer.nextVideo();
}

// Progress Bar Click
progressContainer.addEventListener('click', (e) => {
    if (!ytPlayer || !ytPlayer.getDuration) return;
    const rect = progressContainer.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    ytPlayer.seekTo(pos * ytPlayer.getDuration());
});

// --- UI Updates ---
function updatePlayIconUI(playing) {
    if (playing) {
        playIcon.innerHTML = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
        coverArtEl.classList.add('spin-slow');
    } else {
        playIcon.innerHTML = `<path d="M8 5v14l11-7z"/>`;
        coverArtEl.classList.remove('spin-slow');
    }
}

function updateTrackData() {
    if (!ytPlayer || typeof ytPlayer.getVideoData !== 'function') return;
    try {
        const data = ytPlayer.getVideoData();
        if (data && data.title) {
            trackNameEl.innerText = data.title;
        }
        if (data && data.video_id) {
            coverArtEl.style.backgroundImage = `url('https://img.youtube.com/vi/${data.video_id}/hqdefault.jpg')`;
        }
    } catch(e) {}
}

function startMetadataPolling() {
    if (metadataTimer) clearInterval(metadataTimer);
    metadataTimer = setInterval(updateTrackData, 1000);
}

function startProgressMonitor() {
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = setInterval(() => {
        if (ytPlayer && ytPlayer.getCurrentTime && ytPlayer.getDuration) {
            const cur = ytPlayer.getCurrentTime() || 0;
            const dur = ytPlayer.getDuration() || 0;
            
            timeNowEl.innerText = formatTime(cur);
            timeTotalEl.innerText = formatTime(dur);
            
            const pct = dur > 0 ? (cur / dur) * 100 : 0;
            progressFill.style.width = `${pct}%`;
        }
    }, 500);
}

function formatTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

// --- Vibe Shifts (Removed) ---

// --- Pomodoro Logic ---
function updateTimerDisplay() {
    const m = Math.floor(timeLeft / 60);
    const s = timeLeft % 60;
    timerDisplay.innerText = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function toggleTimer() {
    if (isTimerRunning) {
        clearInterval(timerInterval);
        isTimerRunning = false;
        btnTimerToggle.innerText = isWorkSession ? 'Resume Focus' : 'Resume Break';
    } else {
        isTimerRunning = true;
        btnTimerToggle.innerText = 'Pause Timer';
        
        // Auto-play music if focus starts
        if(isWorkSession && !isPlaying && ytPlayer) {
            ytPlayer.playVideo();
        }

        timerInterval = setInterval(() => {
            timeLeft--;
            if (timeLeft <= 0) {
                switchSession();
            }
            updateTimerDisplay();
        }, 1000);
    }
}

function resetTimer() {
    clearInterval(timerInterval);
    isTimerRunning = false;
    isWorkSession = true;
    timeLeft = 25 * 60;
    updateTimerDisplay();
    timerLabel.innerText = 'Deep Work';
    btnTimerToggle.innerText = 'Start Focus';
    
    // Switch to Focus Vibe automatically (Removed)
}

function switchSession() {
    clearInterval(timerInterval);
    isTimerRunning = false;
    
    if (isWorkSession) {
        // Switch to Break
        isWorkSession = false;
        timeLeft = 5 * 60;
        timerLabel.innerText = 'Take a Break';
        btnTimerToggle.innerText = 'Start Break';
        
        // Switch to Coffee Break Vibe (Removed)
        
    } else {
        // Switch to Work
        isWorkSession = true;
        timeLeft = 25 * 60;
        timerLabel.innerText = 'Deep Work';
        btnTimerToggle.innerText = 'Start Focus';
        
        // Switch to Focus Vibe (Removed)
    }
    updateTimerDisplay();
}

btnTimerToggle.addEventListener('click', toggleTimer);
btnTimerReset.addEventListener('click', resetTimer);

// Init display
updateTimerDisplay();

// --- Ambient Animations ---
const particlesContainer = document.getElementById('particles');
if(particlesContainer) {
    for (let i = 0; i < 40; i++) {
        let p = document.createElement('div');
        p.className = 'particle';
        p.style.width = Math.random() * 5 + 2 + 'px';
        p.style.height = p.style.width;
        p.style.left = Math.random() * 100 + 'vw';
        p.style.animationDuration = Math.random() * 15 + 10 + 's';
        p.style.animationDelay = Math.random() * 20 + 's';
        particlesContainer.appendChild(p);
    }
}
