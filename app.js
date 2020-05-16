// Server
//
const log = console.log.bind();
const error = console.error.bind();

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

handlers.ping = (ws, message) => {
  sendmsg(ws, { type: "pong" });
};

handlers.register = (ws, message) => {
  const { session_id } = message;

  if (session_id) {
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
  sendmsg(clients[message.target], message);
}

wss.on("connection", (ws, req) => {
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

app.use(express.static("public"));

app.get("/:session_id", (req, res) => {
  res.sendFile("index.html", { root: "public" });
});

server.listen(8080, () => {
  log("Server listening on", server.address());
});