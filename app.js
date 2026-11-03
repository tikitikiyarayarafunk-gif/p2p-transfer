/**
 * DropBeam — WebRTC P2P File Transfer Application
 * Przesyłanie plików Peer-to-Peer bez limitów rozmiaru na Netlify i GitHub Pages.
 */

// Konfiguracja
const ID_PREFIX = 'dbeam-';
const CHUNK_SIZE = 64 * 1024; // 64 KB na pakiet
const BUFFER_THRESHOLD = 512 * 1024; // 512 KB bufor WebRTC przed spowolnieniem wysyłki
const TARGET_PASSWORD_CLEAN = 'GRIM12JHG'; // Wymagane hasło (znormalizowane: bez myślników i spacji, wielkie litery)

// Pełna konfiguracja ICE: STUN + darmowy TURN over TCP/UDP (OpenRelay)
// Dzięki temu połączenie P2P działa ZAWSZE: w szkole (OSE), między Wi-Fi a LTE, za firewallami i NAT.
const PEER_CONFIG = {
  debug: 1,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
      { urls: 'stun:relay.metered.ca:80' },
      {
        urls: 'turn:relay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:relay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:relay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ]
  }
};

// Stan aplikacji
let peer = null;
let activeConnection = null;
let myPin = null;
let stagedFiles = [];
let isSending = false;
let isReceiving = false;
let isAppInitialized = false;
let connectTimeoutTimer = null;

// Odbierane pliki: mapa id -> dane
const incomingTransfers = {};

// Elementy DOM
const myPinDisplay = document.getElementById('myPinDisplay');
const btnCopyPin = document.getElementById('btnCopyPin');
const btnCopyLink = document.getElementById('btnCopyLink');
const btnShowQr = document.getElementById('btnShowQr');
const qrModal = document.getElementById('qrModal');
const btnCloseQr = document.getElementById('btnCloseQr');
const qrCodeContainer = document.getElementById('qrCodeContainer');
const qrPinLabel = document.getElementById('qrPinLabel');

const connectForm = document.getElementById('connectForm');
const remotePinInput = document.getElementById('remotePinInput');
const btnConnect = document.getElementById('btnConnect');
const btnConnectText = document.getElementById('btnConnectText');

const globalStatusPill = document.getElementById('globalStatusPill');
const globalStatusText = document.getElementById('globalStatusText');
const connectedBanner = document.getElementById('connectedBanner');
const connectedPeerInfo = document.getElementById('connectedPeerInfo');
const btnDisconnect = document.getElementById('btnDisconnect');

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const stagedContainer = document.getElementById('stagedContainer');
const stagedList = document.getElementById('stagedList');
const fileCountBadge = document.getElementById('fileCountBadge');
const btnClearFiles = document.getElementById('btnClearFiles');
const btnStartTransfer = document.getElementById('btnStartTransfer');
const btnStartTransferText = document.getElementById('btnStartTransferText');

const activeTransferBox = document.getElementById('activeTransferBox');
const transferFileName = document.getElementById('transferFileName');
const transferPercentage = document.getElementById('transferPercentage');
const progressBarFill = document.getElementById('progressBarFill');
const transferProcessed = document.getElementById('transferProcessed');
const transferSpeed = document.getElementById('transferSpeed');
const transferEta = document.getElementById('transferEta');
const emptyTransfersState = document.getElementById('emptyTransfersState');
const receivedSection = document.getElementById('receivedSection');
const receivedList = document.getElementById('receivedList');

const toastContainer = document.getElementById('toastContainer');

// Elementy blokady hasłem
const passwordOverlay = document.getElementById('passwordOverlay');
const passwordForm = document.getElementById('passwordForm');
const passwordInput = document.getElementById('passwordInput');
const passwordError = document.getElementById('passwordError');
const btnTogglePassword = document.getElementById('btnTogglePassword');
const appContainer = document.getElementById('appContainer');

// --- Weryfikacja hasła i uwierzytelnianie ---

