import { describe, test } from "node:test";
import assert from "node:assert";
import Connection, { MESSAGE_TYPES } from "../src/Connection.js";
import { getMockedPortPair } from "./mocks/mockedPort.js";


describe("A Connection", () => {
    test("Should correctly parse properties and methods", () => {
        const [mockedPort, _] = getMockedPortPair("test");

        const foo = () => {};
        const bar = () => {};

        const conn = new Connection(mockedPort, {
            foo,
            bar,
            prop: 1,
            otherProp: "hello, world",
            then: () => {},
            $getMyTabId: () => 1
        });
        
        assert.ok(conn.exposedProps.has("prop"), "Properties were not parsed correctly");
        assert.ok(conn.exposedProps.has("otherProp"), "Properties were not parsed correctly");

        assert.ok(conn.exposedMethods.has("foo"), "Methods were not parsed correctly");
        assert.ok(conn.exposedMethods.has("bar"), "Methods were not parsed correctly");
    });

    test("Should correctly parse options", () => {
        const [mockedPort, _] = getMockedPortPair("test");

        const conn = new Connection(mockedPort, {}, {
            hasTabId: false
        })

        assert.equal(conn.hasTabId, false);
    });

    test("Should fire disconnection event when port disconnects", { timeout: 1000 }, () => {
        return new Promise((resolve, _reject) => {
            const [mockedPort, otherPort] = getMockedPortPair("test");

            const conn = new Connection(mockedPort, {});
            conn.addListener("disconnect", resolve);

            otherPort.disconnect();
        })
    });
    
    test("Should initialize a connection correctly", { timeout: 1000 } ,() => {
        return new Promise((resolve, _reject) => {
            const [mockedPort, otherPort] = getMockedPortPair("test");

            const exposed = {
                foo: () => {},
                bar: () => {},
                prop: 1
            }
            const conn = new Connection(mockedPort, exposed);

            const bgExposed = {
                bgFoo: () => {},
                prop: 2
            };
            const bgConn = new Connection(otherPort, bgExposed);

            otherPort.onMessage.addListener((msg) => {
                assert.equal(msg.type, MESSAGE_TYPES.BOOTSTRAP);
                assert.deepEqual(msg.exposedMethods, ["foo", "bar"]);
                assert.equal(conn.waitingRequests.size, 1);
            });

            mockedPort.onMessage.addListener((msg) => {
                assert.equal(msg.type, MESSAGE_TYPES.BOOTSTRAPANSWER);
                assert.deepEqual(msg.exposedMethods, ["bgFoo"]);
            });

            conn.initConnection(() => {
                assert.equal(conn.waitingRequests.size, 0)

                resolve();
            });
        });
    });
})
