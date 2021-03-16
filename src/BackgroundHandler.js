import { Connection, CONNECTION_PREFIX, CONNECTION_PREFIX_NOTAB } from './Connection.js';
import { BgHandlerErrors as ERRORS, Error } from './Errors';

/** 
 * Class that will handle all the content scripts that will connect to the background script.
 * 
 * @property {Map<string, Connection>} scriptConnections A Map that will relate every script ID to its Connection object.
 * @property {object} exposedData The properties and methods exposed to the connecting scripts.
 * @property {function} errorCallback A callback that gets fired whenever there is an error in the script. It will get passed some details about the error.
 */
class BackgroundHandler {

    /**
     * Creates a new Background Handler and starts listening to new connections.
     * 
     * @param {object} exposedData An object containing all properties and methods to be exposed to the content scripts
     * @param {object} options Currently unused. An object that will customize how this class works.
     */
    constructor(exposedData = {}, options = {}) {
        this.scriptConnections = new Map(); // script-id --> connection
        this.exposedData = exposedData;
        this.errorCallback = options.errorCallback ?? null;

        chrome.runtime.onConnect.addListener( (port) => this.handleNewConnection(port) );
    }

    /**
     * Handle a new incoming connection
     * 
     * @param {chrome.runtime.Port} port The newly created connection to a content script.
     */
    handleNewConnection(port) {

        if (!this.isInternalConnection(port)) return;

        let scriptId = "";

        if (this.isTabAgnostic(port)) {
            scriptId = port.name.substr(CONNECTION_PREFIX_NOTAB.length);
        }
        else {
            scriptId = port.name.substr(CONNECTION_PREFIX.length);
            let tabId = port.sender.tab.id;
            scriptId += `-${tabId}`;
        }

        if (this.scriptConnections.get(scriptId)) return this.handleError(ERRORS.ID_TAKEN, scriptId);

        // In the background script, there is no tab-id associated
        let connectionOptions = { hasTabId: false };

        let connection = new Connection(port, this.exposedData, connectionOptions);

        connection.addListener("disconnect", () => this.disconnectScript(scriptId) );

        this.scriptConnections.set(scriptId, connection);
    }

    /**
     * Checks if the connection was initialized from this library
     * 
     * @param {chrome.runtime.Port} port The connection 
     */
    isInternalConnection(port) {
        return port.name.startsWith(CONNECTION_PREFIX) ||
               port.name.startsWith(CONNECTION_PREFIX_NOTAB);
    }

    /**
     * Check if the connection should not be related to any chrome tab
     * 
     * @param {chrome.runtime.Port} port The connection
     */
    isTabAgnostic(port) {
        return port.name.startsWith(CONNECTION_PREFIX_NOTAB);
    }

    /**
     * Disconnect a script based on its id 
     * 
     * @param {string} id
     */
    disconnectScript(id) {
        this.scriptConnections.delete(id);
    }

    /**
     * Get the connection to a script based on its id and the chrome tab that it's associated with.
     * 
     * @async
     * @param {string} scriptId The id of the script to which you want to get a connection
     * @param {string} tabId The id of the chrome tab this scripts relates to
     * @return {Promise<Proxy>} The connection proxy
     */
    async getScriptConnection(scriptId, tabId) {

        let specificScriptId = scriptId;

        if (tabId) specificScriptId += `-${tabId}`;

        let connection = this.scriptConnections.get(specificScriptId);

        if (!connection) {
            this.handleError(ERRORS.NO_CONNECTION, scriptId, tabId);
            return null;
        }

        let proxy = await connection.getProxy();

        return proxy;
    }
    /**
     * Handle the errors thrown within the class
     * 
     * @param {Error} error 
     * @param  {...any} args 
     * @returns 
     */
    handleError(error, ...args) {
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