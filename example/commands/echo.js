module.exports = {
  regexp: /^\/echo (.+)$/,
  callback: (msg, text) => {
    msg.send(text);
  },
};
