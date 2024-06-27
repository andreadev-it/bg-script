(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";

var _BackgroundHandler = _interopRequireDefault(require("./src/BackgroundHandler.js"));
var _BackgroundScript = _interopRequireDefault(require("./src/BackgroundScript.js"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
// Makes these classes globally available 
globalThis.BackgroundHandler = _BackgroundHandler.default;
globalThis.BackgroundScript = _BackgroundScript.default;

},{"./src/BackgroundHandler.js":2,"./src/BackgroundScript.js":3}],2:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _CustomEventTarget = _interopRequireDefault(require("./CustomEventTarget.js"));
var _Connection = require("./Connection.js");
var _Errors = require("./Errors.js");
var _utilities = require("./utilities.js");
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
const STORED_CONNECTIONS_KEY = "bgscript.connections";

/** 
 * Class that will handle all the content scripts that will connect to the background script.
 */
class BackgroundHandler extends _CustomEventTarget.default {
  /**
   * Creates a new Background Handler and starts listening to new connections.
   * 
   * @param {object} exposedData An object containing all properties and methods to be exposed to the content scripts
   * @param {object} options An object that will customize how this class works.
   */
  constructor(exposedData = {}, options = {}) {
    var _options$errorCallbac, _options$runtime, _options$storage, _options$chromeTabs;
    super();

    /** @type {Map<string, Connection>} scriptConnections A Map that will relate every script ID to its Connection object. */
    this.scriptConnections = new Map(); // script-id --> connection
    /** @property {object} exposedData The properties and methods exposed to the connecting scripts. */
    this.exposedData = exposedData;
    /** @property {function} errorCallback A callback that gets fired whenever there is an error in the script. It will get passed some details about the error. */
    this.errorCallback = (_options$errorCallbac = options.errorCallback) !== null && _options$errorCallbac !== void 0 ? _options$errorCallbac : null;

    /** @property {chrome.runtime} runtime The runtime that will be used to create the connections. */
    this.runtime = (_options$runtime = options.runtime) !== null && _options$runtime !== void 0 ? _options$runtime : chrome.runtime;
    this.storage = (_options$storage = options.storage) !== null && _options$storage !== void 0 ? _options$storage : chrome.storage;
    this.chromeTabs = (_options$chromeTabs = options.chromeTabs) !== null && _options$chromeTabs !== void 0 ? _options$chromeTabs : chrome.tabs;

    /** @property {bool} isRestoringConnections */
    this.isRestoringConnections = false;
    this.runtime.onConnect.addListener(port => this.handleNewConnection(port));
    this.restoreConnections();
  }

  /**
   * Restore all the connections that were saved in the storage.
   */
  async restoreConnections() {
    console.log("Restoring scripts connections");
    this.isRestoringConnections = true;
    let data = await this.storage.local.get(STORED_CONNECTIONS_KEY);
    let connected = [];
    if (data[STORED_CONNECTIONS_KEY]) {
      let connections = data[STORED_CONNECTIONS_KEY];
      for (let [scriptId, tab] of connections) {
        try {
          await this.chromeTabs.sendMessage(tab, {
            type: _Connection.CONNECTION_PREFIX + "ping",
            scriptId
          });
          connected.push([scriptId, tab]);
        } catch (_unused) {
          console.log(`Could not connect to tab ${tab}. Skipping.`);
        }
      }
    }
    await this.storage.local.set({
      [STORED_CONNECTIONS_KEY]: connected
    });
    this.isRestoringConnections = false;
    console.log("Finished restoring connections");
  }

  /**
   * Waits for all connections to be restored. Useful to avoid returning
   * the wrong number of connections from the "getScriptConnection" of
   * "getScriptTabs" functions.
   *
   * @returns {Promise<void>} A promise that is resolved when the restoration is finished
   */
  async waitForRestoration() {
    while (this.isRestoringConnections) {
      await (0, _utilities.waitForNextTask)();
    }
  }

  /**
   * Save the current connections in the storage
   */
  async saveConnections() {
    let conns = [];
    for (let [scriptId, _] of this.scriptConnections) {
      let [name, tabId] = scriptId.split("-");
      conns.push([name, parseInt(tabId)]);
    }
    await this.storage.local.set({
      [STORED_CONNECTIONS_KEY]: conns
    });
  }

  /**
   * Handle a new incoming connection
   * 
   * @param {chrome.runtime.Port} port The newly created connection to a content script
   */
  async handleNewConnection(port) {
    var _port$sender$tab$id, _port$sender;
    if (!this.isInternalConnection(port)) return;
    let [name, scriptId] = this.parsePortName(port);
    let tabId = (_port$sender$tab$id = (_port$sender = port.sender) === null || _port$sender === void 0 || (_port$sender = _port$sender.tab) === null || _port$sender === void 0 ? void 0 : _port$sender.id) !== null && _port$sender$tab$id !== void 0 ? _port$sender$tab$id : null;
    if (tabId == -1) tabId = null;

    // If the script id is already taken, terminate the connection and send an error
    if (this.scriptConnections.get(scriptId)) {
      port.disconnect();
      return this.handleError(_Errors.BgHandlerErrors.ID_TAKEN, scriptId);
    }

    // In the background script, there is no tab-id associated
    let connectionOptions = {
      hasTabId: false
    };
    let connection = new _Connection.Connection(port, this.exposedData, connectionOptions);

    // TODO: Check if I have to set the script connection to null on this event
    // see BackgroundScript.js:68
    connection.addListener("disconnect", () => this.disconnectScript(name, tabId));
    this.scriptConnections.set(scriptId, connection);
    await this.saveConnections();

    // Fire the connection event
    this.fireEvent("connectionreceived", {
      scriptId: name,
      tabId
    });
  }

  /**
   * Checks if the connection was initialized from this library
   * 
   * @param {chrome.runtime.Port} port The connection 
   */
  isInternalConnection(port) {
    return port.name.startsWith(_Connection.CONNECTION_PREFIX) || port.name.startsWith(_Connection.CONNECTION_PREFIX_NOTAB);
  }

  /**
   * Check if the connection should not be related to any chrome tab
   * 
   * @param {chrome.runtime.Port} port The connection
   */
  isTabAgnostic(port) {
    return port.name.startsWith(_Connection.CONNECTION_PREFIX_NOTAB);
  }

  /**
   * Parse the port name and extracts a unique identifier (the script id).
   * 
   * @param {chrome.runtime.Port} port The connection
   * @returns {string} The script id
   */
  parsePortName(port) {
    let scriptId, tabId, completeScriptId;
    if (this.isTabAgnostic(port)) {
      scriptId = port.name.substr(_Connection.CONNECTION_PREFIX_NOTAB.length);
    } else {
      var _port$sender2;
      scriptId = port.name.substr(_Connection.CONNECTION_PREFIX.length);
      tabId = port === null || port === void 0 || (_port$sender2 = port.sender) === null || _port$sender2 === void 0 || (_port$sender2 = _port$sender2.tab) === null || _port$sender2 === void 0 ? void 0 : _port$sender2.id;
    }
    completeScriptId = this.generateScriptId(scriptId, tabId);
    return [scriptId, completeScriptId];
  }

  /**
   * Generate a script id to be used within the connections map
   * 
   * @param {string} name 
   * @param {number} tabId 
   * @returns {string} The generated script id
   */
  generateScriptId(name, tabId) {
    let scriptId = name;
    if (tabId) {
      scriptId += `-${tabId}`;
    }
    return scriptId;
  }

  /**
   * Disconnect a script based on its id 
   * 
   * @param {string} id
   */
  disconnectScript(name, tabId) {
    let id = this.generateScriptId(name, tabId);
    let conn = this.scriptConnections.get(id);

    // Disconnect the script if it hasn't disconnected yet
    if (conn) {
      conn.disconnect();
    }

    // Remove the script in the connections map
    this.scriptConnections.delete(id);
    // Fire the disconnection event
    this.fireEvent("connectionended", {
      scriptId: name,
      tabId
    });
  }

  /**
   * Get the connection to a script based on its id and the chrome tab that it's associated with.
   * 
   * @async
   * @param {string} scriptId The id of the script to which you want to get a connection
   * @param {string} tabId The id of the chrome tab this scripts relates to
   * @return {Promise<Proxy>} The connection proxy
   */
  async getScriptConnection(scriptId, tabId) {
    await this.waitForRestoration();
    let specificScriptId = scriptId;
    if (tabId) specificScriptId += `-${tabId}`;
    let connection = this.scriptConnections.get(specificScriptId);
    if (!connection) {
      this.handleError(_Errors.BgHandlerErrors.NO_CONNECTION, scriptId, tabId);
      return null;
    }
    let proxy = await connection.getProxy();
    return proxy;
  }

  /**
   * Get all tab ids where a specific scriptId is present.
   *
   * @param {string} scriptId
   * @returns {number[]} The tab IDs
   */
  async getScriptTabs(scriptId) {
    await this.waitForRestoration();
    let tabs = [];
    for (let [id, connection] of this.scriptConnections) {
      if (id.startsWith(scriptId)) {
        var _connection$port$send;
        if ((_connection$port$send = connection.port.sender) !== null && _connection$port$send !== void 0 && (_connection$port$send = _connection$port$send.tab) !== null && _connection$port$send !== void 0 && _connection$port$send.id) {
          tabs.push(connection.port.sender.tab.id);
        }
      }
    }
    return tabs;
  }

  /**
   * Check if a script with a specific id associated to a specific tab has made a connection to the background page.
   * 
   * @param {string} scriptId 
   * @param {string} tabId 
   * @returns Whether the script is connected
   */
  hasConnectedScript(scriptId, tabId) {
    let specificScriptId = scriptId;
    if (tabId) specificScriptId += `-${tabId}`;
    return this.scriptConnections.has(specificScriptId);
  }

  /**
   * Handle the errors thrown within the class
   * 
   * @param {Error} error 
   * @param  {...any} args 
   * @returns 
   */
  handleError(error, ...args) {
    if (this.errorCallback) {
      this.errorCallback({
        errorId: error.id,
        error: error.getText(...args)
      });
      return;
    }
    console.error(error.getText(...args));
  }
}
var _default = exports.default = BackgroundHandler;

},{"./Connection.js":4,"./CustomEventTarget.js":5,"./Errors.js":6,"./utilities.js":7}],3:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _CustomEventTarget = _interopRequireDefault(require("./CustomEventTarget.js"));
var _Connection = require("./Connection.js");
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
/** 
 * Class that will handle the connection from a content script to the background script
 * 
 * @property {string} scriptId A string that uniquely identifies this script file (could be in the context of a chrome tab or globally, depending on the context property).
 * @property {Object} exposedData An object containing all properties and methods to be exposed to the background script.
 * @property {Connection} connection The actual connection object that handles the communications with the background script.
 * @property {string} context The context of this script. 
 */