function normalizePassword(pwd) {
  if (!pwd) return '';
  return pwd.toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function checkPasswordMatch(input) {
  return normalizePassword(input) === TARGET_PASSWORD_CLEAN;
}

function isUserAuthenticated() {
  try {
    if (localStorage.getItem('dropbeam_auth') === 'true') return true;
    if (sessionStorage.getItem('dropbeam_auth') === 'true') return true;
  } catch (e) {
    console.warn('Dostęp do Storage zablokowany:', e);
  }

  // Sprawdź czy hasło zostało przekazane w parametrze URL ?pwd=...
  const urlParams = new URLSearchParams(window.location.search);
  const pwdParam = urlParams.get('pwd');
  if (pwdParam && checkPasswordMatch(pwdParam)) {
    markAuthenticated();
    return true;
  }
  return false;
}

function markAuthenticated() {
  try { localStorage.setItem('dropbeam_auth', 'true'); } catch (e) {}
  try { sessionStorage.setItem('dropbeam_auth', 'true'); } catch (e) {}
}

function unlockApp() {
  if (isAppInitialized) return;
  isAppInitialized = true;
  markAuthenticated();

  if (passwordOverlay) passwordOverlay.style.display = 'none';
  if (appContainer) appContainer.style.display = 'block';

  initPeer();
  setupEventListeners();

  // Rejestracja Service Workera (PWA)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('Service Worker info:', err);
    });
  }
}

// --- Inicjalizacja Aplikacji ---
window.addEventListener('DOMContentLoaded', () => {
  // Przełącznik pokazywania / ukrywania hasła
  if (btnTogglePassword && passwordInput) {
    btnTogglePassword.addEventListener('click', () => {
      if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        btnTogglePassword.textContent = '🔒';
      } else {
        passwordInput.type = 'password';
        btnTogglePassword.textContent = '👁️';
      }
    });
  }

  if (isUserAuthenticated()) {
    unlockApp();
  } else {
    if (passwordOverlay) passwordOverlay.style.display = 'flex';
    if (appContainer) appContainer.style.display = 'none';
    if (passwordInput) passwordInput.focus();

    if (passwordForm) {
      passwordForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const entered = (passwordInput.value || '').trim();
        if (checkPasswordMatch(entered)) {
          unlockApp();
        } else {
          if (passwordError) passwordError.style.display = 'block';
          const card = document.querySelector('.lock-card');
          if (card) {
            card.classList.remove('shake');
            void card.offsetWidth; // reflow
            card.classList.add('shake');
          }
          passwordInput.value = '';
          passwordInput.focus();
        }
      });
    }
  }
});

/**
 * Inicjalizacja instancji PeerJS
 */
function initPeer() {
  updateStatus('waiting', 'Inicjalizacja sieci P2P...');

  if (peer && !peer.destroyed) {
    try { peer.destroy(); } catch (e) {}
  }

  // Generowanie losowego 6-cyfrowego PINu
  const randomSixDigits = Math.floor(100000 + Math.random() * 900000).toString();
  myPin = randomSixDigits;
  const fullPeerId = ID_PREFIX + myPin;

  // Utworzenie obiektu Peer z konfiguracją TURN + STUN
  peer = new Peer(fullPeerId, PEER_CONFIG);

  peer.on('open', (id) => {
    console.log('Peer otwarty z ID:', id);
    if (myPinDisplay) myPinDisplay.textContent = formatPin(myPin);
    updateStatus('waiting', 'Gotowy do połączenia');

    // Sprawdzenie parametru w URL (?room=123456)
    checkUrlForRoom();
  });

  peer.on('connection', (conn) => {
    handleIncomingConnection(conn);
  });

  peer.on('error', (err) => {
    console.error('PeerJS Błąd:', err);
    if (err.type === 'unavailable-id') {
      setTimeout(() => initPeer(), 600);
    } else if (err.type === 'peer-unavailable') {
      showToast('Nie znaleziono urządzenia o tym PINie. Upewnij się, że strona jest tam otwarta!', 'error');
      resetConnectButton();
    } else {
      showToast('Status połączenia: ' + (err.message || err.type), 'error');
      resetConnectButton();
    }
  });

  peer.on('disconnected', () => {
    updateStatus('disconnected', 'Utracono połączenie z serwerem. Ponawianie...');
    setTimeout(() => {
      if (peer && !peer.destroyed) {
        try { peer.reconnect(); } catch (e) { initPeer(); }
      }
    }, 2000);
  });
}

