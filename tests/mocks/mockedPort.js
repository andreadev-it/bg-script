import { MockedEvent } from "./mockedEvent.js";

export class MockedPort {
    constructor(name, tabId) {
        this.name = name;
        this.onMessage = new MockedEvent();
        this.onDisconnect = new MockedEvent();
        this.other = null;
        this.sender = {
            tab: {
                id: tabId ?? crypto.randomUUID()
            }
        }
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

export const getMockedPortPair = (name, tabId = null) => {
    let portA = new MockedPort(name, tabId);
    let portB = new MockedPort(name, tabId);
    portA._join(portB);
    portB._join(portA);
    return [portA, portB];
}