class BackgroundScript extends _CustomEventTarget.default {
  /**
   * It creates a new Background Script class and initialize all the class properties. It will also bootstrap the actual connection.
   * 
   * @param {string} scriptId A unique ID to identify this script
   * @param {Object} exposedData An object containing all properties and methods to be exposed to the background script
   * @param {Object} options
   * @param {string} options.context The context of this content script. It can have three values:
   *                                     "content" - To be used in content scripts.
   *                                     "devtools" - To be used in scripts that run from the devtools.
   *                                     "tab-agnostic" - To be used in scripts that are not related to any tab, and are unique in your extension.
   */
  constructor(scriptId, exposedData = {}, options = {
    context: "content",
    runtime: chrome.runtime
  }) {
    var _options$context, _options$runtime;
    super();
    this.scriptId = scriptId !== null && scriptId !== void 0 ? scriptId : this._uuidv4();
    this.connection = null;
    this.exposedData = exposedData;
    this.context = (_options$context = options.context) !== null && _options$context !== void 0 ? _options$context : "content";
    this.runtime = (_options$runtime = options.runtime) !== null && _options$runtime !== void 0 ? _options$runtime : chrome.runtime;
    this.connectBackgroundScript();
    this.checkForReconnection();
  }

  /**
   * Creates a connection to the background script based on the script context. It initializes the "connection" property.
   */
  connectBackgroundScript() {
    let completeScriptId = "";
    switch (this.context) {
      case "content":
        completeScriptId = _Connection.CONNECTION_PREFIX + this.scriptId;
        break;
      case "devtools":
        if (!chrome.devtools) throw "Cannot set context='devtools' when the script is not in a devtools window.";
        completeScriptId = _Connection.CONNECTION_PREFIX_NOTAB + this.scriptId + "-" + chrome.devtools.inspectedWindow.tabId;
        break;
      case "tab-agnostic":
        completeScriptId = this.scriptId;
        break;
    }
    let port = this.runtime.connect({
      name: completeScriptId
    });
    this.connection = new _Connection.Connection(port, this.exposedData);
    this.connection.addListener("disconnect", () => {
      // TODO: Check if I should set the connection to null to avoid
      // wrong call to port.disconnect in the next function
      this.connection = null;
      this.disconnectBackgroundScript();
    });
    window.addEventListener("beforeunload", () => {
      this.disconnectBackgroundScript();
    });
    this.fireEvent("connected", {});
  }

