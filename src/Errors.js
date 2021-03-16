export class Error {

    /**
     * Creates a new Error with a specific id and a function that will return useful informations
     * 
     * @constructor
     * @param {string} id A readable id for the error
     * @param {function} getTextCallback A function that will return a description text for this error.
     */
    constructor( id, getTextCallback ) {
        this.id = id;
        this.getTextCallback = getTextCallback;
    }

    /**
     * Get the error description text
     * 
     * @param  {...any} args
     * @returns {string} The description of this error 
     */
    getText(...args) {
        return this.getTextCallback(...args);
    }
}

export const BgHandlerErrors = {
    ID_TAKEN: new Error('ID_TAKEN', (id) => `The id '${id}' has already been taken. It must be unique.` ),
    NO_CONNECTION: new Error('NO_CONNECTION', (scriptId, tabId) => `There is no connection assigned to id '${scriptId}'${(tabId) ? ` connected to the tab ${tabId}` : ''}.`)
};