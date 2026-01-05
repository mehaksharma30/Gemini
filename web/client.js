// Voice Gateway Client
// PCM16 mono 16kHz, 20ms frames (320 samples, 640 bytes payload)

const SAMPLE_RATE = 16000;
const SAMPLES_PER_FRAME = 320; // 20ms at 16kHz
const FRAME_DURATION_MS = 20;
const PAYLOAD_SIZE = 640; // SAMPLES_PER_FRAME * 2 (Int16 = 2 bytes)
const PACKET_SIZE = 12 + PAYLOAD_SIZE; // header (12) + payload (640)

// Jitter buffer settings
const MIN_BUFFER_PACKETS = 10; // ~200ms buffer before starting playback
const MAX_BUFFER_PACKETS = 30; // ~600ms max buffer
const LOW_BUFFER_THRESHOLD = 6; // Pause if buffer drops below this

// Downsample audio to 16kHz using linear interpolation
function downsampleTo16k(inputFloat32, inputRate) {
  if (inputRate === SAMPLE_RATE) {
    return inputFloat32;
  }

  const ratio = inputRate / SAMPLE_RATE;
  const outputLength = Math.floor(inputFloat32.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputFloat32.length - 1);
    const fraction = srcIndex - srcIndexFloor;
    
    // Linear interpolation
    output[i] = inputFloat32[srcIndexFloor] * (1 - fraction) + inputFloat32[srcIndexCeil] * fraction;
  }

  return output;
}

// State
let ws = null;
let audioContext = null;
let mediaStream = null;
let scriptProcessor = null;
let audioSource = null;
let gainNode = null;

// Audio capture state
let isMicActive = false;
let isMicMuted = false;
let isSpeakerMuted = false;
let seqCounter = 0;

// Audio playback state
let jitterBuffer = new Map(); // seq -> { timestamp, payload }
let playbackGainNode = null;
let nextPlaybackSeq = null;
let isPlaying = false;
let nextPlayTime = null; // Continuous playback scheduling cursor
let scheduledSources = new Set(); // Track all scheduled sources for cleanup

// Stats
let packetsSent = 0;
let packetsRecv = 0;
let packetsSentLastSecond = 0;
let packetsRecvLastSecond = 0;
let micCallbackCount = 0;
let micCallbackCountLastSecond = 0;

// UI elements
const elements = {
  callId: document.getElementById('callId'),
  userId: document.getElementById('userId'),
  btnConnect: document.getElementById('btnConnect'),
  btnDisconnect: document.getElementById('btnDisconnect'),
  btnStartMic: document.getElementById('btnStartMic'),
  btnStopMic: document.getElementById('btnStopMic'),
  btnToggleMicMute: document.getElementById('btnToggleMicMute'),
  btnToggleSpeakerMute: document.getElementById('btnToggleSpeakerMute'),
  statusWs: document.getElementById('statusWs'),
  statusAudioCtx: document.getElementById('statusAudioCtx'),
  statusMic: document.getElementById('statusMic'),
  statusPacketsSent: document.getElementById('statusPacketsSent'),
  statusPacketsRecv: document.getElementById('statusPacketsRecv'),
  statusJitterBuffer: document.getElementById('statusJitterBuffer'),
  logContainer: document.getElementById('logContainer'),
};

// Logging
function log(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  elements.logContainer.appendChild(entry);
  elements.logContainer.scrollTop = elements.logContainer.scrollHeight;
  console.log(`[Voice Client] ${message}`);
}

// Update status
function updateStatus() {
  // WebSocket status
  if (ws && ws.readyState === WebSocket.OPEN) {
    elements.statusWs.textContent = 'Connected';
    elements.statusWs.className = 'status-value success';
  } else {
    elements.statusWs.textContent = 'Disconnected';
    elements.statusWs.className = 'status-value error';
  }

  // Audio context status
  if (audioContext) {
    elements.statusAudioCtx.textContent = `${audioContext.sampleRate}Hz`;
    elements.statusAudioCtx.className = 'status-value success';
  } else {
    elements.statusAudioCtx.textContent = 'Not initialized';
    elements.statusAudioCtx.className = 'status-value';
  }

  // Mic status
  if (isMicActive) {
    elements.statusMic.textContent = isMicMuted ? 'Muted' : 'Active';
    elements.statusMic.className = isMicMuted ? 'status-value error' : 'status-value success';
  } else {
    elements.statusMic.textContent = 'Stopped';
    elements.statusMic.className = 'status-value';
  }

  // Packet stats
  elements.statusPacketsSent.textContent = packetsSentLastSecond;
  elements.statusPacketsRecv.textContent = packetsRecvLastSecond;
  elements.statusJitterBuffer.textContent = `${jitterBuffer.size} packets`;
  
  // Log mic callback count (dev only, in console)
  if (micCallbackCountLastSecond > 0) {
    console.log(`[Voice Client] Mic callbacks/sec: ${micCallbackCountLastSecond}`);
  }
}