  /**
   * Function to disconnect this script
   */
  disconnectBackgroundScript() {
    if (this.connection) {
      this.connection.disconnect();
    }
    this.connection = null;
    this.fireEvent("disconnected", {});
  }

  /**
   * Function to retrieve the connection proxy.
   * 
   * @async
   * @return {Promise<Proxy>}
   */
  async getConnection() {
    if (!this.connection) {
      this.connectBackgroundScript();
    }
    let proxy = await this.connection.getProxy();
    return proxy;
  }

  /**
   * Check if the background script is pinging us
   */
  checkForReconnection() {
    this.runtime.onMessage.addListener(async (req, sender, sendResponse) => {
      if (this.connection != null) return;
      if (req.type == _Connection.CONNECTION_PREFIX + "ping") {
        if (req.scriptId == this.scriptId) {
          this.connectBackgroundScript();
        }
      }
    });
  }

  /**
   * Function that returns a uuid version 4 formatted string.
   * 
   * @return {string} the id.
   */
  _uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0,
        v = c == 'x' ? r : r & 0x3 | 0x8;
      return v.toString(16);
    });
  }
}
var _default = exports.default = BackgroundScript;

},{"./Connection.js":4,"./CustomEventTarget.js":5}],4:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.MESSAGE_TYPES = exports.Connection = exports.CONNECTION_PREFIX_NOTAB = exports.CONNECTION_PREFIX = void 0;
var _CustomEventTarget = _interopRequireDefault(require("./CustomEventTarget.js"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
/** @constant {string} CONNECTION_PREFIX A prefix added to the connection port name to recognize a connection from within the bgscript library. */
const CONNECTION_PREFIX = exports.CONNECTION_PREFIX = "bgscript-";

/** @constant {string} CONNECTION_PREFIX_NOTAB A prefix added to the connection port name to recognize an internal connection to a script that is not associated with any chrome tab. */
const CONNECTION_PREFIX_NOTAB = exports.CONNECTION_PREFIX_NOTAB = "bgscript.notab-";

/** @constant {object} MESSAGE_TYPES It contains all the message types values to be used in the code */
const MESSAGE_TYPES = exports.MESSAGE_TYPES = {
  BOOTSTRAP: "bootstrap",
  // initialization message
  BOOTSTRAPANSWER: "bootstrap-answer",
  // answer to the bootstrap message (to avoi conflict)
  REQUESTID: "request-id",
  // get the id associated with the script
  GET: "get",
  // get an exposed property value
  SET: "set",
  // set an exposed property value
  CALL: "call",
  // call an exposed method
  ANSWER: "answer",
  // receive the answer after calling an exposed method
  ERROR: "error" // the exposed method call resulted in an error
};

/**
 * Class that will handle a connection to a script. It's not opinionated as to what this script is, if it's the background one or a content script.
 * 
 * @property {chrome.runtime.Port} port The actual connection to the script.
 * @property {boolean} hasTabId Controls whether the connection has a port id or not. This will avoid errors in the $getMyId function within the Connection Proxy.
 * @property {Proxy} proxy The connection proxy that implements the RPC protocol.
 * @property {Map<number, function>} waitingRequests A map of all the requests that are waiting an answer. When an answer is received, the callback contained here will be fired.
 * @property {number} nextRequestId Integer that gets incremented every new request, in order to be used as a unique id.
 * @property {Array<string>} RESTRICTED_NAMES A list of function names that should not be called as RPC by the Proxy.
 * @property {Object.<string, function>} exposedMethods The methods exposed by the local script.
 * @property {Object.<string, any>} exposedProps The properties exposed by the local script.
 * @property {Array<string>} remoteMethods A list of the functions exposed by the connected script.
 */
class Connection extends _CustomEventTarget.default {
  /**
   * Creates a new connection based on the port and other options.
   * 
   * @param {chrome.runtime.Port} port The connection that we want to handle.
   * @param {Object} exposedData The methods and properties we want to expose to the connected script.
   * @param {Object} options
   * @param {boolean} options.hasTabId Indicates whether or not the current script is associated to a tab.
   */
  constructor(port, exposedData = {}, options = {}) {
    var _options$hasTabId;
    super();
    this.port = port;
    this.hasTabId = (_options$hasTabId = options.hasTabId) !== null && _options$hasTabId !== void 0 ? _options$hasTabId : true;
    this.proxy = null;
    this.waitingRequests = new Map();
    this.nextRequestId = 1;
    this.RESTRICTED_NAMES = ["then", "$getMyTabId"];
    this.exposedData = exposedData;
    this.exposedMethods = new Set();
    this.exposedProps = new Set();
    this.remoteMethods = [];
    this.parseExposedData();
    this.port.onMessage.addListener(message => this.handleMessage(message));
    this.port.onDisconnect.addListener(() => {
      this.fireEvent("disconnect");
    });
  }

  /**
   * Split the exposed datas into properties and methods, initializing the corresponding class properties.
   * 
   * @param {Object} data 
   */
  parseExposedData() {
    // Split the exposed data between functions and properties, for easier access
    for (let [key, value] of Object.entries(this.exposedData)) {
      if (this.RESTRICTED_NAMES.includes(key)) {
        console.warn(`'${key}' is a restricted property name and will be ignored.`);
        continue;
      }
      if (typeof value === "function") {
        this.exposedMethods.add(key);
      } else {
        this.exposedProps.add(key);
      }
    }
  }

  /**
   * Start the connection initialization (send a bootstrap message to the connected script)
   * 
   * @param {function} callback Function to be called when the initialization has been successful
   */
  initConnection(callback) {
    let request = {
      type: MESSAGE_TYPES.BOOTSTRAP,
      exposedMethods: [...this.exposedMethods.values()]
    };
    this._sendMessage(request, callback);
  }

  /**
   * Return the proxy that will be used to make the RPCs.
   */
  getProxy() {
    return new Promise((resolve, reject) => {
      // If the proxy is already initialized, return it
      if (this.proxy) return resolve(this.proxy);
      this.initConnection(resolve);
    });
  }
  disconnect() {
    this.port.disconnect();
  }

  /**
   * Handle the incoming bootstrapping informations, and initializes the proxy.
   * 
   * @param {Array<string>} remoteMethods The methods exposed by the connected script
   */
  receivedBootstrapInfo(remoteMethods) {
    this.remoteMethods = remoteMethods;
    this.initProxy();
  }

  /**
   * Decide whether to send a response for the received message or not. It will also directly send the answer.
   * 
   * @param {Object} message The incoming message
   */
  handleMessage(message) {
    let response = this.handleMessageTypes(message);

    // I need to check if response is not null, because a message of type "call" should not have an immediate answer
    if (response) {
      this.port.postMessage(response);
    }
  }

  /**
   * Decides how to answer based on the incoming message type.
   * 
   * @param {Object} message The incoming message
   */
  handleMessageTypes(message) {
    var _this$port$sender$tab, _this$port$sender;
    let callback;
    switch (message.type) {
      case MESSAGE_TYPES.BOOTSTRAP:
        this.receivedBootstrapInfo(message.exposedMethods);
        return {
          type: MESSAGE_TYPES.BOOTSTRAPANSWER,
          id: message.id,
          exposedMethods: [...this.exposedMethods.values()]
        };
      case MESSAGE_TYPES.BOOTSTRAPANSWER:
        this.receivedBootstrapInfo(message.exposedMethods);
        callback = this.getRequestCallback(message.id);
        callback(this.proxy);
        return null;
      case MESSAGE_TYPES.REQUESTID:
        return {
          type: MESSAGE_TYPES.ANSWER,
          id: message.id,
          result: (_this$port$sender$tab = (_this$port$sender = this.port.sender) === null || _this$port$sender === void 0 || (_this$port$sender = _this$port$sender.tab) === null || _this$port$sender === void 0 ? void 0 : _this$port$sender.id) !== null && _this$port$sender$tab !== void 0 ? _this$port$sender$tab : null
        };
      case MESSAGE_TYPES.GET:
        let result = undefined;
        if (this.exposedProps.has(message.prop)) {
          result = this.exposedData[message.prop];
        }
        return {
          type: MESSAGE_TYPES.ANSWER,
          id: message.id,
          result
        };
      case MESSAGE_TYPES.SET:
        let res = {
          type: MESSAGE_TYPES.ANSWER,
          id: message.id,
          result: undefined
        };
        if (this.exposedProps.has(message.prop)) {
          res.result = this.exposedData[message.prop] = message.value;
        }
        return res;
      case MESSAGE_TYPES.CALL:
        if (!this.exposedMethods.has(message.name)) {
          return {
            type: MESSAGE_TYPES.ANSWER,
            id: message.id,
            result: undefined
          };
        }
        this._promisify(this.exposedData[message.name], message.args).then(result => this.sendCallResult(message.id, result)).catch(error => {
          console.error(error); // Allows to see the problem within the throwing script too
          this.sendCallError(message.id, error);
        });
        return null;
      case MESSAGE_TYPES.ANSWER:
        callback = this.getRequestCallback(message.id);
        callback(message.result);
        return null;
      case MESSAGE_TYPES.ERROR:
        throw message.error;
    }
  }

  /**
   * Sends back the result of a method that was called remotely.
   * 
   * @param {number} id The message unique id
   * @param {any} result The result of the executed method
   */
  sendCallResult(id, result) {
    let message = {
      type: MESSAGE_TYPES.ANSWER,
      id,
      result
    };
    return this.port.postMessage(message);
  }

  /**
   * Sends back the error that was raised when a remotely called method fails.
   * 
   * @param {number} id The message unique id
   * @param {any} error The error raised during the method execution
   */
  sendCallError(id, error) {
    let message = {
      type: MESSAGE_TYPES.ERROR,
      id,
      error
    };
    return this.port.postMessage(message);
  }

  /**
   * Init the connection proxy, setting the relevant traps.
   * 
   * @return {Proxy}
   */
  initProxy() {
    this.proxy = new Proxy({}, {
      get: (target, property) => this.getTrap(target, property),
      set: (target, property, value) => this.setTrap(target, property, value)
    });
    return this.proxy;
  }

  /**
   * Handle what happens when the user access a property or executes a method on the proxy. It will send messages to the connected script.
   * 
   * @param {Object} target Currently not used.
   * @param {string} property The property that was requested (could also be a method name: proxy.foo() --> "foo").
   */
  getTrap(target, property) {
    // Prevent access to a "then" property (could create problems)
    if (property === "then") {
      return undefined;
    }

    // Returns the tab id as seen by the local script.
    if (property === "$getMyTabId") {
      return () => {
        return new Promise((resolve, reject) => {
          if (!this.hasTabId) return resolve(null);
          let request = {
            type: MESSAGE_TYPES.REQUESTID
          };
          this._sendMessage(request, resolve);
        });
      };
    }

    // Check if the requested property is a function
    if (this._hasMethod(property)) {
      // This is necessary to allow this syntax: `let result = await connection.remoteFunction()`
      return (...args) => {
        return new Promise((resolve, reject) => {
          let request = {
            type: MESSAGE_TYPES.CALL,
            name: property,
            args: args
          };
          this._sendMessage(request, resolve);
        });
      };
    }

    // Imply that it should get the property back
    return new Promise((resolve, reject) => {
      let request = {
        type: MESSAGE_TYPES.GET,
        prop: property
      };
      this._sendMessage(request, resolve);
    });
  }

  /**
   * Handles what happens when a user set a variable on the connection proxy. This method will send a message to the connected script in order to set the remote property.
   * 
   * @param {Object} target Currently not used.
   * @param {string} property The proxy property to be set
   * @param {any} value The new value of the property
   */
  setTrap(target, property, value) {
    return new Promise((resolve, reject) => {
      let request = {
        type: MESSAGE_TYPES.SET,
        prop: property,
        value: value
      };
      this._sendMessage(request, resolve);
    });
  }

  /**
   * Little helper function to return a message id and increment the "nextRequestId" property.
   * 
   * @return {number} A new unique id for the message.
   */
  getNewRequestId() {
    let id = this.nextRequestId;
    this.nextRequestId++;
    return id;
  }

  /**
   * Get a callback for a specific request
   * 
   * @param {number} id The request id (a.k.a. message id)
   * @return {function} The callback
   */
  getRequestCallback(id) {
    let cb = this.waitingRequests.get(id);
    this.waitingRequests.delete(id);
    return cb;
  }

  /**
   * Queue a callback that will be fired when the remote action is completed and an answer is received.
   * 
   * @param {number} id The request id
   * @param {function} callback The callback that will wait for the request to be completed
   */
  registerCallback(id, callback) {
    this.waitingRequests.set(id, callback);
  }

  /**
   * Little helper function to check if the remote script has the requested method
   * 
   * @param {string} methodName 
   */
  _hasMethod(methodName) {
    return this.remoteMethods.findIndex(n => n === methodName) >= 0;
  }

  /**
   * Send a message to the connected script and enqueue a callback to wait for the answer.
   * 
   * @param {Object} request 
   * @param {function} callback 
   */
  _sendMessage(request, callback) {
    let id = this.getNewRequestId();
    request.id = id;
    this.registerCallback(id, callback);
    this.port.postMessage(request);
  }

  /**
   * Helper function to transform a synchronous method into asynchronous. It will leave asynchronous methods as-it-is.
   * 
   * @param {function} func 
   * @param {Array<any>} args The function arguments
   */
  _promisify(func, args) {
    let result = null;
    try {
      result = func(...args);
    } catch (err) {
      // If the function threw an error (usually synchronous functions will throw here) then
      // transform it into a rejected promise.
      return new Promise((resolve, reject) => reject(err));
    }

    // If it's a promise, then send it as it is
    if (typeof result === "object" && "then" in result) {
      return result;
    }
    // If it's not a promise, transform it into a resolved promise
    return new Promise(resolve => resolve(result));
  }
}
exports.Connection = Connection;
var _default = exports.default = Connection;

},{"./CustomEventTarget.js":5}],5:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
class CustomEventTarget {
  constructor() {
    this.listeners = new Map(); // event --> listeners
  }

