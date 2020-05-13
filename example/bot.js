const { Bot } = require('../GenaBotBuilder');
const token = 'access_token';
const groupId = 12345678;

new Bot({ token })
  .attachCommands('commands')
  .logProcessErrors()
  .initLongpoll(groupId)
  .catch(console.error);
