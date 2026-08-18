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

// Sync State
let isGroupMode = false;
let currentRoom = null;
let mqttClient = null;
let isLocalAction = false; // Flag to prevent infinite broadcast loops
let syncBroadcastTimer = null;
let activeHostId = Math.random().toString(36).substring(7);

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

const timerDisplay = document.getElementById('timer-display');
const timerLabel = document.getElementById('timer-label');
const btnTimerToggle = document.getElementById('btn-timer-toggle');
const btnTimerReset = document.getElementById('btn-timer-reset');

// Room UI Elements
const btnToggleMode = document.getElementById('btn-toggle-mode');
const roomStatusText = document.getElementById('room-status-text');
const roomStatusIndicator = document.getElementById('room-status-indicator');
const roomModal = document.getElementById('room-modal');
const roomModalCard = document.getElementById('room-modal-card');
const roomInput = document.getElementById('room-input');
const btnJoinRoom = document.getElementById('btn-join-room');
const btnCancelRoom = document.getElementById('btn-cancel-room');
const btnLeaveRoom = document.getElementById('btn-leave-room');

// --- Initialization ---
function init() {
    // Check URL for room
    const urlParams = new URLSearchParams(window.location.search);
    const urlRoom = urlParams.get('room');
    if (urlRoom) {
        joinRoom(urlRoom);
    }
}

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
    setTimeout(() => { if(ytPlayer && ytPlayer.setShuffle) ytPlayer.setShuffle(true); }, 1000);
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
    isLocalAction = true;
    if (isPlaying) {
        ytPlayer.pauseVideo();
        broadcastSync('PAUSE');
    } else {
        ytPlayer.playVideo();
        broadcastSync('PLAY');
    }
    setTimeout(() => isLocalAction = false, 500);
});

nextBtn.addEventListener('click', () => {
    isLocalAction = true;
    nextTrack();
    setTimeout(() => { broadcastSync('PLAY'); isLocalAction = false; }, 1000);
});

prevBtn.addEventListener('click', () => {
    if (ytPlayer) {
        isLocalAction = true;
        ytPlayer.previousVideo();
        setTimeout(() => { broadcastSync('PLAY'); isLocalAction = false; }, 1000);
    }
});

function nextTrack() {
    if (ytPlayer) ytPlayer.nextVideo();
}

progressContainer.addEventListener('click', (e) => {
    if (!ytPlayer || !ytPlayer.getDuration) return;
    isLocalAction = true;
    const rect = progressContainer.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const seekTime = pos * ytPlayer.getDuration();
    ytPlayer.seekTo(seekTime);
    broadcastSync('SEEK', { time: seekTime });
    setTimeout(() => isLocalAction = false, 500);
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
        if (data && data.title) trackNameEl.innerText = data.title;
        if (data && data.video_id) coverArtEl.style.backgroundImage = `url('https://img.youtube.com/vi/${data.video_id}/hqdefault.jpg')`;
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
            progressFill.style.width = dur > 0 ? `${(cur / dur) * 100}%` : '0%';
        }
    }, 500);
}

function formatTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

// --- Sync / MQTT Logic ---
function openRoomModal() {
    roomModal.classList.remove('hidden');
    setTimeout(() => {
        roomModal.classList.remove('opacity-0');
        roomModalCard.classList.remove('scale-95');
    }, 10);
    roomInput.value = currentRoom || '';
    if (isGroupMode) {
        btnJoinRoom.innerText = "Switch Room";
        btnLeaveRoom.classList.remove('hidden');
    } else {
        btnJoinRoom.innerText = "Join / Create";
        btnLeaveRoom.classList.add('hidden');
    }
}

function closeRoomModal() {
    roomModal.classList.add('opacity-0');
    roomModalCard.classList.add('scale-95');
    setTimeout(() => {
        roomModal.classList.add('hidden');
    }, 300);
}

