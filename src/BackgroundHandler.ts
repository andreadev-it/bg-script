import { CustomEventTarget } from '@andreadev/custom-event-target';
import { Connection, CONNECTION_PREFIX, CONNECTION_PREFIX_NOTAB } from './Connection.js';
import { BgHandlerErrors as ERRORS, Error } from './Errors.js';
import { ChromeTabs, Runtime, Storage, waitForNextTask } from './utilities.js';

const STORED_CONNECTIONS_KEY = "bgscript.connections";

type ErrorData = {
    errorId: string;
    error: string;
};

/** 
 * Class that will handle all the content scripts that will connect to the background script.
 */
class BackgroundHandler extends CustomEventTarget {
    public scriptConnections: Map<string, Connection>;
    public exposedData: any;
    public errorCallback: (data: ErrorData) => void | null;
    private runtime: Runtime;
    private storage: Storage;
    private chromeTabs: ChromeTabs;
    private isRestoringConnections: boolean;

    /**
     * Creates a new Background Handler and starts listening to new connections.
     */
    constructor(exposedData: any = {}, options: any = {}) {
        super();
        
        this.scriptConnections = new Map(); // script-id --> connection
        this.exposedData = exposedData;
        this.errorCallback = options.errorCallback ?? null;

        // Useful for mocking tests
        this.runtime = options.runtime ?? chrome.runtime;
        this.storage = options.storage ?? chrome.storage;
        this.chromeTabs = options.chromeTabs ?? chrome.tabs;

        this.isRestoringConnections = false;

        this.runtime.onConnect.addListener( (port) => this.handleNewConnection(port) );

        this.restoreConnections();
    }

    /**
     * Restore all the connections that were saved in the storage.
     */
    async restoreConnections() {
        console.log("Restoring scripts connections");
        this.isRestoringConnections = true;

        let data = await this.storage.local.get(STORED_CONNECTIONS_KEY);
        let connected = [];
        
        if (data[STORED_CONNECTIONS_KEY]) {
            let connections = data[STORED_CONNECTIONS_KEY];

            for (let [scriptId, tab] of connections) {
                try {
                    await this.chromeTabs.sendMessage(tab, { 
                        type: CONNECTION_PREFIX + "ping",
                        scriptId
                    });

                    connected.push([scriptId, tab]);
                } catch {
                    console.log(`Could not connect to tab ${tab}. Skipping.`);
                }
            }
        }

        await this.storage.local.set({ [STORED_CONNECTIONS_KEY]: connected });

        this.isRestoringConnections = false;
        console.log("Finished restoring connections");
    }

    /**
     * Waits for all connections to be restored. Useful to avoid returning
     * the wrong number of connections from the "getScriptConnection" of
     * "getScriptTabs" functions.
     */
    async waitForRestoration() : Promise<void> {
        while (this.isRestoringConnections) {
            await waitForNextTask();
        }
    }

    /**
     * Save the current connections in the storage
     */
    async saveConnections() {
        let conns = [];
        for (let [scriptId, _] of this.scriptConnections) {
            let [name, tabId] = scriptId.split("-");
            conns.push([name, parseInt(tabId)]);
        }

        await this.storage.local.set({ [STORED_CONNECTIONS_KEY]: conns });
    }

    /**
     * Handle a new incoming connection
     */
    async handleNewConnection(port: chrome.runtime.Port) {

        if (!this.isInternalConnection(port)) return;

        let [name, scriptId] = this.parsePortName(port);
        let tabId = port.sender?.tab?.id ?? null;
        if (tabId == -1) tabId = null;

        // If the script id is already taken, terminate the connection and send an error
        if (this.scriptConnections.get(scriptId)) {
            port.disconnect();
            return this.handleError(ERRORS.ID_TAKEN, scriptId);
        }

        // In the background script, there is no tab-id associated
        let connectionOptions = { hasTabId: false };

        let connection = new Connection(port, this.exposedData, connectionOptions);

        // TODO: Check if I have to set the script connection to null on this event
        // see BackgroundScript.js:68
        connection.addListener("disconnect", () => this.disconnectScript(name, tabId) );

        this.scriptConnections.set(scriptId, connection);
        await this.saveConnections();

        // Fire the connection event
        this.fireEvent("connectionreceived", {
            scriptId: name,
            tabId
        });
    }

