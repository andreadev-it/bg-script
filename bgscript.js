// This must be used in the content script (or extension page script)

// Class that is used internally to emulate the chrome "onMessage" event handling for further user customization
class BSEvent {
    listeners = []

    addListener(f) {
        this.listeners.push(f);
    }

    removeListener(f) {
        let index = this.listeners.findIndex((x) => x === f);
        if (index >= 0) {
            return this.listeners.splice(index, 1);
        }
    }

    trigger(...details) {
        for (let f of this.listeners) {
            f(...details);
        }
    }
}

export class BackgroundScript {
    
    proxy = null
    methods = []
    signature = null
    onMessage = new BSEvent()
    waitingCalls = new Map()

    constructor() {
        this.init();
    }

    // Starts the event listener on message
    init() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            // If the message is an object, and has a "type" property, the it may be for our internal use
            if (this.isScriptMessage(message)) {
                
                // If the message is the result for a function call, then resolve the related promise
                if (message.type === "call_result") {
                    let resolve = this.waitingCalls.get(message.id);
                    resolve(message.result);
                    return;
                }
                else if (message.type === "call_error") {
                    throw message.error || "Generic error in the background script.";
                }
            }

            // If it's not for our use, than redirect it to the user handler
            this.onMessage.trigger(message, sender, sendResponse);
        });
    }

    // Bootstrap and return the proxy
    getConnection() {
        return new Promise( (resolve, reject) => {
            // If there is no proxy, then bootstrap the connection
            if (!this.proxy) {
                // Ask for bootstrapping informations
                chrome.runtime.sendMessage({ type: "bootstrap" }, (response) => {
                    // Copy the shared methods names into the list
                    this.methods = response.methods
                    this.signature = response.signature
    
                    // Create the proxy
                    this.proxy = new Proxy({}, {
                        get: (t, p) => this.getTrap(t, p),
                        set: (t, p, v) => this.setTrap(t, p, v)
                    });
    
                    resolve(this.proxy);
                });
            }
            else {
                resolve(this.proxy);
            }
        });
    }

    // Trap for the "get" action (proxy)
    getTrap(target, property) {
        // Prevent access to a "then" property (could create problems)
        if (property === "then") {
            console.info("'Then' is a restricted variable name. You may see this warning if you used 'await' to initialize the BackgroundConnection. In that case, just ignore it.");
            return undefined;
        }

        // Check if the requested property is a function
        if (this._hasMethod(property)) {

            // This is necessary to allow this syntax: `let result = await connection.remoteFunction()`
            return (...args) => {

                return new Promise((resolve, reject) => {

                    let request = {
                        type: "call",
                        name: property,
                        args: args,
                        signature: this.signature
                    }

                    chrome.runtime.sendMessage(request, (response) => {
                        // If it returned an id for waiting, then add it to the list
                        if (response && "id" in response) {
                            this.waitingCalls.set(response.id, resolve);
                        }
                    });
                });
            }

        }

        // Imply that it should get the property back
        return new Promise((resolve, reject) => {
            let request = {
                type: "get",
                prop: property
            }

            this._sendMessage(request, resolve, reject);
        });
    }

    // Trap for the "set" action (proxy)
    setTrap(target, property, value) {
        return new Promise((resolve, reject) => {
            let request = {
                type: "set",
                prop: property,
                value: value
            }
            
            this._sendMessage(request, resolve, reject);
        });
    }

    // Check if the message received is coming from the bgscript library
    isScriptMessage(message) {
        if (typeof(message) === "object" && "signature" in message && message.signature == this.signature)
            return true;
        return false;
    }

    _sendMessage(request, resolve, reject) {
        try {
            if (this.signature)
                request.signature = this.signature;

            chrome.runtime.sendMessage(request, resolve);
        }
        catch (err) {
            reject(err);
        }
    }

    _hasMethod(name) {
        return ( this.methods.findIndex((n) => n === name) >= 0 );
    }
}


// This must be used in the background script

export class BackgroundHandler {

    sharedMethods = {}
    sharedProps = {}
    currentCallId = 1
    signature = null
    onMessage = new BSEvent()

    constructor(sharedData) {
        // Split the shared data between functions and properties, for easier access
        for (let [key, value] of Object.entries(sharedData)) {
            if (typeof value === "function") {
                this.sharedMethods[key] = value;
            }
            else {
                this.sharedProps[key] = value;
            }
        }

        this.init();
    }

    // Initialization function, adds the message listener
    init() {
        // Create a signature to help identify library messages
        this.signature = this._uuidv4();

        // Add listener for incoming messages
        chrome.runtime.onMessage.addListener(
            (request, sender, sendResponse) => {
                if (this.isScriptMessage(request)) {
                    sendResponse( this.handleRequest(request, sender) );
                }
                else {
                    this.onMessage.trigger(request, sender, sendResponse);
                }
            }
        );
    }

    // This function will handle the incoming requests
    handleRequest({ type, prop, value, name, args } , sender) {
        switch (type) {
            case "bootstrap":
                return {
                    methods: Object.keys(this.sharedMethods),
                    signature: this.signature
                };
            
            case "get":
                return this.sharedProps[prop];
            
            case "set":
                if (prop in this.sharedProps) {
                    return this.sharedProps[prop] = value;
                }
                return undefined;

            case "call":
                if (name in this.sharedMethods) {
                    
                    let callId = this.currentCallId;

                    this._promisify( this.sharedMethods[name], args )
                        .then(
                            (result) => this.sendCallResult(sender.tab.id, callId, result)
                        ).catch(
                            (error) => {
                                console.error(error); // Allows to see the problem within the backend script
                                this.sendCallError(sender.tab.id, callId, error.toString())
                            }
                        );
                    
                    this.currentCallId++;

                    return { id: callId };
                }
                return undefined;
        }
    }

    sendCallResult(tab, id, result) {
        chrome.tabs.sendMessage(tab, {
            signature: this.signature,
            type: "call_result",
            id,
            result
        });
    }

    sendCallError(tab, id, error) {
        chrome.tabs.sendMessage(tab, {
            signature: this.signature,
            type: "call_error",
            id,
            error
        });
    }

    // Check if the message received is coming from the bgscript library
    isScriptMessage(message) {
        if (typeof(message) === "object") {
            if (message.type === "bootstrap") return true;
            if (message.signature == this.signature) return true;
        }
        return false;
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

    _uuidv4() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}

export default {
    BackgroundScript,
    BackgroundHandler
};