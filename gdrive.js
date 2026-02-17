// ─── Google Drive Configuration ─────────────────────────────────────────────
// Set your OAuth 2.0 Client ID here (Web application type, from Google Cloud Console).
// Authorized JavaScript origins must include the origin you serve this file from.
// IMPORTANT: Google OAuth does NOT work from file:// — serve this file via HTTP.
//   Quickest way:  python3 -m http.server 8080  then open http://localhost:8080
const GOOGLE_CLIENT_ID = '1019024216922-inp3es25qekbc4b8nkn8s2q9qeleeu4o.apps.googleusercontent.com';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'Accountable';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

let gAccessToken = null;
let gTokenClient = null;
let gDriveFolderId = null;
let gDriveReady = false;           // GIS library loaded + token client created
let gPendingAction = null;         // function to run after auth succeeds

// ─── Drive bootstrap ─────────────────────────────────────────────────────────
// Called from init() — waits for the GIS <script> to be ready, then wires up
// the token client.  Does NOT attempt a silent token request (GIS popup-blocker
// workaround: only call requestAccessToken inside a user-gesture handler).

function driveInit() {
    if (window.location.protocol === 'file:') {
        updateDriveStatus(false, 'Needs HTTP/HTTPS');
        console.warn('[Drive] Google OAuth does not work over file://. Use http:// or https://');
        return;
    }
    if (!GOOGLE_CLIENT_ID) {
        updateDriveStatus(false, 'No Client ID');
        console.warn('[Drive] GOOGLE_CLIENT_ID is not set');
        return;
    }
    
    // Check if script tag exists
    const existingScript = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if (!existingScript) {
        console.warn('[Drive] GIS script tag not found in DOM — injecting dynamically');
        injectGISScript(() => waitForGIS(driveCreateTokenClient));
    } else {
        waitForGIS(driveCreateTokenClient);
    }
}

function waitForGIS(cb, attempts = 0) {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
        cb();
    } else if (attempts < 50) {           // wait up to 5 s
        setTimeout(() => waitForGIS(cb, attempts + 1), 100);
    } else {
        console.error('[Drive] GIS library failed to load after 5s — trying dynamic injection');
        updateDriveStatus(false, 'Loading GIS…');
        injectGISScript(cb);
    }
}

function injectGISScript_2(cb) {
    // Dynamically inject the GIS script
    const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if (existing) {
        waitForGIS(cb, 0);
        return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
        waitForGIS(cb, 0);
    };
    script.onerror = (err) => {
        console.error('[Drive] Failed to load GIS script — network blocked, CSP, or CORS issue', err);
        updateDriveStatus(false, 'GIS blocked');
        showMessage('Could not load Google Sign-In library. Check console for errors.', 'error');
    };
    document.head.appendChild(script);
}

function injectGISScript(cb) {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = () => {
        waitForGIS(cb, 0);
    };
    script.onerror = () => {
        console.error('[Drive] Failed to load GIS library (network or CSP block)');
        updateDriveStatus(false, 'GIS load failed');
        showMessage('Could not load Google Identity Services. Check network/CSP.', 'error');
    };
    document.head.appendChild(script);
}

function driveCreateTokenClient() {
    try {
        gTokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: DRIVE_SCOPE,
            callback: handleTokenResponse,
            error_callback: (err) => {
                console.error('[Drive] token error', err);
                updateDriveStatus(false, 'Auth error');
                showMessage('Google Drive auth error: ' + (err.message || err.type), 'error');
                if (gPendingAction) { gPendingAction = null; }
            }
        });
        gDriveReady = true;
        updateDriveStatus(false, 'Drive');          // ready but not yet authed
        driveAutoLoad();                            // attempt silent load
    } catch (e) {
        updateDriveStatus(false, 'Init failed');
        console.error('[Drive] initTokenClient threw:', e);
    }
}

// ─── Token lifecycle ─────────────────────────────────────────────────────────

function handleTokenResponse(resp) {
    if (resp.error) {
        updateDriveStatus(false, 'Auth failed');
        showMessage('Google Drive: ' + resp.error, 'error');
        gPendingAction = null;
        return;
    }
    gAccessToken = resp.access_token;
    updateDriveStatus(true, 'Connected');

    if (gPendingAction) {
        const action = gPendingAction;
        gPendingAction = null;
        action();
    }
}

// Call this inside every button click handler that needs Drive access.
// If already have a token, runs fn() immediately.
// Otherwise triggers the OAuth popup (must be called from a user gesture).
function withDriveAuth(fn) {
    if (!gDriveReady) {
        showMessage('Google Drive not ready yet — please wait a moment and try again.', 'error');
        return;
    }
    if (gAccessToken) {
        fn();
        return;
    }
    gPendingAction = fn;
    gTokenClient.requestAccessToken({ prompt: 'consent' });
}