/**
 * Sprawdza czy w adresie URL przekazano kod pokoju (?room=123456)
 */
function checkUrlForRoom() {
  const urlParams = new URLSearchParams(window.location.search);
  const room = urlParams.get('room');
  if (room) {
    const cleanRoom = room.replace(/\D/g, '');
    if (cleanRoom && cleanRoom !== myPin) {
      if (remotePinInput) remotePinInput.value = formatPin(cleanRoom);
      showToast(`Wykryto kod ${cleanRoom} z linku. Automatyczne łączenie...`, 'info');
      setTimeout(() => {
        connectToRemote(cleanRoom);
      }, 700);
    }
  }
}

/**
 * Buduje bezpieczny link do połączenia (z kodem pokoju i hasłem)
 */
function buildShareUrl() {
  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  const params = new URLSearchParams();
  if (myPin) params.set('room', myPin);
  params.set('pwd', 'GRIM-12JHG');
  return `${baseUrl}?${params.toString()}`;
}

/**
 * Podłączenie nasłuchu zdarzeń UI
 */
function setupEventListeners() {
  // Kopiowanie PIN
  if (btnCopyPin) {
    btnCopyPin.addEventListener('click', () => {
      if (!myPin) return;
      navigator.clipboard.writeText(myPin).then(() => {
        showToast('Skopiowano kod PIN do schowka!', 'success');
      }).catch(() => {
        showToast('PIN: ' + myPin, 'info');
      });
    });
  }

  // Kopiowanie Linku (zawiera kod PIN oraz hasło)
  if (btnCopyLink) {
    btnCopyLink.addEventListener('click', () => {
      if (!myPin) return;
      const shareUrl = buildShareUrl();
      navigator.clipboard.writeText(shareUrl).then(() => {
        showToast('Skopiowano bezpośredni link połączenia!', 'success');
      }).catch(() => {
        showToast('Skopiuj adres z paska przeglądarki.', 'info');
      });
    });
  }

  // Obsługa Kodu QR
  if (btnShowQr) {
    btnShowQr.addEventListener('click', () => {
      if (!myPin) return;
      showQrCode();
    });
  }

  if (btnCloseQr) {
    btnCloseQr.addEventListener('click', () => {
      qrModal.style.display = 'none';
    });
  }

  if (qrModal) {
    qrModal.addEventListener('click', (e) => {
      if (e.target === qrModal) qrModal.style.display = 'none';
    });
  }

  // Formatowanie pola wprowadzania PINu (dodawanie spacji po 3 cyfrach)
  if (remotePinInput) {
    remotePinInput.addEventListener('input', (e) => {
      let val = e.target.value.replace(/\D/g, '').substring(0, 6);
      if (val.length > 3) {
        val = val.substring(0, 3) + ' ' + val.substring(3);
      }
      e.target.value = val;
    });
  }

  // Formularz łączenia
  if (connectForm) {
    connectForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const pin = remotePinInput.value.replace(/\D/g, '');
      if (pin.length !== 6) {
        showToast('Wpisz poprawny 6-cyfrowy kod PIN drugiego komputera.', 'error');
        return;
      }
      if (pin === myPin) {
        showToast('Nie możesz połączyć się ze swoim własnym urządzeniem!', 'error');
        return;
      }
      connectToRemote(pin);
    });
  }

  // Rozłączanie
  if (btnDisconnect) {
    btnDisconnect.addEventListener('click', () => {
      if (activeConnection) {
        try { activeConnection.close(); } catch (e) {}
        cleanupConnection();
        showToast('Rozłączono urządzenie.', 'info');
      }
    });
  }

  // Dropzone i wybór plików
  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        addFiles(Array.from(e.dataTransfer.files));
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(Array.from(e.target.files));
      }
      fileInput.value = '';
    });
  }

  if (btnClearFiles) {
    btnClearFiles.addEventListener('click', () => {
      stagedFiles = [];
      renderStagedFiles();
    });
  }

  if (btnStartTransfer) {
    btnStartTransfer.addEventListener('click', () => {
      if (!activeConnection || !activeConnection.open) {
        showToast('Brak aktywnego połączenia z drugim komputerem!', 'error');
        return;
      }
      if (stagedFiles.length === 0) {
        showToast('Dodaj pliki przed rozpoczęciem przesyłania.', 'info');
        return;
      }
      startSendingFiles();
    });
  }
}

