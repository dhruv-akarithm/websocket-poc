// server.js - HTTP server (serves the page) + WebSocket server (real-time chat)
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = 3000;

// 1. Plain HTTP server: only job is to deliver index.html to the browser.
const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    fs.createReadStream(path.join(__dirname, "public", "index.html")).pipe(res);
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

// 2. WebSocket server attached to the same HTTP server and port.
//    A browser opens ws://localhost:3000; the HTTP "Upgrade" handshake
//    turns that connection into a persistent two-way WebSocket.
const wss = new WebSocketServer({ server });

// --- Chat history persistence -------------------------------------------
// Each chat message is appended as one JSON line to history.jsonl.
// On startup the last MAX_HISTORY messages are loaded into memory, and sent
// to every client when it connects.
const HISTORY_FILE = path.join(__dirname, "history.jsonl");
const MAX_HISTORY = 100;
let history = [];

try {
  history = fs
    .readFileSync(HISTORY_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
} catch {
  // no file yet (first run): start empty
}

// Continue numbering after the highest existing UserN so names stay unique.
let nextId =
  history.reduce((max, m) => Math.max(max, Number(/^User(\d+)$/.exec(m.from)?.[1] || 0)), 0) + 1;

function saveMessage(entry) {
  history.push(entry);
  if (history.length > MAX_HISTORY) history.shift();
  fs.appendFile(HISTORY_FILE, JSON.stringify(entry) + "\n", (err) => {
    if (err) console.error("could not save history:", err.message);
  });
}

// Send a JSON message to every connected, open client.
function broadcast(data) {
  const json = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(json);
  }
}

function broadcastUserCount() {
  broadcast({ type: "users", count: wss.clients.size });
}

// 3. Fires once per new client connection.
wss.on("connection", (socket) => {
  socket.name = "User" + nextId++;
  socket.isAlive = true;
  console.log(`${socket.name} connected (${wss.clients.size} online)`);

  // Tell only this client who they are.
  socket.send(JSON.stringify({ type: "welcome", name: socket.name }));
  socket.send(JSON.stringify({ type: "history", messages: history }));
  broadcast({ type: "system", text: `${socket.name} joined` });
  broadcastUserCount();

  // Fires every time THIS client sends a message.
  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // ignore malformed input
    }
    if (msg.type === "chat" && typeof msg.text === "string" && msg.text.trim()) {
      const entry = {
        type: "chat",
        from: socket.name,
        text: msg.text.slice(0, 500),
        ts: new Date().toISOString(),
      };
      saveMessage(entry);
      broadcast(entry);
    }
  });

  // Pong is the browser's automatic reply to our ping (heartbeat).
  socket.on("pong", () => (socket.isAlive = true));

  socket.on("close", () => {
    console.log(`${socket.name} disconnected`);
    broadcast({ type: "system", text: `${socket.name} left` });
    broadcastUserCount();
  });

  socket.on("error", (err) => console.error("socket error:", err.message));
});

// 4. Heartbeat: every 30s ping all clients; drop ones that didn't answer the
//    previous ping (dead connections such as a closed laptop lid).
setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 30000);

server.listen(PORT, () => console.log(`Open http://localhost:${PORT}`));
