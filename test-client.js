// Quick smoke test: two clients, one sends, both should receive.
const WebSocket = require("ws");
const a = new WebSocket("ws://localhost:3000");
const b = new WebSocket("ws://localhost:3000");
let got = 0;
for (const [n, s] of [["A", a], ["B", b]]) {
  s.on("message", (d) => {
    const m = JSON.parse(d);
    console.log(n, "received:", JSON.stringify(m));
    if (m.type === "chat" && ++got === 2) process.exit(0);
  });
}
b.on("open", () => setTimeout(() => a.send(JSON.stringify({ type: "chat", text: "hello" })), 300));
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 5000);
