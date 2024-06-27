import { CustomEventTarget } from "@andreadev/custom-event-target";
import { 
    MessageTypes,
    AnswerMessage,
    CallMethodMessage,
    GetPropertyMessage,
    Message,
    RequestIdMessage,
    SetPropertyMessage 
} from "./Messages";

/** @constant {string} CONNECTION_PREFIX A prefix added to the connection port name to recognize a connection from within the bgscript library. */
export const CONNECTION_PREFIX = "bgscript-";

/** @constant {string} CONNECTION_PREFIX_NOTAB A prefix added to the connection port name to recognize an internal connection to a script that is not associated with any chrome tab. */
export const CONNECTION_PREFIX_NOTAB = "bgscript.notab-";


type BackgroundScriptOptions = Partial<{
    hasTabId: boolean | undefined;
}>;


/**
 * Class that will handle a connection to a script. It's not opinionated as to what this script is, if it's the background one or a content script.
 */
export class Connection extends CustomEventTarget {
    
    port: chrome.runtime.Port;
    hasTabId: boolean;
    proxy: any;
    waitingRequests: Map<number, Function>;
    nextRequestId: number;
    RESTRICTED_NAMES: Array<string>;
    exposedData: any;
    exposedMethods: Set<string>;
    exposedProps: Set<string>;
    remoteMethods: Array<string>;

    /**
     * Creates a new connection based on the port and other options.
     */
    constructor( port: chrome.runtime.Port, exposedData: any = {}, options: BackgroundScriptOptions = {} ) {
        super();

        this.port = port;
        this.hasTabId = options.hasTabId ?? true;

        this.proxy = null;
        this.waitingRequests = new Map();
        this.nextRequestId = 1;
        
        this.RESTRICTED_NAMES = ["then", "$getMyTabId"];
        this.exposedData = exposedData;
        this.exposedMethods = new Set();
        this.exposedProps = new Set();
        this.remoteMethods = [];


        this.parseExposedData();

        this.port.onMessage.addListener( (message) => this.handleMessage(message) );

        this.port.onDisconnect.addListener( () => {
            this.fireEvent("disconnect", {});
        });
    }

    /**
     * Split the exposed datas into properties and methods, initializing the corresponding class properties.
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
            }
            else {
                this.exposedProps.add(key);
            }
        }
    }

    /**
     * Start the connection initialization (send a bootstrap message to the connected script)
     * 
     * @param callback Function to be called when the initialization has been successful
     */
    initConnection(callback: Function) {
        let request = {
            type: MessageTypes.BOOTSTRAP,
            exposedMethods: [...this.exposedMethods.values()]
        }

        this._sendMessage(request, callback);
    }