// ─── Silent auto-load on page start ─────────────────────────────────────────
// GIS supports { prompt: 'none' } only when the user has already consented.
// We use it once on startup; if it fails we just skip silently.

function driveAutoLoad() {
    if (!gDriveReady) return;
    const silentClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        prompt: '',
        callback: async (resp) => {
            if (resp.error) {
                return;           // user hasn't consented yet — that's fine
            }
            gAccessToken = resp.access_token;
            updateDriveStatus(true, 'Connected');
            try {
                await ensureFolder();
                const files = await listJsonFiles();
                const defaultFile = files.find(f => f.name === 'data.json');
                if (defaultFile) {
                    const content = await downloadFile(defaultFile.id);
                    loadLedgerFromString(content, 'data.json');
                    showMessage('Auto-loaded data.json from Google Drive');
                }
            } catch (e) {
                console.warn('[Drive] auto-load failed:', e);
            }
        }
    });
    silentClient.requestAccessToken({ prompt: 'none' });
}

// ─── Drive status indicator ──────────────────────────────────────────────────

function updateDriveStatus(connected, text) {
    const el = document.getElementById('driveStatus');
    const txt = document.getElementById('driveStatusText');
    el.className = 'drive-status' + (connected === true ? ' connected' : '');
    el.title = connected === true ? 'Google Drive connected' : (text || 'Not connected');
    txt.textContent = text || 'Drive';
}

// ─── Drive REST helpers ──────────────────────────────────────────────────────

async function driveGet(url) {
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + gAccessToken } });
    if (res.status === 401) {
        gAccessToken = null;
        updateDriveStatus(false, 'Session expired');
        throw new Error('Drive session expired — please reconnect.');
    }
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
    return json;
}

async function ensureFolder() {
    if (gDriveFolderId) return gDriveFolderId;
    const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const data = await driveGet(`${DRIVE_API}/files?q=${q}&fields=files(id,name)`);
    if (data.files && data.files.length > 0) {
        gDriveFolderId = data.files[0].id;
        return gDriveFolderId;
    }
    // Create the folder
    const res = await fetch(`${DRIVE_API}/files`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + gAccessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    });
    const folder = await res.json();
    if (folder.error) throw new Error(folder.error.message);
    gDriveFolderId = folder.id;
    return gDriveFolderId;
}

async function listJsonFiles() {
    await ensureFolder();
    const q = encodeURIComponent(`'${gDriveFolderId}' in parents and name contains '.json' and trashed=false`);
    const data = await driveGet(`${DRIVE_API}/files?q=${q}&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime desc`);
    return data.files || [];
}

async function downloadFile(fileId) {
    const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
        headers: { Authorization: 'Bearer ' + gAccessToken }
    });
    if (!res.ok) throw new Error('Download failed: ' + res.status);
    return res.text();
}

async function uploadFile(name, content, existingId = null) {
    const boundary = 'bud_' + Date.now();
    if (existingId) {
        // PATCH just the content
        const res = await fetch(`${UPLOAD_API}/files/${existingId}?uploadType=media`, {
            method: 'PATCH',
            headers: { Authorization: 'Bearer ' + gAccessToken, 'Content-Type': 'application/json' },
            body: content
        });
        const j = await res.json();
        if (j.error) throw new Error(j.error.message);
        return j;
    } else {
        // Multipart POST with metadata + body
        const meta = JSON.stringify({ name, parents: [gDriveFolderId], mimeType: 'application/json' });
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
        const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + gAccessToken, 'Content-Type': `multipart/related; boundary=${boundary}` },
            body
        });
        const j = await res.json();
        if (j.error) throw new Error(j.error.message);
        return j;
    }
}

async function renameFile(fileId, newName) {
    const res = await fetch(`${DRIVE_API}/files/${fileId}`, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer ' + gAccessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
    });
    const j = await res.json();
    if (j.error) throw new Error(j.error.message);
    return j;
}

function loadLedgerFromString(content, name) {
    try {
        const parsed = JSON.parse(content);
        ledgerData = parsed;
        ledgerData.fileName = name;
        if (!ledgerData.categories) ledgerData.categories = {};
        markSaved();
        updateUI();
    } catch (e) {
        showMessage('Error parsing file: ' + e.message, 'error');
    }
}

// ─── Open from Drive modal ───────────────────────────────────────────────────

function openDriveOpenModal() {
    document.getElementById('driveOpenModal').classList.add('active');
    document.getElementById('driveSetupNote').style.display =
        window.location.protocol === 'file:' ? 'block' : 'none';
    withDriveAuth(() => {
        loadDriveFileList();
    });
}

