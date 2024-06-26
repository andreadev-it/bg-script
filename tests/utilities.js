import BackgroundHandler from "../src/BackgroundHandler.js";
import BackgroundScript from "../src/BackgroundScript.js";
import { MockedChromeRuntime } from "./mocks/mockedChromeRuntime.js";
import { MockedChromeStorage } from "./mocks/mockedChromeStorage.js";

export function waitFor(ms) {
    return new Promise((resolve, _) => {
        setTimeout(resolve, ms);
    });
}

export function setupScripts(handlerData, scriptsData, fixedTabId = null) {
    let runtime = new MockedChromeRuntime(fixedTabId);
    let storage = new MockedChromeStorage();
    let bgHandler = new BackgroundHandler(handlerData, { runtime, storage, chromeTabs: {} });
    
    let scripts = [];
    for (let data of scriptsData) {
        scripts.push(new BackgroundScript(data.name, data.exposed, { runtime }));
    }

    return [bgHandler, scripts];
}