    /**
     * Return the proxy that will be used to make the RPCs.
     */
    getProxy() {
        return new Promise( (resolve, _reject) => {
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
     * @param remoteMethods The methods exposed by the connected script
     */
    receivedBootstrapInfo(remoteMethods: string[]) {
        this.remoteMethods = remoteMethods;

        this.initProxy();
    }

    /**
     * Decide whether to send a response for the received message or not. It will also directly send the answer.
     */
    handleMessage(message: Message) {
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
    handleMessageTypes(message: Message) : Message | null {
        let callback;

        switch (message.type) {
            case MessageTypes.BOOTSTRAP:

                this.receivedBootstrapInfo(message.exposedMethods);
            
                return {
                    type: MessageTypes.BOOTSTRAPANSWER,
                    id: message.id,
                    exposedMethods: [...this.exposedMethods.values()]
                };
            
            case MessageTypes.BOOTSTRAPANSWER:

                this.receivedBootstrapInfo(message.exposedMethods);
                callback = this.getRequestCallback(message.id);

                if (callback) {
                    callback(this.proxy);
                }

                return null;
            
            case MessageTypes.REQUESTID:
                return {
                    type: MessageTypes.ANSWER,
                    id: message.id,
                    result: this.port.sender?.tab?.id ?? null
                }

            case MessageTypes.GET:
                let result = undefined;

                if (this.exposedProps.has(message.prop)) {
                    result = this.exposedData[message.prop];
                }

                return {
                    type: MessageTypes.ANSWER,
                    id: message.id,
                    result
                };

            case MessageTypes.SET:
                let res: AnswerMessage = {
                    type: MessageTypes.ANSWER,
                    id: message.id,
                    result: undefined,
                };

                if (this.exposedProps.has(message.prop)) {
                    res.result = this.exposedData[message.prop] = message.value;
                }
                
                return res;
            
            case MessageTypes.CALL:
                if (!this.exposedMethods.has(message.name)) {
                    return {
                        type: MessageTypes.ANSWER,
                        id: message.id,
                        result: undefined
                    };
                }

                this._promisify( this.exposedData[message.name], message.args )
                    .then(
                        (result: any) => this.sendCallResult(message.id, result)
                    ).catch(
                        (error: any) => {
                            console.error(error); // Allows to see the problem within the throwing script too
                            this.sendCallError(message.id, error);
                        }
                    );
                
                return null;
            
            case MessageTypes.ANSWER:
                callback = this.getRequestCallback(message.id);

                if (callback) {
                    callback(message.result);
                }

                return null;
            
            case MessageTypes.ERROR:
                throw message.error;
        }
    }

    /**
     * Sends back the result of a method that was called remotely.
     * 
     * @param id The message unique id
     * @param result The result of the executed method
     */
    sendCallResult(id: number, result: any) {
        let message = {
            type: MessageTypes.ANSWER,
            id,
            result
        };

        return this.port.postMessage(message);
    }

    /**
     * Sends back the error that was raised when a remotely called method fails.
     * 
     * @param id The message unique id
     * @param error The error raised during the method execution
     */
    sendCallError(id: number, error: any) {
        let message = {
            type: MessageTypes.ERROR,
            id,
            error
        };

        return this.port.postMessage(message);
    }

    /**
     * Init the connection proxy, setting the relevant traps.
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
     * @param _target Currently not used.
     * @param property The property that was requested (could also be a method name: proxy.foo() --> "foo").
     */
    getTrap(_target: object, property: string | symbol) {

        // Prevent access to a "then" property (could create problems)
        if (property === "then") {
            return undefined;
        }

        // Returns the tab id as seen by the local script.
        if (property === "$getMyTabId") {
            return () => {
                return new Promise((resolve, _reject) => {
                    if (!this.hasTabId) return resolve(null);

                    let request: Partial<RequestIdMessage> = {
                        type: MessageTypes.REQUESTID
                    }

                    this._sendMessage(request, resolve);
                });
            }
        }

        // Make sure that the requested thing is not a symbol
        if (typeof property === "symbol") {
            throw new Error(`Remote symbols are not supported in this library`);
        }

        // Check if the requested property is a function
        if (this._hasMethod(property)) {

            // This is necessary to allow this syntax: `let result = await connection.remoteFunction()`
            return (...args: any[]) => {

                return new Promise((resolve, _reject) => {
                    
                    let request: Partial<CallMethodMessage> = {
                        type: MessageTypes.CALL,
                        name: property,
                        args: args
                    };

                    this._sendMessage(request, resolve);
                });
            }

        }

        // Imply that it should get the property back
        return new Promise((resolve, _reject) => {

            let request: Partial<GetPropertyMessage> = {
                type: MessageTypes.GET,
                prop: property
            }

            this._sendMessage(request, resolve);
        });
    }

    /**
     * Handles what happens when a user set a variable on the connection proxy. This method will send a message to the connected script in order to set the remote property.
     * 
     * @param _target Currently not used.
     * @param property The proxy property to be set
     * @param value The new value of the property
     */
    setTrap(_target: object, property: string | symbol, value: any) {

        if (typeof property === "symbol") {
            throw new Error(`Remote symbols are not supported in this library`);
        }

        new Promise((resolve, _reject) => {
            let request: Partial<SetPropertyMessage> = {
                type: MessageTypes.SET,
                prop: property,
                value: value,
            }
            
            this._sendMessage(request, resolve);
        });

        return true;
    }

    /**
     * Little helper function to return a message id and increment the "nextRequestId" property.
     */
    getNewRequestId() : number {
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
    getRequestCallback(id: number) : Function | null {
        let cb = this.waitingRequests.get(id) ?? null;
        this.waitingRequests.delete(id);
        return cb;
    }

    /**
     * Queue a callback that will be fired when the remote action is completed and an answer is received.
     * 
     * @param id The request id
     * @param callback The callback that will wait for the request to be completed
     */
    registerCallback(id: number, callback: Function) {
        this.waitingRequests.set(id, callback);
    }
    
    /**
     * Little helper function to check if the remote script has the requested method
     */
    _hasMethod(methodName: string) {
        return ( this.remoteMethods.findIndex((n) => n === methodName) >= 0 );
    }

    /**
     * Send a message to the connected script and enqueue a callback to wait for the answer.
     */
    _sendMessage(request: Partial<Message>, callback: Function) {
        let id = this.getNewRequestId();

        request.id = id;

        this.registerCallback(id, callback);
        
        this.port.postMessage(request);
    }

    /**
     * Helper function to transform a synchronous method into asynchronous. It will leave asynchronous methods as-it-is.
     */
    _promisify(func: Function, args: any[]) {
        let result = null;
        try {
            result = func(...args);
        }
        catch (err) {
            // If the function threw an error (usually synchronous functions will throw here) then
            // transform it into a rejected promise.
            return new Promise((_resolve, reject) => reject(err));
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
