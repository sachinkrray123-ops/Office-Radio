// app.js — Office Radio V2

// ========================================
// CONFIG
// ========================================
const YT_API_KEY = 'AIzaSyB54Inb5_XtjHmd53pDMVZYTBiU-ys7MJs';
const MQTT_BROKER = 'wss://broker.emqx.io:8084/mqtt';
const MQTT_PREFIX = 'office-radio-v2';
const DEFAULT_PLAYLIST = 'PLUSeOh5veVTo';

// ========================================
// STATE
// ========================================
let ytPlayer = null;
let isPlaying = false;
let currentPlaylist = DEFAULT_PLAYLIST;
let progressTimer = null;
let metadataTimer = null;

// Pomodoro
let timerInterval = null;
let timeLeft = 25 * 60;
let isTimerRunning = false;
let isWorkSession = true;

// Sync
let isGroupMode = false;
let currentRoom = null;
let mqttClient = null;
let isLocalAction = false;
let syncBroadcastTimer = null;
const myClientId = 'or_' + Math.random().toString(36).substring(2, 10);

// Visitor tracking
let visitorHeartbeatTimer = null;
let visitorMap = {};  // clientId -> lastSeen timestamp

// Mute
let isMuted = false;

// ========================================
// DOM ELEMENTS
// ========================================
const $ = id => document.getElementById(id);

const playBtn = $('btn-play');
const prevBtn = $('btn-prev');
const nextBtn = $('btn-next');
const playIcon = $('icon-play');
const muteBtn = $('btn-mute');
const iconMute = $('icon-mute');
const trackNameEl = $('track-name');
const playlistNameEl = $('playlist-name');
const coverArtEl = $('cover-art');
const timeNowEl = $('time-now');
const timeTotalEl = $('time-total');
const progressFill = $('progress-fill');
const progressContainer = $('progress-container');

const timerDisplay = $('timer-display');
const timerLabel = $('timer-label');
const btnTimerToggle = $('btn-timer-toggle');
const btnTimerReset = $('btn-timer-reset');

// Room UI
const roomModal = $('room-modal');
const roomModalCard = $('room-modal-card');
const tabCreate = $('tab-create');
const tabJoin = $('tab-join');
const panelCreate = $('panel-create');
const panelJoin = $('panel-join');
const generatedCodeEl = $('generated-room-code');
const btnCopyCode = $('btn-copy-code');
const btnCreateGo = $('btn-create-go');
const roomInput = $('room-input');
const btnJoinGo = $('btn-join-go');
const btnCancelModal = $('btn-cancel-modal');

const roomConnectedBar = $('room-connected-bar');
const connectedRoomCode = $('connected-room-code');
const listenerCountEl = $('listener-count');
const btnCloseRoom = $('btn-close-room');
const roomButtons = $('room-buttons');
const btnSolo = $('btn-solo');
const btnGroup = $('btn-group');

const visitorCountEl = $('visitor-count');
const toastContainer = $('toast-container');

// ========================================
// INITIALIZATION
// ========================================
function init() {
    startVisitorTracking();
    
    // Check URL for room auto-join
    const urlParams = new URLSearchParams(window.location.search);
    const urlRoom = urlParams.get('room');
    if (urlRoom) {
        joinRoom(urlRoom.toUpperCase());
    }
}

// ========================================
// YOUTUBE API
// ========================================
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
            index: 0
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
        if (ytPlayer) ytPlayer.nextVideo();
    }
}

function onPlayerError(e) {
    console.warn("YT Error code:", e.data, "— skipping track");
    if (ytPlayer) ytPlayer.nextVideo();
}

// ========================================
// PLAYER CONTROLS
// ========================================
playBtn.addEventListener('click', () => {
    if (!ytPlayer) return;
    isLocalAction = true;
    if (isPlaying) {
        ytPlayer.pauseVideo();
        broadcastSync('PAUSE');
    } else {
        ytPlayer.playVideo();
        // Delay broadcast so YT has time to start and getVideoData works
        setTimeout(() => broadcastSync('PLAY'), 500);
    }
    setTimeout(() => isLocalAction = false, 800);
});

