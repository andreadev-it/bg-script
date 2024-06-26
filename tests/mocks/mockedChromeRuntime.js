import { getMockedPortPair } from "./mockedPort.js";
import { MockedEvent } from "./mockedEvent.js";

export class MockedChromeRuntime {
    constructor(fixedTabId = null) {
        this.onConnect = new MockedEvent();
        this.onMessage = new MockedEvent();
        this.fixedTabId = fixedTabId;
    }

    connect({ name }) {
        let [port, otherPort] = getMockedPortPair(name, this.fixedTabId);

        // Don't do it in the same task
        setTimeout(() => {
            this.onConnect.fireEvent(otherPort);
        }, 0);

        return port;
    }
}