  addListener(event, callback) {
    if (typeof callback !== "function") throw "The callback must be a function";
    let callbacksList = this.listeners.get(event);
    if (!callbacksList) {
      this.listeners.set(event, [callback]);
      return;
    }
    callbacksList.push(callback);
  }
  removeListener(event, callback) {
    let callbacksList = this.listeners.get(event);
    if (!callbacksList) return;
    let callbackIndex = callbacksList.indexOf(callback);
    if (callbackIndex < 0) return;
    callbacksList.splice(callbackIndex, 1);
  }
  fireEvent(event, details = {}) {
    let callbacksList = this.listeners.get(event);
    if (!callbacksList) return;
    for (let callback of callbacksList) {
      callback(details);
    }
  }
}
var _default = exports.default = CustomEventTarget;

},{}],6:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Error = exports.BgHandlerErrors = void 0;
class Error {
  /**
   * Creates a new Error with a specific id and a function that will return useful informations
   * 
   * @constructor
   * @param {string} id A readable id for the error
   * @param {function} getTextCallback A function that will return a description text for this error.
   */
  constructor(id, getTextCallback) {
    this.id = id;
    this.getTextCallback = getTextCallback;
  }

  /**
   * Get the error description text
   * 
   * @param  {...any} args
   * @returns {string} The description of this error 
   */
  getText(...args) {
    return this.getTextCallback(...args);
  }
}
exports.Error = Error;
const BgHandlerErrors = exports.BgHandlerErrors = {
  ID_TAKEN: new Error('ID_TAKEN', id => `The id '${id}' has already been taken. It must be unique.`),
  NO_CONNECTION: new Error('NO_CONNECTION', (scriptId, tabId) => `There is no connection assigned to id '${scriptId}'${tabId ? ` connected to the tab ${tabId}` : ''}.`)
};

},{}],7:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.waitForNextTask = waitForNextTask;
function waitForNextTask() {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

},{}]},{},[1]);