/**
 * Łączenie z drugim urządzeniem z zabezpieczeniem timeout
 */
function connectToRemote(targetPin) {
  if (!peer || peer.destroyed) {
    initPeer();
  }

  const cleanPin = targetPin.replace(/\D/g, '');
  const targetPeerId = ID_PREFIX + cleanPin;

  if (btnConnect) btnConnect.disabled = true;
  if (btnConnectText) btnConnectText.textContent = 'Łączenie...';
  updateStatus('waiting', `Nawiązywanie połączenia z ${formatPin(cleanPin)}...`);

  if (connectTimeoutTimer) clearTimeout(connectTimeoutTimer);

  const conn = peer.connect(targetPeerId, {
    reliable: true
  });

  setupConnection(conn, cleanPin);

  // Zabezpieczenie przed wiecznym statusem "Łączenie..."
  connectTimeoutTimer = setTimeout(() => {
    if (!activeConnection || !activeConnection.open) {
      resetConnectButton();
      updateStatus('waiting', 'Gotowy do połączenia');
      showToast('Czas oczekiwania minął. Upewnij się, że PIN jest poprawny i drugie urządzenie ma otwartą stronę.', 'error');
    }
  }, 15000);
}

/**
 * Obsługa połączenia przychodzącego
 */
function handleIncomingConnection(conn) {
  const remotePin = conn.peer.replace(ID_PREFIX, '');
  setupConnection(conn, remotePin);
  showToast(`Drugi komputer (${formatPin(remotePin)}) połączył się z Tobą!`, 'success');
}

/**
 * Konfiguracja kanału WebRTC DataConnection
 */
function setupConnection(conn, remotePin) {
  if (activeConnection && activeConnection !== conn) {
    try { activeConnection.close(); } catch (e) {}
  }
  activeConnection = conn;

  conn.on('open', () => {
    if (connectTimeoutTimer) {
      clearTimeout(connectTimeoutTimer);
      connectTimeoutTimer = null;
    }
    updateStatus('connected', `Połączono z ${formatPin(remotePin)}`);
    if (connectedBanner) connectedBanner.style.display = 'flex';
    if (connectedPeerInfo) connectedPeerInfo.textContent = `Połączono bezpośrednio z PIN: ${formatPin(remotePin)}`;
    resetConnectButton();
    updateSendButtonState();
    showToast('Połączenie P2P nawiązane pomyślnie!', 'success');
  });

  conn.on('data', (data) => {
    handleIncomingData(data);
  });

  conn.on('close', () => {
    cleanupConnection();
    showToast('Połączenie z drugim komputerem zostało zakończone.', 'info');
  });

  conn.on('error', (err) => {
    console.error('Błąd kanału danych:', err);
    showToast('Błąd połączenia: ' + (err.message || err), 'error');
    cleanupConnection();
  });

  // Monitorowanie stanu WebRTC ICE
  if (conn.peerConnection) {
    conn.peerConnection.oniceconnectionstatechange = () => {
      const state = conn.peerConnection.iceConnectionState;
      if (state === 'failed' || state === 'disconnected') {
        console.warn('ICE state:', state);
      }
    };
  }
}

function cleanupConnection() {
  if (connectTimeoutTimer) {
    clearTimeout(connectTimeoutTimer);
    connectTimeoutTimer = null;
  }
  activeConnection = null;
  updateStatus('waiting', 'Gotowy do połączenia');
  if (connectedBanner) connectedBanner.style.display = 'none';
  resetConnectButton();
  updateSendButtonState();
}

