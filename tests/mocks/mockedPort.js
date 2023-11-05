import { MockedEvent } from "./mockedEvent.js";

export class MockedPort {
    constructor(name) {
        this.name = name;
        this.onMessage = new MockedEvent();
        this.onDisconnect = new MockedEvent();
        this.other = null;
    }

    _join(port) {
        this.other = port;
    }
    
    disconnect() {
        // Do this in a different task
        setTimeout(() => this.other.onDisconnect.fireEvent(), 0);
    }

    postMessage(req) {
        setTimeout(() => this.other.onMessage.fireEvent(req), 0);
    }
}

export const getMockedPortPair = (name) => {
    let portA = new MockedPort(name);
    let portB = new MockedPort(name);
    portA._join(portB);
    portB._join(portA);
    return [portA, portB];
}

