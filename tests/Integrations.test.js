import { describe, test, mock } from "node:test";
import assert from "node:assert";
import { MockedChromeRuntime } from "./mocks/mockedChromeRuntime.js";
import { MockedWindow } from "./mocks/mockedWindow.js";
import BackgroundHandler from "../src/BackgroundHandler.js";
import BackgroundScript from "../src/BackgroundScript.js";
import { waitFor, setupScripts } from "./utilities.js";

global.window = new MockedWindow();

describe("The Background Handler", () => {
    test("should be constructed correctly", () => {
        let runtime = new MockedChromeRuntime();

        const foo = () => {};
        const exposed = {
            foo,
            prop: 1
        };
        let bgHandler = new BackgroundHandler(exposed, { runtime });

        assert.deepEqual(bgHandler.exposedData, { foo, prop: 1});
        assert.equal(bgHandler.scriptConnections.size, 0);
    });

    test("should accept connections", async () => {
        let [bgHandler, [bgScript]] = setupScripts({}, [{ name: "test", exposed: {} }]);

        await waitFor(100);

        assert.ok(bgHandler.scriptConnections.has(bgScript.scriptId));
    });

    test("should allow functions to be executed remotely", async () => {

        let variable = 1;
        function setVariable(val) {
            variable = val;
        }
        function getVariable() {
            return variable;
        }

        let shared = { getVariable, setVariable };
        let [bgHandler, [bgScript]] = setupScripts(shared, [{ name: "test", exposed: {} }]);

        // let messages to be passed and everything to be initialized
        await waitFor(100);

        let conn = await bgScript.getConnection();

        assert.equal((await conn.getVariable()), 1);

        await conn.setVariable(2);

        assert.equal(variable, 2);
    });

    test("should allow props to be seen and changed remotely", async () => {
        let shared = { prop: 1 };
        let [bgHandler, [bgScript]] = setupScripts(shared, [{ name: "test", exposed: {} }]);

        await waitFor(100);

        let conn = await bgScript.getConnection();

        assert.equal((await conn.prop), 1);

        await (conn.prop = 2);

        assert.equal((await conn.prop), 2);
    });

    test("should allow multiple scripts to change the same props", async () => {

        let shared = { prop: 1 };
        let [bgHandler, [bgScript, otherScript]] = setupScripts(
            shared,
            [
                { name: "test", exposed: {} },
                { name: "other", exposed: {} }
            ]
        );

        await waitFor(100);

        let conn = await bgScript.getConnection();
        let otherConn = await otherScript.getConnection();

        await (conn.prop = 2);

        assert.equal((await otherConn.prop), 2);

        await (otherConn.prop = 3);

        assert.equal((await conn.prop), 3);
    });

    test("should correctly remove script when it disconnects", async () => {
        let [bgHandler, [bgScript]] = setupScripts({}, [{ name: "test", exposed: {} }]);

        await waitFor(50);

        assert.equal(bgHandler.scriptConnections.size, 1);

        bgScript.disconnectBackgroundScript();

        await waitFor(50);

        assert.equal(bgHandler.scriptConnections.size, 0);
    });
});

describe("The Background Script should", () => {
    test("refuse to connect if the name is a duplicate", async () => {
        let [bgHandler, [bgScript, otherScript]] = setupScripts({}, [
            { name: "test", exposed: {} },
            { name: "test", exposed: {} }
        ]);

        let cb = mock.fn();

        otherScript.addListener("disconnected", cb);

        await waitFor(50);

        assert.equal(cb.mock.callCount(), 1);
        assert.equal(bgHandler.scriptConnections.size, 1);
        assert.equal(otherScript.connection, null);
        assert.notEqual(bgScript.connection, null);
    });

    test("disconnect itself when the window is unloaded", async () => {
        global.window = new MockedWindow();

        let [bgHandler, [bgScript]] = setupScripts({}, [{ name: "test", exposed: {} }]);

        await waitFor(50);

        assert.equal(bgHandler.scriptConnections.size, 1);

        global.window.fireEvent("beforeunload", {});

        await waitFor(50);

        assert.equal(bgHandler.scriptConnections.size, 0);
        assert.equal(bgScript.connection, null);

        // just reset the value for next tests
        global.window = new MockedWindow();
    });
})
