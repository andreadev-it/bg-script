import CustomEventTarget from './CustomEventTarget.js';
import { Connection, CONNECTION_PREFIX, CONNECTION_PREFIX_NOTAB, FRAME_PREFIX, FRAME_SUFFIX, BASE_FRAME } from './Connection.js';
import { BgHandlerErrors as ERRORS, Error } from './Errors';

/* @const CLEANUP_INTERVAL The time it passes between script connections cleanups */
const CLEANUP_INTERVAL = 3000;

/** 
 * Class that will handle all the content scripts that will connect to the background script.
 * 
 * @property {Map<string, Map<string, Connection>>} scriptConnections A Map that will relate every script ID to its Connection object.
 * @property {object} exposedData The properties and methods exposed to the connecting scripts.
 * @property {function} errorCallback A callback that gets fired whenever there is an error in the script. It will get passed some details about the error.
 */
class BackgroundHandler extends CustomEventTarget {

    /**
     * Creates a new Background Handler and starts listening to new connections.
     * 
     * @param {object} exposedData An object containing all properties and methods to be exposed to the content scripts
     * @param {object} options Currently unused. An object that will customize how this class works.
     */
    constructor(exposedData = {}, options = {}) {
        super();
        this.scriptConnections = new Map(); // script-id --> connection frames (map frame -> connection)
        this.exposedData = exposedData;
        this.errorCallback = options.errorCallback ?? null;

        chrome.runtime.onConnect.addListener( (port) => this.handleNewConnection(port) );
        this.initCleanup();
    }

    /**
     * Handle a new incoming connection
     * 
     * @param {chrome.runtime.Port} port The newly created connection to a content script
     */
    handleNewConnection(port) {

        if (!this.isInternalConnection(port)) return;

        let {name, scriptId, frameSrc} = this.parsePortName(port);
        let tabId = port.sender?.tab?.id ?? null;
        if (tabId == -1) tabId = null;

        // If the script id is already taken, terminate the connection and send an error
        if (this.hasConnectedScript(scriptId, frameSrc)) {
            port.disconnect();
            return this.handleError(ERRORS.ID_TAKEN, scriptId);
        }

        // In the background script, there is no tab-id associated
        let connectionOptions = { hasTabId: false };

        let connection = new Connection(port, this.exposedData, connectionOptions);

        connection.addListener("disconnect", () => this.disconnectScript(name, tabId) );

        // Add the connection to this port to the connections map
        this.addConnection(connection, scriptId, frameSrc);

        // Fire the connection event
        this.fireEvent("connectionreceived", {
            scriptId: name,
            tabId
        });
    }

    /**
     * Add a connection to the connections Map
     * @param {Connection} connection The connection to be added
     * @param {string} scriptId The script id
     * @param {string} frameSrc The iframe url
     */
    addConnection(connection, scriptId, frameSrc=BASE_FRAME) {
        let conn_frames = this.scriptConnections.get(scriptId);
        
        if (!conn_frames) {
            conn_frames = new Map();
        }

        conn_frames.set(frameSrc, connection);
        this.scriptConnections.set(scriptId, conn_frames);
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
     * Check if the incoming connection is from a script inside an iframe
     */
    isInFrame(port) {
        return port.name.includes(FRAME_PREFIX);
    }

    /**
     * Parse the port name and extracts a unique identifier (the script id).
     * 
     * @param {chrome.runtime.Port} port The connection
     * @returns {string} The script id
     */
    parsePortName(port) {
        let scriptId, tabId, completeScriptId, frameSrc;

        if (this.isTabAgnostic(port)) {
            scriptId = port.name.substr(CONNECTION_PREFIX_NOTAB.length);
        }
        else {
            scriptId = port.name.substr(CONNECTION_PREFIX.length);
            tabId = port.sender.tab.id;
        }

        if (this.isInFrame(port)) {
            [frameSrc, scriptId] = scriptId.split(FRAME_SUFFIX);
            frameSrc = frameSrc.substr(FRAME_PREFIX.length, frameSrc.length);

        }

        completeScriptId = this.generateScriptId(scriptId, tabId);

        return {
            name: scriptId,
            scriptId: completeScriptId,
            frameSrc
        }
    }

    /**
     * Generate a script id to be used within the connections map
     * 
     * @param {string} name 
     * @param {number} tabId 
     * @returns {string} The generated script id
     */
    generateScriptId(name, tabId) {
        let scriptId = name;
        if (tabId) {
            scriptId += `-${tabId}`;
        }
        return scriptId;
    }

    /**
     * Disconnect a script based on its id 
     * 
     * @param {string} id
     */
    disconnectScript(name, tabId, frameSrc=BASE_FRAME) {
        let id = this.generateScriptId(name, tabId);
        let conn_frames = this.scriptConnections.get(id);
        let conn = conn_frames?.get(frameSrc);

        // Disconnect the script if it hasn't disconnected yet
        if (!conn) {
            return;
        }
        
        conn.disconnect();

        // Remove the script in the connections map
        conn_frames.delete(frameSrc);

        // Delete all iframe connections if the tab has been closed
        if (frameSrc == BASE_FRAME) {
            for (let frame of conn_frames.keys()) {
                conn_frames.get(frame).disconnect();
                conn_frames.delete(frame);
            }
        }

        if (conn_frames.size == 0) {
            this.scriptConnections.delete(id);
        }
        // Fire the disconnection event
        this.fireEvent("connectionended", {
            scriptId: name,
            tabId,
            frameSrc
        });
    }

    /**
     * Get the connection to a script based on its id and the chrome tab that it's associated with.
     * 
     * @async
     * @param {string} scriptId The id of the script to which you want to get a connection
     * @param {string} tabId The id of the chrome tab this scripts relates to
     * @return {Promise<Proxy>} The connection proxy
     */
    async getScriptConnection(scriptId, tabId, frameSrc=BASE_FRAME) {

        let specificScriptId = scriptId;

        if (tabId) specificScriptId += `-${tabId}`;

        let conn_frames = this.scriptConnections.get(specificScriptId);
        let connection = conn_frames?.get(frameSrc);

        if (!connection) {
            this.handleError(ERRORS.NO_CONNECTION, scriptId, tabId);
            return null;
        }

        let proxy = await connection.getProxy();

        return proxy;
    }

    /**
     * Check if a script with a specific id associated to a specific tab has made a connection to the background page.
     * 
     * @param {string} scriptId 
     * @param {string} tabId 
     * @param {string} frameSrc
     * @returns Whether the script is connected
     */
    hasConnectedScript(scriptId, tabId, frameSrc=BASE_FRAME) {
        let specificScriptId = scriptId;

        if (tabId) specificScriptId += `-${tabId}`;

        let conn_frames = this.scriptConnections.get(specificScriptId);
        if (!conn_frames) return false;
        return conn_frames.has(frameSrc);
    }

    /**
     * Init the connections cleanup timer
     */
    initCleanup() {
        this.cleanupInterval = setInterval(() => {
            this.cleanupConnections();
        }, CLEANUP_INTERVAL);
    }

    /**
     * Stop the connections cleanup timer
     */
    stopCleanup() {
        clearInterval(this.cleanupInterval);
    }

    /**
     * Cleanup all connections that only have iframe connections (main tab is closed)
     */
    cleanupConnections() {
        for (let [key, conn_map] of this.scriptConnections) {
            if (!conn_map.get(BASE_FRAME)) {
                for (let [frame, conn] of conn_map) {
                    conn.disconnect();
                }
                this.scriptConnections.delete(key);
            }
        }
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
