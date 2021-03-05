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

export default CustomEventTarget;