    /**
     * Checks if the connection was initialized from this library
     */
    isInternalConnection(port: chrome.runtime.Port) {
        return port.name.startsWith(CONNECTION_PREFIX) ||
               port.name.startsWith(CONNECTION_PREFIX_NOTAB);
    }

    /**
     * Check if the connection should not be related to any chrome tab
     */
    isTabAgnostic(port: chrome.runtime.Port) {
        return port.name.startsWith(CONNECTION_PREFIX_NOTAB);
    }

    /**
     * Parse the port name and extracts a unique identifier (the script id).
     * @returns The script id as was set in the content script, and the complete id
     */
    parsePortName(port: chrome.runtime.Port) : [string, string] {
        let scriptId: string;
        let tabId = null;
        let completeScriptId: string;

        if (this.isTabAgnostic(port)) {
            scriptId = port.name.substr(CONNECTION_PREFIX_NOTAB.length);
        }
        else {
            scriptId = port.name.substr(CONNECTION_PREFIX.length);
            tabId = port?.sender?.tab?.id ?? null;
        }

        completeScriptId = this.generateScriptId(scriptId, tabId);

        return [scriptId, completeScriptId];
    }

    /**
     * Generate a script id to be used within the connections map
     */
    generateScriptId(name: string, tabId: number | null) : string {
        let scriptId = name;
        if (tabId) {
            scriptId += `-${tabId}`;
        }
        return scriptId;
    }

    /**
     * Disconnect a script based on its id 
     */
    disconnectScript(name: string, tabId: number | null) {
        let id = this.generateScriptId(name, tabId);
        let conn = this.scriptConnections.get(id);

        // Disconnect the script if it hasn't disconnected yet
        if (conn) {
            conn.disconnect();
        }
        
        // Remove the script in the connections map
        this.scriptConnections.delete(id);
        // Fire the disconnection event
        this.fireEvent("connectionended", {
            scriptId: name,
            tabId
        });
    }

    /**
     * Get the connection to a script based on its id and the chrome tab that it's associated with.
     */
    async getScriptConnection(scriptId: string, tabId: number) : Promise<ProxyHandler<{}> | null> {

        await this.waitForRestoration();

        let specificScriptId = scriptId;

        if (tabId) specificScriptId += `-${tabId}`;

        let connection = this.scriptConnections.get(specificScriptId);

        if (!connection) {
            this.handleError(ERRORS.NO_CONNECTION, scriptId, tabId);
            return null;
        }

        let proxy = await connection.getProxy() as ProxyHandler<{}>;

        return proxy;
    }

    /**
     * Get all tab ids where a specific scriptId is present.
     */
    async getScriptTabs(scriptId: string) : Promise<number[]> {
        await this.waitForRestoration();

        let tabs = [];
        for (let [id, connection] of this.scriptConnections) {
            if (id.startsWith(scriptId)) {
                if (connection.port.sender?.tab?.id) {
                    tabs.push(connection.port.sender.tab.id);
                }
            }
        }
        return tabs;
    }

    /**
     * Check if a script with a specific id associated to a specific tab has made a connection to the background page.
     */
    hasConnectedScript(scriptId: string, tabId: number) : boolean {
        let specificScriptId = scriptId;

        if (tabId) specificScriptId += `-${tabId}`;

        return this.scriptConnections.has(specificScriptId);
    }

    /**
     * Handle the errors thrown within the class
     * 
     * @param {Error} error 
     * @param  {...any} args 
     * @returns 
     */
    handleError(error: Error, ...args: any[]) {
        if (this.errorCallback) {
            this.errorCallback({
                errorId: error.id,
                error: error.getText(...args)
            });

            return;
        }

        console.error(error.getText(...args));
    }
}

export default BackgroundHandler;