nextBtn.addEventListener('click', () => {
    if (!ytPlayer) return;
    isLocalAction = true;
    ytPlayer.nextVideo();
    setTimeout(() => {
        broadcastSync('TRACK_CHANGE');
        isLocalAction = false;
    }, 1500);
});

prevBtn.addEventListener('click', () => {
    if (!ytPlayer) return;
    isLocalAction = true;
    ytPlayer.previousVideo();
    setTimeout(() => {
        broadcastSync('TRACK_CHANGE');
        isLocalAction = false;
    }, 1500);
});

progressContainer.addEventListener('click', (e) => {
    if (!ytPlayer || !ytPlayer.getDuration) return;
    isLocalAction = true;
    const rect = progressContainer.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const seekTime = pos * ytPlayer.getDuration();
    ytPlayer.seekTo(seekTime);
    broadcastSync('SEEK', { time: seekTime });
    setTimeout(() => isLocalAction = false, 800);
});

// Mute
muteBtn.addEventListener('click', () => {
    if (!ytPlayer) return;
    if (isMuted) {
        ytPlayer.unMute();
        iconMute.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M11 5L6 9H2v6h4l5 4V5z"></path>`;
    } else {
        ytPlayer.mute();
        iconMute.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"></path>`;
    }
    isMuted = !isMuted;
    muteBtn.classList.toggle('text-white/50', !isMuted);
    muteBtn.classList.toggle('text-emerald-400', isMuted);
});

// ========================================
// UI UPDATES
// ========================================
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
        if (data && data.video_id) {
            coverArtEl.style.backgroundImage = `url('https://img.youtube.com/vi/${data.video_id}/hqdefault.jpg')`;
        }
    } catch (e) { }
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

// ========================================
// TOAST NOTIFICATIONS
// ========================================
function showToast(message, duration = 3000) {
    const t = document.createElement('div');
    t.className = 'toast-notification pointer-events-auto';
    t.innerHTML = `<span class="text-xs">${message}</span>`;
    toastContainer.appendChild(t);
    // Trigger entrance animation
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 300);
    }, duration);
}

// ========================================
// ROOM CODE GENERATION
// ========================================
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1 to avoid confusion
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

// ========================================
// MODAL LOGIC
// ========================================
function openRoomModal() {
    // Generate a fresh code every time the modal opens
    generatedCodeEl.innerText = generateRoomCode();
    
    // Reset to Create tab
    switchTab('create');
    roomInput.value = '';
    
    roomModal.classList.remove('hidden');
    setTimeout(() => {
        roomModal.classList.remove('opacity-0');
        roomModalCard.classList.remove('scale-95');
    }, 10);
}

function closeRoomModal() {
    roomModal.classList.add('opacity-0');
    roomModalCard.classList.add('scale-95');
    setTimeout(() => roomModal.classList.add('hidden'), 300);
}

function switchTab(tab) {
    if (tab === 'create') {
        tabCreate.className = 'flex-1 py-2.5 rounded-lg text-sm font-bold text-center transition-all bg-emerald-500/20 text-emerald-400';
        tabJoin.className = 'flex-1 py-2.5 rounded-lg text-sm font-bold text-center transition-all text-white/50 hover:text-white/80';
        panelCreate.classList.remove('hidden');
        panelJoin.classList.add('hidden');
    } else {
        tabJoin.className = 'flex-1 py-2.5 rounded-lg text-sm font-bold text-center transition-all bg-emerald-500/20 text-emerald-400';
        tabCreate.className = 'flex-1 py-2.5 rounded-lg text-sm font-bold text-center transition-all text-white/50 hover:text-white/80';
        panelJoin.classList.remove('hidden');
        panelCreate.classList.add('hidden');
        setTimeout(() => roomInput.focus(), 100);
    }
}

