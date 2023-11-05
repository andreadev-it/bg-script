export class MockedEvent {
    constructor() {
        this.listeners = [];
    }

    addListener(callback) {
        this.listeners.push(callback);
    }

    removeListener(callback) {
        this.listeners.splice(this.listeners.indexOf(callback), 1);
    }

    fireEvent(options) {
        for (let listener of this.listeners) {
            listener(options);
        }
    }
}
