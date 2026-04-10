const io = require('socket.io-client');
const net = require('net');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const RENDER_URL = 'https://math-bridge.onrender.com';
const MATLAB_TCP_PORT = 3001;
const NEW_SHORT_PATH = path.join(__dirname, '..', 'fresh_matlab', 'New_short.m');

console.log('🚀 Starting Local Bridge...');

// 1. Connect to Cloud (Render)
// Force WebSocket transport for better stability in cloud-to-local scenarios
const socket = io(RENDER_URL, { 
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity
});

socket.on('connect', () => {
    console.log('✅ Connected to Cloud Hub (Render)');
});

// Listen for commands from the cloud website
socket.on('command', (data) => {
    console.log('📬 Command received from Cloud:', data);
    
    // Send to MATLAB if connected
    if (matlabSocket) {
        matlabSocket.write(JSON.stringify(data) + '\n');
    }

    // Update local New_short.m
    try {
        isWritingFile = true;
        const content = `a=[${data.a}];\nb=[${data.b}];\nc= a+b;`;
        fs.writeFileSync(NEW_SHORT_PATH, content);
        setTimeout(() => { isWritingFile = false; }, 500);
        console.log('💾 Local File Synced');
    } catch (err) {
        console.error('Error writing file:', err);
    }
});

// 2. Connect to Local MATLAB (TCP)
let matlabSocket = null;

function connectToMatlab() {
    const client = new net.Socket();
    
    client.connect(MATLAB_TCP_PORT, '127.0.0.1', () => {
        console.log('✅ Connected to Local MATLAB');
        matlabSocket = client;
    });

    client.on('data', (data) => {
        try {
            const jsonStr = data.toString().trim();
            const packets = jsonStr.split('\n');
            packets.forEach(packet => {
                if (packet) {
                    const jsonData = JSON.parse(packet);
                    // Send to Cloud!
                    socket.emit('bridge_telemetry', jsonData);
                }
            });
        } catch (err) {}
    });

    client.on('close', () => {
        console.log('❌ MATLAB Disconnected. Retrying in 5s...');
        matlabSocket = null;
        setTimeout(connectToMatlab, 5000);
    });

    client.on('error', () => {});
}

connectToMatlab();

// 3. Watch New_short.m for manual edits
let isWritingFile = false;
if (fs.existsSync(NEW_SHORT_PATH)) {
    fs.watchFile(NEW_SHORT_PATH, { interval: 1000 }, (curr, prev) => {
        if (isWritingFile) return;
        if (curr.mtime <= prev.mtime) return;

        try {
            const content = fs.readFileSync(NEW_SHORT_PATH, 'utf8');
            const matchA = content.match(/a\s*=\s*\[?\s*([\d.]+)\s*\]?/i);
            const matchB = content.match(/b\s*=\s*\[?\s*([\d.]+)\s*\]?/i);

            if (matchA || matchB) {
                const data = {};
                if (matchA) data.a = parseFloat(matchA[1]);
                if (matchB) data.b = parseFloat(matchB[1]);
                
                console.log(`📂 Local Manual Edit:`, data);
                socket.emit('command', data); // Send to Cloud for broadcast
            }
        } catch (err) {}
    });
}