function resetConnectButton() {
  if (btnConnect) btnConnect.disabled = false;
  if (btnConnectText) btnConnectText.textContent = 'Połącz';
}

/**
 * Dodawanie plików do kolejki
 */
function addFiles(files) {
  stagedFiles = stagedFiles.concat(files);
  renderStagedFiles();
  updateSendButtonState();
}

/**
 * Renderowanie listy przygotowanych plików
 */
function renderStagedFiles() {
  if (!stagedList || !fileCountBadge || !stagedContainer) return;
  stagedList.innerHTML = '';
  fileCountBadge.textContent = `${stagedFiles.length} wybranych`;

  if (stagedFiles.length === 0) {
    stagedContainer.style.display = 'none';
    return;
  }

  stagedContainer.style.display = 'block';

  stagedFiles.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <div class="file-item-info">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span class="file-item-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
        <span class="file-item-size">${formatBytes(file.size)}</span>
      </div>
      <button class="btn-text" onclick="removeStagedFile(${index})" title="Usuń">&times;</button>
    `;
    stagedList.appendChild(item);
  });
}

window.removeStagedFile = function(index) {
  stagedFiles.splice(index, 1);
  renderStagedFiles();
  updateSendButtonState();
};

function updateSendButtonState() {
  if (!btnStartTransfer || !btnStartTransferText) return;
  if (!activeConnection || !activeConnection.open) {
    btnStartTransfer.disabled = true;
    btnStartTransferText.textContent = 'Najpierw połącz się z drugim komputerem';
  } else if (stagedFiles.length === 0) {
    btnStartTransfer.disabled = true;
    btnStartTransferText.textContent = 'Wybierz pliki do wysłania';
  } else if (isSending) {
    btnStartTransfer.disabled = true;
    btnStartTransferText.textContent = 'Trwa wysyłanie...';
  } else {
    btnStartTransfer.disabled = false;
    btnStartTransferText.textContent = `Wyślij ${stagedFiles.length} ${stagedFiles.length === 1 ? 'plik' : 'pliki'} teraz`;
  }
}

// --- Logika Wysyłania Plików ---

async function startSendingFiles() {
  if (isSending || stagedFiles.length === 0) return;
  isSending = true;
  updateSendButtonState();

  const filesToSend = [...stagedFiles];
  stagedFiles = [];
  renderStagedFiles();

  if (emptyTransfersState) emptyTransfersState.style.display = 'none';
  if (activeTransferBox) activeTransferBox.style.display = 'block';

  for (let i = 0; i < filesToSend.length; i++) {
    const file = filesToSend[i];
    await sendSingleFile(file);
  }

  isSending = false;
  updateSendButtonState();
  showToast('Wszystkie pliki zostały pomyślnie wysłane!', 'success');
  setTimeout(() => {
    if (!isReceiving && activeTransferBox) {
      activeTransferBox.style.display = 'none';
      if (receivedList && receivedList.children.length === 0 && emptyTransfersState) {
        emptyTransfersState.style.display = 'flex';
      }
    }
  }, 2500);
}

async function sendSingleFile(file) {
  const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

  if (transferFileName) transferFileName.textContent = `Wysyłanie: ${file.name}`;
  if (transferPercentage) transferPercentage.textContent = '0%';
  if (progressBarFill) progressBarFill.style.width = '0%';

  // 1. Nagłówek metadanych
  activeConnection.send({
    type: 'file-meta',
    id: fileId,
    name: file.name,
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
    totalChunks: totalChunks
  });

  let bytesSent = 0;
  let lastStatsTime = Date.now();
  let lastBytesSent = 0;

  // 2. Wysyłanie pakietów 64 KB
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const blobSlice = file.slice(start, end);
    const arrayBuffer = await blobSlice.arrayBuffer();

    await waitForBufferDrain(activeConnection);

    activeConnection.send({
      type: 'file-chunk',
      id: fileId,
      index: chunkIndex,
      data: arrayBuffer
    });

    bytesSent += (end - start);

    const now = Date.now();
    if (now - lastStatsTime >= 250 || chunkIndex === totalChunks - 1) {
      const elapsedSec = Math.max(0.05, (now - lastStatsTime) / 1000);
      const speedBytesPerSec = (bytesSent - lastBytesSent) / elapsedSec;
      lastStatsTime = now;
      lastBytesSent = bytesSent;

      const progressPercent = file.size > 0 ? Math.min(100, Math.round((bytesSent / file.size) * 100)) : 100;
      if (progressBarFill) progressBarFill.style.width = `${progressPercent}%`;
      if (transferPercentage) transferPercentage.textContent = `${progressPercent}%`;

      if (transferProcessed) transferProcessed.textContent = `${formatBytes(bytesSent)} / ${formatBytes(file.size)}`;
      if (transferSpeed) transferSpeed.textContent = `${(speedBytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;

      const remainingBytes = file.size - bytesSent;
      const remainingSec = speedBytesPerSec > 0 ? Math.round(remainingBytes / speedBytesPerSec) : 0;
      if (transferEta) transferEta.textContent = `Pozostało: ${formatDuration(remainingSec)}`;
    }
  }

  // 3. Zakończenie pliku
  activeConnection.send({
    type: 'file-done',
    id: fileId
  });

  if (progressBarFill) progressBarFill.style.width = '100%';
  if (transferPercentage) transferPercentage.textContent = '100%';
}

