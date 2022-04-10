/**
 * Class that handles dispatching custom events.
 * @property {Map} listeners Map events names to a list of functions (listeners)
 */
class CustomEventTarget {
    
    constructor () {
        this.listeners = new Map(); // event --> listeners
    }

    /**
     * Adds a listener for a specific event
     * @param {string} event The event name
     * @param {function} callback The listener function
     */
    addListener(event, callback) {
        if (typeof(callback) !== "function") throw "The callback must be a function";

        let callbacksList = this.listeners.get(event);

        if (!callbacksList) {
            this.listeners.set(event, [callback]);
            return;
        }

        callbacksList.push(callback);
    }

    /**
     * Removes a listener for a specific event
     * @param {string} event The event name
     * @param {function} callback The listener function to be removed
     */
    removeListener(event, callback) {
        let callbacksList = this.listeners.get(event);

        if (!callbacksList) return;

        let callbackIndex = callbacksList.indexOf(callback);

        if (callbackIndex < 0) return;

        callbacksList.splice(callbackIndex, 1);
    }

    /**
     * Dispatches an event
     * @param {string} event The event name
     * @param {object} data The event data to be passed to the listeners
     */
    fireEvent(event, details = {}) {
        let callbacksList = this.listeners.get(event);

        if (!callbacksList) return;

        for (let callback of callbacksList) {
            callback(details);
        }
    }
}

export default CustomEventTarget;