// Connect to WebSocket
async function connect() {
  const callId = elements.callId.value.trim();
  const userId = elements.userId.value.trim();

  if (!callId || !userId) {
    log('Please enter Call ID and User ID', 'error');
    return;
  }

  try {
    const url = `ws://localhost:8080/?callId=${encodeURIComponent(callId)}&userId=${encodeURIComponent(userId)}`;
    log(`Connecting to ${url}...`);
    
    ws = new WebSocket(url);

    ws.onopen = () => {
      log('WebSocket connected', 'success');
      elements.btnConnect.disabled = true;
      elements.btnDisconnect.disabled = false;
      elements.btnStartMic.disabled = false;
      updateStatus();
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        // Text message (connection confirmation)
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'connected') {
            log(`Connected to call: ${msg.callId} as ${msg.userId}`, 'success');
          }
        } catch (e) {
          log(`Received text message: ${event.data}`);
        }
      } else {
        // Binary message (audio packet)
        // Convert Blob to ArrayBuffer if needed
        if (event.data instanceof Blob) {
          event.data.arrayBuffer().then(buffer => {
            handleAudioPacket(buffer);
          }).catch(error => {
            console.error('[Voice Client] Error converting Blob to ArrayBuffer:', error);
          });
        } else if (event.data instanceof ArrayBuffer) {
          handleAudioPacket(event.data);
        } else {
          console.warn('[Voice Client] Received unknown binary data type:', event.data.constructor.name);
        }
      }
    };

    ws.onerror = (error) => {
      log(`WebSocket error: ${error.message || 'Unknown error'}`, 'error');
      console.error('[Voice Client] WebSocket error:', error);
      
      // Clean up on error
      stopMic();
      
      // Stop scheduler
      if (playbackSchedulerInterval) {
        clearInterval(playbackSchedulerInterval);
        playbackSchedulerInterval = null;
      }
      
      // Stop all playback immediately
      if (scheduledSources.size > 0) {
        scheduledSources.forEach(source => {
          try {
            source.stop();
          } catch (e) {
            // Already stopped
          }
        });
        scheduledSources.clear();
      }
      
      if (playbackGainNode) {
        try {
          playbackGainNode.disconnect();
        } catch (e) {
          // Already disconnected
        }
        playbackGainNode = null;
      }
      
      // Clear jitter buffer
      jitterBuffer.clear();
      
      // Reset playback state
      isPlaying = false;
      nextPlaybackSeq = null;
      nextPlayTime = null;
    };

    ws.onclose = (event) => {
      log(`WebSocket disconnected (code: ${event.code}, reason: ${event.reason || 'none'})`, 'error');
      
      // Clean up on disconnect
      stopMic();
      
      // Stop scheduler
      if (playbackSchedulerInterval) {
        clearInterval(playbackSchedulerInterval);
        playbackSchedulerInterval = null;
      }
      
      // Stop all playback immediately
      if (scheduledSources.size > 0) {
        scheduledSources.forEach(source => {
          try {
            source.stop();
          } catch (e) {
            // Already stopped
          }
        });
        scheduledSources.clear();
      }
      
      if (playbackGainNode) {
        try {
          playbackGainNode.disconnect();
        } catch (e) {
          // Already disconnected
        }
        playbackGainNode = null;
      }
      
      // Clear jitter buffer (rxQueue)
      jitterBuffer.clear();
      
      // Reset playback state
      isPlaying = false;
      nextPlaybackSeq = null;
      nextPlayTime = null;
      
      // Stop any scheduled playback
      if (scheduledSources.size > 0) {
        scheduledSources.forEach(source => {
          try {
            source.stop();
          } catch (e) {
            // Already stopped
          }
        });
        scheduledSources.clear();
      }
      
      elements.btnConnect.disabled = false;
      elements.btnDisconnect.disabled = true;
      elements.btnStartMic.disabled = true;
      elements.btnStopMic.disabled = true;
      updateStatus();
    };
  } catch (error) {
    log(`Connection error: ${error.message}`, 'error');
  }
}