function closeDriveOpenModal() {
    document.getElementById('driveOpenModal').classList.remove('active');
}

async function loadDriveFileList() {
    const listEl = document.getElementById('driveFileList');
    listEl.innerHTML = '<div class="drive-empty">Loading…</div>';
    try {
        const files = await listJsonFiles();
        if (files.length === 0) {
            listEl.innerHTML = '<div class="drive-empty">No .json files found in /Accountable.</div>';
            return;
        }
        listEl.innerHTML = '';
        files.forEach(file => {
            const item = document.createElement('div');
            item.className = 'drive-file-item';
            const modified = new Date(file.modifiedTime).toLocaleDateString('en-US', {
                year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
            const kb = file.size ? (Math.round(file.size / 102.4) / 10) + ' KB' : '';
            item.innerHTML = `<div class="drive-file-name">${escapeHtml(file.name)}</div>
                                <div class="drive-file-meta">${modified}<br>${kb}</div>`;
            item.onclick = () => openDriveFile(file.id, file.name, item);
            listEl.appendChild(item);
        });
    } catch (e) {
        listEl.innerHTML = `<div class="drive-empty">Error: ${escapeHtml(e.message)}</div>`;
    }
}

async function openDriveFile(fileId, fileName, itemEl) {
    itemEl.classList.add('loading-file');
    itemEl.querySelector('.drive-file-name').textContent = 'Loading…';
    try {
        const content = await downloadFile(fileId);
        loadLedgerFromString(content, fileName);
        showMessage('Loaded ' + fileName + ' from Google Drive');
        closeDriveOpenModal();
    } catch (e) {
        showMessage('Error loading file: ' + e.message, 'error');
        itemEl.classList.remove('loading-file');
        itemEl.querySelector('.drive-file-name').textContent = fileName;
    }
}

// ─── Save to Drive modal ─────────────────────────────────────────────────────

function openDriveSaveModal() {
    document.getElementById('driveSaveFileName').value = ledgerData.fileName || 'data.json';
    updateRenamePreview();
    document.getElementById('driveSaveModal').classList.add('active');
    setTimeout(() => document.getElementById('driveSaveFileName').focus(), 100);
}

function closeDriveSaveModal() {
    document.getElementById('driveSaveModal').classList.remove('active');
}

function updateRenamePreview() {
    const checked = document.getElementById('driveRenameExisting').checked;
    const name = document.getElementById('driveSaveFileName').value.trim() || 'data.json';
    const preview = document.getElementById('driveRenamePreview');
    if (checked) {
        const base = name.replace(/\.json$/i, '');
        const today = new Date().toISOString().split('T')[0];
        preview.textContent = `Existing "${name}" will be renamed to ${base}_${today}.json`;
    } else {
        preview.textContent = `Existing "${name}" will be overwritten without backup.`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('driveSaveFileName').addEventListener('input', updateRenamePreview);
    document.getElementById('driveRenameExisting').addEventListener('change', updateRenamePreview);
});

async function executeDriveSave() {
    const name = document.getElementById('driveSaveFileName').value.trim() || 'data.json';
    const renameExisting = document.getElementById('driveRenameExisting').checked;
    const btn = document.getElementById('driveSaveBtn');

    const doSave = async () => {
        btn.textContent = 'Saving…';
        btn.disabled = true;
        try {
            await ensureFolder();
            const content = JSON.stringify(ledgerData, null, 2);
            const files = await listJsonFiles();
            const existing = files.find(f => f.name === name);

            if (existing && renameExisting) {
                const meta = await driveGet(`${DRIVE_API}/files/${existing.id}?fields=modifiedTime`);
                const modDate = new Date(meta.modifiedTime).toISOString().split('T')[0];
                const base = name.replace(/\.json$/i, '');
                const renamedTo = `${base}_${modDate}.json`;
                await renameFile(existing.id, renamedTo);
                showMessage(`Renamed old file to ${renamedTo}`);
                await uploadFile(name, content, null);     // fresh upload
            } else if (existing) {
                await uploadFile(name, content, existing.id);
            } else {
                await uploadFile(name, content, null);
            }

            ledgerData.fileName = name;
            updateFileName();
            markSaved();
            showMessage('Saved ' + name + ' to Google Drive ✓');
            closeDriveSaveModal();
        } catch (e) {
            showMessage('Error saving to Drive: ' + e.message, 'error');
            console.error('[Drive] save error', e);
        } finally {
            btn.textContent = 'Save to Drive';
            btn.disabled = false;
        }
    };

    withDriveAuth(doSave);
}