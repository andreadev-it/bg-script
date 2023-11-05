export class MockedWindow {
    events = new Map();

    addEventListener(event, callback) {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }

        this.events.get(event).push(callback);
    }

    fireEvent(event, details) {
        if (!this.events.has(event)) {
            return;
        }

        this.events.get(event).forEach((callback) => {
            callback(details);
        });
    }

    removeEventListener(event, callback) {
        if (!this.events.has(event)) {
            return;
        }

        this.events.get(event).splice(
            this.events.get(event).indexOf(callback), 1
        );
    }
}
