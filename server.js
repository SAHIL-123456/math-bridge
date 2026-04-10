const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const net = require('net');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- STATIC FILES ---
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- TCP BRIDGE LOGIC (PORT 3001) ---
let matlabSocket = null;

const tcpServer = net.createServer((socket) => {
    console.log('✅ MATLAB Bridge Connected');
    matlabSocket = socket;

    socket.on('data', (data) => {
        try {
            const jsonStr = data.toString().trim();
            // MATLAB sends multiple JSONs separated by newline often
            const packets = jsonStr.split('\n');
            packets.forEach(packet => {
                if (packet) {
                    const jsonData = JSON.parse(packet);
                    io.emit('matlab_data', jsonData); // Send to Browser
                }
            });
        } catch (err) {
            // Silently handle incomplete JSONs
        }
    });

    socket.on('close', () => {
        console.log('❌ MATLAB Bridge Disconnected');
        matlabSocket = null;
        io.emit('status', { connected: false });
    });
});

tcpServer.listen(3001, '127.0.0.1', () => {
    console.log('🚀 TCP Bridge Listening on 127.0.0.1:3001');
});

// --- WEBSOCKET LOGIC (Browser to Server) ---
io.on('connection', (socket) => {
    console.log('🌐 Browser Connected');
    
    // Send initial status
    socket.emit('status', { connected: !!matlabSocket });

    socket.on('command', (data) => {
        if (matlabSocket) {
            // Send to MATLAB as JSON with newline
            matlabSocket.write(JSON.stringify(data) + '\n');
        }

        // --- SYNC TO FILES ---
        try {
            const freshMatlabDir = path.join(__dirname, '..', 'fresh_matlab');
            const newShortPath = path.join(freshMatlabDir, 'New_short.m');
            const newShortContent = `a=[${data.a}];\nb=[${data.b}];\nc= a+b;`;
            
            // Temporary disable watcher to avoid infinite loop when we are the ones writing
            isWritingFile = true;
            fs.writeFileSync(newShortPath, newShortContent);
            setTimeout(() => { isWritingFile = false; }, 500);

            console.log(`💾 File Updated: New_short.m (A=${data.a}, B=${data.b})`);
        } catch (err) {
            console.error('Error syncing files:', err);
        }
    });
});

// --- TWO-WAY SYNC (FILE -> WEBSITE) ---
const newShortPath = path.join(__dirname, '..', 'fresh_matlab', 'New_short.m');
let isWritingFile = false;

fs.watchFile(newShortPath, { interval: 1000 }, (curr, prev) => {
    if (isWritingFile) return;
    if (curr.mtime <= prev.mtime) return;

    try {
        const content = fs.readFileSync(newShortPath, 'utf8');
        // Robust regex: matches "a=50", "a = [50]", "a  =  50.5" etc.
        const matchA = content.match(/a\s*=\s*\[?\s*([\d.]+)\s*\]?/i);
        const matchB = content.match(/b\s*=\s*\[?\s*([\d.]+)\s*\]?/i);

        if (matchA || matchB) {
            const data = {};
            if (matchA) data.a = parseFloat(matchA[1]);
            if (matchB) data.b = parseFloat(matchB[1]);
            
            console.log(`📂 Manual Edit Detected:`, data);
            io.emit('file_sync', data); // Tell browser to update sliders
        }
    } catch (err) {
        console.error('Error reading file change:', err);
    }
});


// --- START SERVER ---
const WEB_PORT = 3000;
server.listen(WEB_PORT, () => {
    console.log(`✨ Dashboard ready at http://localhost:${WEB_PORT}`);
});
