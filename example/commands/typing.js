const self = {
  attach: (vk) => {
    vk.on('message_typing_state', ({ object }) => {
      self.onEvent(vk, object);
    });
  },
  onEvent: (vk, { from_id: fromId }) => {
    if (fromId > 0) {
      vk.callMethod('messages.setActivity', {
        peer_id: fromId,
        type: 'typing',
      });
    }
  },
};

module.exports = self;
