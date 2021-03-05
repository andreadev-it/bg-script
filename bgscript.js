const CONNECTION_PREFIX = "bgscript-";
const CONNECTION_PREFIX_NOTAB = "bgscript.notab-";
const MESSAGE_TYPES = {
    BOOTSTRAP: "bootstrap",  // initialization message
    BOOTSTRAPANSWER: "bootstrap-answer", // answer to the bootstrap message (to avoi conflict)
    REQUESTID: "request-id", // get the id associated with the script
    GET: "get",              // get an exposed property value
    SET: "set",              // set an exposed property value
    CALL: "call",            // call an exposed method
    ANSWER: "answer",        // receive the answer after calling an exposed method
    ERROR: "error"           // the exposed method call resulted in an error
}

// Simple custom implementation of an EventTarget
class CustomEventTarget {
    
    constructor () {
        this.listeners = new Map(); // event --> listeners
    }

    addListener(event, callback) {
        if (typeof(callback) !== "function") throw "The callback must be a function";

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

class BackgroundScript {

    constructor(scriptId, exposedData = {}, options = {}) {
        this.scriptId = scriptId ?? __uuidv4();
        this.connection = null;
        this.exposedData = exposedData;
        
        this.connectBackgroundScript(options);
    }

    connectBackgroundScript(options) {
        let { context = "content" } = options;

        let completeScriptId = "";

        switch (context) {
            case "content":
                completeScriptId = CONNECTION_PREFIX + this.scriptId;
                break;
            case "devtools":
                if (!chrome.devtools) throw "Cannot set context='devtools' when the script is not in a devtools window.";
                completeScriptId = CONNECTION_PREFIX_NOTAB + this.scriptId + "-" + chrome.devtools.inspectedWindow.tabId;
                break;
            case "tab-agnostic":
                completeScriptId = this.scriptId;
                break;
        }

        let port = chrome.runtime.connect(
            {
                name: completeScriptId
            }
        );

        this.connection = new Connection(port, this.exposedData, options);
        
        this.connection.addListener("disconnect", () => {
            this.connection = null;
        });
    }

    async getConnection() {
        let proxy = await this.connection.getProxy();
        return proxy;
    }

    _uuidv4() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}

class BackgroundHandler {

    constructor(exposedData = {}, options = {}) {
        this.scriptConnections = new Map(); // script-id --> connection

        chrome.runtime.onConnect.addListener( (port) => {
            if (!port.name.startsWith(CONNECTION_PREFIX) && !port.name.startsWith(CONNECTION_PREFIX_NOTAB)) return;

            let scriptId = "";

            if (port.name.startsWith(CONNECTION_PREFIX)) {

                scriptId = port.name.substr(CONNECTION_PREFIX.length);
                let tabId = port.sender.tab.id;
                scriptId += `-${tabId}`;
            }
            else {
                scriptId = port.name.substr(CONNECTION_PREFIX_NOTAB.length);
            }

            if (this.scriptConnections.get(scriptId)) throw "The id has already been taken. It must be unique.";

            // In the background script, there is no tab-id associated
            let connectionOptions = { hasTabId: false };

            let connection = new Connection(port, exposedData, connectionOptions);

            connection.addListener("disconnect", () => {
                this.scriptConnections.delete(scriptId);
            });

            this.scriptConnections.set(scriptId, connection);
        });
    }

    async getScriptConnection(scriptId, tabId) {

        let specificScriptId = scriptId;

        if (tabId) specificScriptId += `-${tabId}`;

        let connection = this.scriptConnections.get(specificScriptId);

        if (!connection) {
            console.error(`There is no connection assigned to id '${scriptId}'${(tabId) ? ` connected to the tab ${tabId}` : ''}.`);
            return null;
        }

        let proxy = await connection.getProxy();

        return proxy;
    }
}

class Connection extends CustomEventTarget {
    
    constructor( port, exposedData = {}, { hasTabId = true } = {} ) {
        super();

        this.port = port;
        this.hasTabId = hasTabId;

        this.proxy = null;
        this.waitingRequests = new Map();
        this.nextRequestId = 1;
        
        this.RESTRICTED_NAMES = ["then", "$getMyTabId"];
        this.exposedMethods = {};
        this.exposedProps = {};
        this.remoteMethods = [];


        this.parseExposedData(exposedData);

        this.port.onMessage.addListener( (message) => {
            let response = this.handleIncomingMessage(message);

            // I need to check if response is not null, because a message of type "call" should not have an immediate answer
            if (response) {
                this.port.postMessage(response);
            }
        });

        this.port.onDisconnect.addListener( () => {
            this.fireEvent("disconnect");
        });
    }

    parseExposedData(data) {
        // Split the exposed data between functions and properties, for easier access
        for (let [key, value] of Object.entries(data)) {

            if (this.RESTRICTED_NAMES.includes(key)) {
                console.warn(`'${key}' is a restricted property name and will be ignored.`);
                continue;
            }

            if (typeof value === "function") {
                this.exposedMethods[key] = value;
            }
            else {
                this.exposedProps[key] = value;
            }
        }
    }

    initConnection(callback) {
        let request = {
            type: MESSAGE_TYPES.BOOTSTRAP,
            exposedMethods: Object.keys(this.exposedMethods)
        }

        this._sendMessage(request, callback);
    }

    getProxy() {
        return new Promise( (resolve, reject) => {
            // If the proxy is already initialized, return it
            if (this.proxy) return resolve(this.proxy);

            this.initConnection(resolve);
        });
    }

    receivedBootstrapInfo(remoteMethods) {
        this.remoteMethods = remoteMethods;

        this.initProxy();
    }

    handleIncomingMessage(message) {
        let callback;

        switch (message.type) {
            case MESSAGE_TYPES.BOOTSTRAP:

                this.receivedBootstrapInfo(message.exposedMethods);
            
                return {
                    type: MESSAGE_TYPES.BOOTSTRAPANSWER,
                    id: message.id,
                    exposedMethods: Object.keys(this.exposedMethods)
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
                    result: this.port.sender.tab.id
                }

            case MESSAGE_TYPES.GET:
                return {
                    type: MESSAGE_TYPES.ANSWER,
                    id: message.id,
                    result: this.exposedProps[message.prop]
                };

            case MESSAGE_TYPES.SET:
                let res = {
                    type: MESSAGE_TYPES.ANSWER,
                    id: message.id,
                    result: undefined,
                };

                if (message.prop in this.exposedProps) {
                    res.result = this.exposedProps[message.prop] = message.value;
                }
                
                return res;
            
            case MESSAGE_TYPES.CALL:
                if (!message.name in this.exposedMethods) {
                    return {
                        type: MESSAGE_TYPES.ANSWER,
                        id: message.id,
                        result: undefined
                    };
                }

                this._promisify( this.exposedMethods[message.name], message.args )
                    .then(
                        (result) => this.sendCallResult(message.id, result)
                    ).catch(
                        (error) => {
                            console.error(error); // Allows to see the problem within the throwing script too
                            this.sendCallError(message.id, result);
                        }
                    );
                
                return null;
            
            case MESSAGE_TYPES.ANSWER:
                callback = this.getRequestCallback(message.id);
                callback(message.result);
                return null;
            
            case MESSAGE_TYPES.ERROR:
                throw message.error;
        }
    }

    sendCallResult(id, result) {
        let message = {
            type: MESSAGE_TYPES.ANSWER,
            id,
            result
        };

        return this.port.postMessage(message);
    }

    sendCallError(id, error) {
        let message = {
            type: MESSAGE_TYPES.ERROR,
            id,
            error
        };

        return this.port.postMessage(message);
    }

    initProxy() {
        this.proxy = new Proxy({}, {
            get: (target, property) => this.getTrap(target, property),
            set: (target, property, value) => this.setTrap(target, property, value)
        });

        return this.proxy;
    }

    getTrap(target, property) {
        // Prevent access to a "then" property (could create problems)
        if (property === "then") {
            return undefined;
        }

        if (property === "$getMyTabId") {
            return () => {
                return new Promise((resolve, reject) => {
                    if (!this.hasTabId) return resolve(null);

                    let request = {
                        type: MESSAGE_TYPES.REQUESTID
                    }

                    this._sendMessage(request, resolve);
                });
            }
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
            }

        }

        // Imply that it should get the property back
        return new Promise((resolve, reject) => {

            let request = {
                type: MESSAGE_TYPES.GET,
                prop: property
            }

            this._sendMessage(request, resolve);
        });
    }

    // Trap for the "set" action (proxy)
    setTrap(target, property, value) {
        return new Promise((resolve, reject) => {
            let request = {
                type: MESSAGE_TYPES.SET,
                prop: property,
                value: value
            }
            
            this._sendMessage(request, resolve);
        });
    }

    getNewRequestId() {
        let id = this.nextRequestId;
        this.nextRequestId++;
        return id;
    }

    getRequestCallback(id) {
        return this.waitingRequests.get(id);
    }

    registerCallback(id, callback) {
        this.waitingRequests.set(id, callback);
    }
    
    _hasMethod(methodName) {
        return ( this.remoteMethods.findIndex((n) => n === methodName) >= 0 );
    }

    _sendMessage(request, callback) {
        let id = this.getNewRequestId();

        request.id = id;

        this.registerCallback(id, callback);
        
        this.port.postMessage(request);
    }

    _promisify(func, args) {
        let result = null;
        try {
            result = func(...args);
        }
        catch (err) {
            // If the function threw an error (usually synchronous functions will throw here) then
            // transform it into a rejected promise.
            return new Promise((resolve, reject) => reject(err));
        }
        
        // If it's a promise, then send it as it is
        if (typeof(result) === "object" && "then" in result) {
            return result;
        }
        // If it's not a promise, transform it into a resolved promise
        return new Promise((resolve) => resolve(result));
    }
}