// ========================================
// MQTT ROOM SYNC ENGINE
// ========================================
function connectMQTT(roomCode, callback) {
    if (mqttClient) {
        mqttClient.end(true);
        mqttClient = null;
    }
    
    const clientId = 'or_' + Math.random().toString(36).substring(2, 10);
    
    mqttClient = mqtt.connect(MQTT_BROKER, {
        clientId: clientId,
        clean: true,
        connectTimeout: 5000,
        reconnectPeriod: 3000,  // Auto-reconnect every 3s
        keepalive: 30
    });
    
    mqttClient.on('connect', () => {
        console.log('[MQTT] Connected to broker, room:', roomCode);
        
        // Subscribe to room sync and presence topics
        mqttClient.subscribe(`${MQTT_PREFIX}/room/${roomCode}/sync`);
        mqttClient.subscribe(`${MQTT_PREFIX}/room/${roomCode}/presence`);
        
        // Announce presence
        publishPresence('JOIN');
        
        if (callback) callback();
    });
    
    mqttClient.on('message', (topic, message) => {
        try {
            const data = JSON.parse(message.toString());
            
            // Ignore our own messages
            if (data.senderId === myClientId) return;
            
            if (topic.endsWith('/sync')) {
                handleSyncMessage(data);
            } else if (topic.endsWith('/presence')) {
                handlePresenceMessage(data);
            }
        } catch (e) {
            console.warn('[MQTT] Parse error:', e);
        }
    });
    
    mqttClient.on('error', (err) => {
        console.error('[MQTT] Error:', err);
    });
    
    mqttClient.on('reconnect', () => {
        console.log('[MQTT] Reconnecting...');
    });
    
    mqttClient.on('close', () => {
        console.log('[MQTT] Connection closed');
    });
}

function publishPresence(action) {
    if (!mqttClient || !currentRoom) return;
    mqttClient.publish(`${MQTT_PREFIX}/room/${currentRoom}/presence`, JSON.stringify({
        action: action,
        senderId: myClientId,
        timestamp: Date.now()
    }));
}

// Room member tracking
let roomMembers = new Set();

function handlePresenceMessage(data) {
    if (data.action === 'JOIN') {
        roomMembers.add(data.senderId);
        // Reply with our own presence so the new joiner knows we're here
        publishPresence('HERE');
        // Immediately broadcast current playback state so the joiner syncs instantly
        if (isPlaying) {
            setTimeout(() => broadcastSync('SYNC_STATE'), 300);
        }
        showToast('🟢 Someone joined the room');
    } else if (data.action === 'HERE') {
        roomMembers.add(data.senderId);
    } else if (data.action === 'LEAVE') {
        roomMembers.delete(data.senderId);
        showToast('🔴 Someone left the room');
    }
    updateListenerCount();
}

function updateListenerCount() {
    // +1 for ourselves
    const count = roomMembers.size + 1;
    listenerCountEl.innerText = count;
}

// ========================================
// SYNC LOGIC (Latency-Compensated)
// ========================================
function broadcastSync(action, extraData = {}) {
    if (!isGroupMode || !mqttClient || !ytPlayer) return;
    
    let videoId = '';
    let trackIndex = 0;
    let time = 0;
    let title = '';
    
    try { 
        const vd = ytPlayer.getVideoData();
        videoId = vd.video_id || '';
        title = vd.title || '';
    } catch (e) { }
    try { trackIndex = ytPlayer.getPlaylistIndex(); } catch (e) { }
    try { time = ytPlayer.getCurrentTime(); } catch (e) { }
    
    const payload = {
        action,
        videoId,
        trackIndex,
        time,
        title,
        senderId: myClientId,
        sentAt: Date.now(),   // Used for latency compensation
        ...extraData
    };
    
    mqttClient.publish(`${MQTT_PREFIX}/room/${currentRoom}/sync`, JSON.stringify(payload));
}