/**
 * Kontrola bufora WebRTC z zabezpieczeniem przed deadlockiem
 */
function waitForBufferDrain(conn) {
  return new Promise((resolve) => {
    const dc = conn.dataChannel;
    if (!dc || dc.bufferedAmount <= BUFFER_THRESHOLD) {
      resolve();
      return;
    }

    let checks = 0;
    const checkInterval = setInterval(() => {
      checks++;
      if (!dc || dc.readyState !== 'open' || dc.bufferedAmount <= BUFFER_THRESHOLD / 2 || checks > 150) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 15);
  });
}

// --- Logika Odbierania Plików ---

function handleIncomingData(message) {
  if (!message || !message.type) return;

  switch (message.type) {
    case 'file-meta':
      onReceiveMeta(message);
      break;
    case 'file-chunk':
      onReceiveChunk(message);
      break;
    case 'file-done':
      onReceiveDone(message);
      break;
  }
}

function onReceiveMeta(meta) {
  isReceiving = true;
  if (emptyTransfersState) emptyTransfersState.style.display = 'none';
  if (activeTransferBox) activeTransferBox.style.display = 'block';

  incomingTransfers[meta.id] = {
    name: meta.name,
    size: meta.size,
    mimeType: meta.mimeType,
    totalChunks: meta.totalChunks,
    chunks: new Array(meta.totalChunks),
    receivedBytes: 0,
    startTime: Date.now(),
    lastStatsTime: Date.now(),
    lastBytes: 0
  };

  if (transferFileName) transferFileName.textContent = `Pobieranie: ${meta.name}`;
  if (transferPercentage) transferPercentage.textContent = '0%';
  if (progressBarFill) progressBarFill.style.width = '0%';
  if (transferProcessed) transferProcessed.textContent = `0 B / ${formatBytes(meta.size)}`;
  if (transferSpeed) transferSpeed.textContent = '0 MB/s';
  if (transferEta) transferEta.textContent = 'Inicjowanie...';
}

function onReceiveChunk(chunkMsg) {
  const transfer = incomingTransfers[chunkMsg.id];
  if (!transfer) return;

  transfer.chunks[chunkMsg.index] = chunkMsg.data;
  const chunkBytes = (chunkMsg.data && (chunkMsg.data.byteLength || chunkMsg.data.size || chunkMsg.data.length)) || 0;
  transfer.receivedBytes += chunkBytes;

  const now = Date.now();
  if (now - transfer.lastStatsTime >= 250 || chunkMsg.index === transfer.totalChunks - 1) {
    const elapsedSec = Math.max(0.05, (now - transfer.lastStatsTime) / 1000);
    const speedBytesPerSec = (transfer.receivedBytes - transfer.lastBytes) / elapsedSec;
    transfer.lastStatsTime = now;
    transfer.lastBytes = transfer.receivedBytes;

    const progressPercent = transfer.size > 0 ? Math.min(100, Math.round((transfer.receivedBytes / transfer.size) * 100)) : 100;
    if (progressBarFill) progressBarFill.style.width = `${progressPercent}%`;
    if (transferPercentage) transferPercentage.textContent = `${progressPercent}%`;

    if (transferProcessed) transferProcessed.textContent = `${formatBytes(transfer.receivedBytes)} / ${formatBytes(transfer.size)}`;
    if (transferSpeed) transferSpeed.textContent = `${(speedBytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;

    const remainingBytes = transfer.size - transfer.receivedBytes;
    const remainingSec = speedBytesPerSec > 0 ? Math.round(remainingBytes / speedBytesPerSec) : 0;
    if (transferEta) transferEta.textContent = `Pozostało: ${formatDuration(remainingSec)}`;
  }
}

function onReceiveDone(msg) {
  const transfer = incomingTransfers[msg.id];
  if (!transfer) return;

  if (progressBarFill) progressBarFill.style.width = '100%';
  if (transferPercentage) transferPercentage.textContent = '100%';

  // Rekompozycja pliku z pakietów
  const blob = new Blob(transfer.chunks, { type: transfer.mimeType || 'application/octet-stream' });
  const downloadUrl = URL.createObjectURL(blob);

  // Pobranie pliku
  triggerDownload(downloadUrl, transfer.name);

  // Dodaj do listy odebranych plików
  addReceivedFileItem(transfer.name, transfer.size, downloadUrl);

  delete incomingTransfers[msg.id];
  isReceiving = false;
  showToast(`Plik "${transfer.name}" odebrany pomyślnie!`, 'success');

  setTimeout(() => {
    if (!isSending && !isReceiving && activeTransferBox) {
      activeTransferBox.style.display = 'none';
    }
  }, 2500);
}

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
  }, 100);
}

function addReceivedFileItem(filename, size, downloadUrl) {
  if (!receivedSection || !receivedList) return;
  receivedSection.style.display = 'block';

  const item = document.createElement('div');
  item.className = 'received-item';
  item.innerHTML = `
    <div class="file-item-info">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <div>
        <div class="received-item-name" title="${escapeHtml(filename)}">${escapeHtml(filename)}</div>
        <small style="color: var(--text-dim); font-size: 0.74rem;">${formatBytes(size)} • Zapisano na dysku</small>
      </div>
    </div>
    <a href="${downloadUrl}" download="${escapeHtml(filename)}" class="btn btn-secondary btn-sm">
      Pobierz ponownie
    </a>
  `;
  receivedList.insertBefore(item, receivedList.firstChild);
}

// --- Funkcje Pomocnicze & UI ---

function updateStatus(state, text) {
  if (!globalStatusPill || !globalStatusText) return;
  const dot = globalStatusPill.querySelector('.status-dot');
  if (dot) dot.className = `status-dot status-${state}`;
  globalStatusText.textContent = text;
}

function formatPin(pin) {
  if (!pin) return '------';
  const str = pin.toString();
  if (str.length === 6) {
    return str.substring(0, 3) + ' ' + str.substring(3);
  }
  return str;
}

function showQrCode() {
  if (!qrCodeContainer || !qrPinLabel || !qrModal) return;
  const shareUrl = buildShareUrl();
  qrCodeContainer.innerHTML = '';
  qrPinLabel.textContent = formatPin(myPin);

  new QRCode(qrCodeContainer, {
    text: shareUrl,
    width: 190,
    height: 190,
    colorDark: '#090d16',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
  });

  qrModal.style.display = 'flex';
}

function showToast(message, type = 'info') {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(seconds) {
  if (seconds <= 0 || !isFinite(seconds)) return '--';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function escapeHtml(string) {
  const div = document.createElement('div');
  div.textContent = string;
  return div.innerHTML;
}
