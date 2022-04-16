import CustomEventTarget from './CustomEventTarget.js';
import { Connection, CONNECTION_PREFIX, CONNECTION_PREFIX_NOTAB, FRAME_PREFIX, FRAME_SUFFIX } from './Connection.js';

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
    constructor(scriptId, exposedData = {}, options = { context: "content", multipleFrames: false }) {
        super();

        this.scriptId = scriptId ?? this._uuidv4();

        if (options.context === "tab-agnostic" && options.multipleFrames) {
            throw new Error("You cannot use multiple frames with tab-agnostic scripts");
        }

        this.isMultipleFrames = options.multipleFrames;

        this.connection = null;
        this.exposedData = exposedData;
        this.context = options.context ?? "content";

        this.connectBackgroundScript();
    }

    getCompleteScriptId() {
        let completeScriptId = "";

        let con_prefix = CONNECTION_PREFIX;
        let con_prefix_notab = CONNECTION_PREFIX_NOTAB;

        if (this.isMultipleFrames && this.isInsideIframe()) {
            con_prefix += `${FRAME_PREFIX}${location.href}${FRAME_SUFFIX}`;
            con_prefix_notab += `${FRAME_PREFIX}${location.href}${FRAME_SUFFIX}`;
        }

        switch (this.context) {
            case "content":
                completeScriptId = con_prefix + this.scriptId;
                break;
            case "devtools":
                if (!chrome.devtools) throw "Cannot set context='devtools' when the script is not in a devtools window.";
                completeScriptId = con_prefix_notab + this.scriptId + "-" + chrome.devtools.inspectedWindow.tabId;
                break;
            case "tab-agnostic":
                completeScriptId = this.scriptId;
                break;
        }
        
        return completeScriptId;
    }

    /**
     * Function that returns true if the script is running inside an iframe.
     */
    isInsideIframe() {
        try {
            return window.self !== window.top;
        } catch (e) {
            return true;
        }
    }

    /**
     * Creates a connection to the background script based on the script context. It initializes the "connection" property.
     */
    connectBackgroundScript() {

        let completeScriptId = this.getCompleteScriptId();

        let port = chrome.runtime.connect(
            {
                name: completeScriptId
            }
        );

        this.connection = new Connection(port, this.exposedData);
        
        this.connection.addListener("disconnect", () => {
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