function handleSyncMessage(data) {
    if (!ytPlayer || isLocalAction) return;
    
    // Calculate network latency and compensate
    const latencyMs = Date.now() - (data.sentAt || Date.now());
    const latencySec = Math.max(0, Math.min(latencyMs / 1000, 5));
    // Add 0.15s buffer to account for YouTube's own seek processing time
    const SEEK_BUFFER = 0.15;
    const compensatedTime = (data.time || 0) + latencySec + SEEK_BUFFER;
    
    if (data.action === 'PLAY' || data.action === 'TRACK_CHANGE' || data.action === 'SYNC_STATE') {
        try {
            const currentVideoId = ytPlayer.getVideoData().video_id;
            if (data.videoId && data.videoId !== currentVideoId) {
                ytPlayer.loadVideoById(data.videoId, compensatedTime);
                if (data.action !== 'SYNC_STATE') showToast(`🎵 Now Playing: ${data.title || 'Unknown'}`);
            } else {
                const currentTime = ytPlayer.getCurrentTime() || 0;
                const drift = Math.abs(currentTime - compensatedTime);
                // Aggressive sync for initial join, normal for ongoing
                const threshold = data.action === 'SYNC_STATE' ? 0.3 : 0.5;
                if (drift > threshold) {
                    ytPlayer.seekTo(compensatedTime, true);
                }
                if (!isPlaying) ytPlayer.playVideo();
            }
        } catch (e) {
            if (data.videoId) ytPlayer.loadVideoById(data.videoId, compensatedTime);
        }
    }
    else if (data.action === 'PAUSE') {
        ytPlayer.pauseVideo();
    }
    else if (data.action === 'SEEK') {
        ytPlayer.seekTo(compensatedTime, true);
    }
    else if (data.action === 'HEARTBEAT') {
        try {
            const currentVideoId = ytPlayer.getVideoData().video_id;
            if (data.videoId && data.videoId !== currentVideoId) {
                ytPlayer.loadVideoById(data.videoId, compensatedTime);
            } else {
                const currentTime = ytPlayer.getCurrentTime() || 0;
                if (Math.abs(currentTime - compensatedTime) > 0.5) {
                    ytPlayer.seekTo(compensatedTime, true);
                }
                if (!isPlaying) ytPlayer.playVideo();
            }
        } catch (e) { }
    }
    else if (data.action === 'LOAD_VIDEO') {
        ytPlayer.loadVideoById(data.videoId, 0);
        showToast(`🎵 Now Playing: ${data.title || 'Unknown'}`);
    }
    else if (data.action === 'LOAD_PLAYLIST') {
        ytPlayer.loadPlaylist({ listType: 'playlist', list: data.playlistId, index: 0 });
        showToast(`📋 Playlist changed`);
    }
}

// ========================================
// JOIN / CREATE / LEAVE ROOM
// ========================================
function joinRoom(roomCode) {
    if (!roomCode || roomCode.length < 3) return;
    
    currentRoom = roomCode.toUpperCase();
    isGroupMode = true;
    roomMembers.clear();
    
    // Update URL
    const newurl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?room=' + currentRoom;
    window.history.pushState({ path: newurl }, '', newurl);
    
    // Update UI: hide buttons, show connected bar
    roomButtons.classList.add('hidden');
    roomConnectedBar.classList.remove('hidden');
    roomConnectedBar.classList.add('flex');
    connectedRoomCode.innerText = currentRoom;
    updateListenerCount();
    
    // Connect MQTT
    connectMQTT(currentRoom, () => {
        showToast(`✅ Connected to room ${currentRoom}`);
    });
    
    // Start heartbeat broadcast every 1.5 seconds for tightest sync
    if (syncBroadcastTimer) clearInterval(syncBroadcastTimer);
    syncBroadcastTimer = setInterval(() => {
        if (isPlaying && !isLocalAction) broadcastSync('HEARTBEAT');
    }, 1500);
    
    closeRoomModal();
}

