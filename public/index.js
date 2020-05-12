// Client
//
const $ = document.querySelector.bind(document);
const log = console.log.bind();

const ws = new WebSocket("ws://localhost:5001", "json");

const rtcConfig = {
  iceServers: [
    {
      urls: "turn:numb.viagenie.ca",
      username: "webrtc@live.com",
      credential: "muazkh",
    },
    {
      urls: "stun://stun.l.google.com:19302",
    },
  ],
};

const events = {
  users: [],
  message: [],
};

const pc = new RTCPeerConnection(rtcConfig);

pc.ontrack = ({ track, streams }) => {
  log("New track:", track);
  const remoteVideo = $(".remote-video");
  // if (remoteVideo.srcObject) return;
  remoteVideo.srcObject = streams[0];
};

function onCall(e) {
  const username = e.target.attributes["data-user"].textContent;
  log(`Calling ${username}`);

  let makingOffer = false;
  pc.onnegotiationneeded = () => {
    log("Making offer");
    try {
      makingOffer = true;
      pc.setLocalDescription().then(() =>
        send({
          type: "message",
          target: username,
          body: {
            type: "offer",
            content: pc.localDescription,
          },
        })
      );
    } catch (error) {
      console.error(error);
    } finally {
      makingOffer = false;
    }
  };

  pc.onicecandidate = ({ candidate }) =>
    send({
      type: "message",
      target: username,
      body: {
        type: "icecandidate",
        content: candidate,
      },
    });

  navigator.mediaDevices
    .getUserMedia({ video: true })
    .then((stream) => {
      log("Called side: setting media stream");
      for (const track of stream.getTracks()) pc.addTrack(track, stream);
      $(".local-video").srcObject = stream;
    })
    .catch(console.error);
}

function onMessage(data) {
  // TODO: Accept offer and send answer
  // https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation
  const { from, body } = data;
  const { type, content } = body;
  log(`${from} (${type}): ${content}`);

  // Send answer here
  if (type === "offer") {
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        log("Adding stream:", stream);
        for (const track of stream.getTracks()) pc.addTrack(track, stream);
        $(".local-video").srcObject = stream;
      })
      .catch(console.error);
    pc.setRemoteDescription(content);
    pc.setLocalDescription().then(() => {
      // send answer
      send({
        type: "message",
        target: from,
        body: {
          type: "answer",
          content: pc.localDescription,
        },
      });
    });

    pc.onicecandidate = ({ candidate }) =>
      send({
        type: "message",
        target: from,
        body: {
          type: "icecandidate",
          content: candidate,
        },
      });
  }

  if (type === "answer") {
    pc.setRemoteDescription(content);
  }

  if (type === "icecandidate") {
    if (!content) return;
    log("New icecandidate:", content);
    pc.addIceCandidate(content);
  }
}
events.message.push(onMessage);

function onGetUsers(data) {
  log("Registered users:", data.users);

  const ul = $(".user-list");
  for (username of data.users) {
    ul.insertAdjacentHTML(
      "beforeend",
      `<li>
        <span>${username}</span>
        <input type="button"
          value="call"
          data-user="${username}"
          onclick="onCall(event);">
      </li>`
    );
  }
}
events.users.push(onGetUsers);

ws.addEventListener("open", () => {
  register(ws);
  getUsers(ws);
});

ws.addEventListener("message", (message) => {
  const data = JSON.parse(message.data);
  log("Raw message:", data);

  if (data.type in events) events[data.type].forEach((f) => f(data));
});

function send(data) {
  ws.send(JSON.stringify(data));
}

function register() {
  const data = {
    type: "register",
    username: generateId(4),
  };
  send(data);
}

function getUsers() {
  const data = {
    type: "get-users",
  };
  send(data);
}

const generateId = (length) => {
  const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
  let string = "";
  for (let i = 0; i < length; i++) {
    string += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return string;
};