function joinRoom(roomName) {
    if (!roomName) return;
    currentRoom = roomName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    isGroupMode = true;
    
    // Update URL without reloading
    const newurl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?room=' + currentRoom;
    window.history.pushState({path:newurl},'',newurl);

    // Update UI
    roomStatusText.innerText = 'Room: ' + currentRoom;
    roomStatusIndicator.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]';
    roomStatusText.classList.add('text-emerald-400');
    btnToggleMode.classList.add('border-emerald-500/30');

    // Connect to MQTT
    if (mqttClient) mqttClient.end();
    mqttClient = mqtt.connect('wss://broker.emqx.io:8084/mqtt');
    
    mqttClient.on('connect', () => {
        console.log('Connected to MQTT room:', currentRoom);
        mqttClient.subscribe(`office-radio/room/${currentRoom}`);
    });

    mqttClient.on('message', (topic, message) => {
        if (isLocalAction) return; // Ignore incoming syncs if we just clicked something
        try {
            const data = JSON.parse(message.toString());
            handleSyncMessage(data);
        } catch(e) {}
    });

    // Start auto-broadcasting if we are playing
    if (syncBroadcastTimer) clearInterval(syncBroadcastTimer);
    syncBroadcastTimer = setInterval(() => {
        if (isPlaying && !isLocalAction) broadcastSync('HEARTBEAT');
    }, 3000);

    closeRoomModal();
}

function leaveRoom() {
    isGroupMode = false;
    currentRoom = null;
    if (mqttClient) mqttClient.end();
    if (syncBroadcastTimer) clearInterval(syncBroadcastTimer);
    
    const newurl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    window.history.pushState({path:newurl},'',newurl);

    roomStatusText.innerText = 'Solo Mode';
    roomStatusIndicator.className = 'w-2 h-2 rounded-full bg-gray-400';
    roomStatusText.classList.remove('text-emerald-400');
    btnToggleMode.classList.remove('border-emerald-500/30');
    
    closeRoomModal();
}

function broadcastSync(action, extraData = {}) {
    if (!isGroupMode || !mqttClient || !ytPlayer) return;
    
    let trackIndex = 0;
    try { trackIndex = ytPlayer.getPlaylistIndex(); } catch(e){}
    
    let time = 0;
    try { time = ytPlayer.getCurrentTime(); } catch(e){}

    const payload = {
        action: action,
        trackIndex: trackIndex,
        time: time,
        hostId: activeHostId,
        ...extraData
    };
    
    mqttClient.publish(`office-radio/room/${currentRoom}`, JSON.stringify(payload));
}

function handleSyncMessage(data) {
    if (!ytPlayer) return;
    
    const currentIndex = ytPlayer.getPlaylistIndex();
    
    if (data.action === 'PLAY' || data.action === 'HEARTBEAT') {
        if (data.trackIndex !== currentIndex) {
            ytPlayer.playVideoAt(data.trackIndex);
        }
        if (!isPlaying && data.action === 'PLAY') {
            ytPlayer.playVideo();
        }
        
        // Sync time if drift > 2 seconds
        const currentTime = ytPlayer.getCurrentTime() || 0;
        if (Math.abs(currentTime - data.time) > 2.5) {
            ytPlayer.seekTo(data.time);
        }
    } 
    else if (data.action === 'PAUSE') {
        ytPlayer.pauseVideo();
    }
    else if (data.action === 'SEEK') {
        ytPlayer.seekTo(data.time);
    }
}

// Modal Listeners
btnToggleMode.addEventListener('click', openRoomModal);
btnCancelRoom.addEventListener('click', closeRoomModal);
btnJoinRoom.addEventListener('click', () => joinRoom(roomInput.value));
btnLeaveRoom.addEventListener('click', leaveRoom);
roomInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') joinRoom(roomInput.value); });

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
        if(isWorkSession && !isPlaying && ytPlayer) ytPlayer.playVideo();

        timerInterval = setInterval(() => {
            timeLeft--;
            if (timeLeft <= 0) switchSession();
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
}

function switchSession() {
    clearInterval(timerInterval);
    isTimerRunning = false;
    if (isWorkSession) {
        isWorkSession = false;
        timeLeft = 5 * 60;
        timerLabel.innerText = 'Take a Break';
        btnTimerToggle.innerText = 'Start Break';
    } else {
        isWorkSession = true;
        timeLeft = 25 * 60;
        timerLabel.innerText = 'Deep Work';
        btnTimerToggle.innerText = 'Start Focus';
    }
    updateTimerDisplay();
}

btnTimerToggle.addEventListener('click', toggleTimer);
btnTimerReset.addEventListener('click', resetTimer);

// Init
updateTimerDisplay();
init();

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
