const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

module.exports.generateId = (length) => {
  let string = "";
  for (let i = 0; i < length; i++) {
    string += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return string;
};

module.exports.sendmsg = (ws, message) => {
  ws.send(JSON.stringify(message));
};
