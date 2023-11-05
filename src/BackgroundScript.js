import CustomEventTarget from './CustomEventTarget.js';
import { Connection, CONNECTION_PREFIX, CONNECTION_PREFIX_NOTAB } from './Connection.js';

/** 
 * Class that will handle the connection from a content script to the background script
 * 
 * @property {string} scriptId A string that uniquely identifies this script file (could be in the context of a chrome tab or globally, depending on the context property).
 * @property {Object} exposedData An object containing all properties and methods to be exposed to the background script.
 * @property {Connection} connection The actual connection object that handles the communications with the background script.
 * @property {string} context The context of this script. 
 */
class BackgroundScript extends CustomEventTarget {

    /**
     * It creates a new Background Script class and initialize all the class properties. It will also bootstrap the actual connection.
     * 
     * @param {string} scriptId A unique ID to identify this script
     * @param {Object} exposedData An object containing all properties and methods to be exposed to the background script
     * @param {Object} options
     * @param {string} options.context The context of this content script. It can have three values:
     *                                     "content" - To be used in content scripts.
     *                                     "devtools" - To be used in scripts that run from the devtools.
     *                                     "tab-agnostic" - To be used in scripts that are not related to any tab, and are unique in your extension.
     */
    constructor(scriptId, exposedData = {}, options = { context: "content", runtime: chrome.runtime }) {
        super();

        this.scriptId = scriptId ?? this._uuidv4();
        this.connection = null;
        this.exposedData = exposedData;
        this.context = options.context ?? "content";
        this.runtime = options.runtime ?? chrome.runtime;

        this.connectBackgroundScript();
    }

    /**
     * Creates a connection to the background script based on the script context. It initializes the "connection" property.
     */
    connectBackgroundScript() {

        let completeScriptId = "";

        switch (this.context) {
            case "content":
                completeScriptId = CONNECTION_PREFIX + this.scriptId;
                break;
            case "devtools":
                if (!chrome.devtools) throw "Cannot set context='devtools' when the script is not in a devtools window.";
                completeScriptId = CONNECTION_PREFIX_NOTAB + this.scriptId + "-" + chrome.devtools.inspectedWindow.tabId;
                break;
            case "tab-agnostic":
                completeScriptId = this.scriptId;
                break;
        }

        let port = this.runtime.connect(
            {
                name: completeScriptId
            }
        );

        this.connection = new Connection(port, this.exposedData);
        
        this.connection.addListener("disconnect", () => {
            // TODO: Check if I should set the connection to null to avoid
            // wrong call to port.disconnect in the next function
            this.connection = null;
            this.disconnectBackgroundScript();
        });

        window.addEventListener("beforeunload", () => {
            this.disconnectBackgroundScript();
        });

        this.fireEvent("connected", {});
    }

    /**
     * Function to disconnect this script
     */
    disconnectBackgroundScript() {
        if (this.connection) {
            this.connection.disconnect();
        }

        this.connection = null;
        this.fireEvent("disconnected", {});
    }

    /**
     * Function to retrieve the connection proxy.
     * 
     * @async
     * @return {Promise<Proxy>}
     */
    async getConnection() {

        if (!this.connection) {
            this.connectBackgroundScript();
        }

        let proxy = await this.connection.getProxy();
        return proxy;
    }

    /**
     * Function that returns a uuid version 4 formatted string.
     * 
     * @return {string} the id.
     */
    _uuidv4() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}

export default BackgroundScript;
