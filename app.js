// Server
//
const debug = process.env.NODE_ENV !== "production";
const port = process.env.PORT || 3000;

const error = console.error.bind();
const log = console.log.bind();

const { sendmsg, generateId } = require("./utils");

const http = require("http");
const express = require("express");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = {};
const sessions = {};

const handlers = {};

handlers.register = (ws, message) => {
  const { session_id } = message;

  if (session_id && session_id in sessions) {
    // Peer B registers with invite url

    // retrieve session
    const session = sessions[session_id];

    // generate client id for peerB
    session.peerB = generateId(20);

    // register websocket for peerB
    clients[session.peerB] = ws;

    // send new_peer event to peerA
    sendmsg(clients[session.peerA], {
      type: "new_peer",
      peer_id: session.peerB,
    });

    // send new_peer event to peerB
    sendmsg(clients[session.peerB], {
      type: "new_peer",
      peer_id: session.peerA,
    });
  } else {
    // Peer A registers
    const session_id = generateId(10);

    // create a new session
    const session = (sessions[session_id] = {
      peerA: null,
      peerB: null,
    });

    // generate client id for peerA
    session.peerA = generateId(20);

    // register websocket for peerA
    clients[session.peerA] = ws;

    // send session id to peerA
    sendmsg(clients[session.peerA], {
      type: "session_id",
      session_id: session_id,
    });
  }
};

handlers.offer = forwardmsg;
handlers.answer = forwardmsg;
handlers.candidate = forwardmsg;
function forwardmsg(ws, message) {
  const target_ws = clients[message.target];
  if (!target_ws) {
    sendmsg(ws, { type: "error", error: "No peer with that id" });
    return;
  }

  sendmsg(target_ws, message);
}

wss.on("connection", (ws) => {
  ws.on("message", (rawMessage) => {
    const message = JSON.parse(rawMessage);
    const { type } = message;

    log("<", message);

    if (!type) error("No message type specified");
    else if (!(type in handlers)) error("No handler registered for", type);
    else {
      handlers[message.type](ws, message);
    }
  });
});

setInterval(
  () =>
    wss.clients.forEach((ws) => {
      ws.ping();
    }),
  30000
);

app.use(express.static("public"));

app.get("/:session_id", (req, res) => {
  const { session_id } = req.params;
  if (session_id in sessions) {
    res.sendFile("index.html", { root: "public" });
  } else res.status(404).send("The invite link is invalid.");
});

server.listen(port, () => {
  log("Server listening on", server.address());
});