// Disconnect
function disconnect() {
  stopMic();
  
  // Stop scheduler
  if (playbackSchedulerInterval) {
    clearInterval(playbackSchedulerInterval);
    playbackSchedulerInterval = null;
  }
  
  // Stop all playback
  if (scheduledSources.size > 0) {
    scheduledSources.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Already stopped
      }
    });
    scheduledSources.clear();
  }
  
  if (playbackGainNode) {
    try {
      playbackGainNode.disconnect();
    } catch (e) {
      // Already disconnected
    }
    playbackGainNode = null;
  }
  
  // Clear jitter buffer
  jitterBuffer.clear();
  
  // Reset playback state
  isPlaying = false;
  nextPlaybackSeq = null;
  nextPlayTime = null;
  
  if (ws) {
    ws.close();
    ws = null;
  }
  updateStatus();
}

// Handle incoming audio packet
function handleAudioPacket(data) {
  // Ensure data is ArrayBuffer
  let arrayBuffer;
  if (data instanceof ArrayBuffer) {
    arrayBuffer = data;
  } else if (data.buffer instanceof ArrayBuffer) {
    arrayBuffer = data.buffer;
  } else {
    console.warn('[Voice Client] Invalid data type for audio packet:', typeof data);
    return;
  }

  if (!arrayBuffer || arrayBuffer.byteLength !== PACKET_SIZE) {
    log(`Invalid packet size: ${arrayBuffer?.byteLength || 'undefined'} (expected ${PACKET_SIZE})`, 'error');
    return;
  }

  try {
    const view = new DataView(arrayBuffer);
    const seq = view.getUint32(0, true); // Little-endian
    const timestampMs = Number(view.getBigUint64(4, true)); // Little-endian
    const payload = arrayBuffer.slice(12); // 640 bytes

    packetsRecv++;
    packetsRecvLastSecond++;

    // Add to jitter buffer
    jitterBuffer.set(seq, { timestamp: timestampMs, payload });

    // Process jitter buffer
    processJitterBuffer();
  } catch (error) {
    console.error('[Voice Client] Error parsing audio packet:', error);
  }
}

// Process jitter buffer and play audio
let playbackSchedulerInterval = null;

function processJitterBuffer() {
  if (!audioContext) return;

  // Check if we should start playback
  if (!isPlaying) {
    if (jitterBuffer.size >= MIN_BUFFER_PACKETS) {
      // Initialize playback
      const seqs = Array.from(jitterBuffer.keys()).sort((a, b) => a - b);
      nextPlaybackSeq = seqs[0];
      nextPlayTime = audioContext.currentTime + 0.20; // 200ms initial delay
      isPlaying = true;
      log(`Starting playback from seq ${nextPlaybackSeq} (buffer: ${jitterBuffer.size} packets)`);
      
      // Start periodic scheduler (every 20ms)
      if (!playbackSchedulerInterval) {
        playbackSchedulerInterval = setInterval(() => {
          scheduleNextPacket();
        }, 20); // Schedule one packet every 20ms
      }
    } else {
      return; // Wait for more packets
    }
  }

  // Check if we should pause playback
  if (isPlaying && jitterBuffer.size < LOW_BUFFER_THRESHOLD) {
    // Stop scheduler
    if (playbackSchedulerInterval) {
      clearInterval(playbackSchedulerInterval);
      playbackSchedulerInterval = null;
    }
    
    // Stop all scheduled sources
    scheduledSources.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Already stopped
      }
    });
    scheduledSources.clear();
    isPlaying = false;
    nextPlaybackSeq = null;
    nextPlayTime = null;
    log('Playback paused (low buffer)', 'error');
    return;
  }

  // Limit buffer size (remove oldest if too many)
  if (jitterBuffer.size > MAX_BUFFER_PACKETS) {
    const seqs = Array.from(jitterBuffer.keys()).sort((a, b) => a - b);
    const toRemove = seqs.slice(0, seqs.length - MAX_BUFFER_PACKETS);
    toRemove.forEach(seq => jitterBuffer.delete(seq));
    // Update nextPlaybackSeq if we removed packets before it
    if (nextPlaybackSeq !== null && toRemove.includes(nextPlaybackSeq)) {
      const remainingSeqs = Array.from(jitterBuffer.keys()).sort((a, b) => a - b);
      nextPlaybackSeq = remainingSeqs.length > 0 ? remainingSeqs[0] : null;
    }
  }
}

