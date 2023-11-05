import { getMockedPortPair } from "./mockedPort.js";
import { MockedEvent } from "./mockedEvent.js";

export class MockedChromeRuntime {
    constructor() {
        this.onConnect = new MockedEvent();
    }

    connect({ name }) {
        let [port, otherPort] = getMockedPortPair(name);

        // Don't do it in the same task
        setTimeout(() => {
            this.onConnect.fireEvent(otherPort);
        }, 0);

        return port;
    }
}
