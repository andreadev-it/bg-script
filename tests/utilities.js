import BackgroundHandler from "../src/BackgroundHandler.js";
import BackgroundScript from "../src/BackgroundScript.js";
import { MockedChromeRuntime } from "./mocks/mockedChromeRuntime.js";

export function waitFor(ms) {
    return new Promise((resolve, _) => {
        setTimeout(resolve, ms);
    });
}

export function setupScripts(handlerData, scriptsData) {
    let runtime = new MockedChromeRuntime();
    let bgHandler = new BackgroundHandler(handlerData, { runtime });
    
    let scripts = [];
    for (let data of scriptsData) {
        scripts.push(new BackgroundScript(data.name, data.exposed, { runtime }));
    }

    return [bgHandler, scripts];
}
