const $ = document.querySelector.bind(document);
const log = console.log.bind();
const error = console.error.bind();
const files = {};
const send_queue = [];
const rtcConfig = {
  iceServers: [{ urls: "stun://stun.l.google.com:19302" }],
};
const websocket_url = `${location.hostname === "localhost" ? "ws" : "wss"}://${
  location.host
}`;
const ws = new WebSocket(websocket_url, "json");
const pc = new RTCPeerConnection(rtcConfig);
const handlers = {};

let polite;
let peer_id;
let invite_url;
let making_offer = false;
let ignore_offer = false;
let session_id = location.pathname.slice(1);

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
      <div role="progressbar"
        aria-valuenow="0"
        aria-valuemin="0"
        aria-valuemax="${this.size}"
        class="progress-bar file-list__item__progress">
        <div class="progress-value" style="width: 0%;"></div>
      </div>
    </li>`;
  }

  setElement(el) {
    this.element = el;
  }

  renderProgress() {
    const progress = this.element.querySelector(".progress-bar");
    const value = progress.querySelector(".progress-value");

    progress.setAttribute("aria-valuenow", this.progress);
    value.style.width = `${((this.progress / this.size) * 100).toFixed(2)}%`;
  }

  setProgress(value) {
    this.progress = value;
    this.renderProgress();
  }

  addProgress(value) {
    this.progress += value;
    this.renderProgress();
  }

  addBlob(blob) {
    this.blobs.push(blob);
  }
}

function sendmsg(message) {
  log(">", message);
  ws.send(JSON.stringify(message));
}

function update_invite_url() {
  if (session_id) invite_url = `${location.origin}/${session_id}`;
  else invite_url = "";
  $(".invite-url").textContent = invite_url;
  log("Session id updated:", session_id);
}

function insertFile(fe) {
  const file_list = $(".file-list");

  file_list.insertAdjacentHTML("afterbegin", fe.render());
  const el = file_list.firstElementChild;
  fe.setElement(el);
  log("FileElements:", files);
}

function enqueueFiles(pending_files) {
  log("Adding files to queue:", pending_files);
  // Create FileElement and add file to DOM
  for (let file of pending_files) {
    const fe = new FileElement(file.name, file.size, file.type, "outgoing");
    fe.file = file;
    insertFile(fe);
    files[fe.name] = fe;
    log("Adding file to queue:", fe);
    send_queue.push(fe.name);
  }

  flushFiles();
}

function flushFiles() {
  if (!peer_id) return;
  log("Flushing files:", send_queue);

  const fname = send_queue.pop();
  if (!fname) return;

  sendFile(files[fname]);
}

async function sendFile(fe) {
  log("Sending file:", fe);

  const msg = { name: fe.name, size: fe.file.size, type: fe.file.type };

  let chunksize = 65536;
  let offset = 0;
  let chunk;
  let progress_interval;

  const update_progress = () => {
    fe.setProgress(offset);
  };

  const sendSlice = () => {
    let c = Math.min(buffer.byteLength - offset, chunksize);
    chunk = new DataView(buffer, offset, c);
    channel.send(chunk);

    offset += c;
    fe.addProgress(c);

    if (offset >= buffer.byteLength) {
      log(`Done: ${offset} >= ${buffer.byteLength}`);
      channel.send(0);
      clearInterval(progress_interval);
      update_progress();
      return;
    }
  };

  const buffer = await fe.file.arrayBuffer();

  const channel = pc.createDataChannel(JSON.stringify(msg));
  channel.bufferedAmountLowThreshold = 65535;

  channel.onopen = () => {
    log("Send-Channel opened");
    progress_interval = setInterval(update_progress, 100);
    update_progress();
    sendSlice();
  };

  channel.onclose = () => {
    log("Send-Channel closed");
  };

  channel.onerror = (e) => error(e);

  channel.onbufferedamountlow = () => {
    sendSlice();
    update_progress();
  };
}

function recvFile(channel) {
  const msg = JSON.parse(channel.label);
  log("Receiving file:", msg);

  files[msg.name] = new FileElement(msg.name, msg.size, msg.type, "incoming");
  insertFile(files[msg.name]);

  let total = 0;
  const update_progress = () => files[msg.name].setProgress(total);
  const progress_interval = setInterval(update_progress, 100);
  update_progress();

  channel.onclose = () => {
    log("Recv-Channel closed");
  };

  channel.onerror = (e) => error(e);

  channel.onmessage = (rawMessage) => {
    if (rawMessage.data == 0) {
      log(rawMessage.data);
      log("File received");
      clearInterval(progress_interval);
      update_progress();
      processFile(files[msg.name]);
      return;
    }
    files[msg.name].addBlob(rawMessage.data);
    const c = rawMessage.data.size;
    total += c ? c : 0;
  };
}

function processFile(fe) {
  const blob = new Blob(fe.blobs);
  const url = URL.createObjectURL(blob);
  log("Object url:", url);

  fe.element.insertAdjacentHTML(
    "beforeend",
    `
  <a href="${url}" download="${fe.name}">Download</a>
  `
  );
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

$(".add-file").addEventListener("click", () => {
  const file_input = document.createElement("input");
  file_input.type = "file";
  file_input.multiple = true;
  file_input.onchange = ({ target: { files } }) => {
    log("files selected:", files);
    enqueueFiles(files);
  };
  file_input.click();
});

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

pc.onicecandidate = ({ candidate }) => {
  sendmsg({ type: "candidate", target: peer_id, candidate: candidate });
};

pc.ondatachannel = ({ channel }) => {
  channel.onopen = () => recvFile(channel);
};

handlers.error = (message) => {
  error("Error (WebSocket):", message.error);
};

handlers.session_id = (message) => {
  session_id = message.session_id;
  update_invite_url();
};

handlers.new_peer = (message) => {
  peer_id = message.peer_id;
  log("Peer id updated:", peer_id);
  flushFiles();
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
    if (err instanceof TypeError) {
    } else {
      error("Error in addIceCandidate");
      if (!ignore_offer) throw err;
    }
  }
};

ws.addEventListener("open", () => {
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

update_invite_url();
