const querystring = require('querystring');
const https = require('https');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class VK {
  constructor(apiHost, defaultData) {
    this.apiHost = apiHost;
    this.defaultData = defaultData;

    this.longpollExit = false;
    this.eventEmitter = new EventEmitter();
    this.callMethod = this.callMethod.bind(this);
  }

  httpsRequest(httpsOptions, sendDataCallback) {
    return new Promise((resolve, reject) => {
      const req = https.request(httpsOptions, (res) => {
        const buffers = [];

        res.setTimeout(30000);
        res.on('data', function onData(c) {
          buffers.push(c);
        });
        res.on('end', function onEnd() {
          if (res.statusCode === 200) {
            resolve(Buffer.concat(buffers));
            return;
          }

          reject({
            body: Buffer.concat(buffers),
            code: -res.statusCode,
          });
        });
      });

      req.setTimeout(30000);
      req.on('error', (error) => {
        reject({
          code: -1,
          ...error,
        });
      });

      sendDataCallback(req);
    }).then((data) => {
      return JSON.parse(String(data));
    });
  }

  apiRequest(httpsOptions, defaultData, method, data) {
    const repeatRequest = this.apiRequest.bind(this, ...arguments);
    const stack = new Error().stack;
    const body = querystring.stringify({ ...defaultData, ...data });

    return this.httpsRequest(httpsOptions, (req) => {
      req.end(body);
    }).then((data) => {
      if (data.error) {
        throw data.error;
      } else if (method === 'execute') {
        return data;
      }
      return data.response;
    }).catch((error) => {
      if (error.code === 6) {
        return repeatRequest();
      }

      error.stack = stack;

      if (error.error && error.error.request_params) {
        error.error.request_params = data;
      }

      throw error;
    });
  }

  callMethod(method, data) {
    return this.apiRequest({
      path: '/method/' + method,
      host: this.apiHost,
      method: 'POST',
      headers: {
        'user-agent': 'eee/im_adm_bot',
      },
    }, this.defaultData, method, data).catch((error) => {
      // eslint-disable-next-line no-throw-literal
      throw { method, data, error };
    });
  }

  on(type, listener) {
    this.eventEmitter.addListener(type, listener);
  }

  async longpoll(groupId) {
    this.longpollExit = false;

    const sendRequest = (req) => req.end();
    const listener = (event) => {
      this.eventEmitter.emit(event.type, event);
    };

    while (!this.longpollExit) {
      let { key, server, ts } = await (this.callMethod('groups.getLongPollServer', { group_id: groupId }).catch((error) => {
        console.error('getLongPollServer error', error);
        return {};
      }));

      while (!this.longpollExit && server) {
        const longpollServer = `${server}?act=a_check&key=${key}&ts=${ts}&wait=25`;
        const response = await (this.httpsRequest(longpollServer, sendRequest).catch((error) => {
          console.error('getLongPollUpdates error', error);
          return { failed: 1, error, ts };
        }));

        if (response.failed > 1) {
          break;
        }

        ts = response.ts;
        (response.updates || []).forEach(listener);
      }
    }
  }
}

class ModuleController {
  constructor(modulePath, callback) {
    this.storage = [];
    this.map = {};
    this.callback = callback;

    if (modulePath) {
      this.path = path.resolve(modulePath);
      this.loadPath(this.path);
    }
  }

  loadPath(modulePath) {
    this.path = path.resolve(modulePath);
    fs.readdirSync(this.path).forEach((moduleName) => {
      const fullPath = path.join(this.path, moduleName);
      this.reloadModule(fullPath);
    });

    return this;
  }

  getPath(moduleName) {
    const fullPath = path.join(this.path, moduleName);
    return require.resolve(fullPath);
  }

  reloadModule(moduleName) {
    const fullName = require.resolve(moduleName);
    const oldModule = require(fullName);
    const index = this.storage.indexOf(oldModule);
    let module;

    if (index > -1) {
      this.storage.splice(index, 1);
      if (oldModule.deattach) {
        oldModule.deattach();
      }
    }

    delete require.cache[fullName];
    module = require(fullName);

    if (this.callback) {
      module = this.callback(module, moduleName);
    }

    this.map[moduleName] = module;
    this.storage.push(module);

    return module;
  }
}

class Bot {
  constructor({ token, apiHost='api.vk.com', v = '5.103', lang = 'ru' }) {
    this.vk = new VK(apiHost, { access_token: token, v, lang });
  }

  logProcessErrors() {
    process.on('uncaughtException', (e) => console.error('uncaughtException', e.stack));
    process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
    return this;
  }

  initLongpoll(groupId) {
    this.vk.on('message_new', (...args) => this.onMessage(...args));
    return this.vk.longpoll(groupId);
  }

  attachCommands(commandsPath) {
    const { vk } = this;

    vk.commands = new ModuleController(commandsPath, (command, name) => {
      if (command.attach) {
        command.attach(vk, {});
      }

      command.name = name;
      return command;
    });

    return this;
  };

  onMessage({ object: { message, client_info: clientInfo } }) {
    const commandsStorage = this.vk.commands.storage;
    const text = message.text;

    message.clientInfo = clientInfo;
    this.attachMessageFunctions(message);

    commandsStorage.filter((command) => {
      return command && command.regexp && command.regexp.test(text);
    }).forEach(({ callback, regexp }) => {
      const [, ...args] = text.match(regexp) || [];
      callback.call(this, message, ...args);
    });
  };

  attachMessageFunctions(message) {
    const callAPIMethod = this.vk.callMethod;

    message.send = (messageText, data) => {
      return callAPIMethod('messages.send', {
        peer_id: message.peer_id,
        message: messageText,
        random_id: 0,
        ...data,
      });
    };
  };
}

module.exports = { Bot, VK, ModuleController };
