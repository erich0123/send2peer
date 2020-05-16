// Client
//
const $ = document.querySelector.bind(document);
const log = console.log.bind();
const error = console.error.bind();

let session_id = location.pathname.slice(1);
let invite_url;
let peer_id;
let making_offer = false;
let ignore_offer = false;
let polite;
let send_channel;
let recv_channel;
let downloading = false;

let recv_file;

const files = {};
const send_queue = [];
const recv_queue = [];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class FileElement {
  constructor(name, size, type, direction) {
    this.name = name;
    this.size = size;
    this.type = type;
    this.direction = direction;

    this.progress = 0;
    this.file = null;

    this.element = null;

    this.blobs = [];
  }

  render() {
    return `
    <li class="file-list__item ${this.direction}-file">
      <span class="file-list__item__name">${this.name}</span>
      <span class="file-list__item__type">${this.type}</span>
      <span class="file-list__item__size">${this.size}</span>
      <progress
        class="file-list__item__progress"
        value="${this.progress}"
        max="${this.size}">
      </progress>
    </li>`;
  }

  setElement(el) {
    this.element = el;
    return this;
  }

  setProgress(value) {
    this.progress = value;
    this.element.querySelector("progress").value = value;
    return this;
  }

  addProgress(value) {
    this.progress += value;
    this.element.querySelector("progress").value = this.progress;
    return this;
  }

  addBlob(blob) {
    log(`Adding blob to ${this.name}:`, blob);
    this.blobs.push(blob);
  }
}

function sendmsg(message) {
  log(">", message);
  ws.send(JSON.stringify(message));
}

update_invite_url();
function update_invite_url() {
  if (session_id) invite_url = `http://localhost:8080/${session_id}`;
  else invite_url = "";
  $(".invite-url").textContent = invite_url;
}

async function sendFiles() {
  let name;
  let message = { files: [] };
  while ((name = send_queue.pop())) {
    const file = files[name];
    log("Adding file to message:", file);
    message.files.push({
      name: file.name,
      type: file.type,
      size: file.size,
      progress: 0,
      data: [],
    });
  }

  log(">", message);
  send_channel.send(JSON.stringify(message));

  send_channel.onmessage = async (rawMessage) => {
    if (rawMessage.data != "start") return;

    // await sleep(2000);

    while ((f = message.files.pop())) {
      const file = files[f.name];
      log("Sending file:", f.name);

      let reader = file.file.stream().getReader();
      let done;
      let value;
      while (true) {
        ({ done, value } = await reader.read())
        log("Sending blob:", value);
        if (!value) break;
        send_channel.send(value);
        files[file.name].addProgress(value.length);
      }
    }
  };
}

function insertFile(fe) {
  const file_list = $(".file-list");

  file_list.insertAdjacentHTML("afterbegin", fe.render());
  const el = file_list.firstElementChild;
  fe.setElement(el);
  files[fe.name] = fe;
  log("FileElements:", files);
}

function enqueueFiles(pending_files) {
  const file_list = $(".file-list");

  log("Adding files to queue:", pending_files);
  // Create FileElement and add file to DOM
  for (file of pending_files) {
    const fe = new FileElement(file.name, file.size, file.type, "outgoing");
    fe.file = file;
    insertFile(fe);
    log("Adding file to queue:", fe);
    send_queue.push(fe.name);
  }

  if (send_channel) sendFiles();
}

function start() {
  log("Start...");

  pc.onicecandidate = ({ candidate }) => {
    sendmsg({ type: "candidate", target: peer_id, candidate: candidate });
  };

  pc.onnegotiationneeded = async () => {
    try {
      making_offer = true;
      await pc.setLocalDescription();
      sendmsg({
        type: "offer",
        target: peer_id,
        description: pc.localDescription,
      });
    } finally {
      making_offer = false;
    }
  };

  handlers.offer = async ({ description }) => {
    log("Signaling state:", pc.signalingState);
    const collision = making_offer || pc.signalingState != "stable";
    ignore_offer = collision && !polite;
    if (ignore_offer) return;

    await pc.setRemoteDescription(description);
    await pc.setLocalDescription();
    sendmsg({
      type: "answer",
      target: peer_id,
      description: pc.localDescription,
    });
  };

  handlers.answer = async ({ description }) => {
    await pc.setRemoteDescription(description);
  };

  handlers.candidate = async ({ candidate }) => {
    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      if (!ignore_offer) throw err;
    }
  };

  send_channel = pc.createDataChannel(`file-channel: ${peer_id}`);

  send_channel.onopen = (e) => {
    log(`outgoing file channel opened (${send_channel.binaryType})`);
    sendFiles();
  };

  pc.ondatachannel = (e) => {
    recv_channel = e.channel;

    recv_channel.onopen = () => {
      log(`incoming file channel opened (${e.channel.binaryType})`);
    };
    recv_channel.onmessage = async (rawMessage) => {
      if (downloading) {
        if (recv_file) {
          const blob = rawMessage.data;
          log("Received blob:", blob);

          recv_file.addBlob(blob);
          recv_file.addProgress(blob.size);

          log("Progress:", recv_file.progress);

          if (recv_file.progress >= recv_file.size) {
            log("Done!");
            recv_file = null;
            downloading = false;
          }
        } else if ((next = recv_queue.pop())) {
          log("Downloading next file:", next);
          log(files);
          recv_file = files[next.name];
          log("recv_file:", recv_file);
        } else {
          downloading = false;
        }
      } else {
        const message = JSON.parse(rawMessage.data);
        if ("files" in message) {
          downloading = true;
          recv_queue.push(...message.files);
          log(recv_queue);
          for (f of recv_queue) {
            insertFile(new FileElement(f.name, f.size, f.type, "incoming"));
          }

          recv_channel.send("start");
        }
      }
    };
  };
}

$(".invite-url__copy").addEventListener("click", ({ target: btn }) => {
  navigator.clipboard.writeText(invite_url).then(() => {
    const { textContent } = btn;
    btn.textContent = "Text copied!";
    btn.disabled = true;

    setTimeout(() => {
      btn.textContent = textContent;
      btn.disabled = false;
    }, 1000);
  });
});

$(".add-file").addEventListener("click", ({ target: btn }) => {
  const file_input = document.createElement("input");
  file_input.type = "file";
  file_input.multiple = true;
  file_input.onchange = ({ target: { files } }) => {
    log("files selected:", files);
    enqueueFiles(files);
  };
  file_input.click();
});

const rtcConfig = { iceServers: [{ urls: "stun://stun.l.google.com:19302" }] };

const ws = new WebSocket("ws://localhost:8080", "json");

const pc = new RTCPeerConnection();
const handlers = {};

handlers.pong = (message) => log("Pong!");

handlers.session_id = (message) => {
  session_id = message.session_id;
  update_invite_url();
  log("Session id updated:", session_id);
};

handlers.new_peer = (message) => {
  peer_id = message.peer_id;
  log("Peer id updated:", peer_id);
  start();
};

ws.addEventListener("open", () => {
  sendmsg({ type: "ping" });

  if (session_id) {
    sendmsg({ type: "register", session_id: session_id });
    polite = false;
  } else {
    sendmsg({ type: "register" });
    polite = true;
  }
});

ws.addEventListener("message", (rawMessage) => {
  const message = JSON.parse(rawMessage.data);
  log("<", message);

  const { type } = message;

  if (!(type in handlers)) error(`No handler for ${type}`);
  else handlers[type](message);
});
