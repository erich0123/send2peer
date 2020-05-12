// Server
//
const log = console.log.bind();
const port = 5001;
const WebSocket = require("ws");
const wss = new WebSocket.Server({ port: port });

const error = {
  format: {
    message: "Error: Malformed message",
  },
  args: {
    message: "Error: Missing an argument for this message type",
  },
};

const clients = {};

wss.on("connection", (ws, req) => {
  const data = {
    message: "Hello from server",
  };
  ws.send(JSON.stringify(data));

  ws.on("message", (message) => {
    const data = JSON.parse(message);

    if (!("type" in data)) return sendErr(ws, error.format);

    if (data.type === "register") {
      if (!("username" in data)) return sendErr(ws, error.args);
      clients[data.username] = ws;
      log(`Registered ${data.username}`);
    }

    if (data.type === "get-users") {
      sendMsg(ws, { type: "users", users: Object.keys(clients) });
    }

    if (data.type === "message") {
      let from;
      for (let name in clients)
        if (clients[name] === ws) {
          from = name;
          break;
        }

      log(`Direct message: ${from} -> ${data.target}`);
      sendMsg(clients[data.target], {
        type: "message",
        from: from,
        body: data.body,
      });
    }
  });
});

function sendErr(ws, error) {
  const data = {
    type: "error",
    error: error,
  };
  ws.send(JSON.stringify(data));
}

function sendMsg(ws, data) {
  ws.send(JSON.stringify(data));
}