// Schedule next packet (called periodically)
function scheduleNextPacket() {
  if (!isPlaying || !audioContext || jitterBuffer.size < LOW_BUFFER_THRESHOLD) {
    return;
  }

  // Check if we have the next packet
  if (jitterBuffer.has(nextPlaybackSeq)) {
    const packet = jitterBuffer.get(nextPlaybackSeq);
    jitterBuffer.delete(nextPlaybackSeq);
    
    // Schedule this packet
    scheduleAudioChunk(packet.payload);
    nextPlaybackSeq++;
  } else {
    // Missing packet - skip to next available
    const seqs = Array.from(jitterBuffer.keys()).sort((a, b) => a - b);
    if (seqs.length > 0) {
      // Skip to next available sequence
      nextPlaybackSeq = seqs[0];
    } else if (jitterBuffer.size < LOW_BUFFER_THRESHOLD) {
      // Buffer too low, pause
      if (playbackSchedulerInterval) {
        clearInterval(playbackSchedulerInterval);
        playbackSchedulerInterval = null;
      }
      scheduledSources.forEach(source => {
        try {
          source.stop();
        } catch (e) {
          // Already stopped
        }
      });
      scheduledSources.clear();
      isPlaying = false;
      nextPlaybackSeq = null;
      nextPlayTime = null;
    }
  }
}

// Schedule audio chunk for continuous playback
function scheduleAudioChunk(pcmData) {
  if (!audioContext || isSpeakerMuted || !isPlaying) {
    return;
  }

  try {
    // Convert Int16 PCM to Float32
    const int16Array = new Int16Array(pcmData);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7FFF);
    }

    // Create audio buffer
    const buffer = audioContext.createBuffer(1, float32Array.length, SAMPLE_RATE);
    buffer.copyToChannel(float32Array, 0);

    // Create gain node if needed
    if (!playbackGainNode) {
      playbackGainNode = audioContext.createGain();
      playbackGainNode.connect(audioContext.destination);
    }

    // Ensure nextPlayTime is not in the past
    const now = audioContext.currentTime;
    if (nextPlayTime < now) {
      nextPlayTime = now + 0.05; // Small catch-up delay
    }

    // Create source and schedule
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(playbackGainNode);
    source.start(nextPlayTime);

    // Track scheduled source for cleanup
    scheduledSources.add(source);

    // Update next play time (20ms = 0.02 seconds)
    nextPlayTime += 0.02;

    // Clean up when source ends
    source.onended = () => {
      scheduledSources.delete(source);
    };
  } catch (error) {
    log(`Error scheduling audio: ${error.message}`, 'error');
  }
}

