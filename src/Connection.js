import CustomEventTarget from './CustomEventTarget.js';

/** @constant {string} CONNECTION_PREFIX A prefix added to the connection port name to recognize a connection from within the bgscript library. */
export const CONNECTION_PREFIX = "bgscript-";

/** @constant {string} CONNECTION_PREFIX_NOTAB A prefix added to the connection port name to recognize an internal connection to a script that is not associated with any chrome tab. */
export const CONNECTION_PREFIX_NOTAB = "bgscript.notab-";

/** @constant {object} MESSAGE_TYPES It contains all the message types values to be used in the code */
export const MESSAGE_TYPES = {
    BOOTSTRAP: "bootstrap",  // initialization message
    BOOTSTRAPANSWER: "bootstrap-answer", // answer to the bootstrap message (to avoi conflict)
    REQUESTID: "request-id", // get the id associated with the script
    GET: "get",              // get an exposed property value
    SET: "set",              // set an exposed property value
    CALL: "call",            // call an exposed method
    ANSWER: "answer",        // receive the answer after calling an exposed method
    ERROR: "error"           // the exposed method call resulted in an error
}

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
export class Connection extends CustomEventTarget {
    
    /**
     * Creates a new connection based on the port and other options.
     * 
     * @param {chrome.runtime.Port} port The connection that we want to handle.
     * @param {Object} exposedData The methods and properties we want to expose to the connected script.
     * @param {Object} options
     * @param {boolean} options.hasTabId Indicates whether or not the current script is associated to a tab.
     */
    constructor( port, exposedData = {}, options = {} ) {
        super();

        this.port = port;
        this.hasTabId = options.hasTabId ?? true;

        this.proxy = null;
        this.waitingRequests = new Map();
        this.nextRequestId = 1;
        
        this.RESTRICTED_NAMES = ["then", "$getMyTabId"];
        this.exposedMethods = {};
        this.exposedProps = {};
        this.remoteMethods = [];


        this.parseExposedData(exposedData);

        this.port.onMessage.addListener( (message) => this.handleMessage(message) );

        this.port.onDisconnect.addListener( () => {
            this.fireEvent("disconnect");
        });
    }

    /**
     * Split the exposed datas into properties and methods, initializing the corresponding class properties.
     * 
     * @param {Object} data 
     */
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

    /**
     * Start the connection initialization (send a bootstrap message to the connected script)
     * 
     * @param {function} callback Function to be called when the initialization has been successful
     */
    initConnection(callback) {
        let request = {
            type: MESSAGE_TYPES.BOOTSTRAP,
            exposedMethods: Object.keys(this.exposedMethods)
        }

        this._sendMessage(request, callback);
    }

    /**
     * Return the proxy that will be used to make the RPCs.
     */
    getProxy() {
        return new Promise( (resolve, reject) => {
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
     * Decides how to answer based on the incomin message type.
     * 
     * @param {Object} message The incoming message
     */
    handleMessageTypes(message) {
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
                    result: this.port.sender?.tab?.id ?? null
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
                            this.sendCallError(message.id, error);
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
            }
            
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
        return this.waitingRequests.get(id);
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
        return ( this.remoteMethods.findIndex((n) => n === methodName) >= 0 );
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

export default Connection;