function leaveRoom() {
    // Announce departure
    publishPresence('LEAVE');
    
    isGroupMode = false;
    currentRoom = null;
    roomMembers.clear();
    
    if (mqttClient) { mqttClient.end(true); mqttClient = null; }
    if (syncBroadcastTimer) { clearInterval(syncBroadcastTimer); syncBroadcastTimer = null; }
    
    // Reset URL
    const newurl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    window.history.pushState({ path: newurl }, '', newurl);
    
    // Update UI: show buttons, hide connected bar
    roomButtons.classList.remove('hidden');
    roomConnectedBar.classList.add('hidden');
    roomConnectedBar.classList.remove('flex');
    
    showToast('👋 Left the room — Solo mode');
}

// ========================================
// VISITOR COUNTER (GLOBAL)
// ========================================
function startVisitorTracking() {
    const visitorClient = mqtt.connect(MQTT_BROKER, {
        clientId: 'vis_' + Math.random().toString(36).substring(2, 10),
        clean: true,
        connectTimeout: 5000,
        reconnectPeriod: 5000,
        keepalive: 30
    });
    
    visitorClient.on('connect', () => {
        visitorClient.subscribe(`${MQTT_PREFIX}/visitors`);
        
        // Send heartbeat immediately and every 10 seconds
        const sendHeartbeat = () => {
            visitorClient.publish(`${MQTT_PREFIX}/visitors`, JSON.stringify({
                id: myClientId,
                ts: Date.now()
            }));
        };
        
        sendHeartbeat();
        visitorHeartbeatTimer = setInterval(sendHeartbeat, 10000);
    });
    
    visitorClient.on('message', (topic, message) => {
        try {
            const data = JSON.parse(message.toString());
            visitorMap[data.id] = data.ts;
            
            // Count visitors seen in last 30 seconds
            const now = Date.now();
            const activeVisitors = Object.values(visitorMap).filter(ts => now - ts < 30000).length;
            visitorCountEl.innerText = activeVisitors;
        } catch (e) { }
    });
    
    // Cleanup stale visitors every 15 seconds
    setInterval(() => {
        const now = Date.now();
        for (const id in visitorMap) {
            if (now - visitorMap[id] > 30000) delete visitorMap[id];
        }
    }, 15000);
}

// ========================================
// EVENT LISTENERS — ROOM MODAL
// ========================================
btnGroup.addEventListener('click', openRoomModal);
btnSolo.addEventListener('click', () => {
    // Already in solo mode, just visually confirm
    showToast('🎧 You are in Solo mode');
});
btnCancelModal.addEventListener('click', closeRoomModal);

tabCreate.addEventListener('click', () => switchTab('create'));
tabJoin.addEventListener('click', () => switchTab('join'));

btnCopyCode.addEventListener('click', () => {
    const code = generatedCodeEl.innerText;
    navigator.clipboard.writeText(code).then(() => {
        btnCopyCode.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Copied!`;
        setTimeout(() => {
            btnCopyCode.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg> Copy Code`;
        }, 2000);
    });
});

btnCreateGo.addEventListener('click', () => {
    joinRoom(generatedCodeEl.innerText);
});

btnJoinGo.addEventListener('click', () => {
    joinRoom(roomInput.value.trim());
});

roomInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinRoom(roomInput.value.trim());
});

// Force uppercase as user types
roomInput.addEventListener('input', () => {
    roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

btnCloseRoom.addEventListener('click', leaveRoom);

// Close modal on backdrop click
roomModal.addEventListener('click', (e) => {
    if (e.target === roomModal) closeRoomModal();
});

// ========================================
// POMODORO TIMER
// ========================================
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
        if (isWorkSession && !isPlaying && ytPlayer) ytPlayer.playVideo();

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

// ========================================
// AMBIENT ANIMATIONS
// ========================================
const particlesContainer = $('particles');
if (particlesContainer) {
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

// ========================================
// INIT
// ========================================
updateTimerDisplay();
init();