// Start microphone
async function startMic() {
  if (isMicActive) {
    log('Microphone already active', 'error');
    return;
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    log('WebSocket not connected', 'error');
    return;
  }

  try {
    // Initialize audio context
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const actualSampleRate = audioContext.sampleRate;
      log(`Audio context initialized: ${actualSampleRate}Hz`);
      
      if (actualSampleRate !== SAMPLE_RATE) {
        log(`Warning: Sample rate mismatch. Input: ${actualSampleRate}Hz, Target: ${SAMPLE_RATE}Hz. Will downsample.`, 'error');
      }
      
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
    }

    // Get user media
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    log('Microphone access granted', 'success');

    // Create audio source and processor
    audioSource = audioContext.createMediaStreamSource(mediaStream);
    
    // Use ScriptProcessorNode (deprecated but works everywhere)
    // TODO: Replace with AudioWorklet for production
    scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

    const inputSampleRate = audioContext.sampleRate;
    let txAcc = new Float32Array(0); // Transmit accumulator

    scriptProcessor.onaudioprocess = (e) => {
      // Increment callback counter
      micCallbackCount++;
      
      // Only block if mic is muted or WebSocket is not open
      if (isMicMuted || !ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }

      const inputData = e.inputBuffer.getChannelData(0);
      
      // Downsample if needed
      let processedData = inputData;
      if (inputSampleRate !== SAMPLE_RATE) {
        processedData = downsampleTo16k(inputData, inputSampleRate);
      }
      
      // Append to accumulator
      const newAcc = new Float32Array(txAcc.length + processedData.length);
      newAcc.set(txAcc, 0);
      newAcc.set(processedData, txAcc.length);
      txAcc = newAcc;

      // Process complete frames (320 samples each)
      while (txAcc.length >= SAMPLES_PER_FRAME) {
        // Extract exactly 320 samples
        const frame = txAcc.slice(0, SAMPLES_PER_FRAME);
        txAcc = txAcc.slice(SAMPLES_PER_FRAME);

        // Convert Float32 to Int16
        const pcm16 = new Int16Array(SAMPLES_PER_FRAME);
        for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
          const sample = Math.max(-1, Math.min(1, frame[i]));
          pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }

        // Create packet
        const packet = new ArrayBuffer(PACKET_SIZE);
        const view = new DataView(packet);
        const timestamp = Date.now();

        view.setUint32(0, seqCounter, true); // seq (LE)
        view.setBigUint64(4, BigInt(timestamp), true); // timestamp (LE)
        
        // Copy PCM payload
        const pcmBytes = new Uint8Array(pcm16.buffer);
        new Uint8Array(packet, 12).set(pcmBytes);

        // Send packet as binary
        try {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(packet);
            packetsSent++;
            packetsSentLastSecond++;
            seqCounter++;
          }
        } catch (error) {
          console.error('[Voice Client] Error sending packet:', error);
          break; // Stop processing if send fails
        }
      }
    };

    // Connect processor to zero-gain node to prevent feedback/echo
    // DO NOT connect to audioContext.destination (causes echo)
    const zeroGain = audioContext.createGain();
    zeroGain.gain.value = 0; // Silent output
    audioSource.connect(scriptProcessor);
    scriptProcessor.connect(zeroGain);
    zeroGain.connect(audioContext.destination);

    isMicActive = true;
    elements.btnStartMic.disabled = true;
    elements.btnStopMic.disabled = false;
    elements.btnToggleMicMute.disabled = false;
    elements.btnToggleSpeakerMute.disabled = false;

    log('Microphone started', 'success');
    updateStatus();
  } catch (error) {
    log(`Failed to start microphone: ${error.message}`, 'error');
    console.error(error);
  }
}

// Stop microphone
function stopMic() {
  if (!isMicActive) {
    return;
  }

  if (scriptProcessor) {
    scriptProcessor.disconnect();
    scriptProcessor = null;
  }

  if (audioSource) {
    audioSource.disconnect();
    audioSource = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  isMicActive = false;
  isMicMuted = false;
  // Note: Don't reset isSpeakerMuted here - let user control it

  // Reset mic callback counter
  micCallbackCount = 0;
  micCallbackCountLastSecond = 0;

  elements.btnStartMic.disabled = false;
  elements.btnStopMic.disabled = true;
  elements.btnToggleMicMute.disabled = true;
  elements.btnToggleSpeakerMute.disabled = true;
  elements.btnToggleMicMute.textContent = 'Mic: Unmuted';
  // Note: Keep speaker mute state

  log('Microphone stopped');
  updateStatus();
}

// Toggle mic mute
function toggleMicMute() {
  isMicMuted = !isMicMuted;
  elements.btnToggleMicMute.textContent = `Mic: ${isMicMuted ? 'Muted' : 'Unmuted'}`;
  log(`Microphone ${isMicMuted ? 'muted' : 'unmuted'}`);
  updateStatus();
}

// Toggle speaker mute
function toggleSpeakerMute() {
  isSpeakerMuted = !isSpeakerMuted;
  elements.btnToggleSpeakerMute.textContent = `Speaker: ${isSpeakerMuted ? 'Muted' : 'Unmuted'}`;
  
  if (playbackGainNode) {
    playbackGainNode.gain.value = isSpeakerMuted ? 0 : 1;
  }
  
  log(`Speaker ${isSpeakerMuted ? 'muted' : 'unmuted'}`);
  updateStatus();
}

// Event listeners
elements.btnConnect.addEventListener('click', connect);
elements.btnDisconnect.addEventListener('click', disconnect);
elements.btnStartMic.addEventListener('click', startMic);
elements.btnStopMic.addEventListener('click', stopMic);
elements.btnToggleMicMute.addEventListener('click', toggleMicMute);
elements.btnToggleSpeakerMute.addEventListener('click', toggleSpeakerMute);

// Update stats every second
setInterval(() => {
  packetsSentLastSecond = 0;
  packetsRecvLastSecond = 0;
  micCallbackCountLastSecond = micCallbackCount;
  micCallbackCount = 0; // Reset counter
  updateStatus();
}, 1000);

// Initial status update
updateStatus();
log('Voice Gateway Client ready');

